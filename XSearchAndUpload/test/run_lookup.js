// Response handling, retries, account limits, the only= filter, queue order, toasts.
// node run_lookup.js [variant,..] [scenario,..]
const fs = require('fs');
const path = require('path');
const {readScript} = require('./script.js');
const {chromium, newPage, colors, sleep} = require('./h.js');
const variants = (process.argv[2] || 'current').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;

const TAG_LIMIT_BODY = (n) => JSON.stringify({success: false, error: 'PostQuery::TagLimitError',
  message: `You cannot search for more than ${n} tags at a time.`, backtrace: []});
const ANON = {id: null, name: 'Anonymous', level: 0, level_string: null, tag_query_limit: 2, enable_safe_mode: false};
const MEMBER = {id: 1, name: 'tester', level: 20, tag_query_limit: 3, enable_safe_mode: false};
const GOLD = {id: 2, name: 'gold', level: 30, tag_query_limit: null, enable_safe_mode: false};
const LOGIN_TEXT = 'Not logged in to Danbooru – lookups limited';
const SAFE_TEXT = 'Danbooru safe mode is on – only rating:g posts are visible';
const BLOCKED_TEXT = 'Danbooru blocked the request – open Danbooru once';

// Injects the variant; with expose, the caches are published on window (in memory only).
async function inject(page, v, {expose = false} = {}) {
  let src = readScript(v);
  if (expose) {
    const anchor = 'const hashCache = Object.create(null);';
    if (!src.includes(anchor)) {
      throw new Error('expose anchor missing');
    }
    src = src.replace(anchor, anchor + ' window.__tc = tweetCache; window.__hc = hashCache;');
  }
  await page.evaluate(() => {
    window.__t0 = performance.now();
  });
  await page.addScriptTag({content: src});
}

async function setup(browser, {store = {}, profile = MEMBER, urlPath = '/home', online = true} = {}) {
  const r = await newPage(browser, {store, urlPath});
  r.popups = [];
  r.ctx.on('page', (p) => r.popups.push(p.url()));
  await r.page.evaluate(([profile, online]) => {
    const m = document.createElement('meta');
    m.name = 'viewport';
    m.content = 'width=device-width, initial-scale=1';
    document.head.appendChild(m);
    window.__profile = profile;
    window.__online = online;
    Object.defineProperty(Navigator.prototype, 'onLine', {configurable: true, get: () => window.__online});
    window.setVis = (hidden) => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
      Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => (hidden ? 'hidden' : 'visible')});
      document.dispatchEvent(new Event('visibilitychange'));
    };
    window.returnToTab = () => {
      window.setVis(true);
      window.setVis(false);
    };
    // Every request (profile included): send/answer time, kind, number of search terms; max in flight.
    const orig = window.GM_xmlhttpRequest;
    window.__log = [];
    window.__inflight = 0;
    window.__maxInflight = 0;
    window.GM_xmlhttpRequest = (d) => {
      const url = decodeURIComponent(d.url);
      const now = () => Math.round(performance.now() - (window.__t0 || 0));
      const rec = {t: now(), url, kind: url.includes('profile.json') ? 'profile' : url.includes('media/') ? 'hash' : 'tweet',
        terms: (url.match(/source:/g) || []).length, done: null};
      window.__log.push(rec);
      window.__inflight++;
      window.__maxInflight = Math.max(window.__maxInflight, window.__inflight);
      const end = (fn) => (x) => {
        window.__inflight--;
        rec.done = now();
        rec.status = x && x.status;
        if (fn) {
          fn(x);
        }
      };
      const send = () => orig(Object.assign({}, d, {onload: end(d.onload), onerror: end(d.onerror), ontimeout: end(d.ontimeout)}));
      // __profileDelay: ms the account check takes beyond the stub's 50 ms (a slow /profile.json).
      if (rec.kind === 'profile' && window.__profileDelay) {
        setTimeout(send, window.__profileDelay);
      } else {
        send();
      }
    };
    window.reqs = (kind) => window.__log.filter((x) => !kind || x.kind === kind);
    // Toasts as shown, polled every 50 ms.
    window.__toasts = [];
    let last = '';
    setInterval(() => {
      const t = document.querySelector('.xdsu-toast');
      const vis = t && getComputedStyle(t).display !== 'none' ? t.textContent : '';
      if (vis && vis !== last) {
        window.__toasts.push(vis);
      }
      last = vis;
    }, 50);
    window.__warns = [];
    const w = console.warn;
    console.warn = (...a) => {
      window.__warns.push(a.join(' '));
      w.apply(console, a);
    };
    window.sample = (artId) => {
      const names = {'rgb(154, 154, 154)': 'GREY', 'rgb(26, 140, 26)': 'GREEN', 'rgb(126, 201, 126)': 'LGREEN',
        'rgb(229, 57, 53)': 'RED', 'rgb(61, 78, 232)': 'BLUE'};
      const out = {seq: [], pulse: false};
      out.iv = setInterval(() => {
        const segs = [...document.querySelectorAll(`#${artId} .xdsu-bar-seg`)];
        const c = segs.map((s) => names[window.segColor(s)] || window.segColor(s)).join(',');
        if (segs.some((s) => s.classList.contains('xdsu-rechecking'))) {
          out.pulse = true;
        }
        if (c && out.seq[out.seq.length - 1] !== c) {
          out.seq.push(c);
        }
      }, 10);
      return out;
    };
  }, [profile, online]);
  return r;
}

async function fin(r, pass, extra = '', ignoreErr = null) {
  const {page, errors} = r;
  const log = await page.evaluate(() => window.__log.map((x) => `${x.t}${x.kind === 'profile' ? ' profile'
    : ' ' + x.kind + '/' + x.terms}${x.status && x.status !== 200 ? ':' + x.status : ''}`));
  const max = await page.evaluate(() => window.__maxInflight);
  const unh = await page.evaluate(() => window.__unhandled);
  const errs = errors.filter((e) => !e.includes('Failed to load resource') && !(ignoreErr && ignoreErr.test(e)));
  await page.context().close();
  return {pass: pass && max <= 1 && !errs.length && !unh.length,
    detail: `${extra} | maxInFlight=${max} | reqs(${log.length})=${JSON.stringify(log)}`
      + (unh.length ? ` | unhandled=${JSON.stringify(unh)}` : '') + (errs.length ? ` | errors=${JSON.stringify(errs)}` : '')};
}

const addN = (page, ids, prefix = 'H') => page.evaluate(([ids, prefix]) => ids.forEach((id) => window.add({id, hashes: [prefix + id]})), [ids, prefix]);
const range = (a, n) => Array.from({length: n}, (_, i) => String(a + i));
const flat = (c) => c.flat().join(',');
const allAre = (c, set) => c.flat().length > 0 && c.flat().every((x) => set.includes(x));
const RESOLVED = ['RED', 'GREEN', 'LGREEN'];

// The stored account check (desktop task T3): key, the base URL the script uses by default, and a
// stored value as the script writes it (a JSON string) for a check made ageMs ago, Gold unless o
// says otherwise.
const ACCOUNT_KEY = 'accountCheck';
const HOST = 'https://danbooru.donmai.us/';
const MIN = 60 * 1000;
const acct = (o = {}, ageMs = MIN) => JSON.stringify(Object.assign(
    {host: HOST, at: Date.now() - ageMs, batch: 6, anonymous: false, safeMode: false}, o));
// Resolves true once fn(arg) is truthy in the page, false after ms.
const waitUntil = (page, fn, arg, ms) => page.waitForFunction(fn, arg, {timeout: ms, polling: 20}).then(() => true, () => false);
// Every segment has left grey and no request is in flight (the hash lookups that follow red tweet
// lookups run in the same flush, so nothing is in flight only once they have answered).
const allResolved = () => {
  const s = [...document.querySelectorAll('.xdsu-bar-seg')];
  return s.length > 0 && s.every((x) => window.segColor(x) !== 'rgb(154, 154, 154)') && window.__inflight === 0;
};
// Account checks as [sent, answered] (ms since injection) and the first tweet lookup.
const startLog = (page) => page.evaluate(() => {
  const f = window.reqs('tweet')[0];
  return {p: window.reqs('profile').map((x) => [x.t, x.done]), first: f ? {t: f.t, terms: f.terms} : null};
});
const fmtStart = (s) => `account checks [sent, answered]=${JSON.stringify(s.p)}`
  + ` first lookup=${s.first ? `${s.first.t} ms, ${s.first.terms} terms` : 'none'}`;

// A tab started with the given store, the server answering profile: did it make a real account
// check (one, answered before the first lookup, whose batch size the first lookup uses)?
async function startsWithCheck(browser, v, store, {profile = MEMBER, terms = 3, first = 6201} = {}) {
  const r = await setup(browser, {store, profile});
  await addN(r.page, range(first, 6));
  await inject(r.page, v);
  const done = await waitUntil(r.page, allResolved, null, 8000);
  const s = await startLog(r.page);
  const toasts = await r.page.evaluate(() => window.__toasts.slice());
  const stored = await r.page.evaluate((k) => window.__store[k], ACCOUNT_KEY);
  const ok = done && s.p.length === 1 && s.p[0][1] !== null && !!s.first && s.first.t >= s.p[0][1] && s.first.terms === terms;
  const f = await fin(r, ok, fmtStart(s) + (done ? '' : ' (not resolved in 8 s)'));
  return Object.assign(f, {toasts, stored});
}

// At least n segments, none grey, nothing in flight.
const resolvedN = (n) => {
  const s = [...document.querySelectorAll('.xdsu-bar-seg')];
  return s.length >= n && s.every((x) => window.segColor(x) !== 'rgb(154, 154, 154)') && window.__inflight === 0;
};

// A visible tab makes its own account check (the server answers profile) and resolves 3 tweets.
// Then Date.now is stepped by stepMs, another tab stores a check (a normal Gold one changed by o,
// made agoMs before the stepped now, or fromOwnMs after this tab's own check when given) and the
// tab returns; 6 tweets are added after that. With checkFails, account checks fail (network
// error) from the return on. Reports the account checks before the return and in all, the terms
// of the first lookup of an added tweet and detectedBatch.
async function returnCase(browser, v, {profile = MEMBER, stepMs = 0, o = {}, agoMs = 1000, fromOwnMs = null,
  checkFails = false, first}) {
  const r = await setup(browser, {profile});
  await r.page.evaluate(() => {
    const realNow = Date.now;
    window.__dnOff = 0;
    Date.now = () => realNow() + window.__dnOff;
  });
  await addN(r.page, range(first, 3));
  await inject(r.page, v);
  const done = await waitUntil(r.page, resolvedN, 3, 8000);
  const before = await r.page.evaluate(() => window.reqs('profile').length);
  const seeded = await r.page.evaluate(([k, host, o, stepMs, agoMs, fromOwnMs, checkFails]) => {
    if (checkFails) {
      window.__profile = 'fail';
    }
    let own = null;
    try {
      own = JSON.parse(window.__store[k]).at;
    } catch {
      own = null;
    }
    window.__dnOff += stepMs;
    const at = fromOwnMs === null ? Date.now() - agoMs : own + fromOwnMs;
    window.__store[k] = JSON.stringify(Object.assign({host, at, batch: 6, anonymous: false, safeMode: false}, o));
    window.returnToTab();
    return window.__store[k];
  }, [ACCOUNT_KEY, HOST, o, stepMs, agoMs, fromOwnMs, checkFails]);
  // Fixed: 1 s. The visibilitychange handler sends a check at once if it sends one (answered in
  // 50 ms); the tweets are added only after it.
  await sleep(1000);
  const added = range(first + 3, 6);
  await addN(r.page, added);
  const done2 = await waitUntil(r.page, resolvedN, 9, 8000);
  const s = await r.page.evaluate((ids) => {
    const firstNew = window.reqs('tweet').find((x) => ids.some((id) => x.url.includes(`status/${id}*`)));
    return {checks: window.reqs('profile').length, terms: firstNew ? firstNew.terms : null, batch: window.__store.detectedBatch};
  }, added);
  const f = await fin(r, done && done2, `stored by the other tab=${seeded} | account checks before the return=${before},`
    + ` in all=${s.checks} | first lookup of an added tweet: ${s.terms} terms | detectedBatch=${s.batch}`
    + (done && done2 ? '' : ' (not resolved in 8 s)'));
  return Object.assign(f, {before, checks: s.checks, terms: s.terms, batch: s.batch});
}

const S = {
  // ---------- T08 ----------
  // S8: server allows 2 terms, batch pinned at 3 (profile check fails, stored 3).
  async s8_tag_limit(browser, v) {
    const r = await setup(browser, {profile: 'fail', store: {detectedBatch: 3}});
    await r.page.evaluate((body) => {
      window.__responder = (u) => ((u.match(/source:/g) || []).length > 2 ? {status: 422, body} : {body: '[]'});
    }, TAG_LIMIT_BODY(2));
    await addN(r.page, range(800, 9));
    await inject(r.page, v);
    await sleep(15000);
    const c = await colors(r.page);
    const t = await r.page.evaluate(() => window.reqs('tweet').map((x) => x.terms));
    return fin(r, allAre(c, ['RED']) && t.length <= 6 && t[0] === 3,
        `colours=${flat(c)} tweet lookups=${t.length} terms=${JSON.stringify(t)}`);
  },
  // A 500 on the first batch: the other tweets still resolve within ~3 s.
  async t08_500_one_batch(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__resolved = {};
      window.__responder = (u) => {
        const tags = u.split('tags=')[1];
        if (!window.__failTags && tags.includes('status/')) {
          window.__failTags = tags;
        }
        return tags === window.__failTags ? {status: 500, body: 'oops'} : {body: '[]'};
      };
      setInterval(() => document.querySelectorAll('article').forEach((a) => {
        const s = a.querySelector('.xdsu-bar-seg');
        if (s && window.segColor(s) === 'rgb(229, 57, 53)' && !window.__resolved[a.id]) {
          window.__resolved[a.id] = Math.round(performance.now() - window.__t0);
        }
      }), 20);
    });
    await addN(r.page, range(2101, 6));
    await inject(r.page, v);
    await sleep(14000);
    const s = await r.page.evaluate(() => ({fail: window.__failTags, resolved: window.__resolved}));
    const failIds = (s.fail.match(/status\/(\d+)/g) || []).map((x) => 't' + x.split('/')[1]);
    const others = Object.keys(await r.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('article')].map((a) => [a.id, 1]))))
        .filter((id) => !failIds.includes(id));
    const times = others.map((id) => s.resolved[id] || null);
    const c = await colors(r.page);
    const pass = times.every((t) => t !== null && t <= 3500);
    return fin(r, pass, `failing batch=${failIds} others resolved at ms=${JSON.stringify(times)} colours=${flat(c)}`);
  },
  // 429: keys go back to the queue, 60 s pause without timer spin, then they resolve.
  async t08_429_pause(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__first = true;
      window.__responder = () => {
        if (window.__first) {
          window.__first = false;
          return {status: 429, body: ''};
        }
        return {body: '[]'};
      };
      const st = window.setTimeout;
      window.__t250 = [];
      window.setTimeout = function(fn, ms, ...a) {
        if (ms === 250) {
          window.__t250.push(Math.round(performance.now() - window.__t0));
        }
        return st.call(window, fn, ms, ...a);
      };
    });
    await addN(r.page, range(2201, 3));
    await inject(r.page, v);
    await sleep(30000);
    const mid = await r.page.evaluate(() => ({c: [...document.querySelectorAll('.xdsu-bar-seg')].map((s) => window.segColor(s)),
      n: window.reqs('tweet').length, first: window.reqs('tweet')[0]}));
    await sleep(35000);
    const end = await r.page.evaluate(() => ({log: window.reqs('tweet').map((x) => x.t), t250: window.__t250}));
    const c = await colors(r.page);
    const t429 = mid.first ? mid.first.done : 0;
    const spin = end.t250.filter((t) => t > t429 + 100 && t < t429 + 59000).length;
    const second = end.log[1];
    const pass = mid.n === 1 && mid.c.every((x) => x === 'rgb(154, 154, 154)') && second >= t429 + 59000
      && second <= t429 + 62000 && allAre(c, ['RED']) && spin === 0;
    return fin(r, pass, `429 answered at ${t429} ms; tweet lookups by 30 s=${mid.n}, grey at 30 s=${mid.c.every((x) => x === 'rgb(154, 154, 154)')};`
      + ` next tweet lookup at ${second} ms; 250 ms timers during pause=${spin}; colours=${flat(c)}`);
  },
  // 401/403: reason blocked, queue emptied, one toast, no timer retry (>30 s); a return retries once.
  async t08_t09_blocked(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => (window.__healthy ? {body: '[]'} : {status: 403, body: '<html>Just a moment...</html>'});
    });
    await addN(r.page, range(2301, 7));
    await inject(r.page, v);
    await sleep(3000);
    const a = await r.page.evaluate(() => ({n: window.reqs('tweet').length + window.reqs('hash').length}));
    const ca = await colors(r.page);
    await sleep(33000);
    const b = await r.page.evaluate(() => window.reqs('tweet').length + window.reqs('hash').length);
    await r.page.evaluate(() => window.returnToTab());
    await sleep(3000);
    const c1 = await r.page.evaluate(() => window.reqs('tweet').length);
    await r.page.evaluate(() => {
      window.__healthy = true;
      window.returnToTab();
    });
    await sleep(4000);
    const cEnd = await colors(r.page);
    const toasts = await r.page.evaluate(() => window.__toasts);
    const blockedToasts = toasts.filter((t) => t === BLOCKED_TEXT).length;
    const pass = a.n === 1 && allAre(ca, ['BLUE']) && b === 1 && c1 === 2 && allAre(cEnd, ['RED']) && blockedToasts === 1;
    return fin(r, pass, `requests by 3 s=${a.n} colours=${flat(ca)}; by 36 s=${b}; after 1st return (still 403) tweet lookups=${c1};`
      + ` after 2nd return (healthy) colours=${flat(cEnd)}; toasts=${JSON.stringify(toasts)}`);
  },
  // Other 4xx: reason client, no retry (also not on the 30 s timer), one console.warn.
  async t08_client_4xx(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = (u) => (u.includes('status/') ? {status: 400, body: JSON.stringify({success: false, error: 'BadRequest', message: 'nope'})} : {body: '[]'});
    });
    await addN(r.page, range(2401, 6));
    await inject(r.page, v);
    await sleep(36000);
    const n = await r.page.evaluate(() => window.reqs('tweet').length);
    const warns = await r.page.evaluate(() => window.__warns.filter((w) => w.includes('[XDSU]')));
    const c = await colors(r.page);
    return fin(r, n === 2 && allAre(c, ['BLUE']) && warns.length === 1, `tweet lookups in 36 s=${n} colours=${flat(c)} warns=${JSON.stringify(warns)}`);
  },
  // 2xx with a non-array body (maintenance page): reason server, no immediate retry.
  async t08_nonarray(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => ({body: '<html>Downbooru</html>'});
    });
    await addN(r.page, range(2501, 3));
    await inject(r.page, v);
    await sleep(6000);
    const n = await r.page.evaluate(() => window.reqs('tweet').length);
    const c = await colors(r.page);
    return fin(r, n === 1 && allAre(c, ['BLUE']), `tweet lookups in 6 s=${n} colours=${flat(c)}`);
  },
  // Offline: no request (lookup or profile) until 'online'.
  async t08_offline(browser, v) {
    const r = await setup(browser, {online: false});
    await addN(r.page, range(2601, 4));
    await inject(r.page, v);
    await sleep(4000);
    const a = await r.page.evaluate(() => window.__log.length);
    const ca = await colors(r.page);
    await r.page.evaluate(() => {
      window.__online = true;
      window.dispatchEvent(new Event('online'));
    });
    await sleep(2500);
    const c = await colors(r.page);
    const b = await r.page.evaluate(() => ({profile: window.reqs('profile').length, tweet: window.reqs('tweet').length}));
    return fin(r, a === 0 && allAre(ca, ['GREY']) && allAre(c, ['RED']) && b.profile === 1,
        `requests while offline=${a} (colours ${flat(ca)}); after online: ${JSON.stringify(b)} colours=${flat(c)}`);
  },
  // Busy mix (anonymous 422s, 500s, likes, profile re-checks on return): never two requests in flight.
  async t08_no_overlap_mix(browser, v) {
    const r = await setup(browser, {store: {detectedBatch: 3}});
    await r.page.evaluate(([body, anon]) => {
      // First profile check fails (batch stays 3 -> real 422s), later ones answer anonymous.
      window.__profile = () => ((window.__pn = (window.__pn || 0) + 1) === 1 ? "fail" : anon);
      let n = 0;
      window.__responder = (u) => {
        n++;
        if ((u.match(/source:/g) || []).length > 2) {
          return {status: 422, body, delay: 80};
        }
        return n % 5 === 0 ? {status: 500, body: 'x', delay: 120} : {body: '[]', delay: 120};
      };
      for (let i = 0; i < 10; i++) {
        window.add({id: String(2700 + i), hashes: ['MX' + i]});
      }
      // 14 tweets are 2170 px; scrolled so that all lie within one screen of the viewport.
      scrollTo(0, 700);
      [1200, 1700, 2200, 2900].forEach((t, i) => setTimeout(() => {
        document.querySelector(`#t${2700 + i} [data-testid="like"]`).click();
        window.add({id: String(2800 + i), hashes: ['MY' + i]});
        window.returnToTab();
      }, t));
    }, [TAG_LIMIT_BODY(2), ANON]);
    await inject(r.page, v);
    await sleep(12000);
    const n422 = await r.page.evaluate(() => window.__log.filter((x) => x.status === 422).length);
    const c = await colors(r.page);
    return fin(r, allAre(c, ['RED', 'BLUE']) && n422 > 0, `422 answers=${n422} colours=${flat(c)}`);
  },

  // ---------- T09 ----------
  // S9: every request 503 for the first 15 s, then healthy -> no blue within 60 s.
  async s9_recover(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => (performance.now() - window.__t0 < 15000 ? {status: 503, body: 'down'} : {body: '[]'});
      window.__blueGone = null;
      window.__sawBlue = false;
      setInterval(() => {
        const segs = [...document.querySelectorAll('.xdsu-bar-seg')].map((s) => window.segColor(s));
        if (segs.includes('rgb(61, 78, 232)')) {
          window.__sawBlue = true;
        } else if (window.__sawBlue && window.__blueGone === null && segs.every((x) => x === 'rgb(229, 57, 53)')) {
          window.__blueGone = Math.round(performance.now() - window.__t0);
        }
      }, 100);
    });
    await addN(r.page, range(2901, 3));
    await inject(r.page, v);
    await sleep(60000);
    const s = await r.page.evaluate(() => ({gone: window.__blueGone, saw: window.__sawBlue}));
    const c = await colors(r.page);
    return fin(r, s.saw && s.gone !== null && s.gone <= 60000 && allAre(c, ['RED']),
        `saw blue=${s.saw} all resolved (red) at ${s.gone} ms colours=${flat(c)}`);
  },
  // Error entry whose tweet left the DOM is dropped; remount queries again.
  async t09_unmounted_error_dropped(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => (window.__healthy ? {body: '[]'} : {status: 500, body: 'x'});
    });
    await addN(r.page, ['3001']);
    await inject(r.page, v);
    await sleep(3500);
    const ca = await colors(r.page);
    await r.page.evaluate(() => {
      document.getElementById('t3001').remove();
      window.__healthy = true;
    });
    await sleep(2500); // one poll scan + tick
    await addN(r.page, ['3001']);
    await sleep(2000);
    const c = await colors(r.page);
    const n = await r.page.evaluate(() => window.reqs('tweet').length);
    return fin(r, allAre(ca, ['BLUE']) && allAre(c, ['RED']) && n === 3, `before=${flat(ca)} after remount=${flat(c)} tweet lookups=${n}`);
  },
  // retryEntry keeps the same cache object: tries and at survive (forced retry by a return to the tab).
  async t09_same_object(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => ({status: 503, body: 'x'});
    });
    await addN(r.page, ['3101']);
    await inject(r.page, v, {expose: true});
    await sleep(3500);
    const a = await r.page.evaluate(() => {
      window.__saved = window.__tc['3101'];
      return JSON.stringify(window.__saved);
    });
    await r.page.evaluate(() => window.returnToTab());
    await sleep(500);
    const mid = await r.page.evaluate(() => window.__tc['3101'] && window.__tc['3101'].state);
    await sleep(3000);
    const b = await r.page.evaluate(() => ({same: window.__tc['3101'] === window.__saved, e: JSON.stringify(window.__tc['3101'])}));
    const pa = JSON.parse(a);
    const pb = JSON.parse(b.e);
    const pass = b.same && pa.tries === 1 && pb.tries === 2 && pb.at > pa.at && pb.reason === 'server' && mid === 'pending';
    return fin(r, pass, `before=${a} during retry state=${mid} after=${b.e} sameObject=${b.same}`);
  },

  // ---------- T10 ----------
  async t10_anonymous(browser, v) {
    const r = await setup(browser, {profile: ANON});
    await addN(r.page, range(3201, 6));
    await inject(r.page, v);
    await sleep(2500);
    const t = await r.page.evaluate(() => {
      const el = document.querySelector('.xdsu-toast');
      return el ? {href: el.getAttribute('href'), action: el.classList.contains('xdsu-action')} : null;
    });
    await r.page.evaluate(() => window.returnToTab());
    await sleep(1500);
    await r.page.evaluate(() => window.returnToTab());
    await sleep(1500);
    const s = await r.page.evaluate(() => ({terms: window.reqs('tweet').map((x) => x.terms), toasts: window.__toasts,
      profiles: window.reqs('profile').length}));
    const c = await colors(r.page);
    const pass = s.terms[0] === 2 && s.toasts.length === 1 && s.toasts[0] === LOGIN_TEXT && t && t.action
      && t.href === 'https://danbooru.donmai.us/login' && s.profiles === 3 && allAre(c, ['RED']);
    return fin(r, pass, `terms=${JSON.stringify(s.terms)} toasts=${JSON.stringify(s.toasts)} toast=${JSON.stringify(t)}`
      + ` profile checks=${s.profiles} colours=${flat(c)}`);
  },
  async t10_gold(browser, v) {
    const r = await setup(browser, {profile: GOLD});
    await addN(r.page, range(3301, 9));
    await inject(r.page, v);
    await sleep(2500);
    const s = await r.page.evaluate(() => ({terms: window.reqs('tweet').map((x) => x.terms), stored: window.__store.detectedBatch}));
    return fin(r, s.terms[0] === 6 && s.stored === 6, `terms=${JSON.stringify(s.terms)} stored=${s.stored}`);
  },
  async t10_probe_fail_no_store(browser, v) {
    const r = await setup(browser, {profile: 'fail'});
    await addN(r.page, range(3401, 6));
    await inject(r.page, v);
    await sleep(2500);
    const s = await r.page.evaluate(() => ({terms: window.reqs('tweet').map((x) => x.terms), toasts: window.__toasts}));
    const c = await colors(r.page);
    return fin(r, s.terms[0] === 2 && allAre(c, ['RED']), `terms=${JSON.stringify(s.terms)} colours=${flat(c)} toasts=${JSON.stringify(s.toasts)}`);
  },
  // Anonymous; a lookup the server refuses even alone becomes 'limit'. Log in elsewhere, return:
  // batch rises and the 'limit' entries are queried again.
  async t10_login_elsewhere(browser, v) {
    const r = await setup(browser, {profile: ANON});
    await r.page.evaluate((body) => {
      window.__responder = (u) => (window.__loggedIn || !u.includes('status/3502') ? {body: '[]'} : {status: 422, body});
    }, TAG_LIMIT_BODY(0));
    await addN(r.page, range(3501, 4));
    await inject(r.page, v);
    await sleep(3000);
    const ca = await colors(r.page);
    const n0 = await r.page.evaluate(() => window.__log.length);
    await r.page.evaluate((m) => {
      window.__loggedIn = true;
      window.__profile = m;
      window.returnToTab();
    }, MEMBER);
    await sleep(1500);
    await addN(r.page, range(3511, 3));
    await sleep(2500);
    const s = await r.page.evaluate((n0) => window.__log.slice(n0).map((x) => x.kind + '/' + x.terms), n0);
    const c = await colors(r.page);
    const pass = ca.flat().includes('BLUE') && s[0] === 'profile/0' && s.includes('tweet/1') && s.includes('tweet/3') && allAre(c, ['RED']);
    return fin(r, pass, `before=${flat(ca)} after return: ${JSON.stringify(s)} colours=${flat(c)}`);
  },
  // Safe mode: one toast even across re-checks (anonymous, so every return re-checks).
  async t10_safe_mode(browser, v) {
    const r = await setup(browser, {profile: Object.assign({}, ANON, {enable_safe_mode: true})});
    await addN(r.page, ['3601']);
    await inject(r.page, v);
    await sleep(1500);
    await r.page.evaluate(() => window.returnToTab());
    await sleep(1000);
    await r.page.evaluate(() => window.returnToTab());
    await sleep(12000);
    const s = await r.page.evaluate(() => ({toasts: window.__toasts, profiles: window.reqs('profile').length}));
    const pass = s.toasts.filter((t) => t === SAFE_TEXT).length === 1 && s.toasts.filter((t) => t === LOGIN_TEXT).length === 1
      && s.toasts.length === 2 && s.profiles === 3;
    return fin(r, pass, `toasts=${JSON.stringify(s.toasts)} profile checks=${s.profiles}`);
  },
  async t10_safebooru_host(browser, v) {
    const r = await setup(browser, {store: {booru: 'https://safebooru.donmai.us'}});
    await addN(r.page, ['3701']);
    await inject(r.page, v);
    await sleep(2000);
    const s = await r.page.evaluate(() => ({toasts: window.__toasts, p: window.reqs('profile').map((x) => x.url)}));
    return fin(r, JSON.stringify(s.toasts) === JSON.stringify([SAFE_TEXT]) && s.p[0] === 'https://safebooru.donmai.us/profile.json',
        `toasts=${JSON.stringify(s.toasts)} profile url=${s.p[0]}`);
  },
  // D8: the batch menu is gone; a stored queryBatch is ignored.
  async t10_menu_gone(browser, v) {
    const r = await setup(browser, {store: {queryBatch: 1}});
    await r.page.evaluate(() => {
      window.__menus = [];
      window.GM_registerMenuCommand = (name) => window.__menus.push(name);
    });
    await addN(r.page, range(3801, 3));
    await inject(r.page, v);
    await sleep(2000);
    const s = await r.page.evaluate(() => ({menus: window.__menus, terms: window.reqs('tweet').map((x) => x.terms)}));
    // the domain command is labelled with the host, and the Like toggle and legend joined it.
    const menusOk = JSON.stringify(s.menus) === '["Set Danbooru domain"]'
      || JSON.stringify(s.menus) === '["Danbooru URL (danbooru.donmai.us)","Like = re-check: on","XDSU legend"]';
    return fin(r, menusOk && s.terms[0] === 3,
        `menus=${JSON.stringify(s.menus)} terms=${JSON.stringify(s.terms)}`);
  },

  // ---------- desktop task T3 (P1): the stored account check ----------
  // A successful check is stored (accountCheck). A tab that starts within 10 minutes of a check
  // that found the account logged in with safe mode off takes it over and sends no check of its
  // own; anything else is checked afresh. A tab that starts hidden sends nothing until it is shown.

  // A fresh Gold result is stored and the account check is slow (3 s): no check at all, and the
  // first lookup goes out at once with 6 terms (only the stored check gives 6: nothing else is
  // stored, so the default would be 2) and does not write detectedBatch. The same page with
  // nothing stored: the first lookup comes after the check has answered.
  async p1_reuse(browser, v) {
    const run = async (store) => {
      const r = await setup(browser, {store, profile: GOLD});
      await r.page.evaluate(() => {
        window.__profileDelay = 3000;
      });
      await addN(r.page, range(6101, 9));
      await inject(r.page, v);
      const done = await waitUntil(r.page, allResolved, null, 10000);
      const s = await startLog(r.page);
      const batch = await r.page.evaluate(() => window.__store.detectedBatch);
      const c = await colors(r.page);
      const f = await fin(r, true, `${fmtStart(s)} detectedBatch=${batch} colours=${flat(c)}`);
      return {f, done, s, batch, c};
    };
    const a = await run({[ACCOUNT_KEY]: acct({batch: 6})});
    const b = await run({});
    const aOk = a.f.pass && a.done && a.s.p.length === 0 && !!a.s.first && a.s.first.terms === 6 && a.s.first.t < 3000
      && a.batch === undefined && allAre(a.c, ['RED']);
    const bOk = b.f.pass && b.done && b.s.p.length === 1 && !!b.s.first && b.s.first.t >= b.s.p[0][1]
      && b.s.first.terms === 6;
    const saved = a.s.first && b.s.first ? b.s.first.t - a.s.first.t : null;
    return {pass: aOk && bOk, detail: `stored Gold: ${a.f.detail} || nothing stored: ${b.f.detail}`
      + ` || first lookup earlier by ${saved} ms`};
  },
  // Round trip: a tab with an empty store checks (Member) and stores the result; its shape is
  // exactly {host, at, batch, anonymous, safeMode}, with no id or name. A second tab given that
  // store (account check slow, 3 s) takes it over: no check, first lookup at once with 3 terms.
  async p1_round_trip(browser, v) {
    const r = await setup(browser);
    await addN(r.page, range(6151, 4));
    const before = Date.now();
    await inject(r.page, v);
    const done = await waitUntil(r.page, allResolved, null, 8000);
    const after = Date.now();
    const s1 = await startLog(r.page);
    const store = await r.page.evaluate(() => Object.assign({}, window.__store));
    const f1 = await fin(r, true, fmtStart(s1));
    const raw = store[ACCOUNT_KEY];
    let rec = null;
    try {
      rec = JSON.parse(raw);
    } catch {
      rec = null;
    }
    const keys = rec && typeof rec === 'object' ? Object.keys(rec).sort().join() : null;
    // 1 s either side for the two clocks (this process, the page).
    const shapeOk = typeof raw === 'string' && keys === 'anonymous,at,batch,host,safeMode' && rec.host === HOST
      && rec.batch === 3 && rec.anonymous === false && rec.safeMode === false && Number.isInteger(rec.at)
      && rec.at >= before - 1000 && rec.at <= after + 1000 && !/tester|"id"|"name"|"level"/.test(raw);
    const r2 = await setup(browser, {store});
    await r2.page.evaluate(() => {
      window.__profileDelay = 3000;
    });
    await addN(r2.page, range(6161, 6));
    await inject(r2.page, v);
    const done2 = await waitUntil(r2.page, allResolved, null, 8000);
    const s2 = await startLog(r2.page);
    const f2 = await fin(r2, true, fmtStart(s2));
    const pass = f1.pass && f2.pass && done && s1.p.length === 1 && shapeOk && done2 && s2.p.length === 0 && !!s2.first
      && s2.first.terms === 3 && s2.first.t < 3000;
    return {pass, detail: `first tab: ${f1.detail} | stored ${ACCOUNT_KEY}=${JSON.stringify(raw)}`
      + ` (keys ${keys}; at within the run: ${!!rec && rec.at >= before - 1000 && rec.at <= after + 1000})`
      + ` || second tab: ${f2.detail}`};
  },
  // Not reused: each stored check below fails one condition, and the tab makes a real check. The
  // stored batch size differs from the server's answer, so the first lookup shows which was used.
  async p1_not_reused_old(browser, v) {
    // 11 minutes old (the limit is 10).
    return startsWithCheck(browser, v, {[ACCOUNT_KEY]: acct({batch: 6}, 11 * MIN)});
  },
  async p1_not_reused_anonymous(browser, v) {
    // Stored logged out (2); the user has logged in since (Gold, 6).
    return startsWithCheck(browser, v, {[ACCOUNT_KEY]: acct({batch: 2, anonymous: true})}, {profile: GOLD, terms: 6});
  },
  async p1_not_reused_safe_mode(browser, v) {
    // Stored with safe mode on; it is off now. The stored state raises no toast, and the fresh
    // check replaces it.
    const f = await startsWithCheck(browser, v, {[ACCOUNT_KEY]: acct({safeMode: true})});
    let rec = null;
    try {
      rec = JSON.parse(f.stored);
    } catch {
      rec = null;
    }
    const replaced = !!rec && rec.safeMode === false && rec.batch === 3;
    return {pass: f.pass && f.toasts.length === 0 && replaced,
      detail: `${f.detail} | toasts=${JSON.stringify(f.toasts)} | stored after=${f.stored}`};
  },
  async p1_not_reused_other_host(browser, v) {
    // Made for another Danbooru URL than the one in use.
    return startsWithCheck(browser, v, {[ACCOUNT_KEY]: acct({host: 'https://testbooru.donmai.us/'})});
  },
  async p1_not_reused_malformed(browser, v) {
    const now = Date.now();
    const base = {host: HOST, at: now - MIN, batch: 6, anonymous: false, safeMode: false};
    const json = (o) => JSON.stringify(Object.assign({}, base, o));
    const without = (k) => {
      const o = Object.assign({}, base);
      delete o[k];
      return JSON.stringify(o);
    };
    const cases = [
      ['at is a string', json({at: String(now - MIN)})],
      ['at in the future', json({at: now + 5 * MIN})],
      ['batch is a string', json({batch: '6'})],
      ['batch 0', json({batch: 0})],
      ['batch 7', json({batch: 7})],
      ['batch 2.5', json({batch: 2.5})],
      ['anonymous is 0', json({anonymous: 0})],
      ['safeMode missing', without('safeMode')],
      ['host missing', without('host')],
      ['not JSON', '{"host":'],
      ['JSON null', 'null'],
      ['JSON number', '6'],
      ['JSON array', JSON.stringify([base])],
      ['an object, not a string', Object.assign({}, base)],
    ];
    const rows = [];
    let pass = true;
    for (const [name, value] of cases) {
      const f = await startsWithCheck(browser, v, {[ACCOUNT_KEY]: value});
      pass = pass && f.pass;
      rows.push(`${name}: ${f.pass ? 'checked' : 'NOT CHECKED ' + f.detail}`);
    }
    return {pass, detail: rows.join(' | ')};
  },
  // A tab opened in the background with nothing stored: no request of any kind while hidden, also
  // not on 'online', a window focus or the mouse entering. Once shown: exactly one account check
  // (slow, 1 s, so the first flush has to wait for it), then the lookups, never overlapping.
  async p1_hidden_start(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__profileDelay = 1000;
      window.setVis(true);
    });
    await addN(r.page, range(6301, 6));
    await inject(r.page, v);
    // Fixed: 5 s hidden, past the first scan and two 2 s polls; the absence of requests is the point.
    await sleep(2500);
    await r.page.evaluate(() => {
      window.dispatchEvent(new Event('online'));
      window.dispatchEvent(new Event('focus'));
      document.documentElement.dispatchEvent(new PointerEvent('pointerenter', {pointerType: 'mouse'}));
    });
    await sleep(2500);
    const hidden = await r.page.evaluate(() => window.__log.length);
    // Read before the dispatch: the visibilitychange handler may send a request inside setVis.
    const tVis = await r.page.evaluate(() => {
      const t = Math.round(performance.now() - window.__t0);
      window.setVis(false);
      return t;
    });
    const done = await waitUntil(r.page, allResolved, null, 8000);
    const s = await startLog(r.page);
    const order = await r.page.evaluate(() => window.__log.map((x) => [x.kind, x.t, x.done]));
    const lookups = order.filter((x) => x[0] !== 'profile');
    const ok = hidden === 0 && done && s.p.length === 1 && s.p[0][0] >= tVis && s.p[0][1] !== null
      && lookups.length > 0 && lookups.every((x) => x[1] >= s.p[0][1]) && !!s.first && s.first.terms === 3;
    return fin(r, ok, `requests while hidden=${hidden} | shown at ${tVis} ms: ${fmtStart(s)}`);
  },
  // A tab opened in the background with a fresh Gold result stored: nothing while hidden; once
  // shown, lookups with 6 terms and no account check (which would take 3 s).
  async p1_hidden_start_reuse(browser, v) {
    const r = await setup(browser, {store: {[ACCOUNT_KEY]: acct({batch: 6})}, profile: GOLD});
    await r.page.evaluate(() => {
      window.__profileDelay = 3000;
      window.setVis(true);
    });
    await addN(r.page, range(6401, 9));
    await inject(r.page, v);
    // Fixed: 5 s hidden, as in p1_hidden_start.
    await sleep(2500);
    await r.page.evaluate(() => window.dispatchEvent(new Event('online')));
    await sleep(2500);
    const hidden = await r.page.evaluate(() => window.__log.length);
    // Read before the dispatch: the visibilitychange handler may send a request inside setVis.
    const tVis = await r.page.evaluate(() => {
      const t = Math.round(performance.now() - window.__t0);
      window.setVis(false);
      return t;
    });
    // A check would be sent by the visibilitychange handler itself, so it is logged by the time
    // the lookups have answered.
    const done = await waitUntil(r.page, allResolved, null, 8000);
    const s = await startLog(r.page);
    const ok = hidden === 0 && done && s.p.length === 0 && !!s.first && s.first.terms === 6 && s.first.t >= tVis
      && s.first.t - tVis < 3000;
    return fin(r, ok, `requests while hidden=${hidden} | shown at ${tVis} ms: ${fmtStart(s)}`);
  },
  // The reused size is too large: Member (3) is stored, but the user has logged out since (limit 2,
  // a 422 TagLimitError for more than 2 terms). The first lookup is refused and split, one account
  // check follows and the rest goes 2 at a time; results are right (6805 has a post). The stored
  // check is replaced by the logged-out one, which a tab started next does not take over.
  async p1_reused_too_large(browser, v) {
    const r = await setup(browser, {store: {detectedBatch: 3, [ACCOUNT_KEY]: acct({batch: 3})}, profile: ANON});
    await r.page.evaluate((body) => {
      window.__responder = (u) => {
        if ((u.match(/source:/g) || []).length > 2) {
          return {status: 422, body};
        }
        return {body: u.includes('status/6805*') ? JSON.stringify([{id: 1, source: 'https://x.com/u/status/6805'}]) : '[]'};
      };
    }, TAG_LIMIT_BODY(2));
    await addN(r.page, range(6801, 9));
    const before = Date.now();
    await inject(r.page, v);
    const done = await waitUntil(r.page, allResolved, null, 10000);
    const s = await r.page.evaluate(() => ({log: window.__log.map((x) => ({k: x.kind, n: x.terms, s: x.status})),
      store: Object.assign({}, window.__store), toasts: window.__toasts.slice(),
      c: Object.fromEntries([...document.querySelectorAll('article')].map((a) => [a.id,
        window.segColor(a.querySelector('.xdsu-bar-seg'))]))}));
    const f1 = await fin(r, true, '');
    const pi = s.log.findIndex((x) => x.k === 'profile');
    const profiles = s.log.filter((x) => x.k === 'profile').length;
    let rec = null;
    try {
      rec = JSON.parse(s.store[ACCOUNT_KEY]);
    } catch {
      rec = null;
    }
    const GREEN = 'rgb(26, 140, 26)';
    const RED = 'rgb(229, 57, 53)';
    const right = Object.entries(s.c).every(([id, col]) => col === (id === 't6805' ? GREEN : RED));
    const first = s.log[0] || {};
    const ok1 = f1.pass && done && first.k === 'tweet' && first.n === 3 && first.s === 422 && profiles === 1 && pi > 1
      && s.log.slice(1).every((x) => x.n <= 2) && right && !!rec && rec.anonymous === true && rec.batch === 2
      && rec.at >= before && s.store.detectedBatch === 2 && s.toasts.includes(LOGIN_TEXT);
    const next = await startsWithCheck(browser, v, s.store, {profile: ANON, terms: 2, first: 6811});
    const log = s.log.map((x) => `${x.k}/${x.n}${x.s && x.s !== 200 ? ':' + x.s : ''}`);
    return {pass: ok1 && next.pass, detail: `requests=${JSON.stringify(log)} colours=${JSON.stringify(s.c)}`
      + ` stored after=${s.store[ACCOUNT_KEY]} detectedBatch=${s.store.detectedBatch} toasts=${JSON.stringify(s.toasts)}`
      + `${f1.detail} || a tab started next: ${next.detail}`};
  },
  // The age of a reused check counts from when it was made: stored 9 minutes ago, no check at
  // start, none on a return to the tab at once; Date.now stepped 2 minutes on (11 minutes since the
  // check), a return checks once.
  async p1_age_from_check(browser, v) {
    const r = await setup(browser, {store: {detectedBatch: 3, [ACCOUNT_KEY]: acct({batch: 3}, 9 * MIN)}});
    await r.page.evaluate(() => {
      const realNow = Date.now;
      window.__dnOff = 0;
      Date.now = () => realNow() + window.__dnOff;
    });
    await addN(r.page, range(6901, 3));
    await inject(r.page, v);
    const done = await waitUntil(r.page, allResolved, null, 8000);
    const count = () => r.page.evaluate(() => window.reqs('profile').length);
    const n0 = await count();
    await r.page.evaluate(() => window.returnToTab());
    // Fixed: 1 s. The visibilitychange handler would send a check at once (answered in 50 ms).
    await sleep(1000);
    const n1 = await count();
    await r.page.evaluate((ms) => {
      window.__dnOff += ms;
      window.returnToTab();
    }, 2 * MIN);
    const checked = await waitUntil(r.page, () => window.reqs('profile').length > 0
      && window.reqs('profile').every((x) => x.done !== null), null, 3000);
    // Fixed: 1 s for a second check that must not come.
    await sleep(1000);
    const n2 = await count();
    const stored = await r.page.evaluate((k) => window.__store[k], ACCOUNT_KEY);
    return fin(r, done && n0 === 0 && n1 === 0 && checked && n2 === 1,
        `account checks: at start=${n0}, after a return at 9 min=${n1}, after a return at 11 min=${n2}`
        + ` | stored after=${stored}`);
  },

  // On a return the tab also takes over a newer check another tab stored (logged in, safe mode
  // off, within 10 minutes). The other tab's write is made by changing __store after this page
  // loaded, as d10 does for the watch list.

  // Opened in the background with nothing stored; while it is hidden another tab stores a fresh
  // Gold check. Shown: no account check (the server would answer Member after 3 s), lookups with 6
  // terms at once, none while hidden.
  async p1_return_hidden_start(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__profileDelay = 3000;
      window.setVis(true);
    });
    await addN(r.page, range(7001, 9));
    await inject(r.page, v);
    // Fixed: 3 s hidden, the other tab storing its check half way; no request may come.
    await sleep(1500);
    await r.page.evaluate(([k, host]) => {
      window.__store[k] = JSON.stringify({host, at: Date.now() - 1000, batch: 6, anonymous: false, safeMode: false});
    }, [ACCOUNT_KEY, HOST]);
    await sleep(1500);
    const hidden = await r.page.evaluate(() => window.__log.length);
    // Read before the dispatch: the visibilitychange handler may send a request inside setVis.
    const tVis = await r.page.evaluate(() => {
      const t = Math.round(performance.now() - window.__t0);
      window.setVis(false);
      return t;
    });
    const done = await waitUntil(r.page, allResolved, null, 8000);
    const s = await startLog(r.page);
    const ok = hidden === 0 && done && s.p.length === 0 && !!s.first && s.first.terms === 6 && s.first.t >= tVis
      && s.first.t - tVis < 3000;
    return fin(r, ok, `requests while hidden=${hidden} | shown at ${tVis} ms: ${fmtStart(s)}`);
  },
  // The tab checked as Member (3); 11 minutes later another tab has just stored a Gold check. A
  // return takes it over: no account check (the server still answers Member, so one would also
  // show as 3 terms), and the tweets added after use 6 terms.
  async p1_return_after_old_check(browser, v) {
    const f = await returnCase(browser, v, {stepMs: 11 * MIN, agoMs: MIN, first: 7051});
    return {pass: f.pass && f.before === 1 && f.checks === 1 && f.terms === 6, detail: f.detail};
  },
  // The tab checked logged out (2); another tab then stores a fresh logged-in check (Gold). A
  // return takes it over: no account check (a logged-out tab checks on every return), the added
  // tweets use 6 terms, and detectedBatch is left as this tab's own check wrote it (2).
  async p1_return_after_anonymous(browser, v) {
    const f = await returnCase(browser, v, {profile: ANON, agoMs: 0, first: 7061});
    return {pass: f.pass && f.before === 1 && f.checks === 1 && f.terms === 6 && f.batch === 2, detail: f.detail};
  },
  // Not taken over on a return; each case below ends as it would without the return rule. Here
  // the tab's own check (Member) is 11 minutes old, so the return checks, and the added tweets use
  // the check's 3 terms.
  async p1_return_not_anonymous(browser, v) {
    const f = await returnCase(browser, v, {stepMs: 11 * MIN, agoMs: MIN, o: {anonymous: true, batch: 2}, first: 7071});
    return {pass: f.pass && f.before === 1 && f.checks === 2 && f.terms === 3, detail: f.detail};
  },
  async p1_return_not_safe_mode(browser, v) {
    const f = await returnCase(browser, v, {stepMs: 11 * MIN, agoMs: MIN, o: {safeMode: true}, first: 7081});
    return {pass: f.pass && f.before === 1 && f.checks === 2 && f.terms === 3, detail: f.detail};
  },
  // Stored 30 s after this tab's own check, so newer, but 10.5 minutes old at the return. The
  // return's check fails (network error): the tab keeps its own 3 terms. A stale check taken over
  // would be checked again just the same (it is old too), so only a failed check shows it: its 6
  // terms would stay.
  async p1_return_not_stale(browser, v) {
    const f = await returnCase(browser, v, {stepMs: 11 * MIN, fromOwnMs: 30000, checkFails: true, first: 7091});
    return {pass: f.pass && f.before === 1 && f.checks === 2 && f.terms === 3, detail: f.detail};
  },
  // Fresh but 2 minutes older than this tab's own check (fresh too): nothing changes. No check,
  // and the added tweets keep the tab's own 3 terms.
  async p1_return_not_older(browser, v) {
    const f = await returnCase(browser, v, {fromOwnMs: -2 * MIN, first: 7101});
    return {pass: f.pass && f.before === 1 && f.checks === 1 && f.terms === 3, detail: f.detail};
  },
  // A lookup that failed with 'limit' (refused even alone) or 'blocked' (403) still makes the
  // return check the account, although a fresh normal check is stored meanwhile: the first request
  // after the return is that check. For 'limit' the take-over changes the batch size (3 -> 6) and
  // so retries the failed lookup; that must not hide the failure.
  async p1_return_failed_lookup(browser, v) {
    const one = async (kind, first) => {
      const r = await setup(browser);
      await r.page.evaluate(([kind, id, body]) => {
        window.__responder = (u) => {
          if (kind === 'blocked') {
            return {status: 403, body: ''};
          }
          return u.includes(`status/${id}*`) ? {status: 422, body} : {body: '[]'};
        };
      }, [kind, String(first + 1), TAG_LIMIT_BODY(0)]);
      await addN(r.page, range(first, 3));
      await inject(r.page, v);
      const done = await waitUntil(r.page, allResolved, null, 8000);
      const failed = await r.page.evaluate((id) => window.segColor(document.querySelector(`#t${id} .xdsu-bar-seg`)), String(first + 1));
      const n0 = await r.page.evaluate(([k, host]) => {
        window.__store[k] = JSON.stringify({host, at: Date.now(), batch: 6, anonymous: false, safeMode: false});
        const n = window.__log.length;
        window.returnToTab();
        return n;
      }, [ACCOUNT_KEY, HOST]);
      // The request after the return has been sent and answered (a lookup comes 250 ms later).
      const sent = await waitUntil(r.page, (n) => window.__log.length > n && window.__log[n].done !== null, n0, 3000);
      const next = await r.page.evaluate((n) => (window.__log[n] ? `${window.__log[n].kind}/${window.__log[n].terms}` : 'none'), n0);
      const ok = done && failed === 'rgb(61, 78, 232)' && sent && next === 'profile/0';
      return fin(r, ok, `${kind}: failed segment blue=${failed === 'rgb(61, 78, 232)'} | first request after the return=${next}`);
    };
    const a = await one('limit', 7111);
    const b = await one('blocked', 7121);
    return {pass: a.pass && b.pass, detail: `${a.detail} || ${b.detail}`};
  },

  // ---------- T11 ----------
  // Every lookup carries only=; a stub that returns only those fields gives the same judgements.
  async t11_only(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      const P = (id, source, extra = {}) => Object.assign({id, source, is_deleted: false, is_banned: false}, extra);
      window.__responder = (u) => {
        const out = [];
        if (u.includes('status/3901')) {
          out.push(P(1, 'https://x.com/u/status/3901'));
        }
        if (u.includes('status/3902')) {
          out.push(P(2, 'https://x.com/u/status/3902/photo/1', {is_deleted: true}));
        }
        if (u.includes('media/H3903')) {
          out.push(P(3, 'https://pbs.twimg.com/media/H3903.jpg', {is_banned: true}));
        }
        return {body: JSON.stringify(out)};
      };
    });
    await addN(r.page, range(3901, 4));
    await inject(r.page, v);
    await sleep(3000);
    const urls = await r.page.evaluate(() => window.__log.filter((x) => x.kind !== 'profile').map((x) => x.url));
    const okUrls = urls.length > 0 && urls.every((u) => /posts\.json\?limit=100&only=id,source,is_deleted,is_banned&tags=/.test(u));
    const c = await colors(r.page);
    const st = await r.page.evaluate(() => [...document.querySelectorAll('.xdsu-bar-seg')].map((s) => window.segUrl(s)));
    const pass = okUrls && flat(c) === 'GREEN,GREEN,GREEN,RED' && st[0].endsWith('posts/1') && st[1].endsWith('posts/2') && st[2].endsWith('posts/3');
    return fin(r, pass, `all lookup URLs carry only=: ${okUrls} (e.g. ${urls[0]}) colours=${flat(c)} links=${JSON.stringify(st)}`);
  },

  // ---------- T12 ----------
  // S10: 30 tweets scroll past within 300 ms, one stays; it resolves within 2 requests.
  async s10_flick(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 500});
      for (let i = 0; i < 30; i++) {
        window.add({id: String(4000 + i), hashes: ['FL' + i]});
      }
    });
    await inject(r.page, v);
    await sleep(300);
    await r.page.evaluate(() => {
      document.querySelectorAll('article').forEach((a) => a.remove());
      window.add({id: '4100', hashes: ['VIS1']});
      window.__left = window.__log.length;
      window.__leftInflight = window.__inflight;
      window.__resolvedAfter = null;
      const iv = setInterval(() => {
        const s = document.querySelector('#t4100 .xdsu-bar-seg');
        if (s && window.segColor(s) !== 'rgb(154, 154, 154)') {
          window.__resolvedAfter = window.__log.length - window.__left + window.__leftInflight;
          window.__resolvedAt = Math.round(performance.now() - window.__t0);
          clearInterval(iv);
        }
      }, 20);
    });
    await sleep(14000);
    const s = await r.page.evaluate(() => ({n: window.__resolvedAfter, at: window.__resolvedAt}));
    return fin(r, s.n !== null && s.n <= 2, `visible tweet resolved after ${s.n} requests (counting the one in flight), at ${s.at} ms`);
  },
  // S10b: 150 tweets scroll past at 5/s (12 mounted at a time), then stop: the 12 on screen resolve
  // within ceil(12/3)+1 = 5 requests. Also: red appears while scrolling.
  async s10b_long_scroll(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 500});
      window.__redDuringScroll = null;
    });
    await inject(r.page, v);
    await r.page.evaluate(() => new Promise((res) => {
      let i = 0;
      const iv = setInterval(() => {
        window.add({id: String(5000 + i), hashes: ['LS' + i]});
        const arts = document.querySelectorAll('article');
        if (arts.length > 12) {
          arts[0].remove();
        }
        // 12 tweets are 1860 px; keep the viewport in their middle so all are within range.
        scrollTo(0, 530);
        if (window.__redDuringScroll === null && [...document.querySelectorAll('.xdsu-bar-seg')]
            .some((s) => window.segColor(s) === 'rgb(229, 57, 53)')) {
          window.__redDuringScroll = i;
        }
        if (++i >= 150) {
          clearInterval(iv);
          res();
        }
      }, 200);
    }));
    await r.page.evaluate(() => {
      window.__stop = window.__log.length;
      window.__stopInflight = window.__inflight;
      window.__doneAfter = null;
      const iv = setInterval(() => {
        const segs = [...document.querySelectorAll('.xdsu-bar-seg')];
        if (segs.length === 12 && segs.every((s) => window.segColor(s) !== 'rgb(154, 154, 154)')) {
          window.__doneAfter = window.__log.length - window.__stop + window.__stopInflight;
          clearInterval(iv);
        }
      }, 20);
    });
    await sleep(15000);
    const s = await r.page.evaluate(() => ({n: window.__doneAfter, red: window.__redDuringScroll, total: window.__log.length}));
    const c = await colors(r.page);
    return fin(r, s.n !== null && s.n <= 5 && s.red !== null && s.red < 140,
        `12 on screen resolved after ${s.n} requests from stop; first red seen while scrolling at tweet #${s.red};`
        + ` total requests=${s.total} colours=${flat(c)}`);
  },
  // Red as soon as the tweet lookup is empty, before any hash request has answered.
  async t12_red_before_hash(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = (u) => (u.includes('media/') ? {body: '[]', delay: 3000} : {body: '[]', delay: 100});
    });
    await addN(r.page, range(4201, 3));
    await inject(r.page, v);
    await sleep(1200);
    const s = await r.page.evaluate(() => ({hashDone: window.reqs('hash').filter((x) => x.done !== null).length}));
    const c = await colors(r.page);
    return fin(r, allAre(c, ['RED']) && s.hashDone === 0, `colours at 1.2 s=${flat(c)} hash answers so far=${s.hashDone}`);
  },
  // Hash-only hit: red -> green on first load; during a re-check (Like) it stays green (no flicker).
  async t12_hash_hit_no_flicker(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = (u) => (u.includes('media/HH1')
        ? {body: JSON.stringify([{id: 71, source: 'https://pbs.twimg.com/media/HH1.jpg'}]), delay: 600}
        : {body: '[]', delay: 200});
      window.add({id: '4301', hashes: ['HH1']});
      window.__s1 = window.sample('t4301');
    });
    await inject(r.page, v);
    await sleep(3000);
    const first = await r.page.evaluate(() => {
      clearInterval(window.__s1.iv);
      window.__s2 = window.sample('t4301');
      document.querySelector('#t4301 [data-testid="like"]').click();
      return window.__s1.seq;
    });
    await sleep(3000);
    const second = await r.page.evaluate(() => {
      clearInterval(window.__s2.iv);
      return {seq: window.__s2.seq, pulse: window.__s2.pulse, left: document.querySelectorAll('.xdsu-rechecking').length,
        n: window.reqs('hash').length};
    });
    const pass = first.join(' > ') === 'GREY > RED > GREEN' && second.seq.join() === 'GREEN' && second.pulse
      && second.left === 0 && second.n === 2;
    return fin(r, pass, `first load: ${first.join(' > ')} | re-check: ${second.seq.join(' > ')} pulse=${second.pulse}`
      + ` pulseLeft=${second.left} hash lookups=${second.n}`);
  },
  // Same segment re-attached right after its queued lookup was dropped (no scan saw it leave):
  // it is looked up again.
  async t12_reattach_dropped(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 1000});
      for (let i = 0; i < 6; i++) {
        window.add({id: String(4400 + i), hashes: ['RA' + i]});
      }
    });
    await inject(r.page, v);
    await sleep(700);
    // Detach the first-taken... a tweet still queued (oldest under LIFO, newest under FIFO), re-attach after the 2nd batch started.
    const target = await r.page.evaluate(() => {
      const first = window.reqs('tweet')[0].url;
      const queued = [...document.querySelectorAll('article')].map((a) => a.id.slice(1)).find((id) => !first.includes('status/' + id + '*'));
      const el = document.getElementById('t' + queued);
      window.__kept = el;
      window.__next = el.nextSibling;
      el.remove();
      return queued;
    });
    await sleep(800);
    await r.page.evaluate(() => document.getElementById('root').insertBefore(window.__kept, window.__next));
    await sleep(6000);
    const c = await colors(r.page);
    const n = await r.page.evaluate((id) => window.reqs('tweet').filter((x) => x.url.includes(`status/${id}*`)).length, target);
    return fin(r, allAre(c, RESOLVED), `detached ${target}; its tweet lookups=${n} colours=${flat(c)}`);
  },
  // Removed while queued (dropped), remounted later as a new element: looked up again.
  async t12_remount_dropped(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 1000});
      for (let i = 0; i < 6; i++) {
        window.add({id: String(4500 + i), hashes: ['RM' + i]});
      }
    });
    await inject(r.page, v);
    await sleep(700);
    const target = await r.page.evaluate(() => {
      const first = window.reqs('tweet')[0].url;
      const queued = [...document.querySelectorAll('article')].map((a) => a.id.slice(1)).find((id) => !first.includes('status/' + id + '*'));
      document.getElementById('t' + queued).remove();
      return queued;
    });
    await sleep(4000);
    const between = await r.page.evaluate((id) => window.reqs('tweet').filter((x) => x.url.includes(`status/${id}*`)).length, target);
    await r.page.evaluate((id) => window.add({id, hashes: ['RMX']}), target);
    await sleep(4000);
    const c = await colors(r.page);
    const n = await r.page.evaluate((id) => window.reqs('tweet').filter((x) => x.url.includes(`status/${id}*`)).length, target);
    return fin(r, allAre(c, RESOLVED) && n >= 1, `removed ${target} while queued; lookups naming it while gone=${between}, total=${n}; colours=${flat(c)}`);
  },

  // ---------- T21 ----------
  // A passive toast lets taps through; position per spec.
  async t21_passive(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => ({status: 403, body: ''});
      for (let i = 0; i < 12; i++) {
        window.add({id: String(4600 + i), hashes: ['TP' + i]});
      }
    });
    await inject(r.page, v);
    await sleep(1500);
    const s = await r.page.evaluate(() => {
      const t = document.querySelector('.xdsu-toast');
      if (!t) {
        return null;
      }
      const b = t.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      const cs = getComputedStyle(t);
      return {text: t.textContent, left: b.left, bottomGap: innerHeight - b.bottom, h: b.height, w: b.width, maxW: innerWidth - 100,
        pe: cs.pointerEvents, z: cs.zIndex, hitIsToast: hit === t || t.contains(hit), hit: hit && (hit.closest('article') ? 'article' : hit.tagName)};
    });
    await sleep(4000);
    const gone = await r.page.evaluate(() => getComputedStyle(document.querySelector('.xdsu-toast')).display);
    const pass = s && s.text === BLOCKED_TEXT && s.left === 12 && s.bottomGap === 64 && s.h >= 44 && s.w <= s.maxW
      && s.pe === 'none' && !s.hitIsToast && s.z === '2147483000' && gone === 'none';
    return fin(r, pass, `${JSON.stringify(s)} display after 5.5 s=${gone}`);
  },
  // The action toast takes the tap and opens the login page; it stays up to 8 s.
  async t21_action(browser, v) {
    const r = await setup(browser, {profile: ANON});
    await r.page.evaluate(() => {
      for (let i = 0; i < 12; i++) {
        window.add({id: String(4700 + i), hashes: ['TA' + i]});
      }
      window.__artClicks = 0;
      document.addEventListener('click', (e) => {
        if (e.target.closest && e.target.closest('article')) {
          window.__artClicks++;
        }
      });
    });
    await inject(r.page, v);
    await sleep(5500);
    const s = await r.page.evaluate(() => {
      const t = document.querySelector('.xdsu-toast');
      if (!t) {
        return null;
      }
      const b = t.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return {x: b.left + b.width / 2, y: b.top + b.height / 2, hitIsToast: hit === t || t.contains(hit),
        pe: getComputedStyle(t).pointerEvents, shown: getComputedStyle(t).display !== 'none'};
    });
    if (s) {
      await r.page.touchscreen.tap(s.x, s.y);
    }
    await sleep(500);
    const o = await r.page.evaluate(() => ({opened: window.__opened, art: window.__artClicks}));
    const pass = s && s.shown && s.hitIsToast && s.pe === 'auto' && o.opened.length === 1
      && o.opened[0] === 'https://danbooru.donmai.us/login' && o.art === 0 && r.popups.length === 0;
    return fin(r, pass, `at 5.5 s: ${JSON.stringify(s)} opened=${JSON.stringify(o.opened)} articleClicks=${o.art} newPages=${r.popups.length}`);
  },
};

(async () => {
  const browser = await chromium.launch();
  for (const v of variants) {
    console.log(`\n===== ${v} =====`);
    for (const [name, fn] of Object.entries(S)) {
      if (only && !only.includes(name)) {
        continue;
      }
      const t0 = Date.now();
      try {
        const r = await Promise.race([fn(browser, v), sleep(120000).then(() => ({pass: false, detail: 'TIMEOUT'}))]);
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name} (${Math.round((Date.now() - t0) / 1000)} s)\n      ${r.detail}`);
      } catch (e) {
        console.log(`HARNESS-ERROR ${name}: ${e.message.split('\n')[0]}`);
      }
    }
  }
  await browser.close();
})();
