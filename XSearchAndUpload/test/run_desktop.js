// Desktop browsers: no touch, mouse and keyboard, wide windows (h.js DESKTOP, DESKTOP_WIDE).
// node run_desktop.js [variant,..] [scenario,..]
// A scenario in KNOWN_GAPS documents behaviour that a later task adds. While the behaviour is
// missing it prints GAP (run_all.js counts it apart from PASS and FAIL); once it is there it prints
// FAIL until the entry is removed, so the scenario becomes an ordinary one with that task.
const {chromium, newPage, inject, sleep, PHONE, DESKTOP, DESKTOP_WIDE} = require('./h.js');
const SCROLL = require('./run_scroll.js');
const {readScript} = require('./script.js');

const variants = (process.argv[2] || 'current').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;
const LOGIN_TEXT = 'Not logged in to Danbooru – lookups limited';
const SAFE_TEXT = 'Danbooru safe mode is on – only rating:g posts are visible';

// Scenario name -> the task that closes the gap. Empty since T2 closed d4 and d5.
const KNOWN_GAPS = {};

// ---------- synthetic page (h.js) ----------

async function setup(browser, {ctxOpts = DESKTOP, profile = null, store = {}} = {}) {
  const r = await newPage(browser, {ctxOpts, store});
  r.popups = [];
  r.ctx.on('page', (p) => r.popups.push(p.url()));
  r.navs = [];
  r.page.on('framenavigated', (f) => {
    if (f === r.page.mainFrame()) {
      r.navs.push(f.url());
    }
  });
  await r.page.evaluate((profile) => {
    if (profile) {
      window.__profile = profile;
    }
    // Fake post table: lookups are answered from it.
    window.__db = [];
    window.__responder = (u) => {
      const ids = [...u.matchAll(/source:\*status\/(\d+)\*/g)].map((x) => x[1]);
      const hs = [...u.matchAll(/source:\*media\/([A-Za-z0-9_-]+)\*/g)].map((x) => x[1]);
      const out = window.__db.filter((p) => ids.some((id) => new RegExp(`status/${id}(?!\\d)`).test(p.source))
        || hs.some((h) => p.source.includes('media/' + h)));
      return {body: JSON.stringify(out)};
    };
    window.post = (id, source) => ({id, source, is_deleted: false, is_banned: false});
    // Every request: send time, url, visibility at send; number in flight.
    const orig = window.GM_xmlhttpRequest;
    window.__reqLog = [];
    window.__inflight = 0;
    window.GM_xmlhttpRequest = (d) => {
      const rec = {t: Math.round(performance.now() - (window.__t0 || 0)), url: decodeURIComponent(d.url),
        hidden: document.hidden, done: null};
      window.__reqLog.push(rec);
      window.__inflight++;
      window.__maxInflight = Math.max(window.__maxInflight || 0, window.__inflight);
      const end = (fn) => (x) => {
        window.__inflight--;
        rec.done = Math.round(performance.now() - (window.__t0 || 0));
        if (fn) {
          fn(x);
        }
      };
      return orig(Object.assign({}, d, {onload: end(d.onload), onerror: end(d.onerror), ontimeout: end(d.ontimeout)}));
    };
    window.lookups = (needle) => window.__reqLog.filter((x) => !x.url.includes('/profile.json') && x.url.includes(needle));
    // Faked visibility, as the other runners do it.
    window.setHidden = (hidden) => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
      Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => (hidden ? 'hidden' : 'visible')});
      document.dispatchEvent(new Event('visibilitychange'));
    };
    window.__visEvents = 0;
    document.addEventListener('visibilitychange', () => window.__visEvents++);
    window.__focusEvents = [];
    window.addEventListener('focus', (e) => window.__focusEvents.push(e.isTrusted ? 'trusted' : 'synthetic'));
    // Date.now offset, to step past the 1.5 s open locks without waiting (as run_bar.js).
    const realNow = Date.now;
    window.__dnOff = 0;
    Date.now = () => realNow() + window.__dnOff;
    // Events from the script's controls that reach x.com's elements in the bubble phase: the
    // article, its status links (time, photo) and the document (where React listens).
    window.__reach = [];
    const CONTROLS = '.xdsu-bar-seg, .xdsu-upload-btn, .xdsu-pill';
    const TYPES = ['click', 'auxclick', 'mousedown', 'contextmenu'];
    const note = (where) => (e) => {
      if (e.target.closest && e.target.closest(CONTROLS)) {
        window.__reach.push(`${where}:${e.type}:${e.button}`);
      }
    };
    TYPES.forEach((t) => document.addEventListener(t, note('document')));
    // Left and middle clicks on a control whose default action (open the link, follow the photo
    // link) was not cancelled, read once the dispatch is over. A popup can be reported late; this
    // cannot.
    window.__undefaulted = [];
    ['click', 'auxclick'].forEach((t) => window.addEventListener(t, (e) => {
      if (e.button < 2 && e.target.closest && e.target.closest(CONTROLS)) {
        setTimeout(() => {
          if (!e.defaultPrevented) {
            window.__undefaulted.push(`${e.type}:${e.button}`);
          }
        }, 0);
      }
    }, true));
    window.watchReach = () => document.querySelectorAll('article').forEach((a) => {
      TYPES.forEach((t) => a.addEventListener(t, note('article')));
      a.querySelectorAll('a[href*="/status/"]').forEach((l) => TYPES.forEach((t) => l.addEventListener(t, note('link'))));
    });
    // A tweet with one 280x200 tile: a coarse pointer would give it the 40 px button.
    window.addBig = (id, hash) => {
      const a = window.mkTweet({id, hashes: [hash]});
      a.querySelector('[data-testid="tweetPhoto"]').style.cssText = 'width:280px;height:200px';
      document.getElementById('root').appendChild(a);
      return a;
    };
    window.seg = (id) => document.querySelector(`#t${id} .xdsu-bar-seg`);
    // Toasts as shown: text, ms since injection, hidden at the time. Polled every 20 ms.
    window.__toastLog = [];
    let last = '';
    setInterval(() => {
      const t = document.querySelector('.xdsu-toast');
      const now = t && t.classList.contains('xdsu-show') && getComputedStyle(t).display !== 'none' ? t.textContent : '';
      if (now && now !== last) {
        window.__toastLog.push({text: now, t: Math.round(performance.now() - (window.__t0 || 0)), hidden: document.hidden});
      }
      last = now;
    }, 20);
    // Re-check helpers (T2). tNow: ms since injection, the clock of __reqLog's t.
    window.tNow = () => Math.round(performance.now() - (window.__t0 || 0));
    // Nothing in flight and no segment held for a re-check (a re-check holds its segment until the
    // tweet lookup, and the hash lookup that may follow, have answered).
    window.settled = () => window.__inflight === 0 && !document.querySelector('.xdsu-rechecking');
    // A tweet's first lookups are over and it is red: tweet lookup answered, hash lookup answered.
    window.redIdle = (id, hash) => !!window.seg(id) && window.seg(id).dataset.state === 'missing'
      && window.lookups('media/' + hash).length > 0 && window.__inflight === 0;
    // Synthetic return signals: the window gets the focus, the pointer enters the page.
    window.focusWin = () => window.dispatchEvent(new Event('focus'));
    window.enter = (pointerType) => document.documentElement.dispatchEvent(new PointerEvent('pointerenter', {pointerType}));
    // Visibility changed without a visibilitychange event (which re-checks by itself).
    window.setHiddenQuiet = (hidden) => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
      Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => (hidden ? 'hidden' : 'visible')});
    };
    // The stored watch list (null if it is not JSON), and its tweet ids.
    window.storedWatch = () => {
      try {
        return JSON.parse(window.__store.watch);
      } catch {
        return null;
      }
    };
    window.storedIds = () => (window.storedWatch() || []).map((e) => e[0]);
    window.upload = (id) => document.querySelector(`#t${id} .xdsu-upload-btn`).click();
  }, profile);
  return r;
}

// Closes the page. Errors and unhandled rejections fail a scenario and make a known gap unsound.
async function fin(r, {pass, detail, sound = true}) {
  const unh = await r.page.evaluate(() => window.__unhandled);
  const errs = r.errors.filter((e) => !e.includes('Failed to load resource'));
  await r.ctx.close();
  const clean = !errs.length && !unh.length;
  return {pass: pass && clean, sound: sound && clean,
    detail: detail + (unh.length ? ` | unhandled=${JSON.stringify(unh)}` : '') + (errs.length ? ` | errors=${JSON.stringify(errs)}` : '')};
}

// Resolves true once fn(arg) is truthy in the page, false after ms.
const waitUntil = (page, fn, arg, ms) => page.waitForFunction(fn, arg, {timeout: ms, polling: 20}).then(() => true, () => false);

async function centre(page, sel) {
  return page.evaluate((sel) => {
    const e = document.querySelector(sel);
    if (!e.closest('.xdsu-pill')) {
      e.scrollIntoView({block: 'center'});
    }
    const b = e.getBoundingClientRect();
    return {x: b.left + b.width / 2, y: b.top + b.height / 2};
  }, sel);
}

// One real mouse click of a kind: left, ctrl (Ctrl + left), middle, right.
async function mouseClick(page, p, kind) {
  if (kind === 'ctrl' || kind === 'meta') {
    const key = kind === 'ctrl' ? 'Control' : 'Meta';
    await page.keyboard.down(key);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up(key);
  } else {
    await page.mouse.click(p.x, p.y, {button: kind === 'left' ? 'left' : kind});
  }
}

// The four clicks on one control. Left opens one tab in front, Ctrl + left and middle one tab
// behind, right opens nothing; with opens false (a segment since desktop task T11) no click opens
// anything. None may reach x.com (click, or auxclick/mousedown of the left or middle button), open
// a page of the browser's own or navigate. A right click is left to the browser (link menu), so its
// auxclick and contextmenu may bubble; they are listed, not judged.
async function clickMatrix(r, sel, urlRe, opens = true) {
  const {page} = r;
  const want = opens ? {left: true, ctrl: false, middle: false, right: null} : {left: null, ctrl: null, middle: null, right: null};
  const rows = [];
  let ok = true;
  for (const kind of Object.keys(want)) {
    const p = await centre(page, sel);
    const url0 = page.url();
    const nav0 = r.navs.length;
    const pop0 = r.popups.length;
    await page.evaluate(() => {
      window.__dnOff += 2000;
      window.__opened.length = 0;
      window.__openedOpts.length = 0;
      window.__reach.length = 0;
      window.__undefaulted.length = 0;
    });
    await mouseClick(page, p, kind);
    if (want[kind] !== null) {
      await waitUntil(page, () => window.__openedOpts.length > 0, null, 1000);
    }
    // Fixed settle: a second tab, a page the browser opens itself or a navigation would show by now.
    await sleep(300);
    const s = await page.evaluate(() => ({opened: window.__openedOpts.slice(), reach: window.__reach.slice(),
      undefaulted: window.__undefaulted.slice()}));
    const leaks = s.reach.filter((x) => kind !== 'right' && (/:click:/.test(x) || /:(auxclick|mousedown):[01]$/.test(x)));
    const tabs = s.opened.map((o) => `${o.opts && o.opts.active}`);
    const good = (want[kind] === null ? s.opened.length === 0
      : s.opened.length === 1 && s.opened[0].opts && s.opened[0].opts.active === want[kind] && urlRe.test(s.opened[0].url))
      && !s.reach.some((x) => /:click:/.test(x)) && !leaks.length && !s.undefaulted.length
      && r.popups.length === pop0 && r.navs.length === nav0 && page.url() === url0;
    ok = ok && good;
    rows.push(`${kind}: tabs=${s.opened.length}${tabs.length ? ' active=' + tabs.join(',') : ''}`
      + (s.reach.length ? ` reached=${JSON.stringify(s.reach)}` : '')
      + (s.undefaulted.length ? ` default not prevented=${JSON.stringify(s.undefaulted)}` : '')
      + (r.popups.length !== pop0 ? ` popups=${r.popups.length - pop0}` : '')
      + (r.navs.length !== nav0 || page.url() !== url0 ? ` navigated to ${page.url()}` : '')
      + (good ? '' : ' <-- wrong'));
  }
  return {ok, text: rows.join(', ')};
}

const S = {
  // Pointer media queries and the fine-pointer sizes at 1280x800 and 1920x1080: bar 6 px, segment
  // hit area 16 px (6 px above and 4 px below the bar), upload button 32x32 with a 40 px hit area.
  async d1_css(browser, v) {
    const rows = [];
    let ok = true;
    let errs = '';
    for (const [name, ctxOpts] of [['1280x800', DESKTOP], ['1920x1080', DESKTOP_WIDE]]) {
      const r = await setup(browser, {ctxOpts});
      await r.page.evaluate(() => {
        window.__db.push(window.post(501, 'https://x.com/u/status/7001/photo/1'));
        window.addBig('7001', 'DC1');
      });
      await inject(r.page, v);
      const ready = await waitUntil(r.page, () => window.seg('7001') && window.seg('7001').dataset.state === 'found'
        && document.querySelector('#t7001 .xdsu-upload-btn'), null, 5000);
      const g = !ready ? null : await r.page.evaluate(() => {
        const seg = window.seg('7001');
        const bar = seg.parentElement;
        const btn = document.querySelector('#t7001 .xdsu-upload-btn');
        const b = bar.getBoundingClientRect();
        const s = seg.getBoundingClientRect();
        const k = btn.getBoundingClientRect();
        const onSeg = (x, y) => {
          const e = document.elementFromPoint(x, y);
          return !!e && e.closest('.xdsu-bar-seg') === seg;
        };
        const onBtn = (x, y) => {
          const e = document.elementFromPoint(x, y);
          return !!e && e.closest('.xdsu-upload-btn') === btn;
        };
        // Chromium's elementFromPoint hits a 1x1 px area from the point (228.1 already hits a box
        // that starts at 229), so the scans step over whole pixels, on a layout that sits on whole
        // pixels (checked). Extent along a line: [first pixel hit, last pixel hit + 1).
        const whole = [b.top, b.bottom, s.left, s.right, k.left, k.right, k.top, k.bottom].every(Number.isInteger);
        const extent = (hit, from, to) => {
          let lo = null;
          let hi = null;
          for (let p = from; p <= to; p++) {
            if (hit(p)) {
              lo = lo === null ? p : lo;
              hi = p + 1;
            }
          }
          return lo === null ? null : {lo, hi};
        };
        const sx = Math.round(s.left + s.width / 2);
        const segV = extent((y) => onSeg(sx, y), b.top - 12, b.bottom + 12);
        const kx = Math.round(k.left + k.width / 2);
        const ky = Math.round(k.top + k.height / 2);
        const btnV = extent((y) => onBtn(kx, y), k.top - 10, k.bottom + 10);
        const btnH = extent((x) => onBtn(x, ky), k.left - 10, k.right + 10);
        return {coarse: matchMedia('(pointer: coarse)').matches, fine: matchMedia('(pointer: fine)').matches,
          hover: matchMedia('(hover: hover)').matches, whole, barH: b.height, segH: s.height,
          segHit: segV && {above: b.top - segV.lo, below: segV.hi - b.bottom, h: segV.hi - segV.lo},
          // The pixel rows 6 above and 4 below the bar hit the segment; the next ones out do not.
          edges: {hit6Above: onSeg(sx, b.top - 6), hit4Below: onSeg(sx, b.bottom + 3),
            miss7Above: !onSeg(sx, b.top - 7), miss5Below: !onSeg(sx, b.bottom + 4)},
          btn: `${k.width}x${k.height}`, btnHit: btnV && btnH && `${btnH.hi - btnH.lo}x${btnV.hi - btnV.lo}`};
      });
      const res = await fin(r, {pass: true, detail: ''});
      errs += res.detail;
      const good = !!g && !g.coarse && g.hover && g.whole && g.barH === 6 && g.segH === 6 && !!g.segHit
        && g.segHit.above === 6 && g.segHit.below === 4 && g.segHit.h === 16
        && Object.values(g.edges).every(Boolean) && g.btn === '32x32' && g.btnHit === '40x40';
      ok = ok && good && res.pass;
      rows.push(`${name}: ${g ? JSON.stringify(g) : 'bar or button never appeared'}${good ? '' : ' <-- wrong'}`);
    }
    return {pass: ok, detail: rows.join(' | ') + errs};
  },

  // Real mouse clicks (not touch) on a found segment, an upload button and the viewer button.
  async d2_mouse(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__db.push(window.post(501, 'https://x.com/u/status/7011/photo/1'));
      window.addBig('7011', 'DM1');
      window.addBig('7012', 'DM2');
    });
    await inject(r.page, v);
    const ready = await waitUntil(r.page, () => window.seg('7011') && window.seg('7011').dataset.state === 'found'
      && window.seg('7012') && window.seg('7012').dataset.state === 'missing', null, 5000);
    if (!ready) {
      return fin(r, {pass: false, detail: 'segments never reached found / missing'});
    }
    await r.page.evaluate(() => window.watchReach());
    // Since desktop task T11 a segment opens nothing; its clicks are swallowed.
    const seg = await clickMatrix(r, '#t7011 .xdsu-bar-seg', null, false);
    const btn = await clickMatrix(r, '#t7012 .xdsu-upload-btn', /\/uploads\/new\?/);
    // The viewer over the timeline, on the missing tweet's photo: the button uploads that image.
    await r.page.evaluate(() => {
      history.pushState({}, '', '/u/status/7012/photo/1');
      const layer = document.createElement('div');
      layer.id = 'viewer';
      layer.style.cssText = 'position:fixed;inset:0;z-index:1000;background:#000';
      layer.innerHTML = '<img src="https://pbs.twimg.com/media/DM2?format=jpg&name=large" style="width:100%;height:100%">';
      document.body.appendChild(layer);
    });
    const pillReady = await waitUntil(r.page, () => !!document.querySelector('.xdsu-pill[data-action="upload"]'), null, 3000);
    const pill = pillReady ? await clickMatrix(r, '.xdsu-pill', /\/uploads\/new\?/) : {ok: false, text: 'viewer button never offered an upload'};
    // Fixed: time for a late page of the browser's own to show up after the last click.
    await sleep(1000);
    return fin(r, {pass: seg.ok && btn.ok && pill.ok && r.popups.length === 0,
      detail: `found segment: ${seg.text} | upload button: ${btn.text} | viewer button: ${pill.text}`
        + ` | pages the browser opened itself=${r.popups.length}`});
  },

  // run_scroll.js's stay-mounted feed at 1920x1080, fast scroll then stop, Member and Gold. Judged:
  // one request in flight at most, the tweets visible at the stop resolve, and every key a request
  // names was within one screen height of the viewport when it was sent (so a tweet flown past and
  // never in range at a send is never requested). Recorded: requests per stop, tweets in range.
  async d3_wide_range(browser, v) {
    const rows = [];
    let ok = true;
    for (const [label, profile] of [['Member', SCROLL.MEMBER], ['Gold', SCROLL.GOLD]]) {
      const {r, atStop, m} = await SCROLL.fastStop(browser, v, false, {ctxOpts: DESKTOP_WIDE, profile,
        beforeInject: (page) => page.evaluate(() => {
          // Distance of each named key's segment from the viewport at send time (the script's own
          // measure: takeBatch runs in the same task as the send).
          const orig = window.GM_xmlhttpRequest;
          window.__sendDist = [];
          window.GM_xmlhttpRequest = (d) => {
            const url = decodeURIComponent(d.url);
            if (!url.includes('/profile.json')) {
              const ids = (url.match(/status\/(\d+)\*/g) || []).map((x) => Number(x.slice(7, -1)) - 6000)
                .concat((url.match(/media\/FD(\d+)\*/g) || []).map((x) => Number(x.slice(8, -1))));
              const dist = ids.map((i) => {
                const s = document.querySelector(`#t${6000 + i} .xdsu-bar-seg`);
                if (!s) {
                  return Infinity;
                }
                const b = s.getBoundingClientRect();
                return Math.max(0, -b.bottom, b.top - innerHeight);
              });
              window.__sendDist.push({ids, max: Math.round(Math.max(...dist))});
            }
            return orig(d);
          };
        })});
      const idle = await r.page.evaluate(() => window.waitIdle(600, 20000));
      const s = await r.page.evaluate((nAtStop) => {
        const y = window.scroller.scrollTop;
        const H = innerHeight;
        const tweets = [...document.querySelectorAll('article')].map((a) => {
          const b = a.querySelector('.xdsu-bar-seg').getBoundingClientRect();
          return {i: Number(a.id.slice(1)) - 6000, top: b.top + y, bottom: b.bottom + y};
        });
        // In range of the start (scroll 0) and of the stop, by the script's rule.
        const near = (t, at) => Math.max(0, at - t.bottom, t.top - (at + H)) <= H;
        const inRange = tweets.filter((t) => near(t, y)).map((t) => t.i);
        const flown = tweets.filter((t) => !near(t, 0) && !near(t, y)).map((t) => t.i);
        const requested = new Set(window.reqs('tweet').flatMap((x) => window.reqIds(x)));
        const after = window.__log.slice(nAtStop).filter((x) => x.kind !== 'profile');
        return {H, inRange, flown, flownRequested: flown.filter((i) => requested.has(i)),
          afterTweet: after.filter((x) => x.kind === 'tweet').length, afterHash: after.filter((x) => x.kind === 'hash').length,
          afterLog: after.map((x) => `${x.kind[0]}[${window.reqIds(x).concat((x.url.match(/media\/FD(\d+)\*/g) || [])
            .map((h) => 'h' + h.slice(8, -1))).join(',')}]`),
          maxDist: Math.max(...window.__sendDist.map((x) => x.max)),
          far: window.__sendDist.filter((x) => x.max > H), sends: window.__sendDist.length,
          maxInflight: window.__maxInflight, batch: window.reqs('tweet').reduce((n, x) => Math.max(n, x.terms), 0)};
      }, atStop.sentDuringScroll);
      const res = await fin(r, {pass: true, detail: ''});
      const good = m.ok && idle.ok && s.maxInflight <= 1 && s.far.length === 0 && res.pass;
      ok = ok && good;
      rows.push(`${label} (largest tweet batch ${s.batch}): visible at stop=[${atStop.vis}] in range at stop=${s.inRange.length}`
        + ` [${s.inRange}]; visible resolved in ${m.ms} ms with ${m.sent + m.inflightAtStop} requests`
        + ` (in flight ${m.inflightAtStop} + sent ${m.sent}); until idle (${idle.ok ? 'at ' + idle.t + ' ms' : 'NOT idle in 20 s'}):`
        + ` ${s.afterTweet} tweet + ${s.afterHash} hash requests sent after the stop ${JSON.stringify(s.afterLog)};`
        + ` flown past=${s.flown.length} of which requested while in range=${s.flownRequested.length} [${s.flownRequested}];`
        + ` farthest key at send=${s.maxDist} px of ${s.H} allowed${s.far.length ? ' OUT OF RANGE ' + JSON.stringify(s.far) : ''};`
        + ` maxInFlight=${s.maxInflight}${good ? '' : ' <-- wrong'}${res.detail}`);
    }
    return {pass: ok, detail: rows.join(' | ')};
  },

  // T2 (was a known gap). The tab stays visible: the user uploads in a window beside X and clicks
  // back into X. A focus on the window should re-check the watched tweet.
  async d4_focus_return(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.addBig('7101', 'FR1'));
    await inject(r.page, v);
    const red = await waitUntil(r.page, () => window.seg('7101') && window.seg('7101').dataset.state === 'missing'
      && window.lookups('media/FR1').length > 0 && window.__inflight === 0, null, 5000);
    const p = await centre(r.page, '#t7101 .xdsu-upload-btn');
    await r.page.mouse.click(p.x, p.y);
    const opened = await r.page.evaluate(() => {
      window.__db.push(window.post(601, 'https://x.com/u/status/7101/photo/1'));
      return window.__openedOpts.map((o) => o.opts && o.opts.active);
    });
    const watch = await r.page.evaluate(() => window.__store.watch || '');
    const n0 = await r.page.evaluate(() => window.lookups('status/7101').length);
    // Control, a fixed observation window: without a return nothing re-checks the tweet.
    await sleep(3000);
    const ctl = await r.page.evaluate(() => ({n: window.lookups('status/7101').length, state: window.seg('7101').dataset.state}));
    const t0 = Date.now();
    await r.page.evaluate(() => {
      window.__tFocus = Math.round(performance.now() - window.__t0);
      window.dispatchEvent(new Event('focus'));
    });
    const sent = await waitUntil(r.page, (n) => window.lookups('status/7101').length > n, ctl.n, 3000);
    const msSent = Date.now() - t0;
    const green = sent && await waitUntil(r.page, () => window.seg('7101').dataset.state === 'found', null, 3000);
    const msGreen = Date.now() - t0;
    const s = await r.page.evaluate(() => ({hidden: document.hidden, vis: window.__visEvents, focus: window.__focusEvents,
      state: window.seg('7101').dataset.state,
      log: window.__reqLog.filter((x) => /status\/7101|media\/FR1/.test(x.url)).map((x) => `${x.t}:${x.url.includes('media/') ? 'hash' : 'tweet'}`),
      tFocus: window.__tFocus}));
    const sound = red && opened.length === 1 && opened[0] === true && watch.includes('7101') && ctl.n === n0
      && ctl.state === 'missing' && !s.hidden && s.vis === 0;
    return fin(r, {sound, pass: sound && sent && green,
      detail: `red before=${red} upload tabs active=${JSON.stringify(opened)} watch=${watch} | control 3 s: lookups ${n0}->${ctl.n}`
        + ` state=${ctl.state} | focus at ${s.tFocus} ms: lookup ${sent ? 'after ' + msSent + ' ms' : 'NOT sent within 3 s'},`
        + ` ${green ? 'green after ' + msGreen + ' ms' : 'state ' + s.state} | hidden=${s.hidden} visibilitychange=${s.vis}`
        + ` window focus events=${JSON.stringify(s.focus)} | lookups of 7101=${JSON.stringify(s.log)}`});
  },

  // T2 (was a known gap). A tab opened behind (middle click) starts hidden and is logged out of
  // Danbooru. The login toast should be on screen when the tab is first looked at.
  async d5_hidden_toast(browser, v) {
    const r = await setup(browser, {profile: SCROLL.ANON});
    await r.page.evaluate(() => {
      window.addBig('7201', 'HT1');
      window.setHidden(true);
    });
    await inject(r.page, v);
    // Fixed: hidden for longer than the 8 s a toast with a link stays. That time passing is the point.
    await sleep(9000);
    const hid = await r.page.evaluate(() => ({toasts: window.__toastLog.slice(), profile: window.__profileReqs.slice(),
      lookups: window.__reqLog.filter((x) => !x.url.includes('/profile.json')).length}));
    const t0 = Date.now();
    await r.page.evaluate(() => {
      window.__tVisible = Math.round(performance.now() - window.__t0);
      window.setHidden(false);
    });
    const shown = await waitUntil(r.page, (text) => {
      const t = document.querySelector('.xdsu-toast');
      if (!t || !t.classList.contains('xdsu-show') || getComputedStyle(t).display === 'none' || t.textContent !== text) {
        return false;
      }
      const b = t.getBoundingClientRect();
      return b.width > 0 && b.left >= 0 && b.bottom <= innerHeight;
    }, LOGIN_TEXT, 3000);
    const ms = Date.now() - t0;
    const s = await r.page.evaluate(() => ({tVisible: window.__tVisible, toasts: window.__toastLog.slice(),
      profile: window.__profileReqs.slice(), lookups: window.__reqLog.filter((x) => !x.url.includes('/profile.json')).length}));
    const fmt = (ts) => JSON.stringify(ts.map((x) => `${x.t}${x.hidden ? ' hidden' : ''}: ${x.text}`));
    return fin(r, {pass: shown,
      detail: `while hidden (9 s): profile checks at ${JSON.stringify(hid.profile)} ms, lookups=${hid.lookups}, toasts=${fmt(hid.toasts)}`
        + ` | visible at ${s.tVisible} ms: login toast ${shown ? 'on screen after ' + ms + ' ms' : 'NOT on screen within 3 s'}`
        + ` | all profile checks=${JSON.stringify(s.profile)} lookups=${s.lookups} toasts=${fmt(s.toasts)}`});
  },

  // T2, D1 as it happens on a desktop. The upload tab opens in front (X hidden); the user drags it
  // out to a window of its own, so X is visible again and a ladder of re-checks starts (0, 5, 20
  // and 60 s); the ladder runs to its end while the user is still tagging; then the post is made
  // and the user clicks back into the X window. The entry must outlive the ladder, with no timer
  // left running, and the focus must re-check the tweet. v2.0.0 dropped the entry at the ladder's
  // last step.
  async d6_ladder_then_focus(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.addBig('7301', 'LF1'));
    await inject(r.page, v);
    const red = await waitUntil(r.page, () => window.redIdle('7301', 'LF1'), null, 5000);
    const p = await centre(r.page, '#t7301 .xdsu-upload-btn');
    await r.page.mouse.click(p.x, p.y);
    // The upload tab opens in front.
    await r.page.evaluate(() => window.setHidden(true));
    await sleep(500);
    const n0 = await r.page.evaluate(() => window.lookups('status/7301').length);
    // Dragged out to a window of its own: X is visible again.
    await r.page.evaluate(() => {
      window.__tVisible = window.tNow();
      window.setHidden(false);
    });
    // Fixed: the ladder runs in real time, its last step 60 s after the return; that time passing
    // is the point. Then 5 s more, in which nothing may be sent (no timer left behind).
    const ladder = await waitUntil(r.page, (n) => window.lookups('status/7301').length >= n + 4 && window.settled(), n0, 70000);
    await sleep(5000);
    const mid = await r.page.evaluate((n0) => ({stored: window.storedIds(), state: window.seg('7301').dataset.state,
      times: window.lookups('status/7301').slice(n0).map((x) => x.t - window.__tVisible)}), n0);
    // The user posts more than 15 s after the last step. The script measures RETURN_GAP_MS with
    // Date.now, so that time is stepped over (__dnOff) rather than waited.
    await r.page.evaluate(() => {
      window.__dnOff += 20000;
      window.__db.push(window.post(611, 'https://x.com/u/status/7301/photo/1'));
    });
    const n1 = n0 + mid.times.length;
    const t0 = Date.now();
    await r.page.evaluate(() => window.focusWin());
    const sent = await waitUntil(r.page, (n) => window.lookups('status/7301').length > n, n1, 3000);
    const msSent = Date.now() - t0;
    const green = sent && await waitUntil(r.page, () => window.seg('7301').dataset.state === 'found' && window.settled(), null, 3000);
    // A later return finds the post count risen: the entry goes, without a lookup.
    await r.page.evaluate(() => {
      window.__dnOff += 16000;
      window.focusWin();
    });
    // Fixed: 1 s for a lookup that must not come.
    await sleep(1000);
    const end = await r.page.evaluate(() => ({n: window.lookups('status/7301').length, stored: window.storedIds()}));
    const ladderOk = ladder && mid.times.length === 4 && mid.times[3] >= 59000 && mid.times[3] <= 62000;
    const pass = red && ladderOk && mid.stored.includes('7301') && mid.state === 'missing' && sent && green
      && end.n === n1 + 1 && !end.stored.includes('7301');
    return fin(r, {pass, detail: `red before=${red} | ladder: lookups at ${JSON.stringify(mid.times)} ms after the return,`
      + ` none in the 5 s after (${ladderOk ? 'ok' : 'WRONG'}) state=${mid.state} stored watch=${JSON.stringify(mid.stored)}`
      + ` | focus after the post: lookup ${sent ? 'after ' + msSent + ' ms' : 'NOT sent within 3 s'}, ${green ? 'green' : 'not green'}`
      + ` | next focus (16 s on): lookups ${n1 + 1}->${end.n} stored watch=${JSON.stringify(end.stored)}`});
  },

  // T2: the mouse coming back over the page (an upload posted in a window on another screen) is a
  // return: a mouse pointerenter on the root element re-checks the watched tweet. Touch and pen do
  // not, nor a mouse while nothing is watched or the tab is hidden. The events are synthetic and no
  // real pointer moves here: whether a browser sends pointerenter to <html> when the pointer comes
  // in from outside the window cannot be shown in this harness.
  async d7_pointer_return(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.addBig('7401', 'PR1'));
    await inject(r.page, v);
    const red = await waitUntil(r.page, () => window.redIdle('7401', 'PR1'), null, 5000);
    const count = () => r.page.evaluate(() => window.lookups('status/7401').length);
    const rows = [];
    let quiet = true;
    // Each must send nothing; fixed 1 s windows.
    const none = async (label, kind) => {
      const n = await count();
      await r.page.evaluate((kind) => {
        if (kind === 'hidden') {
          window.setHiddenQuiet(true);
          window.enter('mouse');
          window.setHiddenQuiet(false);
        } else {
          window.enter(kind);
        }
      }, kind);
      await sleep(1000);
      const d = (await count()) - n;
      quiet = quiet && d === 0;
      rows.push(`${label}: ${d}${d ? ' <-- want 0' : ''}`);
    };
    await none('mouse, nothing watched', 'mouse');
    await r.page.evaluate(() => {
      window.upload('7401');
      window.__db.push(window.post(621, 'https://x.com/u/status/7401/photo/1'));
    });
    await none('touch', 'touch');
    await none('pen', 'pen');
    await none('mouse, tab hidden', 'hidden');
    const n = await count();
    const t0 = Date.now();
    await r.page.evaluate(() => window.enter('mouse'));
    const sent = await waitUntil(r.page, (n) => window.lookups('status/7401').length > n, n, 3000);
    const msSent = Date.now() - t0;
    const green = sent && await waitUntil(r.page, () => window.seg('7401').dataset.state === 'found', null, 3000);
    const s = await r.page.evaluate(() => ({vis: window.__visEvents, focus: window.__focusEvents.length}));
    return fin(r, {pass: red && quiet && sent && green && s.vis === 0 && s.focus === 0,
      detail: `red before=${red} | lookups per pointerenter: ${rows.join(', ')}`
        + ` | mouse, watched and visible: lookup ${sent ? 'after ' + msSent + ' ms' : 'NOT sent within 3 s'},`
        + ` ${green ? 'green' : 'not green'} | visibilitychange=${s.vis} focus=${s.focus}`});
  },

  // T2: returns noticed while the tab stayed visible (focus, mouse) re-check at most once per
  // RETURN_GAP_MS (15 s), counted from the last pass of any kind, a ladder step included. The script
  // measures the gap with Date.now, so the scenario steps Date.now forward (__dnOff) instead of
  // waiting. Every step is past the 1.5 s refresh debounce, so only the gap can hold a signal back.
  // Then, in real time: such a pass leaves a running ladder alone, and starts none of its own.
  async d8_return_gap(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.addBig('7501', 'GP1'));
    await inject(r.page, v);
    const red = await waitUntil(r.page, () => window.redIdle('7501', 'GP1'), null, 5000);
    await r.page.evaluate(() => window.upload('7501'));
    // [Date.now step in ms, signal, lookups it should send]
    const plan = [
      [0, 'focus', 1],
      [2000, 'mouse', 0],
      [2000, 'focus', 0],
      [12000, 'mouse', 1], // 16 s after the first pass
      [2000, 'focus', 0],
      [16000, 'tab', 1], // a return to the tab: a pass at once, and a ladder
      [2000, 'focus', 0], // 2 s after the ladder's first pass
    ];
    const rows = [];
    let ok = red;
    let at = 0;
    let tabAt = null;
    for (const [dn, kind, want] of plan) {
      at += dn;
      const n = await r.page.evaluate(() => window.lookups('status/7501').length);
      await r.page.evaluate(([dn, kind]) => {
        window.__dnOff += dn;
        if (kind === 'focus') {
          window.focusWin();
        } else if (kind === 'mouse') {
          window.enter('mouse');
        } else {
          window.setHidden(true);
          window.setHidden(false);
        }
      }, [dn, kind]);
      if (want) {
        await waitUntil(r.page, (n) => window.lookups('status/7501').length > n && window.settled(), n, 3000);
      } else {
        // Fixed: 1 s for a lookup that must not come. After the 'tab' step this ends about 2 s into
        // the ladder, well before its 5 s step.
        await sleep(1000);
      }
      const got = (await r.page.evaluate(() => window.lookups('status/7501').length)) - n;
      ok = ok && got === want;
      rows.push(`+${at / 1000} s ${kind}: ${got}${got === want ? '' : ' <-- want ' + want}`);
      if (kind === 'tab') {
        tabAt = await r.page.evaluate((n) => window.lookups('status/7501')[n].t, n);
      }
    }
    // The ladder the 'tab' step started runs on untouched by a focus pass in between: its next step
    // still comes 5 s after its first (not cancelled, not restarted from the focus).
    const n8 = await r.page.evaluate(() => window.lookups('status/7501').length);
    await r.page.evaluate(() => {
      window.__dnOff += 16000;
      window.focusWin();
    });
    const focus8 = await waitUntil(r.page, (n) => window.lookups('status/7501').length > n && window.settled(), n8, 3000);
    const step1 = await waitUntil(r.page, (n) => window.lookups('status/7501').length > n + 1 && window.settled(), n8, 8000);
    const t8 = await r.page.evaluate((n) => window.lookups('status/7501').slice(n).map((x) => x.t), n8);
    const ladderOk = focus8 && step1 && t8.length === 2 && t8[1] - tabAt >= 4500 && t8[1] - tabAt <= 6000;
    rows.push(`a focus 16 s on, while the ladder runs: lookup at ${t8[0] - tabAt} ms after the ladder's first,`
      + ` the ladder's next at ${t8[1] - tabAt} ms${ladderOk ? '' : ' <-- want one focus lookup, then the ladder at ~5 s'}`);
    // Ends the ladder.
    await r.page.evaluate(() => window.setHidden(true));
    // Neither signal starts a ladder: after its pass, nothing for 6 s (a ladder re-checks at 5 s).
    // The tab is made visible without a visibilitychange, which would start one itself.
    for (const kind of ['focus', 'mouse']) {
      const n = await r.page.evaluate(() => window.lookups('status/7501').length);
      await r.page.evaluate((kind) => {
        window.__dnOff += 16000;
        window.setHiddenQuiet(false);
        if (kind === 'focus') {
          window.focusWin();
        } else {
          window.enter('mouse');
        }
      }, kind);
      const one = await waitUntil(r.page, (n) => window.lookups('status/7501').length > n && window.settled(), n, 3000);
      // Fixed: 6 s in which a ladder's 5 s step would show.
      await sleep(6000);
      const got = (await r.page.evaluate(() => window.lookups('status/7501').length)) - n;
      const good = one && got === 1;
      ok = ok && good;
      rows.push(`${kind} alone: ${got} lookup(s) in 6 s${good ? '' : ' <-- want 1'}`);
    }
    return fin(r, {pass: ok && ladderOk, detail: `red before=${red} | lookups per signal, at Date.now offsets: ${rows.join(', ')}`});
  },

  // T2: a tab switch fires visibilitychange and focus, in either order. Together they cost one
  // lookup per watched tweet and use one of its WATCH_MAX_CHECKS (12) checks. To show the count,
  // single returns follow the two switches until the entries leave the store, which must happen
  // right at the 12th lookup of each tweet. "focus first" is sent with the tab already visible
  // (the order in which focus could run a pass of its own), then visibilitychange. Date.now is
  // stepped (__dnOff) past the 1.5 s refresh debounce and the 15 s gap instead of waiting.
  async d9_tab_switch(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.addBig('7601', 'TS1');
      window.addBig('7602', 'TS2');
    });
    await inject(r.page, v);
    const red = await waitUntil(r.page, () => window.redIdle('7601', 'TS1') && window.redIdle('7602', 'TS2'), null, 5000);
    await r.page.evaluate(() => {
      window.upload('7601');
      window.upload('7602');
      // The upload tab opens in front.
      window.setHidden(true);
    });
    const IDS = ['7601', '7602'];
    const count = () => r.page.evaluate((ids) => ids.map((id) => window.lookups(`status/${id}`).length), IDS);
    // Every tweet has a lookup more than in b, and all of them have answered.
    const grew = ([ids, b]) => ids.every((id, i) => window.lookups(`status/${id}`).length > b[i]) && window.settled();
    const n0 = await count();
    const rows = [];
    let ok = red;
    for (const order of ['visibilitychange, focus', 'focus, visibilitychange']) {
      const b = await count();
      await r.page.evaluate((order) => {
        window.__dnOff += 16000;
        if (order === 'visibilitychange, focus') {
          window.setHidden(false);
          window.focusWin();
        } else {
          window.setHiddenQuiet(false);
          window.focusWin();
          document.dispatchEvent(new Event('visibilitychange'));
        }
      }, order);
      await waitUntil(r.page, grew, [IDS, b], 3000);
      // Fixed: 1 s in which no second lookup may follow (the ladder's next step is 5 s away).
      await sleep(1000);
      const d = (await count()).map((x, i) => x - b[i]);
      const good = d.every((x) => x === 1);
      ok = ok && good;
      rows.push(`${order}: lookups ${JSON.stringify(d)}${good ? '' : ' <-- want [1,1]'}`);
      // Back to the upload tab; this also ends the ladder the switch started.
      await r.page.evaluate(() => window.setHidden(true));
    }
    // Single returns (visibilitychange) until both entries have left the store. Each ends long
    // before the ladder's 5 s step; were one to come, it would be a counted lookup too.
    const singles = [];
    const left = {};
    for (let i = 0; i < 14 && Object.keys(left).length < IDS.length; i++) {
      const b = await count();
      await r.page.evaluate(() => {
        window.__dnOff += 2000;
        window.setHidden(false);
      });
      await waitUntil(r.page, grew, [IDS, b], 3000);
      const stored = await r.page.evaluate(() => window.storedIds());
      const c = (await count()).map((x, k) => x - n0[k]);
      IDS.forEach((id, k) => {
        if (!(id in left) && !stored.includes(id)) {
          left[id] = c[k];
        }
      });
      singles.push(c.join('/'));
      await r.page.evaluate(() => window.setHidden(true));
    }
    // A switch after that sends nothing. Fixed: 1.5 s for lookups that must not come.
    const b = await count();
    await r.page.evaluate(() => {
      window.__dnOff += 16000;
      window.setHidden(false);
      window.focusWin();
    });
    await sleep(1500);
    const extra = (await count()).map((x, i) => x - b[i]);
    const capOk = IDS.every((id) => left[id] === 12) && extra.every((x) => x === 0);
    return fin(r, {pass: ok && capOk,
      detail: `red before=${red} | ${rows.join(' | ')} | lookups of each tweet after each single return: ${singles.join(', ')}`
        + ` | left the store at lookup ${JSON.stringify(left)} (want 12 each) | a switch after that: lookups ${JSON.stringify(extra)}`});
  },

  // T2, D4: every X tab stores its watch entries under one key. A tab adds and removes its own
  // entries by reading the stored list, changing that entry and writing it back, so an entry
  // another tab stored after this one loaded survives both. Start-up prunes expired (and
  // malformed) entries, whoever wrote them. An entry another tab stored since for the same tweet
  // (another t0) is that tab's, so this tab's removal leaves it.
  async d10_watch_store(browser, v) {
    const now = Date.now();
    const seeded = [['8801', {t0: now - 60000, n0: 0}], ['8802', {t0: now - 31 * 60 * 1000, n0: 0}], ['8803'],
      ['8804', {t0: 'x', n0: 0}]];
    const r1 = await setup(browser, {store: {watch: JSON.stringify(seeded)}});
    await inject(r1.page, v);
    await sleep(300);
    const atStart = await r1.page.evaluate(() => window.__store.watch);
    const res1 = await fin(r1, {pass: true, detail: ''});
    const startOk = atStart === JSON.stringify([seeded[0]]);

    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.addBig('7701', 'WS1');
      window.addBig('7702', 'WS2');
    });
    await inject(r.page, v);
    const red = await waitUntil(r.page, () => window.redIdle('7701', 'WS1') && window.redIdle('7702', 'WS2'), null, 5000);
    const steps = [];
    const ids = async (label) => {
      const s = await r.page.evaluate(() => window.storedIds());
      steps.push(`${label}: ${JSON.stringify(s)}`);
      return s;
    };
    // Another tab, after this one loaded, stores a tweet of its own.
    await r.page.evaluate(() => {
      window.__store.watch = JSON.stringify((window.storedWatch() || []).concat([['8811', {t0: Date.now(), n0: 0}]]));
    });
    await ids('another tab stores 8811');
    await r.page.evaluate(() => window.upload('7701'));
    const add1 = await ids('this tab watches 7701');
    await r.page.evaluate(() => window.upload('7702'));
    const add2 = await ids('and 7702');
    // The other tab watches 7702 too, later (a newer t0).
    const t0b = await r.page.evaluate(() => {
      const t0 = Date.now() + 5;
      window.__store.watch = JSON.stringify((window.storedWatch() || []).map((e) => (e[0] === '7702' ? ['7702', {t0, n0: 0}] : e)));
      return t0;
    });
    await ids('another tab watches 7702 anew');
    // Both get a post; a focus re-checks them; the next pass (16 s on) drops both here.
    await r.page.evaluate(() => {
      window.__db.push(window.post(631, 'https://x.com/u/status/7701/photo/1'));
      window.__db.push(window.post(632, 'https://x.com/u/status/7702/photo/1'));
      window.__dnOff += 16000;
      window.focusWin();
    });
    const green = await waitUntil(r.page, () => window.seg('7701').dataset.state === 'found' && window.seg('7702').dataset.state === 'found'
      && window.settled(), null, 3000);
    const n = await r.page.evaluate(() => window.lookups('status/77').length);
    await r.page.evaluate(() => {
      window.__dnOff += 16000;
      window.focusWin();
    });
    // Fixed: 1 s for lookups that must not come (the post counts rose).
    await sleep(1000);
    const end = await ids('this tab drops 7701 and 7702');
    const last = await r.page.evaluate(() => ({n: window.lookups('status/77').length, foreign: window.lookups('status/88').length,
      e7702: ((window.storedWatch() || []).find((e) => e[0] === '7702') || [])[1] || null}));
    const pass = startOk && res1.pass && red && JSON.stringify(add1) === '["8811","7701"]'
      && JSON.stringify(add2) === '["8811","7701","7702"]' && green && JSON.stringify(end) === '["8811","7702"]'
      && last.e7702 && last.e7702.t0 === t0b && last.n === n && last.foreign === 0;
    return fin(r, {pass, detail: `start-up: seeded ${JSON.stringify(seeded.map((e) => e[0]))} (8802 expired, 8803/8804 malformed)`
      + ` -> stored ${atStart}${startOk ? '' : ' <-- want only 8801'}${res1.detail} | red before=${red} | ${steps.join(' | ')}`
      + ` | stored 7702 is the other tab's (t0 kept)=${!!last.e7702 && last.e7702.t0 === t0b} | green after the focus=${green}`
      + ` | lookups at the dropping pass=${last.n - n} | lookups of the other tab's tweets=${last.foreign}`});
  },

  // T2, D2: toasts that come while the tab is hidden wait; once it is visible they show one after
  // another, each for its full time (8 s with a link, 4 s without). A toast raised while visible
  // shows at once as before, and one on screen when the tab is hidden keeps its timer.
  async d11_hidden_toasts(browser, v) {
    const r = await setup(browser, {profile: Object.assign({}, SCROLL.ANON, {enable_safe_mode: true})});
    await r.page.evaluate(() => {
      // Menu commands by label: the Like toggle confirms with a toast, raised on demand below.
      window.__menu = {};
      window.GM_registerMenuCommand = (label, fn) => {
        window.__menu[label] = fn;
      };
      // Every stretch a toast is on screen: text, from and to (ms since injection), hidden then.
      window.__shown = [];
      let cur = null;
      setInterval(() => {
        const t = document.querySelector('.xdsu-toast');
        const text = t && t.classList.contains('xdsu-show') && getComputedStyle(t).display !== 'none' ? t.textContent : '';
        const at = window.tNow();
        if (cur && cur.text !== text) {
          cur.to = at;
          cur.hiddenAtEnd = document.hidden;
          cur = null;
        }
        if (text && !cur) {
          cur = {text, from: at, to: null, hidden: document.hidden};
          window.__shown.push(cur);
        }
      }, 20);
      window.setHidden(true);
    });
    await inject(r.page, v);
    // Fixed: 3 s hidden; the account check answers after 50 ms, so both of its toasts are due long
    // before the end.
    await sleep(3000);
    const tVis = await r.page.evaluate(() => {
      window.setHidden(false);
      return window.tNow();
    });
    // The k-th toast has come and gone.
    const ended = (k) => window.__shown.length > k && window.__shown[k].to !== null;
    const drained = await waitUntil(r.page, ended, 1, 15000);
    const tLike = await r.page.evaluate(() => {
      window.__menu['Like = re-check: on']();
      return window.tNow();
    });
    const likeDone = await waitUntil(r.page, ended, 2, 6000);
    const tLike2 = await r.page.evaluate(() => {
      window.__menu['Like = re-check: on']();
      return window.tNow();
    });
    await sleep(500);
    await r.page.evaluate(() => window.setHidden(true));
    const hiddenDone = await waitUntil(r.page, ended, 3, 6000);
    // Fixed: 1 s in which no further toast may appear.
    await sleep(1000);
    const s = await r.page.evaluate(() => window.__shown);
    const len = (x) => (x && x.to !== null ? x.to - x.from : null);
    const near = (x, want) => x !== null && Math.abs(x - want) <= 400;
    const want = [
      [LOGIN_TEXT, tVis, 8000],
      [SAFE_TEXT, s[0] ? s[0].to : null, 4000],
      ['Like no longer re-checks the tweet', tLike, 4000],
      ['Like now re-checks the tweet', tLike2, 4000],
    ];
    const rows = s.map((x) => `${x.from}-${x.to}${x.hidden ? ' (hidden)' : ''}${x.hiddenAtEnd ? ' (ended hidden)' : ''}: ${x.text}`);
    const good = drained && likeDone && hiddenDone && s.length === 4 && want.every(([text, start, ms], i) => s[i].text === text
      && !s[i].hidden && start !== null && s[i].from - start >= 0 && s[i].from - start <= 200 && near(len(s[i]), ms))
      && s[3].hiddenAtEnd;
    return fin(r, {pass: good, detail: `hidden until ${tVis} ms; Like toggled at ${tLike} and ${tLike2} ms, hidden again 0.5 s`
      + ` after the second | toasts on screen: ${JSON.stringify(rows)} | lengths ${JSON.stringify(s.map(len))}`});
  },

  // T2: a focus retries lookups that failed with a network error and are waiting out their
  // back-off (30 s), with the tab visible throughout: a browser check may have been passed in the
  // other window. The mouse coming back does not retry. Nothing is watched, so neither signal has a
  // re-check to run.
  async d12_focus_retry(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      const answer = window.__responder;
      window.__responder = (u) => (!window.__healthy && u.includes('status/7801') ? {error: true} : answer(u));
      window.addBig('7801', 'FT1');
    });
    await inject(r.page, v);
    // The lookup fails, is retried once 1.5 s later, fails again and waits out its back-off.
    const blue = await waitUntil(r.page, () => window.seg('7801') && window.seg('7801').dataset.state === 'error'
      && window.__inflight === 0, null, 6000);
    const count = () => r.page.evaluate(() => window.lookups('status/7801').length);
    const n0 = await count();
    await r.page.evaluate(() => {
      window.__healthy = true;
      window.enter('mouse');
    });
    // Fixed: 1.5 s in which the pointer must not retry.
    await sleep(1500);
    const n1 = await count();
    const t0 = Date.now();
    await r.page.evaluate(() => window.focusWin());
    const sent = await waitUntil(r.page, (n) => window.lookups('status/7801').length > n, n1, 2000);
    const msSent = Date.now() - t0;
    const red = sent && await waitUntil(r.page, () => window.seg('7801').dataset.state === 'missing', null, 3000);
    const s = await r.page.evaluate(() => ({vis: window.__visEvents, hidden: window.__reqLog.some((x) => x.hidden)}));
    return fin(r, {pass: blue && n0 === 2 && n1 === n0 && sent && red && s.vis === 0 && !s.hidden,
      detail: `failed (blue) after ${n0} lookups=${blue} | mouse enter: lookups ${n0}->${n1}`
        + ` | focus: retry ${sent ? 'after ' + msSent + ' ms' : 'NOT sent within 2 s'}, ${red ? 'red' : 'not red'}`
        + ` | visibilitychange=${s.vis} sent while hidden=${s.hidden}`});
  },

  // T2: a focus retries failed lookups and lifts a queue pause at most once per RETURN_GAP_MS
  // (15 s); a visibilitychange always does, and counts as the last retry. Otherwise, while Danbooru
  // refuses, every focus change would send a request that fails again and cancel the pause meant
  // to back off. The script measures the gap with Date.now, so the scenario steps Date.now forward
  // (__dnOff) instead of waiting. Nothing is watched, so no focus has a re-check pass to run.
  // A: network errors. One retry is one batch, which runBatch repeats once 1.5 s later for a
  // network error, so 2 requests. B: 429, which pauses the queue for 60 s with the key still
  // queued; lifting the pause sends it once more. C: a tab switch with a lookup that is refused
  // (403): visibilitychange and focus together, and focus after the visibilitychange's retry has
  // been answered. In the first, focus finds the retried lookup already queued, so even a focus
  // without the gap sends nothing more there; the second tells the two apart.
  async d13_focus_retry_gap(browser, v) {
    // A focus, Date.now stepped by dn first; returns the Date.now offset from the page's first focus.
    const focusAt = (page, dn) => page.evaluate((dn) => {
      window.__dnOff += dn;
      const t = Date.now();
      if (window.__f0 === undefined) {
        window.__f0 = t;
      }
      window.focusWin();
      return t - window.__f0;
    }, dn);
    const count = (page, id) => page.evaluate((id) => window.lookups(`status/${id}`).length, id);
    const failing = (id, answer) => (page) => page.evaluate(([id, answer]) => {
      const db = window.__responder;
      window.__responder = (u) => (u.includes(`status/${id}`) ? answer : db(u));
      window.addBig(id, 'RG' + id);
    }, [id, answer]);
    let ok = true;
    const rows = [];
    const errs = [];
    // Runs a list of [Date.now step, requests wanted] focuses; done(id) says a round has answered.
    const focuses = async (page, id, plan, settle) => {
      const out = [];
      for (const [dn, want] of plan) {
        const b = await count(page, id);
        const at = await focusAt(page, dn);
        if (want) {
          await waitUntil(page, settle, [id, b + want], 5000);
          // Fixed: 0.3 s in which no further request may follow.
          await sleep(300);
        } else {
          // Fixed: long enough for a retry (0.25 s flush, 1.5 s repeat of a network error).
          await sleep(2500);
        }
        const got = (await count(page, id)) - b;
        ok = ok && got === want;
        out.push(`focus at +${(at / 1000).toFixed(1)} s: ${got}${got === want ? '' : ' <-- want ' + want}`);
      }
      return out.join(', ');
    };

    const a = await setup(browser);
    await failing('7901', {error: true})(a.page);
    await inject(a.page, v);
    const errIdle = (id) => window.seg(id) && window.seg(id).dataset.state === 'error' && window.__inflight === 0;
    const aBlue = await waitUntil(a.page, errIdle, '7901', 6000);
    const aRows = await focuses(a.page, '7901', [[0, 2], [0, 0], [16000, 2]], ([id, n]) => window.lookups(`status/${id}`).length >= n
      && window.__inflight === 0 && window.seg(id).dataset.state === 'error');
    ok = ok && aBlue;
    rows.push(`A network error (failed=${aBlue}): ${aRows}`);
    errs.push((await fin(a, {pass: true, detail: ''})).detail);

    const b = await setup(browser);
    await failing('7911', {status: 429, body: ''})(b.page);
    await inject(b.page, v);
    const paused = await waitUntil(b.page, (id) => window.lookups(`status/${id}`).length === 1 && window.__inflight === 0, '7911', 4000);
    const bRows = await focuses(b.page, '7911', [[0, 1], [2000, 0], [16000, 1]], ([id, n]) => window.lookups(`status/${id}`).length >= n
      && window.__inflight === 0);
    ok = ok && paused;
    rows.push(`B 429 (paused=${paused}): ${bRows}`);
    errs.push((await fin(b, {pass: true, detail: ''})).detail);

    const c = await setup(browser);
    await failing('7921', {status: 403, body: ''})(c.page);
    await inject(c.page, v);
    const cBlue = await waitUntil(c.page, errIdle, '7921', 4000);
    const answered = ([id, n]) => window.lookups(`status/${id}`).length >= n && window.__inflight === 0
      && window.seg(id).dataset.state === 'error';
    let n = await count(c.page, '7921');
    await c.page.evaluate(() => {
      window.setHidden(true);
      window.__dnOff += 16000;
      window.setHidden(false);
      window.focusWin();
    });
    await waitUntil(c.page, answered, ['7921', n + 1], 3000);
    // Fixed: 1.5 s in which no second request may follow.
    await sleep(1500);
    const together = (await count(c.page, '7921')) - n;
    n = await count(c.page, '7921');
    await c.page.evaluate(() => {
      window.setHidden(true);
      window.__dnOff += 16000;
      window.setHidden(false);
    });
    await waitUntil(c.page, answered, ['7921', n + 1], 3000);
    await c.page.evaluate(() => window.focusWin());
    // Fixed: 1.5 s for a request the focus must not send.
    await sleep(1500);
    const after = (await count(c.page, '7921')) - n;
    ok = ok && cBlue && together === 1 && after === 1;
    rows.push(`C 403 tab switch (failed=${cBlue}): visibilitychange + focus together: ${together}${together === 1 ? '' : ' <-- want 1'},`
      + ` focus after the visibilitychange's retry was answered: ${after}${after === 1 ? '' : ' <-- want 1'}`);
    return fin(c, {pass: ok && errs.every((e) => !e), detail: `requests per focus: ${rows.join(' | ')}${errs.join('')}`});
  },

  // T6: a "not posted" or "partly posted" result is looked up again when its tweet is mounted again
  // more than 10 minutes (RESULT_MAX_AGE_MS) after the lookup. Not a fully posted one, not one
  // within the 10 minutes, not a tweet that stays mounted. While the new lookup runs, the new
  // segment shows the old result and pulses, never the grey "checking" line. The script measures
  // the age with Date.now, so the scenario steps it (__dnOff) instead of waiting.
  async d14_stale_remount(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      // 8001 not posted, 8002 posted, 8003 partly posted (1 of 2), 8004 not posted and stays mounted.
      window.__db.push(window.post(811, 'https://x.com/u/status/8002/photo/1'));
      window.__db.push(window.post(812, 'https://x.com/u/status/8003/photo/1'));
      window.mount = (id) => document.getElementById('root').appendChild(
          window.mkTweet({id, hashes: id === '8003' ? ['SE3a', 'SE3b'] : ['SE' + id.slice(3)]}));
      window.unmount = (ids) => ids.forEach((id) => document.getElementById('t' + id).remove());
      window.states = (id) => [...document.querySelectorAll(`#t${id} .xdsu-bar-seg`)].map((s) => s.dataset.state).join(',');
      ['8001', '8002', '8003', '8004'].forEach(window.mount);
    });
    await inject(r.page, v);
    const want0 = {'8001': 'missing', '8002': 'found', '8003': 'found,foundWeak', '8004': 'missing'};
    const atRest = (want) => Object.entries(want).every(([id, s]) => window.states(id) === s) && window.settled();
    const ready = await waitUntil(r.page, atRest, want0, 6000);
    const ids = ['8001', '8002', '8003', '8004'];
    const count = () => r.page.evaluate((ids) => ids.map((id) => window.lookups('status/' + id).length), ids);
    const n0 = await count();
    // 5 minutes on: mounted again, the results are reused as they are.
    await r.page.evaluate(() => {
      window.unmount(['8001', '8002', '8003']);
      window.__dnOff += 5 * 60 * 1000;
      ['8001', '8002', '8003'].forEach(window.mount);
    });
    const back5 = await waitUntil(r.page, atRest, want0, 3000);
    // Fixed: 1.5 s in which no lookup may be sent (a scan runs 0.1 s after the mount).
    await sleep(1500);
    const n5 = await count();
    // 11 minutes after the lookups, with posts made meanwhile for 8001 and 8003's second image.
    await r.page.evaluate(() => {
      window.unmount(['8001', '8002', '8003']);
      window.__dnOff += 6 * 60 * 1000;
      window.__db.push(window.post(813, 'https://x.com/u/status/8001/photo/1'));
      window.__db.push(window.post(814, 'https://x.com/u/status/8003/photo/2'));
      // What 8001's new segment shows, from its creation on; * marks a segment held for a re-check.
      window.__seq = [];
      window.__seqIv = setInterval(() => {
        const s = document.querySelector('#t8001 .xdsu-bar-seg');
        const now = s ? s.dataset.state + (s.classList.contains('xdsu-rechecking') ? '*' : '') : null;
        if (now && window.__seq[window.__seq.length - 1] !== now) {
          window.__seq.push(now);
        }
      }, 5);
      ['8001', '8002', '8003'].forEach(window.mount);
    });
    const want11 = {'8001': 'found', '8002': 'found', '8003': 'found,found', '8004': 'missing'};
    const back11 = await waitUntil(r.page, atRest, want11, 5000);
    // Fixed: 1 s for a lookup of 8002 or 8004, which must not come.
    await sleep(1000);
    const n11 = await count();
    const s = await r.page.evaluate((ids) => {
      clearInterval(window.__seqIv);
      return {seq: window.__seq, states: ids.map((id) => window.states(id))};
    }, ids);
    const d5 = n5.map((x, i) => x - n0[i]);
    const d11 = n11.map((x, i) => x - n5[i]);
    const seq = s.seq;
    const held = seq.length >= 2 && seq[0] === 'missing*' && seq[seq.length - 1] === 'found' && !seq.some((x) => x.startsWith('searching'));
    const pass = ready && back5 && d5.every((x) => x === 0) && back11 && JSON.stringify(d11) === '[1,0,1,0]' && held;
    return fin(r, {pass, detail: `first lookups done=${ready} | mounted again after 5 min: states restored=${back5},`
      + ` lookups ${JSON.stringify(d5)} (want none) | after 11 min: lookups per tweet ${JSON.stringify(d11)} (want [1,0,1,0]),`
      + ` states ${JSON.stringify(s.states)} | 8001's new segment showed ${JSON.stringify(seq)}`
      + `${held ? '' : ' <-- want the old state held (missing*) until found, never searching'}`});
  },

  // T6: in a tab left open for long the caches are trimmed. Past 3000 entries (CACHE_MAX_ENTRIES)
  // the oldest answered results that no tile in the page and no watched tweet uses are dropped,
  // down to 2400 (CACHE_TRIM_TO), at most once a minute (CACHE_TRIM_INTERVAL_MS); refresh debounce
  // stamps that have run out go too. Filling the caches through lookups would take thousands of
  // tweets, so an in-memory copy of the script publishes the caches (window.__tc, __hc, __lr) and
  // they are filled with made-up answered entries. Date.now is stepped past the minute (__dnOff).
  async d15_cache_trim(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__db.push(window.post(821, 'https://x.com/u/status/8101/photo/1'));
      // 8101 posted and 8102 not posted, both stay mounted; 8103 not posted, opened for upload
      // (watched) and then unmounted.
      window.addBig('8101', 'CT1');
      window.addBig('8102', 'CT2');
      window.addBig('8103', 'CT3');
    });
    await injectExposed(r.page, v);
    const ready = await waitUntil(r.page, () => !!window.seg('8101') && window.seg('8101').dataset.state === 'found'
      && window.redIdle('8102', 'CT2') && window.redIdle('8103', 'CT3'), null, 6000);
    if (!ready) {
      return fin(r, {pass: false, detail: 'the three tweets never reached found / missing / missing'});
    }
    await r.page.evaluate(() => {
      window.upload('8103');
      document.getElementById('t8103').remove();
      const now = Date.now();
      for (let i = 0; i < 3200; i++) {
        window.__tc['f' + i] = {state: 'done', posts: [], checkedAt: now - (4000 - i) * 1000};
        window.__hc['h' + i] = {state: 'done', posts: [], checkedAt: now - (4000 - i) * 1000};
      }
      // The real results are made older than any made-up one; only the unused one may go.
      ['8101', '8102', '8103'].forEach((id, k) => {
        window.__tc[id].checkedAt = k + 1;
      });
      window.__hc.CT2.checkedAt = 1;
      window.__hc.CT3.checkedAt = 2;
      window.__tc.p1 = {state: 'pending', posts: []};
      window.__lr.old = now - 60 * 1000;
      // A scan at once: an element added inside a tweet (since T7 the observer ignores the rest).
      window.poke = () => document.getElementById('t8101').appendChild(document.createElement('div'));
    });
    const sizes = () => r.page.evaluate(() => [Object.keys(window.__tc).length, Object.keys(window.__hc).length]);
    // Fixed waits of 0.5 s below: a scan runs 0.1 s after the page changes (poke).
    await r.page.evaluate(() => window.poke());
    await sleep(500);
    const early = await sizes();
    await r.page.evaluate(() => {
      window.__dnOff += 61 * 1000;
      window.poke();
    });
    await sleep(500);
    const after = await sizes();
    const kept = await r.page.evaluate(() => {
      const has = (c, k) => k in c;
      return {tweets: ['8101', '8102', '8103', 'p1'].filter((k) => has(window.__tc, k)).join(),
        tweetEdge: [has(window.__tc, 'f803'), has(window.__tc, 'f804')], hashes: ['CT2', 'CT3'].filter((k) => has(window.__hc, k)).join(),
        hashEdge: [has(window.__hc, 'h800'), has(window.__hc, 'h801')], oldStamp: has(window.__lr, 'old'),
        watched: (window.storedIds() || []).includes('8103'), states: [window.seg('8101').dataset.state, window.seg('8102').dataset.state]};
    });
    // More results within the minute: not trimmed until the minute has passed.
    await r.page.evaluate(() => {
      const now = Date.now();
      for (let i = 0; i < 1000; i++) {
        window.__tc['g' + i] = {state: 'done', posts: [], checkedAt: now};
      }
      window.poke();
    });
    await sleep(500);
    const within = await sizes();
    await r.page.evaluate(() => {
      window.__dnOff += 61 * 1000;
      window.poke();
    });
    await sleep(500);
    const later = await sizes();
    const pass = ready && early[0] === 3204 && early[1] === 3202 && after[0] === 2400 && after[1] === 2400
      && kept.tweets === '8101,8102,8103,p1' && JSON.stringify(kept.tweetEdge) === '[false,true]' && kept.hashes === 'CT2'
      && JSON.stringify(kept.hashEdge) === '[false,true]' && !kept.oldStamp && kept.watched
      && kept.states.join() === 'found,missing' && within[0] === 3400 && later[0] === 2400;
    return fin(r, {pass, detail: `ready=${ready} | sizes [tweet ids, hashes]: filled ${JSON.stringify(early)} (within the first`
      + ` minute), a minute on ${JSON.stringify(after)} (want [2400,2400]) | kept: tweet ids ${kept.tweets}`
      + ` (want 8101,8102,8103,p1: in the page, watched, pending), f803/f804 ${JSON.stringify(kept.tweetEdge)},`
      + ` hashes ${kept.hashes} (want CT2: CT3's tile is gone), h800/h801 ${JSON.stringify(kept.hashEdge)},`
      + ` stale debounce stamp kept=${kept.oldStamp}, 8103 still watched=${kept.watched}, states ${kept.states}`
      + ` | 1000 more within the minute: ${within[0]}, a minute on: ${later[0]} (want 3400, then 2400)`});
  },

  // T4, revised by T11: a segment only shows the state. With a mouse it keeps the default cursor
  // and does not light up in any state, but takes the pointer, so its label shows as the tooltip;
  // it does not take the keyboard focus. The viewer button darkens under the pointer like the
  // tile's button, and the controls that take the focus show a focus ring. On a phone none of the
  // hover rules apply, and the segments still take taps (to swallow them; see run_bar.js).
  async d16_hover_focus(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__db.push(window.post(831, 'https://x.com/u/status/8201/photo/1'));
      const answer = window.__responder;
      window.__responder = (u) => {
        if (u.includes('status/8203')) {
          return {error: true};
        }
        if (u.includes('status/8204')) {
          return {body: '[]', delay: 30000};
        }
        return answer(u);
      };
      window.addBig('8201', 'HF1');
      window.addBig('8202', 'HF2');
    });
    await inject(r.page, v);
    const state = (id) => r.page.evaluate((id) => window.seg(id) && window.seg(id).dataset.state, id);
    // One at a time, so that the failing and the slow lookup hold up nothing else.
    let ready = await waitUntil(r.page, () => !!window.seg('8201') && window.seg('8201').dataset.state === 'found'
      && window.redIdle('8202', 'HF2'), null, 6000);
    await r.page.evaluate(() => window.addBig('8203', 'HF3'));
    ready = ready && await waitUntil(r.page, () => !!window.seg('8203') && window.seg('8203').dataset.state === 'error'
      && window.__inflight === 0, null, 6000);
    await r.page.evaluate(() => window.addBig('8204', 'HF4'));
    ready = ready && await waitUntil(r.page, () => window.lookups('status/8204').length === 1, null, 3000);
    if (!ready || await state('8204') !== 'searching') {
      return fin(r, {pass: false, detail: `set-up: states ${JSON.stringify(await Promise.all(['8201', '8202', '8203', '8204'].map(state)))}`});
    }
    const look = (sel) => r.page.evaluate((sel) => {
      const el = document.querySelector(sel);
      const cs = getComputedStyle(el);
      return {filter: cs.filter, cursor: cs.cursor, pe: cs.pointerEvents, bg: cs.backgroundColor,
        outline: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor}`, title: el.title, aria: el.getAttribute('aria-label')};
    }, sel);
    const hover = async (sel) => {
      await r.page.mouse.move(5, 5);
      const p = await centre(r.page, sel);
      await r.page.mouse.move(p.x, p.y);
      const on = await look(sel);
      await r.page.mouse.move(5, 5);
      const off = await look(sel);
      return {on, off};
    };
    const rows = [];
    let ok = true;
    for (const id of ['8201', '8202', '8203', '8204']) {
      const h = await hover(`#t${id} .xdsu-bar-seg`);
      const good = h.on.filter === 'none' && h.on.cursor === 'default' && h.on.pe === 'auto' && !!h.on.title
        && h.on.title === h.on.aria && h.off.filter === 'none';
      ok = ok && good;
      rows.push(`${id} ${await state(id)}: hovered filter=${h.on.filter} cursor=${h.on.cursor} pointer-events=${h.on.pe}`
        + ` tooltip="${h.on.title}"${good ? '' : ' <-- wrong'}`);
    }
    // Keyboard: Tab until the control has the focus (at most 40 presses), then read its outline.
    const ring = async (sel) => {
      for (let i = 0; i < 40; i++) {
        if (await r.page.evaluate((sel) => document.activeElement && document.activeElement.matches(sel), sel)) {
          return (await look(sel)).outline;
        }
        await r.page.keyboard.press('Tab');
      }
      return 'never focused';
    };
    const RING = 'solid 2px rgb(91, 108, 255)';
    const segRing = await ring('#t8201 .xdsu-bar-seg');
    const btnRing = await ring('#t8202 .xdsu-upload-btn');
    // The viewer over the timeline, on the missing tweet's photo.
    await r.page.evaluate(() => {
      history.pushState({}, '', '/u/status/8202/photo/1');
      const layer = document.createElement('div');
      layer.style.cssText = 'position:fixed;inset:0;z-index:1000;background:#000';
      layer.innerHTML = '<img src="https://pbs.twimg.com/media/HF2?format=jpg&name=large" style="width:100%;height:100%">';
      document.body.appendChild(layer);
    });
    const pillReady = await waitUntil(r.page, () => !!document.querySelector('.xdsu-pill[data-action="upload"]'), null, 3000);
    const pill = pillReady ? await hover('.xdsu-pill') : null;
    const pillRing = pillReady ? await ring('.xdsu-pill') : 'no viewer button';
    const pillOk = !!pill && pill.on.bg === 'rgba(0, 0, 0, 0.78)' && pill.off.bg === 'rgba(0, 0, 0, 0.55)';
    const ringsOk = segRing === 'never focused' && [btnRing, pillRing].every((x) => x === RING);
    const res = await fin(r, {pass: true, detail: ''});
    // A phone: the same posted segment, touched and hovered, does not light up.
    const p = await setup(browser, {ctxOpts: PHONE});
    await p.page.evaluate(() => {
      window.__db.push(window.post(832, 'https://x.com/u/status/8211/photo/1'));
      window.addBig('8211', 'HF5');
    });
    await inject(p.page, v);
    const phoneReady = await waitUntil(p.page, () => !!window.seg('8211') && window.seg('8211').dataset.state === 'found', null, 6000);
    const pos = await centre(p.page, '#t8211 .xdsu-bar-seg');
    await p.page.mouse.move(pos.x, pos.y);
    const phone = await p.page.evaluate(() => ({mq: matchMedia('(hover: hover) and (pointer: fine)').matches,
      filter: getComputedStyle(window.seg('8211')).filter, pe: getComputedStyle(window.seg('8211')).pointerEvents}));
    const res2 = await fin(p, {pass: true, detail: ''});
    const phoneOk = phoneReady && !phone.mq && phone.filter === 'none' && phone.pe === 'auto';
    return {pass: ok && ringsOk && pillOk && phoneOk && res.pass && res2.pass,
      detail: `segments: ${rows.join(' | ')} | viewer button hovered bg=${pill && pill.on.bg}, after=${pill && pill.off.bg}${pillOk ? '' : ' <-- wrong'}`
        + ` | focus: posted segment=${segRing} (want never focused), upload button=${btnRing}, viewer button=${pillRing}${ringsOk ? '' : ' <-- want ' + RING}`
        + ` | phone: hover media query=${phone.mq}, filter=${phone.filter}, segment pointer-events=${phone.pe}${phoneOk ? '' : ' <-- wrong'}${res.detail}${res2.detail}`};
  },

  // T4, revised by T11: Command+click (macOS) opens the upload tab behind, as Ctrl+click and a middle
  // click do; a plain click still opens it in front. A click on a posted segment opens nothing. A
  // middle press on a segment is cancelled, so that it does not start the browser's autoscroll;
  // read from the mousedown event once its dispatch is over.
  async d17_meta_middle(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__db.push(window.post(841, 'https://x.com/u/status/8301/photo/1'));
      window.addBig('8301', 'MM1');
      window.addBig('8302', 'MM2');
      window.__downs = [];
      window.addEventListener('mousedown', (e) => {
        if (e.target.closest && e.target.closest('.xdsu-bar-seg')) {
          setTimeout(() => window.__downs.push(`${e.button}:${e.defaultPrevented}`), 0);
        }
      }, true);
    });
    await inject(r.page, v);
    const ready = await waitUntil(r.page, () => !!window.seg('8301') && window.seg('8301').dataset.state === 'found'
      && window.redIdle('8302', 'MM2'), null, 6000);
    if (!ready) {
      return fin(r, {pass: false, detail: 'set-up: segments never reached found / missing'});
    }
    const opened = async (sel, kind) => {
      const p = await centre(r.page, sel);
      await r.page.evaluate(() => {
        window.__dnOff += 2000;
        window.__openedOpts.length = 0;
      });
      await mouseClick(r.page, p, kind);
      await waitUntil(r.page, () => window.__openedOpts.length > 0, null, 1000);
      return r.page.evaluate(() => window.__openedOpts.map((o) => o.opts && o.opts.active));
    };
    const rows = [];
    let ok = true;
    // [label, selector, kind, the tab's active flag, or null for no tab]
    for (const [label, sel, kind, front] of [
      ['posted segment', '#t8301 .xdsu-bar-seg', 'left', null], ['posted segment', '#t8301 .xdsu-bar-seg', 'meta', null],
      ['upload button', '#t8302 .xdsu-upload-btn', 'left', true], ['upload button', '#t8302 .xdsu-upload-btn', 'meta', false]]) {
      const a = await opened(sel, kind);
      const want = front === null ? [] : [front];
      const good = JSON.stringify(a) === JSON.stringify(want);
      ok = ok && good;
      rows.push(`${label} ${kind}: active=${JSON.stringify(a)}${good ? '' : ' <-- want ' + JSON.stringify(want)}`);
    }
    // Middle presses: the posted segment, then the one that is not posted (no link).
    const downs = [];
    for (const sel of ['#t8301 .xdsu-bar-seg', '#t8302 .xdsu-bar-seg']) {
      const p = await centre(r.page, sel);
      await r.page.evaluate(() => {
        window.__dnOff += 2000;
        window.__downs.length = 0;
      });
      await r.page.mouse.move(p.x, p.y);
      await r.page.mouse.down({button: 'middle'});
      await r.page.mouse.up({button: 'middle'});
      await waitUntil(r.page, () => window.__downs.length > 0, null, 1000);
      downs.push((await r.page.evaluate(() => window.__downs.slice())).join());
    }
    const midOk = downs.every((d) => d === '1:true');
    return fin(r, {pass: ok && midOk, detail: `${rows.join(' | ')} | middle press [button:cancelled] on posted, not posted:`
      + ` ${JSON.stringify(downs)}${midOk ? '' : ' <-- want both cancelled'}`});
  },

  // T10: the photo grid of a profile's media tab, as captured on x.com (2026-11-28): tiles outside
  // every tweet, li[role=listitem] > a[role=link][href=/<user>/status/<id>/photo/1] > img, 194 px,
  // one tile per tweet. Each tile gets a one-segment bar over its bottom edge that shows the state:
  // any post (by the tweet, or by the image's media hash) makes it found, as the grid does not know
  // the image count. The label names the post or the post count. A click on the segment goes
  // through to the tile, and the script opens nothing. A tile reused for another tweet gets a new
  // bar. The photo links of a tweet get no grid bar. The viewer opened from a tile judges on its
  // own (here 1 post for a 2-image tweet: partly posted), not by the tile.
  async d18_photo_grid(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      [[851, 'https://x.com/u/status/8401'], [852, 'https://pbs.twimg.com/media/GR3.jpg'], [853, 'https://x.com/u/status/8404'],
        [854, 'https://x.com/u/status/8404'], [855, 'https://x.com/u/status/8405'], [857, 'https://x.com/u/status/8407']]
          .forEach(([id, src]) => window.__db.push(window.post(id, src)));
      window.gridTile = (id, hash) => `<li role="listitem"><div><a role="link" href="/u/status/${id}/photo/1"`
        + ` style="display:block;width:194px;height:194px"><div><img src="https://pbs.twimg.com/media/${hash}?format=jpg&name=360x360"`
        + ` style="display:block;width:194px;height:194px"></div></a></div></li>`;
      const ul = document.createElement('ul');
      ul.id = 'grid';
      ul.style.cssText = 'display:grid;grid-template-columns:repeat(3,194px);gap:4px 3px;list-style:none;margin:0;padding:0';
      ul.innerHTML = [['8401', 'GR1'], ['8402', 'GR2'], ['8403', 'GR3'], ['8404', 'GR4'], ['8405', 'GR5'], ['8406', 'GR6']]
          .map(([id, h]) => window.gridTile(id, h)).join('');
      document.body.appendChild(ul);
      window.gtile = (id) => document.querySelector(`#grid a[href*="/status/${id}/"]`);
      window.gseg = (id) => window.gtile(id) && window.gtile(id).querySelector('.xdsu-grid-bar .xdsu-bar-seg');
      window.__linkClicks = [];
      ul.addEventListener('click', (e) => {
        const a = e.target.closest('a');
        if (a) {
          window.__linkClicks.push(a.getAttribute('href'));
          e.preventDefault();
        }
      });
      // A tweet in the timeline too: its photo link is not a grid tile.
      window.addBig('8409', 'GR9');
    });
    await inject(r.page, v);
    const want = {8401: 'found', 8402: 'missing', 8403: 'found', 8404: 'found', 8405: 'found', 8406: 'missing'};
    const ready = await waitUntil(r.page, (want) => Object.entries(want).every(([id, s]) => window.gseg(id)
      && window.gseg(id).dataset.state === s) && window.__inflight === 0, want, 8000);
    if (!ready) {
      const s = await r.page.evaluate((ids) => ids.map((id) => window.gseg(id) ? window.gseg(id).dataset.state : 'no bar'), Object.keys(want));
      return fin(r, {pass: false, detail: `grid tiles never reached ${JSON.stringify(want)}: ${JSON.stringify(s)}`});
    }
    const g = await r.page.evaluate((ids) => {
      const rr = (b) => [b.left, b.top, b.right, b.bottom].map(Math.round);
      return {
        states: Object.fromEntries(ids.map((id) => [id, window.gseg(id) ? window.gseg(id).dataset.state : null])),
        labels: Object.fromEntries(ids.map((id) => [id, window.gseg(id) ? window.gseg(id).title : null])),
        bars: ids.map((id) => window.gtile(id).querySelectorAll('.xdsu-grid-bar').length),
        tile: rr(window.gtile('8401').getBoundingClientRect()), bar: rr(window.gtile('8401').querySelector('.xdsu-grid-bar').getBoundingClientRect()),
        segH: window.gseg('8401').getBoundingClientRect().height,
        inTweet: document.querySelectorAll('article .xdsu-grid-bar').length, tweetBar: !!document.querySelector('#t8409 .xdsu-bar'),
      };
    }, Object.keys(want));
    const geoOk = g.bar[0] === g.tile[0] + 6 && g.bar[2] === g.tile[2] - 6 && g.bar[3] === g.tile[3] - 6 && g.segH === 6;
    const labelOk = g.labels['8401'] === 'On Danbooru: post #851' && g.labels['8404'] === 'On Danbooru: 2 posts'
      && g.labels['8402'] === 'Not on Danbooru' && g.labels['8405'] === 'On Danbooru: post #855';
    // A mouse click on 8402's segment: the tile's link gets it, nothing is opened.
    const p = await centre(r.page, '#grid a[href*="/status/8402/"] .xdsu-bar-seg');
    await r.page.mouse.click(p.x, p.y);
    await sleep(300);
    const click = await r.page.evaluate(() => ({links: window.__linkClicks.slice(), opened: window.__openedOpts.length}));
    const clickOk = JSON.stringify(click.links) === '["/u/status/8402/photo/1"]' && click.opened === 0;
    // The tile of 8406 reused for 8407 (posted). The poll (2 s) sees the changed link.
    await r.page.evaluate(() => {
      const a = window.gtile('8406');
      a.setAttribute('href', '/u/status/8407/photo/1');
      a.querySelector('img').setAttribute('src', 'https://pbs.twimg.com/media/GR7?format=jpg&name=360x360');
    });
    const reused = await waitUntil(r.page, () => !!window.gseg('8407') && window.gseg('8407').dataset.state === 'found'
      && window.gtile('8407').querySelectorAll('.xdsu-grid-bar').length === 1
      && window.gtile('8407').querySelector('.xdsu-grid-bar').dataset.tweetId === '8407', null, 5000);
    // The viewer opened on 8405 shows two images; its button judges 1 post of 2 as partly posted.
    await r.page.evaluate(() => {
      history.pushState({}, '', '/u/status/8405/photo/1');
      const layer = document.createElement('div');
      layer.style.cssText = 'position:fixed;inset:0;z-index:1000;background:#000;overflow:hidden;white-space:nowrap';
      layer.innerHTML = '<img src="https://pbs.twimg.com/media/GR5?format=jpg&name=large" style="width:100vw;height:100vh">'
        + '<img src="https://pbs.twimg.com/media/GR5b?format=jpg&name=large" style="width:100vw;height:100vh">';
      document.body.appendChild(layer);
    });
    const pillOk = await waitUntil(r.page, () => {
      const pill = document.querySelector('.xdsu-pill');
      return !!pill && pill.dataset.state === 'foundWeak' && window.gseg('8405').dataset.state === 'found';
    }, null, 4000);
    const pill = await r.page.evaluate(() => {
      const el = document.querySelector('.xdsu-pill');
      return el ? `${el.dataset.state} "${el.getAttribute('aria-label')}"` : 'none';
    });
    const statesOk = ready && JSON.stringify(g.states) === JSON.stringify(want) && g.bars.every((n) => n === 1);
    const tweetOk = g.inTweet === 0 && g.tweetBar;
    return fin(r, {pass: statesOk && geoOk && labelOk && clickOk && reused && pillOk && tweetOk,
      detail: `states ${JSON.stringify(g.states)}${statesOk ? '' : ' <-- want ' + JSON.stringify(want)} | labels ${JSON.stringify(g.labels)}`
        + `${labelOk ? '' : ' <-- wrong'} | tile ${g.tile} bar ${g.bar} segment ${g.segH}px${geoOk ? '' : ' <-- want 6 px in from the sides and bottom, 6 px high'}`
        + ` | click on a segment: tile links ${JSON.stringify(click.links)}, opened ${click.opened}${clickOk ? '' : ' <-- wrong'}`
        + ` | tile reused for 8407: ${reused ? 'one new bar, found' : 'NOT'} | viewer on 8405: button ${pill}, tile`
        + ` ${pillOk ? 'found' : '?'}${pillOk ? '' : ' <-- want the button partly posted, the tile found'}`
        + ` | grid bars inside tweets ${g.inTweet}, the tweet's own bar ${g.tweetBar}`});
  },

  // T10: a grid of 60 tiles (20 rows) at 1280x800 is looked up from the viewport out, as the
  // timeline is: at the top only rows within one screen height are looked up; after a jump to the
  // bottom, the bottom rows; the rows passed over (never within range) never.
  async d19_grid_range(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      const ul = document.createElement('ul');
      ul.id = 'grid';
      ul.style.cssText = 'display:grid;grid-template-columns:repeat(3,194px);gap:4px 3px;list-style:none;margin:0;padding:0';
      let html = '';
      for (let i = 0; i < 60; i++) {
        html += `<li role="listitem"><a role="link" href="/u/status/${8500 + i}/photo/1" style="display:block;width:194px;height:194px">`
          + `<img src="https://pbs.twimg.com/media/GG${i}?format=jpg&name=360x360" style="display:block;width:194px;height:194px"></a></li>`;
      }
      ul.innerHTML = html;
      document.getElementById('root').replaceWith(ul);
      window.requested = () => [...new Set(window.__reqLog.flatMap((x) => [...x.url.matchAll(/status\/(\d+)\*/g)].map((m) => Number(m[1]) - 8500)))]
          .sort((a, b) => a - b);
      window.rowOf = (i) => Math.floor(i / 3);
      window.resolvedRows = (rows) => rows.every((row) => [0, 1, 2].every((c) => {
        const s = document.querySelector(`a[href*="/status/${8500 + row * 3 + c}/"] .xdsu-bar-seg`);
        return s && s.dataset.state !== 'searching';
      }));
    });
    await inject(r.page, v);
    const top = await waitUntil(r.page, () => window.resolvedRows([0, 1, 2, 3, 4, 5, 6, 7]) && window.__inflight === 0, null, 15000);
    // Fixed: 1 s in which nothing further may be sent.
    await sleep(1000);
    const atTop = await r.page.evaluate(() => [...new Set(window.requested().map(window.rowOf))]);
    await r.page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const bottom = await waitUntil(r.page, () => window.resolvedRows([14, 15, 16, 17, 18, 19]) && window.__inflight === 0, null, 15000);
    await sleep(1000);
    const all = await r.page.evaluate(() => [...new Set(window.requested().map(window.rowOf))]);
    const middle = [9, 10, 11];
    const pass = top && bottom && atTop.every((row) => row <= 8) && middle.every((row) => !all.includes(row));
    return fin(r, {pass, detail: `rows looked up at the top: [${atTop}]${top ? '' : ' (rows 0-7 NOT all resolved)'}`
      + ` | after the jump to the bottom: [${all}]${bottom ? '' : ' (rows 14-19 NOT all resolved)'}`
      + ` | rows 9-11 (passed over) looked up: ${middle.filter((row) => all.includes(row)).join(',') || 'none'}`});
  },

  // T12: a photo grid is answered author by author. One search for every post whose source names a
  // tweet of the grid's author (one term, 200 posts a page) turns every posted tile green with no
  // lookup of its own. Only the tiles it left open are looked up tweet by tweet: a post that names
  // the tweet without the author (i/web), one that names only the image, and the ones not posted.
  // The viewer opened on an author-found tile still looks the tweet up itself. Further: an author
  // with more than 200 posts is read page by page; when the author search fails every tile falls
  // back to its own lookup.
  async d20_grid_author(browser, v) {
    const gridPage = async (tiles, cols) => {
      const r = await setup(browser);
      await r.page.evaluate(([tiles, cols]) => {
        const ul = document.createElement('ul');
        ul.id = 'grid';
        ul.style.cssText = `display:grid;grid-template-columns:repeat(${cols},194px);gap:4px 3px;list-style:none;margin:0;padding:0`;
        ul.innerHTML = tiles.map(([path, hash]) => `<li role="listitem"><a role="link" href="${path}/photo/1"`
          + ` style="display:block;width:194px;height:194px"><img src="https://pbs.twimg.com/media/${hash}?format=jpg&name=360x360"`
          + ` style="display:block;width:194px;height:194px"></a></li>`).join('');
        document.getElementById('root').replaceWith(ul);
        window.gstate = (id) => {
          const s = document.querySelector(`#grid a[href*="/status/${id}/"] .xdsu-bar-seg`);
          return s ? s.dataset.state : null;
        };
        window.glabel = (id) => document.querySelector(`#grid a[href*="/status/${id}/"] .xdsu-bar-seg`).title;
        // The author search: every post whose source has /<user>/status/, without regard to case,
        // by page. Everything else goes to the table of setup().
        const table = window.__responder;
        window.__responder = (u) => {
          const am = u.match(/source:\*\/([^/*]+)\/status\/\*/);
          if (!am) {
            return table(u);
          }
          if (window.__authorFail) {
            return {status: 500, body: 'oops'};
          }
          const limit = Number(u.match(/limit=(\d+)/)[1]);
          const page = Number((u.match(/[?&]page=(\d+)/) || [0, 1])[1]);
          const all = window.__db.filter((p) => p.source.toLowerCase().includes(`/${am[1].toLowerCase()}/status/`));
          return {body: JSON.stringify(all.slice((page - 1) * limit, page * limit))};
        };
        window.authorReqs = () => window.__reqLog.filter((x) => /source:\*\/[^/*]+\/status\/\*/.test(x.url));
        // Tweet ids named by the lookups that are not author searches.
        window.idsLookedUp = () => [...new Set(window.__reqLog.filter((x) => !/source:\*\//.test(x.url))
            .flatMap((x) => [...x.url.matchAll(/status\/(\d+)\*/g)].map((m) => m[1])))].sort();
      }, [tiles, cols]);
      return r;
    };
    const range = (a, n) => Array.from({length: n}, (_, i) => String(a + i));

    // A: 31 tiles. 8600-8619 posted under the author's name, 8620 posted as i/web, 8621 posted with
    // the image as its source, 8622-8629 not posted, 8630 a tile whose link names no author.
    const tilesA = range(8600, 30).map((id) => [`/Artist_1/status/${id}`, 'GA' + id]).concat([['/i/web/status/8630', 'GA8630']]);
    const a = await gridPage(tilesA, 6);
    await a.page.evaluate((ids) => {
      ids.forEach((id, i) => window.__db.push(window.post(9000 + i, i === 1
        ? `https://twitter.com/Artist_1/status/${id}/photo/1` : `https://x.com/artist_1/status/${id}`)));
      window.__db.push(window.post(9100, 'https://x.com/artist_1/status/8603'));
      window.__db.push(window.post(9101, 'https://x.com/i/web/status/8620'));
      window.__db.push(window.post(9102, 'https://pbs.twimg.com/media/GA8621.jpg'));
    }, range(8600, 20));
    await inject(a.page, v);
    const posted = range(8600, 20);
    const greens = await waitUntil(a.page, (ids) => ids.every((id) => window.gstate(id) === 'found'), posted, 6000);
    const early = await a.page.evaluate(() => ({first: window.__reqLog.filter((x) => !x.url.includes('/profile.json'))[0],
      author: window.authorReqs().length, ids: window.idsLookedUp()}));
    const firstOk = !!early.first && /limit=200/.test(early.first.url) && (early.first.url.match(/source:/g) || []).length === 1
      && /source:\*\/artist_1\/status\/\*/.test(early.first.url);
    const wantA = Object.fromEntries(posted.map((id) => [id, 'found']).concat([['8620', 'found'], ['8621', 'found']],
        range(8622, 9).map((id) => [id, 'missing'])));
    const doneA = await waitUntil(a.page, (want) => Object.entries(want).every(([id, s]) => window.gstate(id) === s)
      && window.__inflight === 0, wantA, 15000);
    const endA = await a.page.evaluate(() => ({author: window.authorReqs().length, ids: window.idsLookedUp(),
      label: window.glabel('8603'), max: 0}));
    const idsOk = JSON.stringify(endA.ids) === JSON.stringify(range(8620, 11));
    // The viewer on an author-found tile: its button looks the tweet up itself.
    await a.page.evaluate(() => {
      history.pushState({}, '', '/Artist_1/status/8600/photo/1');
      const layer = document.createElement('div');
      layer.style.cssText = 'position:fixed;inset:0;z-index:1000;background:#000';
      layer.innerHTML = '<img src="https://pbs.twimg.com/media/GA8600?format=jpg&name=large" style="width:100%;height:100%">';
      document.body.appendChild(layer);
    });
    const pill = await waitUntil(a.page, () => {
      const p = document.querySelector('.xdsu-pill');
      return !!p && p.dataset.state === 'found' && window.lookups('status/8600*').length === 1;
    }, null, 5000);
    const resA = await fin(a, {pass: true, detail: ''});
    const okA = greens && firstOk && early.author === 1 && early.ids.every((id) => !posted.includes(id)) && doneA
      && endA.author === 1 && idsOk && endA.label === 'On Danbooru: 2 posts' && pill && resA.pass;

    // B: an author with 250 posts. The tile of the 230th post turns green from page 2.
    const b = await gridPage([['/Big/status/8700', 'GB0'], ['/Big/status/8701', 'GB1'], ['/Big/status/8702', 'GB2']], 3);
    await b.page.evaluate(() => {
      for (let i = 0; i < 250; i++) {
        const id = i === 229 ? 8700 : i === 5 ? 8701 : 700000 + i;
        window.__db.push(window.post(20000 + i, `https://x.com/big/status/${id}`));
      }
    });
    await inject(b.page, v);
    const doneB = await waitUntil(b.page, () => window.gstate('8700') === 'found' && window.gstate('8701') === 'found'
      && window.gstate('8702') === 'missing' && window.__inflight === 0, null, 8000);
    const endB = await b.page.evaluate(() => ({pages: window.authorReqs().map((x) => Number(x.url.match(/[?&]page=(\d+)/)[1])),
      ids: window.idsLookedUp()}));
    const resB = await fin(b, {pass: true, detail: ''});
    const okB = doneB && JSON.stringify(endB.pages) === '[1,2]' && JSON.stringify(endB.ids) === '["8702"]' && resB.pass;

    // C: the author search fails (500). Every tile is then looked up by itself.
    const c = await gridPage([['/Down/status/8800', 'GC0'], ['/Down/status/8801', 'GC1']], 3);
    await c.page.evaluate(() => {
      window.__authorFail = true;
      window.__db.push(window.post(30000, 'https://x.com/down/status/8800'));
    });
    await inject(c.page, v);
    const doneC = await waitUntil(c.page, () => window.gstate('8800') === 'found' && window.gstate('8801') === 'missing'
      && window.__inflight === 0, null, 8000);
    const endC = await c.page.evaluate(() => ({author: window.authorReqs().length, ids: window.idsLookedUp()}));
    const resC = await fin(c, {pass: true, detail: ''});
    const okC = doneC && endC.author === 1 && JSON.stringify(endC.ids) === '["8800","8801"]' && resC.pass;

    return {pass: okA && okB && okC,
      detail: `A: 20 posted tiles green=${greens}, first lookup is the author search=${firstOk}, by then author searches=${early.author}`
        + ` and tweets looked up=[${early.ids}]; in the end author searches=${endA.author}, tweets looked up=[${endA.ids}]`
        + `${idsOk ? '' : ' <-- want 8620..8630 only'}, all states right=${doneA}, 8603 "${endA.label}", viewer button looked 8600 up itself=${pill}`
        + `${okA ? '' : ' <-- A wrong'}${resA.detail} | B (250 posts): pages ${JSON.stringify(endB.pages)}, states right=${doneB},`
        + ` tweets looked up=[${endB.ids}]${okB ? '' : ' <-- B wrong'}${resB.detail} | C (author search fails): author searches=${endC.author},`
        + ` tweets looked up=[${endC.ids}], states right=${doneC}${okC ? '' : ' <-- C wrong'}${resC.detail}`};
  },

  // T12: while a photo grid is in the page, up to 4 lookups (GRID_PARALLEL) run at once; the author
  // search runs alone before them. A timeline keeps to one request at a time. After a 429 the grid
  // goes back to one at a time as well. Lookups answer after 300 ms, so that overlaps show.
  async d21_grid_parallel(browser, v) {
    const slow = () => {
      const table = window.__responder;
      window.__responder = (u) => {
        if (window.__limit && /status\/\d+\*/.test(u)) {
          return {status: 429, body: 'slow down', delay: 300};
        }
        return Object.assign(table(u), {delay: 300});
      };
      // The largest number of lookups in flight at once, and whether an author search overlapped
      // any other lookup, from the request log (profile checks left out).
      window.overlap = (from = 0) => {
        const reqs = window.__reqLog.filter((x) => !x.url.includes('/profile.json') && x.t >= from && x.done !== null);
        const isAuthor = (x) => /source:\*\/[^/*]+\/status\/\*/.test(x.url);
        const over = (a, b) => a !== b && a.t < b.done && b.t < a.done;
        return {max: Math.max(0, ...reqs.map((a) => 1 + reqs.filter((b) => over(a, b)).length)),
          authorAlone: reqs.filter(isAuthor).every((a) => !reqs.some((b) => over(a, b))),
          tweets: reqs.filter((x) => !isAuthor(x) && /status\/\d+\*/.test(x.url)).length, n: reqs.length};
      };
    };
    const grid = (ids) => {
      const ul = document.createElement('ul');
      ul.id = 'grid';
      ul.style.cssText = 'display:grid;grid-template-columns:repeat(6,194px);gap:4px 3px;list-style:none;margin:0;padding:0';
      ul.innerHTML = ids.map((id) => `<li role="listitem"><a role="link" href="/Par/status/${id}/photo/1"`
        + ` style="display:block;width:194px;height:194px"><img src="https://pbs.twimg.com/media/GP${id}?format=jpg&name=360x360"`
        + ` style="display:block;width:194px;height:194px"></a></li>`).join('');
      document.getElementById('root').replaceWith(ul);
    };
    const allMissing = (n) => {
      const s = [...document.querySelectorAll('.xdsu-bar-seg')];
      return s.length === n && s.every((x) => x.dataset.state === 'missing') && window.__inflight === 0;
    };
    const ids = Array.from({length: 24}, (_, i) => String(8900 + i));

    // A: a grid of 24 tiles, none posted, Member (3 tweets a request).
    const a = await setup(browser);
    await a.page.evaluate(slow);
    await a.page.evaluate(grid, ids);
    await inject(a.page, v);
    const doneA = await waitUntil(a.page, allMissing, 24, 15000);
    const oa = await a.page.evaluate(() => window.overlap());
    const resA = await fin(a, {pass: true, detail: ''});
    const okA = doneA && oa.max === 4 && oa.authorAlone && oa.tweets === 8 && resA.pass;

    // B: a timeline of 8 tweets (all within range of the viewport), none posted: one request at a
    // time.
    const b = await setup(browser);
    await b.page.evaluate(slow);
    await b.page.evaluate(() => {
      for (let i = 0; i < 8; i++) {
        window.add({id: String(8950 + i), hashes: ['GT' + i]});
      }
    });
    await inject(b.page, v);
    const doneB = await waitUntil(b.page, allMissing, 8, 20000);
    const ob = await b.page.evaluate(() => window.overlap());
    const resB = await fin(b, {pass: true, detail: ''});
    const okB = doneB && ob.max === 1 && ob.n >= 6 && resB.pass;

    // C: the grid again, with the first tweet lookups answered 429. The queue pauses; a return to
    // the tab lifts the pause, and from then on the grid sends one request at a time.
    const c = await setup(browser);
    await c.page.evaluate(slow);
    await c.page.evaluate(() => {
      window.__limit = true;
    });
    await c.page.evaluate(grid, ids);
    await inject(c.page, v);
    const limited = await waitUntil(c.page, () => window.__reqLog.filter((x) => /status\/\d+\*/.test(x.url)
      && !/source:\*\//.test(x.url) && x.done !== null).length >= 1 && window.__inflight === 0, null, 8000);
    const tReturn = await c.page.evaluate(() => {
      window.__limit = false;
      const t = window.tNow();
      window.setHidden(true);
      window.setHidden(false);
      return t;
    });
    const doneC = await waitUntil(c.page, allMissing, 24, 30000);
    const oc = await c.page.evaluate((t) => ({before: window.overlap().max, after: window.overlap(t)}), tReturn);
    const resC = await fin(c, {pass: true, detail: ''});
    const okC = limited && doneC && oc.after.max === 1 && oc.after.n > 8 && resC.pass;

    return {pass: okA && okB && okC,
      detail: `A grid: all 24 resolved=${doneA}, most lookups at once=${oa.max} (want 4), author search alone=${oa.authorAlone},`
        + ` tweet lookups=${oa.tweets} (want 8)${okA ? '' : ' <-- A wrong'}${resA.detail} | B timeline: resolved=${doneB}, most at once=${ob.max}`
        + ` (want 1)${okB ? '' : ' <-- B wrong'}${resB.detail} | C grid after a 429: paused=${limited}, resolved after the return=${doneC},`
        + ` most at once before=${oc.before}, after=${oc.after.max} over ${oc.after.n} lookups (want 1)${okC ? '' : ' <-- C wrong'}${resC.detail}`};
  },
};

// Injects an in-memory copy of the variant that publishes its caches as window.__tc (tweet ids),
// __hc (media hashes) and __lr (refresh debounce stamps). Throws if an anchor is not found once.
async function injectExposed(page, v) {
  let src = readScript(v);
  for (const [anchor, add] of [
    ['const hashCache = Object.create(null);', ' window.__tc = tweetCache; window.__hc = hashCache;'],
    ['const lastRefresh = Object.create(null);', ' window.__lr = lastRefresh;'],
  ]) {
    if (src.split(anchor).length !== 2) {
      throw new Error('expose anchor not found once: ' + anchor);
    }
    src = src.replace(anchor, anchor + add);
  }
  await page.evaluate(() => {
    window.__t0 = performance.now();
  });
  await page.addScriptTag({content: src});
}

(async () => {
  const browser = await chromium.launch();
  for (const v of variants) {
    console.log(`\n===== ${v} =====`);
    for (const [name, fn] of Object.entries(S)) {
      if (only && !only.includes(name)) {
        continue;
      }
      const t0 = Date.now();
      let timer = null;
      try {
        // A cancelled timeout, so the process ends when the last scenario does.
        const timeout = new Promise((res) => {
          timer = setTimeout(() => res({pass: false, sound: false, detail: 'TIMEOUT'}), 120000);
        });
        const r = await Promise.race([fn(browser, v), timeout]);
        clearTimeout(timer);
        const secs = Math.round((Date.now() - t0) / 1000);
        const task = KNOWN_GAPS[name];
        let head = `${r.pass ? 'PASS' : 'FAIL'}  ${name} (${secs} s)`;
        let detail = r.detail;
        if (task && r.sound === false) {
          head = `FAIL  ${name} (${secs} s)`;
          detail = `known gap (${task}) whose set-up went wrong, so the result says nothing: ${detail}`;
        } else if (task && r.pass) {
          head = `FAIL  ${name} (${secs} s)`;
          detail = `now passes: remove it from KNOWN_GAPS (closes with ${task}) | ${detail}`;
        } else if (task) {
          head = `GAP   ${name} (closes with ${task}) (${secs} s)`;
        }
        console.log(`${head}\n      ${detail}`);
      } catch (e) {
        clearTimeout(timer);
        console.log(`HARNESS-ERROR ${name}: ${e.message.split('\n')[0]}`);
      }
    }
  }
  await browser.close();
})();
