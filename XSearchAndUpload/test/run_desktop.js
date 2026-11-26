// Desktop browsers: no touch, mouse and keyboard, wide windows (h.js DESKTOP, DESKTOP_WIDE).
// node run_desktop.js [variant,..] [scenario,..]
// A scenario in KNOWN_GAPS documents behaviour that a later task adds. While the behaviour is
// missing it prints GAP (run_all.js counts it apart from PASS and FAIL); once it is there it prints
// FAIL until the entry is removed, so the scenario becomes an ordinary one with that task.
const {chromium, newPage, inject, sleep, DESKTOP, DESKTOP_WIDE} = require('./h.js');
const SCROLL = require('./run_scroll.js');

const variants = (process.argv[2] || 'current').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;
const LOGIN_TEXT = 'Not logged in to Danbooru – lookups limited';

// Scenario name -> the task that closes the gap.
const KNOWN_GAPS = {
  d4_focus_return: 'T2',
  d5_hidden_toast: 'T2',
};

// ---------- synthetic page (h.js) ----------

async function setup(browser, {ctxOpts = DESKTOP, profile = null} = {}) {
  const r = await newPage(browser, {ctxOpts});
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
  if (kind === 'ctrl') {
    await page.keyboard.down('Control');
    await page.mouse.click(p.x, p.y);
    await page.keyboard.up('Control');
  } else {
    await page.mouse.click(p.x, p.y, {button: kind === 'left' ? 'left' : kind});
  }
}

// The four clicks on one control. Left opens one tab in front, Ctrl + left and middle one tab
// behind, right opens nothing. None may reach x.com (click, or auxclick/mousedown of the left or
// middle button), open a page of the browser's own or navigate. A right click is left to the
// browser (link menu), so its auxclick and contextmenu may bubble; they are listed, not judged.
async function clickMatrix(r, sel, urlRe) {
  const {page} = r;
  const want = {left: true, ctrl: false, middle: false, right: null};
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
    const seg = await clickMatrix(r, '#t7011 .xdsu-bar-seg', /\/posts\/501$/);
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

  // Known gap (T2). The tab stays visible: the user uploads in a window beside X and clicks back
  // into X. A focus on the window should re-check the watched tweet.
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

  // Known gap (T2). A tab opened behind (middle click) starts hidden and is logged out of Danbooru.
  // The login toast should be on screen when the tab is first looked at.
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
