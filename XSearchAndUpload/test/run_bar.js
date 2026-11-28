// The status bar (shows the state only since desktop task T11): its place, its taps going to the tweet, state shapes and contrast, menu commands.
// node run_bar.js [variant,..] [scenario,..]
const {chromium, newPage, inject, sleep, withTimeout} = require('./h.js');
const L = require('./lib.js');
const fs = require('fs');
const path = require('path');

const variants = (process.argv[2] || 'current').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;
const B = 'https://danbooru.donmai.us/';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, {recursive: true});

// ---------- synthetic page (h.js) helpers ----------

async function setup(browser, opts = {}) {
  const r = await newPage(browser, opts);
  r.popups = [];
  r.ctx.on('page', (p) => r.popups.push(p.url()));
  await r.page.evaluate(() => {
    const m = document.createElement('meta');
    m.name = 'viewport';
    m.content = 'width=device-width, initial-scale=1';
    document.head.appendChild(m);
    // Fake post table: tweet id -> posts; responder answers lookups from it.
    window.__db = [];
    window.__fail = null;
    window.__delay = 50;
    window.__responder = (u) => {
      if (window.__fail) {
        return window.__fail(u);
      }
      const ids = [...u.matchAll(/source:\*status\/(\d+)\*/g)].map((x) => x[1]);
      const hs = [...u.matchAll(/source:\*media\/([A-Za-z0-9_-]+)\*/g)].map((x) => x[1]);
      const out = window.__db.filter((p) => ids.some((id) => new RegExp(`status/${id}(?!\\d)`).test(p.source))
        || hs.some((h) => p.source.includes('media/' + h)));
      return {body: JSON.stringify(out), delay: window.__delay};
    };
    window.__lookups = [];
    const orig = window.GM_xmlhttpRequest;
    window.GM_xmlhttpRequest = (d) => {
      if (!d.url.includes('/profile.json')) {
        window.__lookups.push(decodeURIComponent(d.url));
      }
      return orig(d);
    };
    window.countReq = (needle) => window.__lookups.filter((u) => u.includes(needle)).length;
    // Clicks that reach x.com's own elements in the bubble phase.
    window.__clicks = [];
    document.addEventListener('click', (e) => {
      const t = e.target;
      if (t.closest && t.closest('a[href*="/photo/"]')) {
        window.__clicks.push('photo');
      } else if (t.closest && t.closest('article')) {
        window.__clicks.push('article');
      }
      // Like x.com's router: a click that reaches the document does not navigate the page.
      if (t.closest && t.closest('a[href]')) {
        e.preventDefault();
      }
    });
    window.__mousedowns = 0;
    document.addEventListener('mousedown', (e) => {
      if (e.target.closest && e.target.closest('article')) {
        window.__mousedowns++;
      }
    });
    // Toast sampler: every time a toast is shown (or its text changes while shown).
    window.__toasts = [];
    let last = '';
    setInterval(() => {
      const t = document.querySelector('.xdsu-toast');
      const now = t && t.classList.contains('xdsu-show') ? t.textContent : '';
      if (now && now !== last) {
        window.__toasts.push(now);
      }
      last = now;
    }, 10);
    window.__winOpen = [];
    window.open = (u) => {
      window.__winOpen.push(u);
      return null;
    };
    // Date.now offset, to step past time locks without waiting.
    const realNow = Date.now;
    window.__dnOff = 0;
    Date.now = () => realNow() + window.__dnOff;
    window.seg = (id, n = 1) => document.querySelectorAll(`#t${id} .xdsu-bar-seg`)[n - 1];
    // match: the post a segment stands for (href before desktop task T11, data-match-url since).
    window.segAttrs = (id, n = 1) => {
      const s = window.seg(id, n);
      return s && {tag: s.tagName, state: s.dataset.state || null, href: s.getAttribute('href'),
        match: s.getAttribute('href') || s.dataset.matchUrl || null, role: s.getAttribute('role'),
        aria: s.getAttribute('aria-label'), title: s.getAttribute('title'), color: window.segColor(s)};
    };
  });
  return r;
}

async function fin(r, pass, extra = '') {
  const {page, errors} = r;
  const unh = await page.evaluate(() => window.__unhandled);
  const errs = errors.filter((e) => !e.includes('Failed to load resource'));
  await page.context().close();
  return {pass: pass && !errs.length && !unh.length,
    detail: extra + (unh.length ? ` | unhandled=${JSON.stringify(unh)}` : '') + (errs.length ? ` | errors=${JSON.stringify(errs)}` : '')};
}

async function segCentre(page, id, n = 1) {
  return page.evaluate(([id, n]) => {
    const s = window.seg(id, n);
    s.scrollIntoView({block: 'center'});
    const b = s.getBoundingClientRect();
    return {x: b.left + b.width / 2, y: b.top + b.height / 2};
  }, [id, n]);
}
async function tapSeg(page, id, n = 1) {
  const p = await segCentre(page, id, n);
  await page.touchscreen.tap(p.x, p.y);
}
const like = (page, id) => page.evaluate((id) => document.querySelector(`#t${id} [data-testid="like"]`).click(), id);
const post = (id, source) => ({id, source, is_deleted: false, is_banned: false});

// ---------- realistic page (lib.js) helpers ----------

// One real touch tap on the realistic page; returns what opened and which x.com handlers saw a click.
async function realTap(page, x, y) {
  await page.evaluate(() => {
    window.__log.length = 0;
    window.__gm.openInTab.length = 0;
    window.__dnOff = (window.__dnOff || 0) + 2000;
  });
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(35);
  return page.evaluate(() => ({open: window.__gm.openInTab.map((o) => o.url),
    clicks: window.__log.filter((l) => l.type === 'click').map((l) => l.who)}));
}

async function realPage(browser, v, opts = {}) {
  const r = await L.newPage(browser, {width: 360, height: 800}, opts.theme || 'white', Object.assign({
    errorIds: [], variant: v,
    beforeInject: async (page) => {
      if (opts.pageCss) {
        await page.addStyleTag({content: opts.pageCss});
      }
      await page.evaluate(() => {
        const realNow = Date.now;
        window.__dnOff = 0;
        Date.now = () => realNow() + window.__dnOff;
      });
    },
  }, opts));
  await r.page.waitForTimeout(1500);
  return r;
}

// Geometry and tap sweeps for one article on the realistic page.
async function bandReport(page, tid) {
  const g = await page.evaluate((tid) => {
    const art = document.querySelector(`article[data-tid="${tid}"]`);
    const bar = art.querySelector('.xdsu-bar');
    const segs = [...art.querySelectorAll('.xdsu-bar-seg')];
    segs[0].scrollIntoView({block: 'center'});
    const rr = (n) => Math.round(n * 100) / 100;
    const b = bar.getBoundingClientRect();
    // ::after left/right/top/bottom are negative offsets: band = rect grown by -offset.
    const bandsFixed = segs.map((s) => {
      const r = s.getBoundingClientRect();
      const a = getComputedStyle(s, '::after');
      if (a.content === 'none') {
        return {left: r.left, right: r.right, top: r.top, bottom: r.bottom};
      }
      return {left: r.left + parseFloat(a.left), right: r.right - parseFloat(a.right),
        top: r.top + parseFloat(a.top), bottom: r.bottom - parseFloat(a.bottom)};
    });
    const overlap = (p, q) => Math.max(0, Math.min(p.right, q.right) - Math.max(p.left, q.left))
      * Math.max(0, Math.min(p.bottom, q.bottom) - Math.max(p.top, q.top));
    const photos = [...art.querySelectorAll('a[data-photo]')].map((a) => a.getBoundingClientRect());
    const acts = [...art.querySelectorAll('[role="group"] .ab, [role="group"] .circle')].map((a) => a.getBoundingClientRect());
    const photoOverlap = Math.max(...bandsFixed.flatMap((bd) => photos.map((p) => overlap(bd, p))));
    const actOverlap = Math.max(...bandsFixed.flatMap((bd) => acts.map((p) => overlap(bd, p))));
    const bandTop = Math.min(...bandsFixed.map((x) => x.top));
    const bandBottom = Math.max(...bandsFixed.map((x) => x.bottom));
    const photoBottom = Math.max(...photos.map((p) => p.bottom));
    const actTop = Math.min(...acts.map((p) => p.top));
    const s0 = segs[0].getBoundingClientRect();
    const cy = s0.top + s0.height / 2;
    const sweepY = (x, from, to, step = 1) => {
      const rows = [];
      for (let d = from; d <= to; d += step) {
        const el = document.elementFromPoint(x, cy + d);
        rows.push({k: d, v: el && el.closest('.xdsu-bar-seg') ? 'seg' + segs.indexOf(el.closest('.xdsu-bar-seg')) : window.__who(x, cy + d)});
      }
      return rows;
    };
    const centre = sweepY(s0.left + s0.width / 2, -9, 9);
    const wide = sweepY(s0.left + s0.width / 2, -16, 16, 0.5);
    const gaps = segs.slice(1).map((s, i) => {
      const x = (segs[i].getBoundingClientRect().right + s.getBoundingClientRect().left) / 2;
      return {i, x: rr(x), rows: sweepY(x, -9, 9)};
    });
    // Horizontal sweep across the whole bar at the centre line and at +-9.
    const hs = [];
    for (const d of [-9, 0, 9]) {
      for (let x = Math.ceil(b.left); x <= Math.floor(b.right) - 1; x += 0.5) {
        const el = document.elementFromPoint(x + 0.25, cy + d);
        if (!el || !el.closest('.xdsu-bar-seg')) {
          hs.push(`${rr(x)},${d}:${window.__who(x + 0.25, cy + d)}`);
        }
      }
    }
    return {
      segs: segs.length, segH: rr(s0.height), barH: rr(b.height), barTop: rr(b.top), barBottom: rr(b.bottom),
      band: {top: rr(bandTop), bottom: rr(bandBottom), h: rr(bandBottom - bandTop),
        inBarV: bandTop >= b.top - 0.01 && bandBottom <= b.bottom + 0.01,
        overhangL: rr(b.left - Math.min(...bandsFixed.map((x) => x.left))),
        overhangR: rr(Math.max(...bandsFixed.map((x) => x.right)) - b.right)},
      gapPhotoToBand: rr(bandTop - photoBottom), gapBandToActions: rr(actTop - bandBottom),
      photoOverlapPx2: rr(photoOverlap), actionOverlapPx2: rr(actOverlap),
      centreSweep: centre, wideSweep: wide, gaps, hMisses: hs,
      x: s0.left + s0.width / 2, cy,
    };
  }, tid);
  return g;
}

// ---------- scenarios ----------

const S = {
  // ---------- T17 / S13 (since desktop task T11: the bar only shows the state) ----------
  // The bar on a touch screen, flex-column and block parents, 1-image and 4-image tweets: it sits
  // between the photos and the action row without overlapping either, and a tap anywhere on it
  // does nothing: it reaches neither x.com nor any action of the script's.
  async e17_band_flex(browser, v) {
    return bandScenario(browser, v, '');
  },
  async e17_band_block(browser, v) {
    return bandScenario(browser, v, '.content{display:block !important}');
  },

  // A tap on a segment, whatever its state, does nothing: no lookup, no tab, no toast, and it does
  // not reach x.com's tweet either.
  async e17_taps_pass(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__db.push({id: 501, source: 'https://x.com/u/status/9401/photo/1', is_deleted: false, is_banned: false});
      const table = window.__responder;
      window.__responder = (u) => (u.includes('status/9201') ? {status: 400, body: '{"error":"X","message":"bad"}'} : table(u));
      window.add({id: '9401', hashes: ['FD1']});
      window.add({id: '9101', hashes: ['MS1']});
    });
    await inject(r.page, v);
    await sleep(1500);
    // Alone, so that its refused lookup fails no other tweet.
    await r.page.evaluate(() => window.add({id: '9201', hashes: ['ER1']}));
    await sleep(1500);
    await r.page.evaluate(() => {
      window.__delay = 8000;
      window.add({id: '9301', hashes: ['SR1']});
    });
    await sleep(1200);
    // The tip a tap shows: the segment's label, inside the viewport, next to the segment and
    // clear of it.
    const tipState = (id) => {
      const t = document.querySelector('.xdsu-tip');
      const seg = document.querySelector(`#t${id} .xdsu-bar-seg`);
      if (!t || !seg) {
        return {shown: false};
      }
      const a = t.getBoundingClientRect();
      const b = seg.getBoundingClientRect();
      return {shown: t.classList.contains('xdsu-show') && getComputedStyle(t).display !== 'none', text: t.textContent,
        label: seg.getAttribute('aria-label'), inside: a.left >= 0 && a.right <= document.documentElement.clientWidth && a.top >= 0,
        clear: a.bottom <= b.top || a.top >= b.bottom, near: Math.min(Math.abs(b.top - a.bottom), Math.abs(a.top - b.bottom)) <= 12};
    };
    const rows = [];
    let ok = true;
    for (const [id, want] of [['9401', 'found'], ['9101', 'missing'], ['9201', 'error'], ['9301', 'searching']]) {
      const a = await r.page.evaluate(() => ({n: window.__lookups.length, t: window.__toasts.length, c: window.__clicks.length}));
      await r.page.evaluate(() => {
        window.__dnOff += 2000;
      });
      await tapSeg(r.page, id);
      await sleep(200);
      const tip = await r.page.evaluate(tipState, id);
      await tapSeg(r.page, id);
      await sleep(600);
      const s = await r.page.evaluate(() => ({n: window.__lookups.length, t: window.__toasts.length,
        clicks: window.__clicks.slice(), opened: window.__opened.length, win: window.__winOpen.length}));
      const state = await r.page.evaluate((id) => window.segAttrs(id).state, id);
      const clicks = s.clicks.slice(a.c);
      const tipOk = tip.shown && !!tip.label && tip.text === tip.label && tip.inside && tip.clear && tip.near;
      const good = state === want && s.n === a.n && s.t === a.t && s.opened === 0 && s.win === 0
        && clicks.length === 0 && tipOk;
      ok = ok && good;
      rows.push(`${id} ${state}: lookups +${s.n - a.n}, toasts +${s.t - a.t}, opened ${s.opened}, x.com clicks ${JSON.stringify(clicks)},`
        + ` tip ${tip.shown ? JSON.stringify(tip.text) : 'not shown'}${tipOk ? '' : ` <-- tip wrong ${JSON.stringify(tip)}`}${good ? '' : ' <-- wrong'}`);
    }
    // The tip leaves by itself after 2.5 s, and at once when the page scrolls.
    await sleep(3000);
    const left = !(await r.page.evaluate(tipState, '9301')).shown;
    await tapSeg(r.page, '9301');
    await sleep(200);
    const back = (await r.page.evaluate(tipState, '9301')).shown;
    await r.page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await sleep(100);
    const scrolled = !(await r.page.evaluate(tipState, '9301')).shown;
    const tipEnds = left && back && scrolled;
    return fin(r, ok && tipEnds && r.popups.length === 0, `${rows.join(' | ')} | tip gone after 3 s=${left}, shown again by a tap=${back},`
      + ` gone on a scroll=${scrolled}${tipEnds ? '' : ' <-- wrong'} | popups=${r.popups.length}`);
  },

  // A failed segment names the reason in its label (the tooltip with a mouse): a refused search, a
  // network error and a server error. One tweet at a time, so each lookup fails its own way.
  async e17_error_reason(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__fail = (u) => {
        if (u.includes('status/9211')) {
          return {status: 400, body: '{"error":"X","message":"bad"}'};
        }
        if (u.includes('status/9212')) {
          return {error: true};
        }
        if (u.includes('status/9213')) {
          return {status: 500, body: 'oops'};
        }
        return {body: '[]'};
      };
    });
    await inject(r.page, v);
    const want = {
      9211: 'Lookup failed – Danbooru refused the search.',
      9212: 'Lookup failed – Could not reach Danbooru.',
      9213: 'Lookup failed – Danbooru had a server error.',
    };
    const got = {};
    for (const id of Object.keys(want)) {
      await r.page.evaluate((id) => window.add({id, hashes: ['ER' + id]}), id);
      // A network or server error is retried once after 1.5 s before it counts.
      await r.page.waitForFunction((id) => window.seg(id) && window.seg(id).dataset.state === 'error', id,
          {timeout: 6000, polling: 50}).catch(() => null);
      got[id] = await r.page.evaluate((id) => window.segAttrs(id), id);
    }
    const ok = Object.entries(want).every(([id, t]) => got[id] && got[id].state === 'error' && got[id].title === t
      && got[id].aria === t);
    return fin(r, ok, Object.entries(got).map(([id, x]) => `${id}: ${x && x.state} "${x && x.title}"`).join(' | '));
  },

  // found -> re-check -> missing -> re-check -> found on the same element, still tracked. Both
  // re-checks come from the Like button.
  async e17_identity(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__db.push({id: 601, source: 'https://x.com/u/status/9501/photo/1', is_deleted: false, is_banned: false});
      window.add({id: '9501', hashes: ['ID1']});
    });
    await inject(r.page, v);
    await sleep(1500);
    const a = await r.page.evaluate(() => {
      window.__el = window.seg('9501');
      window.__db.length = 0;
      return window.segAttrs('9501');
    });
    await like(r.page, '9501');
    await sleep(1500);
    const b = await r.page.evaluate(() => ({a: window.segAttrs('9501'), same: window.seg('9501') === window.__el,
      n: document.querySelectorAll('#t9501 .xdsu-bar-seg').length}));
    await r.page.evaluate(() => window.__db.push({id: 602, source: 'https://x.com/u/status/9501/photo/1', is_deleted: false, is_banned: false}));
    await sleep(200);
    await like(r.page, '9501');
    await sleep(1500);
    const c = await r.page.evaluate(() => ({a: window.segAttrs('9501'), same: window.seg('9501') === window.__el}));
    const pass = a.state === 'found' && a.match === B + 'posts/601' && b.same && b.n === 1 && b.a.state === 'missing' && b.a.match === null
      && c.same && c.a.state === 'found' && c.a.match === B + 'posts/602';
    return fin(r, pass, `found=${JSON.stringify(a)} | after a Like: ${JSON.stringify(b)} | after another Like: ${JSON.stringify(c)}`);
  },

  // No segment is a link or takes the focus: every one is a <span role="img"> whose label is its
  // title. A found or partly posted one names its post in data-match-url (no href).
  async e17_no_links(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__db.push({id: 701, source: 'https://x.com/u/status/9601/photo/1', is_deleted: false, is_banned: false});
      window.__db.push({id: 702, source: 'https://x.com/u/status/9602', is_deleted: false, is_banned: false});
      window.add({id: '9601', hashes: ['LP1']});
      window.add({id: '9602', hashes: ['LP2', 'LP3']});
      window.add({id: '9603', hashes: ['LP4']});
      const table = window.__responder;
      window.__responder = (u) => (u.includes('status/9604') ? {status: 400, body: '{}'} : table(u));
    });
    await inject(r.page, v);
    await sleep(2000);
    await r.page.evaluate(() => window.add({id: '9604', hashes: ['LP5']}));
    await sleep(1500);
    await r.page.evaluate(() => {
      window.__delay = 8000;
      window.add({id: '9605', hashes: ['LP6']});
    });
    await sleep(1200);
    const s = await r.page.evaluate(() => ({found: window.segAttrs('9601'), weak: window.segAttrs('9602', 1),
      missing: window.segAttrs('9603'), error: window.segAttrs('9604'), searching: window.segAttrs('9605'),
      tabbable: [...document.querySelectorAll('.xdsu-bar-seg')].filter((x) => x.tabIndex >= 0).length}));
    const plain = (x, k) => x.state === k && x.tag === 'SPAN' && x.href === null && x.role === 'img' && !!x.aria && x.aria === x.title;
    const pass = plain(s.found, 'found') && s.found.match === B + 'posts/701'
      && plain(s.weak, 'foundWeak') && s.weak.match === B + 'posts/702'
      && ['missing', 'error', 'searching'].every((k) => plain(s[k], k) && s[k].match === null) && s.tabbable === 0;
    return fin(r, pass, Object.entries(s).map(([k, x]) => `${k}: ${JSON.stringify(x)}`).join(' | '));
  },

  // ---------- T18 ----------
  // data-state, aria-label, role and the five computed shapes.
  async e18_states(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__db.push({id: 801, source: 'https://x.com/u/status/9701/photo/1', is_deleted: false, is_banned: false});
      window.__db.push({id: 802, source: 'https://x.com/u/status/9702', is_deleted: false, is_banned: false});
      const table = window.__responder;
      window.__responder = (u) => (u.includes('status/9704') ? {status: 400, body: '{}'} : table(u));
      window.add({id: '9701', hashes: ['ST1']});
      window.add({id: '9702', hashes: ['ST2', 'ST3']});
      window.add({id: '9703', hashes: ['ST4']});
    });
    await inject(r.page, v);
    await sleep(2000);
    await r.page.evaluate(() => window.add({id: '9704', hashes: ['ST5']}));
    await sleep(1500);
    await r.page.evaluate(() => {
      window.__delay = 8000;
      window.add({id: '9705', hashes: ['ST6']});
    });
    await sleep(1200);
    const s = await r.page.evaluate(() => {
      const cs = (s) => {
        const c = getComputedStyle(s);
        return {bgc: c.backgroundColor, bgi: c.backgroundImage, bgs: c.backgroundSize, bgp: c.backgroundPosition,
          bgr: c.backgroundRepeat, sh: c.boxShadow, anim: c.animationName};
      };
      const out = {};
      for (const [k, id, n] of [['found', '9701', 1], ['foundWeak', '9702', 1], ['missing', '9703', 1], ['error', '9704', 1], ['searching', '9705', 1]]) {
        out[k] = Object.assign(window.segAttrs(id, n), {cs: cs(window.seg(id, n))});
      }
      return out;
    });
    const G = 'rgb(26, 140, 26)';
    const shape = {
      found: (c) => c.bgc === G && c.bgi === 'none' && c.sh === 'none',
      foundWeak: (c) => c.bgi === `repeating-linear-gradient(135deg, ${G} 0px, ${G} 3px, rgba(0, 0, 0, 0) 3px, rgba(0, 0, 0, 0) 6px)`
        && c.sh === 'none',
      missing: (c) => c.bgc === 'rgba(0, 0, 0, 0)' && c.bgi === 'none' && c.sh === 'rgb(229, 57, 53) 0px 0px 0px 2px inset',
      error: (c) => c.bgi === 'repeating-linear-gradient(90deg, rgb(91, 108, 255) 0px, rgb(91, 108, 255) 4px, rgba(0, 0, 0, 0) 4px, rgba(0, 0, 0, 0) 10px)',
      searching: (c) => c.bgi === 'linear-gradient(rgb(118, 118, 118), rgb(118, 118, 118))' && c.bgs === '100% 2px'
        && c.bgr === 'no-repeat' && c.bgp === '50% 50%' && c.anim === 'xdsu-pulse',
    };
    // Since desktop task T11 every segment only shows its state.
    const role = {found: 'img', foundWeak: 'img', missing: 'img', error: 'img', searching: 'img'};
    const bad = Object.keys(shape).filter((k) => !(s[k] && s[k].state === k && s[k].aria && s[k].aria === s[k].title
      && s[k].role === role[k] && shape[k](s[k].cs)));
    const distinct = new Set(Object.values(s).map((x) => JSON.stringify(x.cs))).size;
    return fin(r, bad.length === 0 && distinct === 5, `bad=${JSON.stringify(bad)} distinctStyles=${distinct} `
      + Object.entries(s).map(([k, x]) => `${k}: state=${x.state} role=${x.role} aria="${x.aria}" ${JSON.stringify(x.cs)}`).join(' | '));
  },

  // Contrast of the four palette colours against the three X backgrounds (>= 3:1).
  async e18_contrast(browser, v) {
    const r = await setup(browser);
    await inject(r.page, v);
    await sleep(300);
    const vars = await r.page.evaluate(() => Object.fromEntries(['found', 'missing', 'error', 'searching'].map((k) => [k,
      getComputedStyle(document.documentElement).getPropertyValue('--xdsu-' + k).trim()])));
    const lum = (hex) => {
      const c = hex.replace('#', '').match(/../g).map((x) => parseInt(x, 16) / 255)
          .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const cr = (a, b) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return Math.round((x + 0.05) / (y + 0.05) * 100) / 100;
    };
    const bgs = {white: '#ffffff', dim: '#15202b', black: '#000000'};
    const table = {};
    let ok = true;
    for (const [k, c] of Object.entries(vars)) {
      if (!/^#[0-9a-f]{6}$/i.test(c)) {
        ok = false;
        table[k] = 'missing';
        continue;
      }
      table[k] = Object.fromEntries(Object.entries(bgs).map(([n, b]) => [n, cr(c, b)]));
      ok = ok && Object.values(table[k]).every((x) => x >= 3);
    }
    return fin(r, ok, `palette=${JSON.stringify(vars)} contrast=${JSON.stringify(table)}`);
  },

  // Pulse on every held shape while re-checking (and on searching); none under reduced motion, static cue instead.
  async e18_pulse(browser, v) {
    const res = {};
    for (const rm of ['no-preference', 'reduce']) {
      const r = await setup(browser, {ctxOpts: {reducedMotion: rm}});
      await r.page.evaluate(() => {
        window.__db.push({id: 901, source: 'https://x.com/u/status/9801/photo/1', is_deleted: false, is_banned: false});
        window.__db.push({id: 902, source: 'https://x.com/u/status/9802', is_deleted: false, is_banned: false});
        const table = window.__responder;
        window.__responder = (u) => (u.includes('status/9804') && !window.__slow ? {status: 400, body: '{}'}
          : Object.assign(table(u), window.__slow ? {delay: 6000} : {}));
        window.add({id: '9801', hashes: ['PU1']});
        window.add({id: '9802', hashes: ['PU2', 'PU3']});
        window.add({id: '9803', hashes: ['PU4']});
      });
      await inject(r.page, v);
      await sleep(2000);
      await r.page.evaluate(() => window.add({id: '9804', hashes: ['PU5']}));
      await sleep(1500);
      await r.page.evaluate(() => {
        window.__slow = true;
        for (const id of ['9801', '9802', '9803', '9804']) {
          document.querySelector(`#t${id} [data-testid="like"]`).click();
        }
        window.add({id: '9805', hashes: ['PU6']});
      });
      await sleep(1000);
      res[rm] = await r.page.evaluate(() => Object.fromEntries([['9801', 1], ['9802', 1], ['9803', 1], ['9804', 1], ['9805', 1]].map(([id, n]) => {
        const s = window.seg(id, n);
        const c = getComputedStyle(s);
        return [id, {state: s.dataset.state || window.segColor(s), rechecking: s.classList.contains('xdsu-rechecking'),
          anim: c.animationName, dur: c.animationDuration, opacity: c.opacity}];
      })));
      await fin(r, true);
    }
    const held = ['9801', '9802', '9803', '9804'];
    const want = {9801: 'found', 9802: 'foundWeak', 9803: 'missing', 9804: 'error'};
    const np = res['no-preference'];
    const rd = res.reduce;
    const pass = held.every((id) => np[id].state === want[id] && np[id].rechecking && np[id].anim === 'xdsu-pulse')
      && np['9805'].state === 'searching' && np['9805'].anim === 'xdsu-pulse'
      && held.every((id) => rd[id].rechecking && rd[id].anim === 'none' && rd[id].opacity === '0.6')
      && rd['9805'].anim === 'none' && rd['9805'].opacity === '1';
    return {pass, detail: `normal=${JSON.stringify(np)} | reduced=${JSON.stringify(rd)}`};
  },

  // Greyscale stills (DPR 1) of every state on white, dim and black at 8 px (coarse) and 6 px (fine).
  async e18_render(browser, v) {
    const css = await (async () => {
      const r = await setup(browser);
      await inject(r.page, v);
      await sleep(200);
      const t = await r.page.evaluate(() => [...document.querySelectorAll('style')].map((s) => s.textContent)
          .find((x) => x.includes('.xdsu-bar')));
      await fin(r, true);
      return t;
    })();
    const states = ['found', 'foundWeak', 'missing', 'error', 'searching'];
    const bar = (list) => `<div class="xdsu-bar">${list.map((s) => `<a class="xdsu-bar-seg" data-state="${s}"`
      + ` style="background-color:${{found: '#1a8c1a', foundWeak: '#7ec97e', missing: '#e53935', error: '#3d4ee8', searching: '#9a9a9a'}[s]}"></a>`).join('')}</div>`;
    // HEAD paints only the inline colour; bundle E's attribute rules win over it only for background shorthand,
    // so for bundle E the inline colour is dropped.
    const isHead = !css.includes('data-state');
    const barE = (list) => (isHead ? bar(list) : `<div class="xdsu-bar">${list.map((s) => `<a class="xdsu-bar-seg" data-state="${s}"></a>`).join('')}</div>`);
    const files = [];
    for (const [mode, touch] of [['8px', true], ['6px', false]]) {
      const ctx = await browser.newContext({viewport: {width: 360, height: 1100}, deviceScaleFactor: 1, isMobile: touch, hasTouch: touch});
      const page = await ctx.newPage();
      let h = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}
        body{margin:0;font:11px/14px Arial} .th{padding:6px 16px 8px 64px} .lab{font-size:10px;opacity:.8;margin:4px 0 0}
        .xdsu-bar{width:280px}</style>`;
      for (const [n, bg] of Object.entries({white: '#ffffff', dim: '#15202b', black: '#000000'})) {
        h += `<div class="th" style="background:${bg};color:${n === 'white' ? '#000' : '#fff'}">`
          + `<div class="lab">${n} ${mode}: searching | found | searching | missing</div>${barE(['searching', 'found', 'searching', 'missing'])}`
          + `<div class="lab">found | foundWeak | missing | error</div>${barE(['found', 'foundWeak', 'missing', 'error'])}`
          + states.map((s) => `<div class="lab">${s}</div>${barE([s])}`).join('') + '</div>';
      }
      await page.setContent(h);
      const segH = await page.evaluate(() => document.querySelector('.xdsu-bar-seg').getBoundingClientRect().height);
      const cdp = await ctx.newCDPSession(page);
      for (const vd of ['none', 'achromatopsia']) {
        await cdp.send('Emulation.setEmulatedVisionDeficiency', {type: vd});
        const f = path.join(OUT, `e18_${v}_${mode}_${vd === 'none' ? 'colour' : 'grey'}.png`);
        // No fullPage: it drops the touch emulation, and with it pointer: coarse.
        await page.screenshot({path: f, animations: 'disabled'});
        files.push(`${f} (seg ${segH}px)`);
        // 3x nearest-neighbour copy for viewing.
        const buf = fs.readFileSync(f).toString('base64');
        const p2 = await ctx.newPage();
        await p2.setContent(`<body style="margin:0"><img id="i" style="image-rendering:pixelated" src="data:image/png;base64,${buf}"></body>`);
        await p2.evaluate(() => {
          const i = document.getElementById('i');
          i.style.width = (i.naturalWidth * 3) + 'px';
        });
        await p2.setViewportSize({width: 1080, height: 3300});
        await p2.screenshot({path: f.replace('.png', '_x3.png'), fullPage: true});
        await p2.close();
      }
      await ctx.close();
    }
    return {pass: !isHead, detail: `rendered ${isHead ? '(HEAD: colour only, no data-state rules) ' : ''}${files.join(', ')}`};
  },

  // ---------- T22 ----------
  // Domain label names the current host; legend lists the five states.
  async e22_menus(browser, v) {
    const out = {};
    for (const [k, store] of [['default', {}], ['safe', {booru: 'https://safebooru.donmai.us'}]]) {
      const r = await setup(browser, {store});
      await r.page.evaluate(() => {
        window.__menus = [];
        window.GM_registerMenuCommand = (name, fn, opts) => {
          window.__menus.push({name, fn, opts});
          return opts && opts.id;
        };
        window.__alerts = [];
        window.alert = (m) => window.__alerts.push(m);
      });
      await inject(r.page, v);
      await sleep(300);
      out[k] = await r.page.evaluate(() => {
        const leg = window.__menus.find((m) => m.name === 'XDSU legend');
        if (leg) {
          leg.fn();
        }
        return {names: window.__menus.map((m) => m.name), alerts: window.__alerts};
      });
      await fin(r, true);
    }
    const legend = out.default.alerts[0] || '';
    const pass = out.default.names.includes('Danbooru URL (danbooru.donmai.us)') && out.safe.names.includes('Danbooru URL (safebooru.donmai.us)')
      && out.default.alerts.length === 1
      && ['Solid green', 'Green stripes', 'Red outline', 'Blue dashes', 'Thin grey line'].every((t) => legend.includes(t))
      // The bar does nothing when tapped (desktop task T11).
      && /tap or point at a segment/.test(legend);
    return {pass, detail: `menus=${JSON.stringify(out.default.names)} safebooru menus=${JSON.stringify(out.safe.names)} legend=${JSON.stringify(legend)}`};
  },

  // Like toggle: flips the stored value, applies at once, relabels via id, toasts, survives a reload.
  async e22_like_toggle(browser, v) {
    const run = async (store, idSupport) => {
      const r = await setup(browser, {store});
      await r.page.evaluate((idSupport) => {
        window.__menus = [];
        window.GM_registerMenuCommand = (name, fn, opts) => {
          window.__menus.push({name, fn, id: opts && opts.id});
          return idSupport ? opts && opts.id : window.__menus.length;
        };
        window.likeMenu = () => window.__menus.filter((m) => /^Like = re-check/.test(m.name));
      }, idSupport);
      await r.page.evaluate(() => window.add({id: '9901', hashes: ['LK1']}));
      await inject(r.page, v);
      await sleep(1500);
      return r;
    };
    const likeSends = async (r) => {
      const n0 = await r.page.evaluate(() => window.countReq('status/9901'));
      await like(r.page, '9901');
      await sleep(1700); // past the 1.5 s debounce for the next Like
      return (await r.page.evaluate(() => window.countReq('status/9901'))) - n0;
    };
    const toggle = (r) => r.page.evaluate(() => {
      const m = window.likeMenu();
      if (m.length) {
        m[m.length - 1].fn();
      }
    });
    const r = await run({}, true);
    const s = {};
    s.label0 = await r.page.evaluate(() => window.likeMenu().map((m) => m.name));
    s.like0 = await likeSends(r);
    await toggle(r);
    await sleep(100);
    s.afterOff = await r.page.evaluate(() => ({stored: window.__store.likeRecheck, menus: window.likeMenu().map((m) => `${m.name}#${m.id}`),
      toasts: window.__toasts.slice()}));
    s.like1 = await likeSends(r);
    const store = await r.page.evaluate(() => Object.assign({}, window.__store));
    await toggle(r);
    await sleep(100);
    s.afterOn = await r.page.evaluate(() => ({stored: window.__store.likeRecheck, menus: window.likeMenu().map((m) => `${m.name}#${m.id}`),
      toasts: window.__toasts.slice()}));
    s.like2 = await likeSends(r);
    // Toasts queue: the second one shows when the first (4 s) has gone.
    await sleep(2500);
    s.allToasts = await r.page.evaluate(() => window.__toasts.slice());
    await fin(r, true);
    // Reload with likeRecheck=false stored.
    const r2 = await run(store, true);
    s.reload = {label: await r2.page.evaluate(() => window.likeMenu().map((m) => m.name)), like: await likeSends(r2)};
    await fin(r2, true);
    // Manager without ids: no second entry, toast still confirms.
    const r3 = await run({}, false);
    await toggle(r3);
    await sleep(100);
    s.noId = await r3.page.evaluate(() => ({stored: window.__store.likeRecheck, menus: window.likeMenu().map((m) => m.name), toasts: window.__toasts.slice()}));
    s.noIdLike = await likeSends(r3);
    await fin(r3, true);
    const pass = JSON.stringify(s.label0) === '["Like = re-check: on"]' && s.like0 === 1
      && s.afterOff.stored === false && s.afterOff.menus.slice(-1)[0] === 'Like = re-check: off#xdsu-like-recheck'
      && s.afterOff.toasts.length === 1 && s.like1 === 0
      && s.afterOn.stored === true && s.afterOn.menus.slice(-1)[0] === 'Like = re-check: on#xdsu-like-recheck'
      && JSON.stringify(s.allToasts) === '["Like no longer re-checks the tweet","Like now re-checks the tweet"]' && s.like2 === 1
      && JSON.stringify(s.reload.label) === '["Like = re-check: off"]' && s.reload.like === 0
      && s.noId.stored === false && s.noId.menus.length === 1 && s.noId.toasts.length === 1 && s.noIdLike === 0;
    return {pass, detail: JSON.stringify(s)};
  },

  // ---------- article height ----------
  async e17_height(browser, v) {
    const out = {};
    for (const [k, touch] of [['coarse', true], ['fine', false]]) {
      const {context, page, before} = await L.newPage(browser, {width: 360, height: 800}, 'white', {errorIds: [], variant: v, touch});
      await page.waitForTimeout(1500);
      out[k] = await page.evaluate((before) => {
        const a = document.querySelector('article[data-tid="1001"]');
        const bar = a.querySelector('.xdsu-bar');
        const cs = getComputedStyle(bar);
        const h0 = before.find((b) => b.id === '1001').h;
        return {coarse: matchMedia('(pointer: coarse)').matches, growth: a.getBoundingClientRect().height - h0,
          footprint: bar.getBoundingClientRect().height + parseFloat(cs.marginTop) + parseFloat(cs.marginBottom),
          segH: a.querySelector('.xdsu-bar-seg').getBoundingClientRect().height};
      }, before);
      await context.close();
    }
    return {pass: true, detail: JSON.stringify(out)};
  },
};

// The bar on the realistic page with a touch screen (desktop task T11: it only shows the state).
// Judged: the bar sits between the photos and the action row without overlapping either; every
// point of it, gaps between segments included, hits a segment; real taps on it and on the gaps do
// nothing at all. Were the segments to let taps through, the browser's touch adjustment would move
// a tap near the edges to the photo above or to the Like button below.
async function bandScenario(browser, v, pageCss) {
  const r = await realPage(browser, v, {pageCss});
  const page = r.page;
  const R = {};
  let ok = true;
  for (const tid of ['1001', '1004']) {
    const g = await bandReport(page, tid);
    const taps = [];
    for (let d = -9; d <= 9; d++) {
      const p = await page.evaluate((tid) => {
        const s = document.querySelector(`article[data-tid="${tid}"] .xdsu-bar-seg`);
        s.scrollIntoView({block: 'center'});
        const b = s.getBoundingClientRect();
        return {x: b.left + b.width / 2, y: b.top + b.height / 2};
      }, tid);
      const t = await realTap(page, p.x, p.y + d);
      taps.push({k: d, v: t.open.length ? `opened ${JSON.stringify(t.open)}` : t.clicks.length ? t.clicks.join('+') : 'nothing'});
    }
    const gapTaps = [];
    for (const gp of g.gaps) {
      for (const d of [-9, 0, 9]) {
        await page.evaluate((tid) => document.querySelector(`article[data-tid="${tid}"] .xdsu-bar-seg`).scrollIntoView({block: 'center'}), tid);
        const cy = await page.evaluate((tid) => {
          const b = document.querySelector(`article[data-tid="${tid}"] .xdsu-bar-seg`).getBoundingClientRect();
          return b.top + b.height / 2;
        }, tid);
        const t = await realTap(page, gp.x, cy + d);
        gapTaps.push(`gap${gp.i}/${d}:${t.open.length ? 'opened' : t.clicks.join('+') || 'nothing'}`);
      }
    }
    const efpOk = g.centreSweep.every((x) => x.v === 'seg0');
    const gapOk = g.gaps.every((gp) => gp.rows.every((x) => /^seg\d$/.test(x.v)));
    const noHitOk = efpOk && gapOk && g.hMisses.length === 0;
    const tapOk = taps.every((x) => x.v === 'nothing');
    const gapTapOk = gapTaps.every((x) => x.endsWith(':nothing'));
    const geoOk = g.band.inBarV && g.photoOverlapPx2 === 0 && g.actionOverlapPx2 === 0;
    ok = ok && noHitOk && tapOk && gapTapOk && geoOk;
    R[tid] = {segs: g.segs, segH: g.segH, barH: g.barH, band: g.band, gapPhotoToBand: g.gapPhotoToBand, gapBandToActions: g.gapBandToActions,
      photoOverlapPx2: g.photoOverlapPx2, actionOverlapPx2: g.actionOverlapPx2,
      efpCentre: L.bands(g.centreSweep), efpGaps: g.gaps.map((gp) => L.bands(gp.rows)), hMissCount: g.hMisses.length,
      taps: L.bands(taps), gapTaps: gapTapOk ? 'all do nothing' : gapTaps,
      ok: {noHitOk, tapOk, gapTapOk, geoOk}};
  }
  await r.context.close();
  return {pass: ok, detail: JSON.stringify(R)};
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
      try {
        const r = await withTimeout(fn(browser, v), 240000);
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name} (${Math.round((Date.now() - t0) / 1000)} s)\n      ${r.detail}`);
      } catch (e) {
        console.log(`HARNESS-ERROR ${name}: ${e.stack}`);
      }
    }
  }
  await browser.close();
})();
