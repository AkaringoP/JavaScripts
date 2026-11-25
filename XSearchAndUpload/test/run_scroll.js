// Viewport-first queue: tweets stay mounted while the page scrolls.
// node run_scroll.js [variant,..] [scenario,..]
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

// ---------- stay-mounted feed (tweets are never removed; x.com pre-renders below the viewport) ----------
const FEED_N = 40;
const TWEET_H = 300;
const AHEAD = 1600;

// Builds the feed page: tweets ~300 px high, pre-rendered until AHEAD px below the viewport,
// never unmounted. Helpers: visIds(), unresolvedVisible(), tweetTop(i), reqIds(rec), timers.
async function feed(browser, {delay = 800, inner = false} = {}) {
  const r = await setup(browser);
  await r.page.evaluate(([N, H, AHEAD, delay, inner]) => {
    window.__responder = () => ({body: '[]', delay});
    document.body.style.margin = '0';
    // inner: the feed scrolls inside a 100vh overflow:auto element instead of the window.
    window.scroller = document.scrollingElement;
    if (inner) {
      const root = document.getElementById('root');
      const box = document.createElement('div');
      box.style.cssText = 'height:100vh;overflow-y:auto';
      root.replaceWith(box);
      box.appendChild(root);
      window.scroller = box;
    }
    window.setScroll = (y) => {
      window.scroller.scrollTop = y;
    };
    let next = 0;
    window.mountAhead = () => {
      const root = document.getElementById('root');
      while (next < N && root.getBoundingClientRect().bottom < innerHeight + AHEAD) {
        const a = window.mkTweet({id: String(6000 + next), hashes: ['FD' + next],
          before: `<div style="height:${H - 150}px">#${next}</div>`});
        a.style.display = 'block';
        root.appendChild(a);
        next++;
      }
    };
    window.mountAhead();
    window.addEventListener('scroll', window.mountAhead, {passive: true, capture: true});
    window.tweetTop = (i) => document.getElementById('t6000').offsetHeight * i;
    const segVisible = (s) => {
      const b = s.getBoundingClientRect();
      return b.bottom > 0 && b.top < innerHeight;
    };
    window.visIds = () => [...document.querySelectorAll('article')].filter((a) => {
      const s = a.querySelector('.xdsu-bar-seg');
      return s && segVisible(s);
    }).map((a) => Number(a.id.slice(1)) - 6000);
    window.unresolvedVisible = () => [...document.querySelectorAll('.xdsu-bar-seg')]
      .filter((s) => segVisible(s) && window.segColor(s) === 'rgb(154, 154, 154)').length;
    window.reqIds = (rec) => (rec.url.match(/status\/(\d+)\*/g) || []).map((m) => Number(m.slice(7, -1)) - 6000);
    window.__timers = [];
    const st = window.setTimeout;
    window.setTimeout = function(fn, ms, ...a) {
      window.__timers.push([Math.round(performance.now() - (window.__t0 || 0)), ms]);
      return st.call(window, fn, ms, ...a);
    };
    // Fast scroll from the current position to y over durMs.
    window.scrollFast = (y, durMs) => new Promise((res) => {
      const y0 = window.scroller.scrollTop;
      const t0 = performance.now();
      const step = () => {
        const f = Math.min(1, (performance.now() - t0) / durMs);
        window.setScroll(y0 + (y - y0) * f);
        if (f < 1) {
          requestAnimationFrame(step);
        } else {
          res();
        }
      };
      requestAnimationFrame(step);
    });
    // Waits until no grey segment is visible; returns requests sent since the call (+ in flight) and ms.
    window.measureStop = () => new Promise((res) => {
      const n0 = window.__log.length;
      const inflight = window.__inflight;
      const t0 = performance.now();
      const iv = setInterval(() => {
        if (window.unresolvedVisible() === 0 || performance.now() - t0 > 20000) {
          clearInterval(iv);
          const after = window.__log.slice(n0).filter((x) => x.kind !== 'profile');
          res({ok: window.unresolvedVisible() === 0, ms: Math.round(performance.now() - t0), inflightAtStop: inflight,
            // Requests sent after the stop that had answered by the time the view was resolved.
            sent: after.filter((x) => x.done !== null).length,
            reqs: after.map((x) => `${x.kind}[${window.reqIds(x).join(',')}]`)});
        }
      }, 20);
    });
  }, [FEED_N, TWEET_H, AHEAD, delay, inner]);
  return r;
}

const tweetLog = (page) => page.evaluate(() => window.reqs('tweet').map((x) => `${x.t}:[${window.reqIds(x).join(',')}]`));
const idsRequested = (page) => page.evaluate(() => [...new Set(window.reqs('tweet').flatMap((x) => window.reqIds(x)))].sort((a, b) => a - b));

// Scroll fast from the top to tweet 30 in 1.5 s, stop, measure.
async function fastStop(browser, v, inner = false) {
  const r = await feed(browser, {inner});
  await inject(r.page, v);
  await sleep(1000);
  const before = await r.page.evaluate(() => window.__log.length);
  await r.page.evaluate(() => window.scrollFast(window.tweetTop(30) - 100, 1500));
  const atStop = await r.page.evaluate(() => ({vis: window.visIds(), mounted: document.querySelectorAll('article').length,
    sentDuringScroll: window.__log.length, queued: null}));
  const m = await r.page.evaluate(() => window.measureStop());
  return {r, atStop, m, before};
}

const SC = {
  async f1_fast_stop(browser, v, inner = false) {
    const {r, atStop, m} = await fastStop(browser, v, inner);
    // The request in flight at the stop counts as one.
    const n = m.sent + m.inflightAtStop;
    await sleep(3000);
    const ids = await idsRequested(r.page);
    const log = await tweetLog(r.page);
    // Tweets the viewport passed during the scroll and that were never within one viewport of a batch: 6..24.
    const flown = ids.filter((i) => i >= 6 && i <= 24);
    const pass = m.ok && n <= Math.ceil(atStop.vis.length / 3) + 1;
    return fin(r, pass, `visible at stop=[${atStop.vis}] mounted=${atStop.mounted}; after stop: requests=${n}`
      + ` (in flight ${m.inflightAtStop} + sent ${m.sent}) until visible resolved, ${m.ms} ms; requests after stop=${JSON.stringify(m.reqs)}`
      + ` | ids requested by +3 s: ${ids.length} [${ids}], of 6..24: ${flown.length} | tweet log=${JSON.stringify(log)}`);
  },
  // After f1, scroll back up to a grey region: resolved within ~0.5 s + one request.
  async f2_scroll_back(browser, v, inner = false) {
    const {r} = await fastStop(browser, v, inner);
    await sleep(5000);
    const target = await r.page.evaluate(() => {
      for (let i = 10; i < 25; i++) {
        const s = document.querySelector(`#t${6000 + i} .xdsu-bar-seg`);
        if (window.segColor(s) === 'rgb(154, 154, 154)' && [1, 2].every((d) => {
          const n = document.querySelector(`#t${6000 + i + d} .xdsu-bar-seg`);
          return window.segColor(n) === 'rgb(154, 154, 154)';
        })) {
          return i;
        }
      }
      return 15;
    });
    const greyBefore = await r.page.evaluate((t) => [0, 1, 2].map((d) => window.segColor(document.querySelector(`#t${6000 + t + d} .xdsu-bar-seg`)) === 'rgb(154, 154, 154)'), target);
    const inflight = await r.page.evaluate(() => window.__inflight);
    await r.page.evaluate((t) => window.setScroll(window.tweetTop(t) - 50), target);
    const m = await r.page.evaluate(() => window.measureStop());
    const vis = await r.page.evaluate(() => window.visIds());
    // 800 ms latency: 0.5 s + one request = 1.3 s.
    const pass = m.ok && inflight === 0 && m.sent <= 1 && m.ms <= 1500;
    return fin(r, pass, `target tweet ${target} grey before=${greyBefore} inflight at scroll=${inflight} visible=[${vis}]`
      + ` resolved in ${m.ms} ms with ${m.sent} requests ${JSON.stringify(m.reqs)}`);
  },
  // With only out-of-range keys queued: no repeating 250 ms timer and no requests for 6 s.
  async f3_no_spin(browser, v) {
    const {r} = await fastStop(browser, v);
    await sleep(4000);
    const s0 = await r.page.evaluate(() => ({n: window.__log.length, t: window.__timers.length, inflight: window.__inflight,
      grey: [...document.querySelectorAll('.xdsu-bar-seg')].filter((s) => window.segColor(s) === 'rgb(154, 154, 154)').length}));
    await sleep(6000);
    const s1 = await r.page.evaluate(([n, t]) => ({n: window.__log.length - n,
      timers: window.__timers.slice(t), grey: [...document.querySelectorAll('.xdsu-bar-seg')]
        .filter((s) => window.segColor(s) === 'rgb(154, 154, 154)').length}), [s0.n, s0.t]);
    const t250 = s1.timers.filter((x) => x[1] === 250).length;
    const pass = s0.inflight === 0 && s1.n === 0 && t250 === 0;
    return fin(r, pass, `grey (queued, out of range)=${s0.grey}; over 6 s: requests=${s1.n} 250 ms timers=${t250}`
      + ` all timers=${JSON.stringify(s1.timers.map((x) => x[1]).reduce((o, ms) => Object.assign(o, {[ms]: (o[ms] || 0) + 1}), {}))}`);
  },
  // Slow continuous scroll (one tweet per second) for 25 s: bars resolve as they come into view.
  async f4_slow_scroll(browser, v) {
    const r = await feed(browser);
    await inject(r.page, v);
    await sleep(1000);
    const res = await r.page.evaluate(() => new Promise((done) => {
      const enter = {};
      const lag = {};
      const t0 = performance.now();
      const iv = setInterval(() => {
        const now = performance.now() - t0;
        window.setScroll(now * 0.3);
        document.querySelectorAll('article').forEach((a) => {
          const s = a.querySelector('.xdsu-bar-seg');
          if (!s) {
            return;
          }
          const b = s.getBoundingClientRect();
          const id = Number(a.id.slice(1)) - 6000;
          if (b.bottom > 0 && b.top < innerHeight && enter[id] === undefined) {
            enter[id] = now;
          }
          if (enter[id] !== undefined && lag[id] === undefined && window.segColor(s) !== 'rgb(154, 154, 154)') {
            lag[id] = Math.round(now - enter[id]);
          }
        });
        if (now > 25000) {
          clearInterval(iv);
          done({lag, unresolved: Object.keys(enter).filter((k) => lag[k] === undefined).map(Number), last: window.visIds()});
        }
      }, 50);
    }));
    const lags = Object.values(res.lag);
    const max = Math.max(...lags);
    const unresolvedVisible = await r.page.evaluate(() => window.unresolvedVisible());
    const pass = max <= 2500 && unresolvedVisible === 0;
    return fin(r, pass, `tweets entered view=${lags.length + res.unresolved.length}, max lag entering view->resolved=${max} ms`
      + ` (0 = resolved before entering), lags=${JSON.stringify(res.lag)} never resolved=[${res.unresolved}] visible unresolved at end=${unresolvedVisible}`);
  },
  // Like on a resolved tweet that is now far above: no lookup while far, keeps its colour, and
  // is looked up when scrolled back to.
  async f5_like_far(browser, v) {
    const r = await feed(browser);
    await inject(r.page, v);
    await sleep(2000);
    const before = await r.page.evaluate(() => window.segColor(document.querySelector('#t6001 .xdsu-bar-seg')));
    await r.page.evaluate(() => window.setScroll(window.tweetTop(12)));
    await sleep(4000);
    const n0 = await r.page.evaluate(() => {
      window.__s = window.sample('t6001');
      document.querySelector('#t6001 [data-testid="like"]').click();
      return window.reqs('tweet').length;
    });
    await sleep(3000);
    const far = await r.page.evaluate((n0) => ({reqs: window.reqs('tweet').slice(n0).filter((x) => window.reqIds(x).includes(1)).length,
      seq: window.__s.seq, pulse: window.__s.pulse}), n0);
    await r.page.evaluate(() => window.setScroll(0));
    const m = await r.page.evaluate(() => new Promise((res) => {
      const t0 = performance.now();
      const n = window.__log.length;
      const iv = setInterval(() => {
        const req = window.__log.slice(n).find((x) => x.kind === 'tweet' && window.reqIds(x).includes(1));
        if ((req && req.done !== null && !document.querySelector('#t6001 .xdsu-rechecking')) || performance.now() - t0 > 8000) {
          clearInterval(iv);
          res({ms: Math.round(performance.now() - t0), sentAt: req ? Math.round(req.t - (t0 - window.__t0)) : null});
        }
      }, 20);
    }));
    const seq = await r.page.evaluate(() => {
      clearInterval(window.__s.iv);
      return window.__s.seq;
    });
    const pass = before === 'rgb(229, 57, 53)' && far.reqs === 0 && far.seq.join() === 'RED' && m.sentAt !== null
      && m.sentAt <= 600 && seq.join() === 'RED';
    return fin(r, pass, `far: lookups of the liked tweet in 3 s=${far.reqs} colours=${far.seq.join('>')} pulse=${far.pulse};`
      + ` back at top: lookup sent after ${m.sentAt} ms, done+pulse off after ${m.ms} ms; colours overall=${seq.join('>')}`);
  },
  // Same as f1/f2 with the feed scrolling inside an element.
  async f6_inner_scroller(browser, v) {
    const a = await SC.f1_fast_stop(browser, v, true);
    const b = await SC.f2_scroll_back(browser, v, true);
    return {pass: a.pass && b.pass, detail: `stop: ${a.detail.split(' | ids')[0]} || back: ${b.detail.split(' | reqs')[0]}`};
  },
};

(async () => {
  const browser = await chromium.launch();
  for (const v of variants) {
    console.log(`\n===== ${v} =====`);
    for (const [name, fn] of Object.entries(SC)) {
      if (only && !only.includes(name)) {
        continue;
      }
      const t0 = Date.now();
      try {
        const r = await fn(browser, v);
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name} (${Math.round((Date.now() - t0) / 1000)} s)\n      ${r.detail}`);
      } catch (e) {
        console.log(`HARNESS-ERROR ${name}: ${e.message.split('\n')[0]}`);
      }
    }
  }
  await browser.close();
})();
