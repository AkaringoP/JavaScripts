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
      orig(Object.assign({}, d, {onload: end(d.onload), onerror: end(d.onerror), ontimeout: end(d.ontimeout)}));
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
