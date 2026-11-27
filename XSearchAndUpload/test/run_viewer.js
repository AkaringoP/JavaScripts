// The photo viewer button.
// node run_viewer.js [variant_probe,..] [scenario,..]
// A *_probe variant is the script with imageRefs exposed as window.__imageRefs (see script.js);
// nothing else differs.
const {chromium, inject, sleep, withTimeout} = require('./h.js');
const F = require('./run_markers.js');
const fs = require('fs');
const path = require('path');

const variants = (process.argv[2] || 'current_probe').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;
const OUT = path.join(__dirname, 'out');

async function setup(browser, opts = {}) {
  const r = await F.setup(browser, opts);
  await r.page.evaluate(() => {
    // x.com has a device-width viewport; without it a phone lays the page out 980px wide.
    document.head.insertAdjacentHTML('beforeend', '<meta name="viewport" content="width=device-width,initial-scale=1">');
    // Active intervals and timers created by anyone (the harness's own are made before inject).
    window.__iv = new Set();
    const si = window.setInterval;
    const ci = window.clearInterval;
    window.setInterval = (fn, ms, ...a) => {
      const id = si(fn, ms, ...a);
      window.__iv.add(id + ':' + ms);
      window.__ivIds = window.__ivIds || {};
      window.__ivIds[id] = ms;
      return id;
    };
    window.clearInterval = (id) => {
      if (window.__ivIds && window.__ivIds[id] !== undefined) {
        window.__iv.delete(id + ':' + window.__ivIds[id]);
      }
      return ci(id);
    };
    window.__ivList = () => [...window.__iv].map((s) => s.split(':')[1]).sort();
    window.__delays = {};
    const resp = window.__responder;
    window.__responder = (u) => {
      const r = resp(u);
      const d = Object.keys(window.__delays).find((k) => u.includes(k));
      if (d) {
        r.delay = window.__delays[d];
      }
      return r;
    };
    // Events that reach the viewer layer, an article, or the document while starting on the pill.
    window.__leaks = [];
    ['click', 'mousedown', 'pointerdown', 'touchstart', 'auxclick'].forEach((t) => {
      document.addEventListener(t, (e) => {
        if (e.target.closest && e.target.closest('.xdsu-pill')) {
          window.__leaks.push('document:' + t);
        }
      });
    });
    window.__layerHits = [];
    // Synthetic viewer: a full-screen layer outside any article with the tweet's images in a strip;
    // image n is on screen. opts: fmt ('jpg', 'webp', 'none' = no format), bg ('dark'|'light'),
    // count (images rendered), user.
    window.openViewer = (id, n, prefix, {fmt = 'jpg', bg = 'dark', count = 0, user = 'u', total = 1} = {}) => {
      history.pushState({}, '', `/${user}/status/${id}/photo/${n}`);
      let layer = document.getElementById('viewer');
      if (layer) {
        layer.remove();
      }
      layer = document.createElement('div');
      layer.id = 'viewer';
      const bgCss = bg === 'dark'
        ? 'radial-gradient(circle at 40% 45%, #3b3550 0, #1a1626 45%, #050407 100%)'
        : 'radial-gradient(circle at 40% 45%, #ffffff 0, #f3efe6 50%, #ddd6c8 100%)';
      layer.style.cssText = `position:fixed;inset:0;z-index:1000;overflow:hidden;background:${bgCss}`;
      const k = count || total;
      const src = (h) => (fmt === 'none' ? `https://pbs.twimg.com/media/${h}`
        : `https://pbs.twimg.com/media/${h}?format=${fmt}&name=large`);
      layer.innerHTML = `<div class="strip" style="display:flex;height:100%;transform:translateX(${-(n - 1) * 100}vw)">`
        + Array.from({length: k}, (_, i) => `<img src="${src(prefix + (i + 1))}" `
          + 'style="flex:0 0 100vw;width:100vw;height:100%;opacity:0">').join('') + '</div>';
      ['click', 'mousedown', 'pointerdown', 'touchstart', 'pointerup'].forEach((t) => {
        layer.addEventListener(t, () => window.__layerHits.push(t));
      });
      document.body.appendChild(layer);
    };
    // URL change only (plus a style change), like a swipe in X's viewer.
    window.swipe = (id, n, user = 'u') => {
      history.pushState({}, '', `/${user}/status/${id}/photo/${n}`);
      const strip = document.querySelector('#viewer .strip');
      if (strip) {
        strip.style.transform = `translateX(${-(n - 1) * 100}vw)`;
      }
    };
    window.closeViewer = (to = '/home') => {
      history.pushState({}, '', to);
      const layer = document.getElementById('viewer');
      if (layer) {
        layer.remove();
      }
    };
    window.pill = () => {
      const p = document.querySelector('.xdsu-pill');
      if (!p) {
        return null;
      }
      const b = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      const icon = p.querySelector('img');
      return {text: p.textContent.trim(), state: p.dataset.state, action: p.dataset.action || null,
        border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`,
        icon: icon ? {nat: icon.naturalWidth, w: icon.getBoundingClientRect().width} : null,
        href: p.getAttribute('href'), role: p.getAttribute('role'), aria: p.getAttribute('aria-label'),
        title: p.getAttribute('title'), cls: p.className, n: document.querySelectorAll('.xdsu-pill').length,
        rect: {l: b.left, t: b.top, w: b.width, h: b.height, gap: innerHeight - b.bottom},
        tracked: p.dataset.tracked || null, hashAttr: p.dataset.imageHash || null};
    };
    window.waitPill = (pred, ms = 3000) => new Promise((res) => {
      const t0 = performance.now();
      const iv = setInterval(() => {
        const p = window.pill();
        if (pred(p) || performance.now() - t0 > ms) {
          clearInterval(iv);
          res({p, ms: Math.round(performance.now() - t0)});
        }
      }, 10);
    });
    window.pillRefs = () => (window.__imageRefs || []).filter((r) => r.bar.classList.contains('xdsu-pill'))
        .map((r) => ({tweetId: r.tweetId, hash: r.imageHash, n: r.photoIndex, count: r.photoCount,
          connected: r.bar.isConnected}));
    window.tap = () => {
      const p = document.querySelector('.xdsu-pill');
      p.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, button: 0}));
    };
  });
  return r;
}

const P = (p) => (p ? `[${p.aria}] ${p.state}${p.href ? ' href=' + p.href.replace('https://danbooru.donmai.us/', '') : ''}` : 'NONE');
const S2 = (u) => decodeURIComponent(u || '').replace('https://danbooru.donmai.us/', '');
// Per-state label and border; look() lists what differs from them (empty when all is right).
const LABEL = {found: 'On Danbooru', missing: 'Upload to Danbooru', searching: 'Checking',
  error: 'Lookup failed – tap to retry'};
const BORDER = {found: '2px solid rgb(26, 140, 26)', foundWeak: '2px dashed rgb(26, 140, 26)',
  missing: '2px solid rgb(229, 57, 53)', error: '2px dashed rgb(91, 108, 255)', searching: '2px dotted rgb(118, 118, 118)'};
function look(p, state, label = LABEL[state]) {
  if (!p) {
    return ['no pill'];
  }
  const bad = [];
  if (p.state !== state) bad.push(`state ${p.state}`);
  if (p.aria !== label || p.title !== label) bad.push(`label "${p.aria}"/"${p.title}"`);
  if (p.text !== '') bad.push(`visible text "${p.text}"`);
  if (p.rect.w !== 44 || p.rect.h !== 44) bad.push(`box ${p.rect.w}x${p.rect.h}`);
  if (!p.icon || !(p.icon.nat > 0) || p.icon.w !== 24) bad.push(`icon ${JSON.stringify(p.icon)}`);
  if (p.border !== BORDER[state]) bad.push(`border ${p.border}`);
  return bad;
}
const db = (id, photo, extra = {}) => Object.assign({source: `https://twitter.com/u/status/${id}` + (photo ? `/photo/${photo}` : '')}, extra);

const S = {
  // Pill appears on the viewer route and leaves within ~300 ms; no pill and no extra interval elsewhere.
  async g1_route(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate(() => {
      window.__db = [{id: 11, ...{source: 'https://twitter.com/u/status/9801/photo/1'}}];
      window.addN('9801', 2, 'RTA');
    });
    await inject(page, v);
    await sleep(1500);
    const base = await page.evaluate(() => window.__ivList());
    // A non-viewer status route, with a DOM change so a scan runs.
    await page.evaluate(() => {
      history.pushState({}, '', '/u/status/9801');
      document.body.appendChild(document.createElement('section'));
    });
    await sleep(2500);
    const detail = await page.evaluate(() => ({pill: window.pill(), iv: window.__ivList()}));
    await page.evaluate(() => window.openViewer('9802', 1, 'RTB'));
    const shown = await page.evaluate(() => window.waitPill((p) => p && p.state !== undefined));
    const ivOpen = await page.evaluate(() => window.__ivList());
    await sleep(500);
    const gone = await page.evaluate(() => {
      window.closeViewer('/home');
      return window.waitPill((p) => !p, 2000);
    });
    await sleep(400);
    const after = await page.evaluate(() => ({iv: window.__ivList(), refs: window.pillRefs()}));
    // Back to the viewer then leave to a non-photo status URL.
    await page.evaluate(() => window.openViewer('9802', 1, 'RTB'));
    await page.evaluate(() => window.waitPill((p) => !!p));
    const gone2 = await page.evaluate(() => {
      history.pushState({}, '', '/u/status/9802');
      return window.waitPill((p) => !p, 2000);
    });
    await sleep(300);
    const after2 = await page.evaluate(() => window.__ivList());
    await r.ctx.close();
    const pass = !detail.pill && JSON.stringify(detail.iv) === JSON.stringify(base) && shown.p && shown.ms < 1000
      && ivOpen.length === base.length + 1 && !gone.p && gone.ms <= 300 && JSON.stringify(after.iv) === JSON.stringify(base)
      && after.refs.length === 0 && !gone2.p && gone2.ms <= 300 && JSON.stringify(after2) === JSON.stringify(base)
      && r.errors.length === 0;
    return {pass, detail: `intervals base=${JSON.stringify(base)} | /status/ route: pill=${P(detail.pill)} iv=${JSON.stringify(detail.iv)}`
      + ` | viewer: pill after ${shown.ms} ms ${P(shown.p)} iv=${JSON.stringify(ivOpen)} | closed to /home: gone after ${gone.ms} ms,`
      + ` iv=${JSON.stringify(after.iv)} pillRefs=${after.refs.length} | closed to /u/status/9802 (URL only): gone after ${gone2.ms} ms`
      + ` iv=${JSON.stringify(after2)} | errors=${JSON.stringify(r.errors)}`};
  },

  // Mirror mode: article underneath in each state; pill text/state/link match the segment; swipe.
  async g2_mirror(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate((dbRows) => {
      window.__db = dbRows;
      window.__fail = (u) => u.includes('status/9815');
      window.addN('9811', 1, 'MIA');
      window.addN('9812', 4, 'MIB');
      window.addN('9813', 1, 'MIC');
    }, [{id: 21, ...db('9811', 1)}, {id: 22, ...db('9812', 1)}, {id: 23, ...db('9812')}]);
    await inject(page, v);
    await sleep(1500);
    // Added alone so its failure does not share a batch.
    await page.evaluate(() => window.addN('9815', 1, 'MIE'));
    await sleep(2500);
    await page.evaluate(() => {
      window.__delays['status/9814'] = 60000;
      window.addN('9814', 1, 'MID');
    });
    await sleep(800);
    const rows = [];
    let ok = true;
    const cases = [['9811', 1, 'MIA', 1, 'found'], ['9812', 1, 'MIB', 4, 'found'], ['9812', 3, 'MIB', 4, 'foundWeak'],
      ['9813', 1, 'MIC', 1, 'missing'], ['9814', 1, 'MID', 1, 'searching'], ['9815', 1, 'MIE', 1, 'error']];
    for (const [id, n, pre, total, want] of cases) {
      const res = await page.evaluate(async ([id, n, pre, total]) => {
        window.openViewer(id, n, pre, {total});
        const w = await window.waitPill((p) => !!p);
        await new Promise((r) => setTimeout(r, 300));
        const seg = window.artState(id).segs[n - 1];
        return {p: window.pill(), seg, refs: window.pillRefs()};
      }, [id, n, pre, total]);
      const p = res.p;
      const upload = 'https://danbooru.donmai.us/uploads/new?url=' + encodeURIComponent(`https://x.com/u/status/${id}`);
      const issues = look(p, want, want === 'foundWeak' ? 'Upload to Danbooru · 2 of 4 posted' : LABEL[want]);
      const wantHref = want === 'found' ? res.seg.href : (want === 'missing' || want === 'foundWeak') ? upload : null;
      const good = p && p.state === want && res.seg.state === want && issues.length === 0 && p.href === wantHref
        && res.refs.length === 0;
      ok = ok && good;
      rows.push(`${id}/photo/${n}: seg=${res.seg.state}${res.seg.href ? '>' + S2(res.seg.href) : ''} pill=${P(p)} ownRefs=${res.refs.length}${good ? '' : ' <-- MISMATCH ' + issues.join('; ')}`);
    }
    // Swipe 9812 photo 1 (found) -> 2 (foundWeak) -> 1, URL only.
    const sw = await page.evaluate(async () => {
      window.openViewer('9812', 1, 'MIB', {total: 4});
      await window.waitPill((p) => p && p.state === 'found');
      window.swipe('9812', 2);
      const a = await window.waitPill((p) => p && p.state === 'foundWeak', 2000);
      window.swipe('9812', 1);
      const b = await window.waitPill((p) => p && p.state === 'found', 2000);
      return {a, b};
    });
    ok = ok && sw.a.p.state === 'foundWeak' && sw.a.ms <= 300 && sw.b.p.state === 'found' && sw.b.ms <= 300;
    rows.push(`swipe 1->2: ${P(sw.a.p)} after ${sw.a.ms} ms; 2->1: ${P(sw.b.p)} after ${sw.b.ms} ms`);
    await r.ctx.close();
    return {pass: ok && r.errors.length === 0, detail: rows.join(' | ') + ` | errors=${JSON.stringify(r.errors)}`};
  },

  // Own-ref mode: viewer opened with no article in the DOM.
  async g3_ownref(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate((rows) => {
      window.__db = rows;
    }, [{id: 31, ...db('9821', 1)}, {id: 33, source: 'https://pbs.twimg.com/media/OWC2?format=jpg&name=orig'},
      {id: 34, ...db('9824')}]);
    await inject(page, v);
    await sleep(1200);
    const rows = [];
    let ok = true;
    const cases = [
      ['9821', 1, 'OWA', {total: 1}, 'found', 'On Danbooru', ['status/9821']],
      ['9822', 1, 'OWB', {total: 1}, 'missing', 'Upload to Danbooru', ['status/9822', 'media/OWB1']],
      ['9823', 2, 'OWC', {total: 3}, 'found', 'On Danbooru', ['status/9823', 'media/OWC2']],
      // Photo count from the viewer images (4) -> partly posted.
      ['9824', 3, 'OWD', {total: 4}, 'foundWeak', 'Upload to Danbooru · 1 of 4 posted', ['status/9824']],
      // Viewer renders only image 3 of 4 -> image 1 of them is not n -> no hash; count = n = 3.
      ['9826', 3, 'OWF', {total: 4, count: 1}, 'missing', 'Upload to Danbooru', ['status/9826']],
    ];
    for (const [id, n, pre, o, want, wantText, wantLookups] of cases) {
      const res = await page.evaluate(async ([id, n, pre, o]) => {
        const l0 = window.__lookups.length;
        window.openViewer(id, n, pre, o);
        await window.waitPill((p) => p && p.state !== 'searching', 4000);
        await new Promise((r) => setTimeout(r, 600));
        const out = {p: window.pill(), refs: window.pillRefs(),
          lookups: window.__lookups.slice(l0).map((u) => u.split('tags=')[1].replace('status:any ', ''))};
        window.closeViewer();
        await new Promise((r) => setTimeout(r, 400));
        out.after = window.pillRefs();
        out.pillAfter = window.pill();
        return out;
      }, [id, n, pre, o]);
      const issues = look(res.p, want, wantText);
      const good = issues.length === 0
        && wantLookups.every((k) => res.lookups.some((l) => l.includes(k)))
        && res.refs.length === 1 && res.after.length === 0 && !res.pillAfter;
      ok = ok && good;
      rows.push(`${id}/photo/${n}${o.count ? ` (viewer shows ${o.count} img)` : ''}: ${P(res.p)} ref=${JSON.stringify(res.refs[0] || null)}`
        + ` lookups=${JSON.stringify(res.lookups)} afterClose refs=${res.after.length}${good ? '' : ' <-- MISMATCH ' + issues.join('; ')}`);
    }
    // Closed before the lookup is sent: nothing stays pending; the tweet is looked up again later.
    const st = await page.evaluate(async () => {
      window.__db.push({id: 35, source: 'https://twitter.com/u/status/9825/photo/1'});
      const l0 = window.__lookups.length;
      window.openViewer('9825', 1, 'OWE', {total: 1});
      await window.waitPill((p) => !!p);
      window.closeViewer();
      await new Promise((r) => setTimeout(r, 1500));
      const sent = window.__lookups.slice(l0).filter((u) => u.includes('9825')).length;
      window.addN('9825', 1, 'OWE');
      await new Promise((r) => setTimeout(r, 2000));
      return {sent, art: window.artState('9825').segs.map((s) => s.state)};
    });
    ok = ok && st.art[0] === 'found';
    rows.push(`closed before lookup: lookups sent while closed=${st.sent}, article added later -> ${JSON.stringify(st.art)}`);
    // Own ref first, then the article mounts -> pill switches to mirror, own ref dropped.
    const sw = await page.evaluate(async () => {
      window.__db.push({id: 36, source: 'https://twitter.com/u/status/9827/photo/1'});
      window.openViewer('9827', 1, 'OWG', {total: 1});
      await window.waitPill((p) => p && p.state === 'found');
      const before = window.pillRefs().length;
      window.addN('9827', 1, 'OWG');
      await new Promise((r) => setTimeout(r, 1500));
      const out = {before, after: window.pillRefs().length, p: window.pill(), seg: window.artState('9827').segs[0].state};
      window.closeViewer();
      return out;
    });
    ok = ok && sw.before === 1 && sw.after === 0 && sw.p.state === 'found';
    rows.push(`article mounts under open viewer: ownRefs ${sw.before} -> ${sw.after}, pill ${P(sw.p)}, seg=${sw.seg}`);
    await r.ctx.close();
    return {pass: ok && r.errors.length === 0, detail: rows.join(' | ') + ` | errors=${JSON.stringify(r.errors)}`};
  },

  // Taps: open once, per-image upload + watch + return -> found, tweet-level fallbacks, retry, searching.
  async g4_taps(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate((rows) => {
      window.__db = rows;
      window.__fail = (u) => u.includes('status/9835');
      window.setVis = (hidden) => {
        Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
        Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => (hidden ? 'hidden' : 'visible')});
        document.dispatchEvent(new Event('visibilitychange'));
      };
      window.addN('9832', 4, 'TPB');
    }, [{id: 41, ...db('9831', 1)}]);
    await inject(page, v);
    await sleep(1500);
    const rows = [];
    let ok = true;
    // Found, own ref: double tap -> one tab.
    const f = await page.evaluate(async () => {
      window.openViewer('9831', 1, 'TPA', {total: 1});
      await window.waitPill((p) => p && p.state === 'found');
      window.__opened.length = 0;
      window.tap();
      window.tap();
      await new Promise((r) => setTimeout(r, 100));
      return {opened: window.__opened.slice(), p: window.pill()};
    });
    const fGood = f.opened.length === 1 && f.opened[0] === 'https://danbooru.donmai.us/posts/41';
    ok = ok && fGood;
    rows.push(`found double tap: opened=${JSON.stringify(f.opened.map(S2))}`);
    // Upload: photo 3 of 4, mirror (article 9832 underneath) and own ref (9833, no article).
    for (const [id, mode] of [['9832', 'mirror'], ['9833', 'own']]) {
      const u = await page.evaluate(async ([id]) => {
        window.openViewer(id, 3, id === '9832' ? 'TPB' : 'TPC', {total: 4});
        await window.waitPill((p) => p && p.state === 'missing');
        await new Promise((r) => setTimeout(r, 300));
        window.__opened.length = 0;
        window.tap();
        window.tap();
        await new Promise((r) => setTimeout(r, 100));
        const watch = JSON.parse(window.__store.watch || '[]').map((e) => e[0]);
        const out = {opened: window.__opened.slice(), watch, p: window.pill(), refs: window.pillRefs()};
        // Leave the tab, the post is created, come back.
        window.setVis(true);
        window.__db.push({id: id === '9832' ? 42 : 43, source: `https://twitter.com/u/status/${id}/photo/3`});
        await new Promise((r) => setTimeout(r, 300));
        window.setVis(false);
        out.back = (await window.waitPill((p) => p && p.state === 'found', 4000)).p;
        out.seg = id === '9832' ? window.artState(id).segs.map((s) => s.state) : null;
        window.closeViewer();
        await new Promise((r) => setTimeout(r, 300));
        return out;
      }, [id]);
      const pre = id === '9832' ? 'TPB' : 'TPC';
      const want = 'uploads/new?url=https://pbs.twimg.com/media/' + pre + '3?format=jpg&name=orig&ref=https://x.com/u/status/' + id;
      const good = u.opened.length === 1 && S2(u.opened[0]) === want && u.watch.includes(id) && u.back && u.back.state === 'found'
        && u.p.href === 'https://danbooru.donmai.us/uploads/new?url=' + encodeURIComponent('https://x.com/u/status/' + id)
        && u.refs.length === (mode === 'own' ? 1 : 0);
      ok = ok && good;
      rows.push(`upload ${mode} photo 3/4: opened=${JSON.stringify(u.opened.map(S2))} watch=${JSON.stringify(u.watch)}`
        + ` href=${S2(u.p.href)} after return: ${P(u.back)}${u.seg ? ' segs=' + u.seg.join(',') : ''}${good ? '' : ' <-- MISMATCH'}`);
    }
    // Tweet-level fallbacks: webp, no format, no hash (viewer image not found), /i/web/ URL.
    for (const [label, id, o] of [['webp', '9836', {fmt: 'webp', total: 2}], ['no format', '9837', {fmt: 'none', total: 2}],
      ['no viewer image', '9838', {total: 2, count: 0.5}], ['i/web url', '9839', {total: 2, user: 'i/web'}]]) {
      const u = await page.evaluate(async ([id, o]) => {
        if (o.count === 0.5) {
          o.count = 0;
          window.openViewer(id, 2, 'FB' + id, Object.assign({}, o, {total: 0}));
          document.querySelector('#viewer .strip').innerHTML = '';
        } else {
          window.openViewer(id, 2, 'FB' + id, o);
        }
        await window.waitPill((p) => p && p.state === 'missing', 4000);
        await new Promise((r) => setTimeout(r, 300));
        window.__opened.length = 0;
        await new Promise((r) => setTimeout(r, 1600));
        window.tap();
        await new Promise((r) => setTimeout(r, 100));
        const out = {opened: window.__opened.slice(), p: window.pill(), refs: window.pillRefs()};
        window.closeViewer();
        await new Promise((r) => setTimeout(r, 300));
        return out;
      }, [id, o]);
      const user = o.user || 'u';
      const want = 'uploads/new?url=https://x.com/' + user + '/status/' + id;
      const good = u.opened.length === 1 && S2(u.opened[0]) === want;
      ok = ok && good;
      rows.push(`${label}: opened=${JSON.stringify(u.opened.map(S2))} ref.hash=${u.refs[0] ? u.refs[0].hash : '-'}${good ? '' : ' <-- MISMATCH'}`);
    }
    // Error: tap retries now and shows the reason toast.
    const e = await page.evaluate(async () => {
      window.openViewer('9835', 1, 'TPE', {total: 1});
      await window.waitPill((p) => p && p.state === 'error', 6000);
      const l0 = window.__lookups.length;
      window.tap();
      await new Promise((r) => setTimeout(r, 60));
      const toast = document.querySelector('.xdsu-toast.xdsu-show');
      const out = {afterTap: window.pill(), toast: toast ? toast.textContent : null, toastCls: toast ? toast.className : null};
      await new Promise((r) => setTimeout(r, 2500));
      out.lookups = window.__lookups.slice(l0).map((u) => u.split('tags=')[1]);
      out.p = window.pill();
      window.closeViewer();
      return out;
    });
    const eGood = e.toast === 'Could not reach Danbooru. Trying again.' && e.lookups.some((l) => l.includes('9835'))
      && e.afterTap.state === 'searching';
    ok = ok && eGood;
    rows.push(`error tap: pill->${P(e.afterTap)} toast="${e.toast}" (${e.toastCls}) lookups=${JSON.stringify(e.lookups)} then ${P(e.p)}`);
    // Searching: tap does nothing.
    const s = await page.evaluate(async () => {
      window.__delays['status/9834'] = 60000;
      window.openViewer('9834', 1, 'TPD', {total: 1});
      await window.waitPill((p) => p && p.state === 'searching');
      await new Promise((r) => setTimeout(r, 500));
      window.__opened.length = 0;
      const l0 = window.__lookups.length;
      const t0 = document.querySelectorAll('.xdsu-toast.xdsu-show').length;
      window.tap();
      await new Promise((r) => setTimeout(r, 300));
      const out = {opened: window.__opened.length, lookups: window.__lookups.length - l0,
        toasts: document.querySelectorAll('.xdsu-toast.xdsu-show').length - t0, p: window.pill()};
      return out;
    });
    ok = ok && s.opened === 0 && s.lookups === 0 && s.p.state === 'searching' && !s.p.href;
    rows.push(`searching tap: opened=${s.opened} lookups=${s.lookups} pill=${P(s.p)}`);
    // Real touch taps on the pill: nothing reaches the viewer layer, an article or the document.
    const leaks = await page.evaluate(async () => {
      window.closeViewer();
      await new Promise((r) => setTimeout(r, 300));
      window.openViewer('9832', 1, 'TPB', {total: 4});
      await window.waitPill((p) => !!p);
      window.__layerHits.length = 0;
      window.__leaks.length = 0;
      window.__artClicks = 0;
      document.querySelectorAll('article').forEach((a) => a.addEventListener('click', () => window.__artClicks++));
      const b = document.querySelector('.xdsu-pill').getBoundingClientRect();
      return {x: b.left + b.width / 2, y: b.top + b.height / 2};
    });
    await page.touchscreen.tap(leaks.x, leaks.y);
    await sleep(1700);
    await page.touchscreen.tap(leaks.x, leaks.y);
    await sleep(200);
    await page.mouse.click(leaks.x, leaks.y);
    await sleep(200);
    const lk = await page.evaluate(() => ({layer: window.__layerHits.slice(), doc: window.__leaks.slice(), art: window.__artClicks,
      opened: window.__opened.slice()}));
    ok = ok && lk.layer.length === 0 && lk.doc.length === 0 && lk.art === 0;
    rows.push(`3 real taps on pill: viewer layer got ${JSON.stringify(lk.layer)}, document got ${JSON.stringify(lk.doc)}, articles got ${lk.art} clicks`);
    await r.ctx.close();
    return {pass: ok && r.errors.length === 0, detail: rows.join(' | ') + ` | errors=${JSON.stringify(r.errors)}`};
  },

  // Geometry at 360x800 with a passive toast and with an action toast.
  async g5_geometry(browser, v) {
    const r = await setup(browser, {profile: {id: null, tag_query_limit: 2, enable_safe_mode: false}});
    const {page} = r;
    await page.evaluate(() => {
      window.__db = [];
    });
    await inject(page, v);
    await sleep(600);
    // The login toast (an action toast) is already showing when the viewer opens.
    const a = await page.evaluate(async () => {
      window.openViewer('9851', 1, 'GEA', {total: 1});
      await window.waitPill((p) => p && p.state === 'missing');
      const t = document.querySelector('.xdsu-toast');
      const p = document.querySelector('.xdsu-pill');
      const tb = t.getBoundingClientRect();
      const pb = p.getBoundingClientRect();
      const hit = (x, y) => {
        const e = document.elementFromPoint(x, y);
        return e ? (e.closest('.xdsu-pill') ? 'pill' : e.closest('.xdsu-toast') ? 'toast' : e.closest('#viewer') ? 'viewer' : e.tagName) : null;
      };
      const overlap = Math.max(0, Math.min(tb.bottom, pb.bottom) - Math.max(tb.top, pb.top))
        * Math.max(0, Math.min(tb.right, pb.right) - Math.max(tb.left, pb.left));
      return {toastShown: t.classList.contains('xdsu-show'), toastText: t.textContent, toastAction: t.classList.contains('xdsu-action'),
        toast: {l: tb.left, t: tb.top, w: tb.width, h: tb.height, gap: innerHeight - tb.bottom},
        pill: {l: pb.left, t: pb.top, w: pb.width, h: pb.height, gap: innerHeight - pb.bottom},
        overlap, hitPill: hit(pb.left + pb.width / 2, pb.top + pb.height / 2),
        hitPillInner: [hit(pb.left + 22, pb.top + 22), hit(pb.right - 22, pb.bottom - 22)], vw: innerWidth, vh: innerHeight};
    });
    // A passive toast (Like toggle) while the pill is shown.
    const b = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 8500));
      window.__menus['Like = re-check']();
      await new Promise((r) => setTimeout(r, 100));
      const t = document.querySelector('.xdsu-toast');
      const p = document.querySelector('.xdsu-pill');
      const tb = t.getBoundingClientRect();
      const pb = p.getBoundingClientRect();
      const hit = (x, y) => {
        const e = document.elementFromPoint(x, y);
        return e ? (e.closest('.xdsu-pill') ? 'pill' : e.closest('.xdsu-toast') ? 'toast' : e.closest('#viewer') ? 'viewer' : e.tagName) : null;
      };
      const overlap = Math.max(0, Math.min(tb.bottom, pb.bottom) - Math.max(tb.top, pb.top))
        * Math.max(0, Math.min(tb.right, pb.right) - Math.max(tb.left, pb.left));
      return {toastText: t.textContent, toastShown: t.classList.contains('xdsu-show'),
        toast: {l: tb.left, t: tb.top, w: tb.width, h: tb.height, gap: innerHeight - tb.bottom}, overlap,
        hitPill: hit(pb.left + pb.width / 2, pb.top + pb.height / 2), hitToastCentre: hit(tb.left + tb.width / 2, tb.top + tb.height / 2),
        cssBottom: getComputedStyle(t).bottom};
    });
    // Toast after the viewer closes goes back to its own place.
    const c = await page.evaluate(async () => {
      window.closeViewer();
      await new Promise((r) => setTimeout(r, 400));
      const t = document.querySelector('.xdsu-toast');
      return {cls: t.className, gap: innerHeight - t.getBoundingClientRect().bottom};
    });
    await page.screenshot({path: path.join(OUT, `g5_geometry_${v}.png`)});
    await r.ctx.close();
    const pass = a.pill.l === 12 && a.pill.gap === 64 && a.pill.h === 44 && a.pill.w === 44 && a.toastShown && a.overlap === 0
      && a.hitPill === 'pill' && a.hitPillInner.every((h) => h === 'pill') && a.vw === 360 && a.vh === 800 && a.toast.gap === 116 && b.toastShown && b.overlap === 0 && b.hitPill === 'pill'
      && b.hitToastCentre === 'viewer' && b.toast.gap === 116 && c.gap === 64;
    return {pass, detail: `action toast + pill: ${JSON.stringify(a)} | passive toast + pill: ${JSON.stringify(b)} | after close: ${JSON.stringify(c)}`};
  },

  // Article logic while a pill-owned ref exists.
  async g6_article_unharmed(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate((rows) => {
      window.__db = rows;
      window.addN('9861', 4, 'AUA');
      window.addN('9863', 1, 'AUC');
    }, [{id: 61, ...db('9861')}, {id: 62, ...db('9861')}, {id: 63, ...db('9862', 1)}]);
    await inject(page, v);
    await sleep(1800);
    const before = await page.evaluate(() => [window.artState('9861'), window.artState('9863')]);
    const during = await page.evaluate(async () => {
      window.openViewer('9862', 1, 'AUB', {total: 2});
      await window.waitPill((p) => p && p.state === 'found');
      const r0 = window.__imageRefs.find((x) => x.bar.classList.contains('xdsu-pill'));
      // Two poll cycles and a foreign DOM change (prune loop runs every scan).
      document.getElementById('root').appendChild(document.createElement('div'));
      await new Promise((r) => setTimeout(r, 4500));
      const r1 = window.__imageRefs.find((x) => x.bar.classList.contains('xdsu-pill'));
      const seg = document.querySelector('#t9861 .xdsu-bar-seg');
      window.__opened.length = 0;
      seg.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, button: 0}));
      document.querySelector('#t9863 .xdsu-bar-seg').dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, button: 0}));
      await new Promise((r) => setTimeout(r, 1500));
      const p = document.querySelector('.xdsu-pill');
      return {same: r0 === r1, ref: window.pillRefs(), states: [window.artState('9861'), window.artState('9863')],
        opened: window.__opened.slice(), pillAttrs: [...p.attributes].map((a) => a.name).sort(), p: window.pill(),
        segsWithPill: [...document.querySelectorAll('.xdsu-bar-seg')].filter((s) => s.closest('.xdsu-pill')).length};
    });
    const after = await page.evaluate(async () => {
      window.closeViewer();
      await new Promise((r) => setTimeout(r, 2500));
      return {refs: window.pillRefs(), total: window.__imageRefs.length, states: [window.artState('9861'), window.artState('9863')]};
    });
    await r.ctx.close();
    const strip = (s) => JSON.stringify(s.segs.map((g) => [g.state, g.href, g.aria]));
    const pass = during.same && during.ref.length === 1 && during.ref[0].count === 2
      && strip(during.states[0]) === strip(before[0]) && strip(after.states[0]) === strip(before[0])
      && before[0].segs.every((g) => g.state === 'foundWeak' && g.aria === '2 of 4 images posted')
      && during.opened.length === 1 && after.refs.length === 0 && after.total === 5
      && !during.pillAttrs.includes('data-tracked') && !during.pillAttrs.includes('data-image-hash')
      && during.p.aria === 'On Danbooru' && r.errors.length === 0;
    return {pass, detail: `9861 before: ${F_ST(before[0])} | viewer 9862 open 4.5 s: pill ref same object=${during.same} ${JSON.stringify(during.ref)}`
      + ` pill=${P(during.p)} pill attrs=${JSON.stringify(during.pillAttrs)} | 9861 during: ${F_ST(during.states[0])} | 9863 during: ${F_ST(during.states[1])}`
      + ` | seg taps opened ${JSON.stringify(during.opened.map(S2))} | after close: pillRefs=${after.refs.length} imageRefs=${after.total}`
      + ` 9861: ${F_ST(after.states[0])} | errors=${JSON.stringify(r.errors)}`};
  },

  // Screenshots of each state on a dark and on a light image (DSF 1).
  async g7_screens(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate((rows) => {
      window.__db = rows;
      window.__fail = (u) => u.includes('status/9875');
      window.__delays['status/9874'] = 600000;
    }, [{id: 71, ...db('9871', 1)}, {id: 72, ...db('9872')}]);
    await inject(page, v);
    await sleep(800);
    const shots = [];
    const texts = [];
    // The searching lookup never answers and holds the queue, so it goes last.
    const CASES = [['9871', 1, 2, 'found'], ['9872', 2, 2, 'foundWeak'], ['9873', 1, 1, 'missing'], ['9875', 1, 1, 'error']];
    const order = [...['dark', 'light'].flatMap((bg) => CASES.map((c) => [bg, c])),
      ['dark', ['9874', 1, 1, 'searching']], ['light', ['9874', 1, 1, 'searching']]];
    {
      for (const [bg, [id, n, total, want]] of order) {
        const p = await page.evaluate(async ([id, n, total, bg, want]) => {
          window.openViewer(id, n, 'SC' + id, {total, bg});
          return (await window.waitPill((p) => p && p.state === want, 6000)).p;
        }, [id, n, total, bg, want]);
        const label = want === 'foundWeak' ? 'Upload to Danbooru · 1 of 2 posted' : LABEL[want];
        const role = p && p.href ? 'link' : 'button';
        const named = await page.getByRole(role, {name: label, exact: true}).count();
        const issues = look(p, want, label).concat(named === 1 ? [] : [`getByRole(${role}, "${label}") = ${named}`]);
        texts.push(`${bg}/${want}: ${P(p)} role=${role} border=${p && p.border} icon=${JSON.stringify(p && p.icon)}`
          + ` box=${p && p.rect.w}x${p && p.rect.h}${issues.length ? ' <-- ' + issues.join('; ') : ''}`);
        const buf = await page.screenshot({clip: {x: 0, y: 640, width: 360, height: 160}});
        shots.push({bg, want, b64: buf.toString('base64'), ok: issues.length === 0});
        await page.evaluate(() => window.closeViewer());
        await sleep(300);
      }
    }
    // One sheet per background.
    const ORDER = ['found', 'foundWeak', 'missing', 'searching', 'error'];
    shots.sort((a, b) => ORDER.indexOf(a.want) - ORDER.indexOf(b.want));
    // One sheet per background, in colour and in greyscale (the shots themselves are DSF 1).
    for (const [bg, grey] of [['dark', false], ['light', false], ['dark', true], ['light', true]]) {
      await page.setContent('<body style="margin:0;background:#888">' + shots.filter((s) => s.bg === bg)
          .map((s) => `<div style="display:flex;align-items:center"><img src="data:image/png;base64,${s.b64}" `
            + `style="display:block;border-bottom:2px solid #f0f;${grey ? 'filter:grayscale(1)' : ''}">`
            + `<span style="font:12px monospace;color:#000;padding:4px">${s.want}</span></div>`).join('') + '</body>');
      await page.setViewportSize({width: 460, height: 820});
      await page.screenshot({path: path.join(OUT, `g7_icon_${bg}${grey ? '_grey' : ''}_${v}.png`), fullPage: true});
    }
    await r.ctx.close();
    return {pass: shots.every((s) => s.ok), detail: texts.join(' | ')};
  },

  // The icon fails to load: the glyph shows and the accessible name stays.
  async g8_icon_error(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate(() => {
      window.__db = [];
      window.__fail = (u) => u.includes('status/9882');
    });
    await inject(page, v);
    await sleep(600);
    const rows = [];
    let ok = true;
    for (const [id, want] of [['9881', 'missing'], ['9882', 'error']]) {
      const p = await page.evaluate(async ([id, want]) => {
        window.openViewer(id, 1, 'IE' + id, {total: 1});
        await window.waitPill((p) => p && p.state === want, 6000);
        document.querySelector('.xdsu-pill img').src = 'https://broken.invalid/icon.png';
        await new Promise((r) => setTimeout(r, 500));
        return window.pill();
      }, [id, want]);
      const role = want === 'missing' ? 'link' : 'button';
      const named = await page.getByRole(role, {name: LABEL[want], exact: true}).count();
      const good = p && p.state === want && p.text === '↑' && !p.icon && p.aria === LABEL[want] && named === 1
        && p.rect.w === 44 && p.rect.h === 44 && p.border === BORDER[want];
      ok = ok && good;
      rows.push(`${want}: visible "${p && p.text}" icon=${JSON.stringify(p && p.icon)} aria="${p && p.aria}"`
        + ` getByRole(${role}, name)=${named} box=${p && p.rect.w}x${p && p.rect.h} border=${p && p.border}${good ? '' : ' <-- MISMATCH'}`);
      await page.evaluate(() => window.closeViewer());
      await sleep(300);
    }
    await r.ctx.close();
    // The 404 of the deliberately broken icon URL is expected.
    const errors = r.errors.filter((e) => !e.includes('404'));
    return {pass: ok && errors.length === 0, detail: rows.join(' | ') + ` | other errors=${JSON.stringify(errors)}`};
  },
};

function F_ST(s) {
  return `segs=[${s.segs.map((g) => g.state + (g.href ? '>' + S2(g.href) : '') + ` "${g.aria}"`).join(', ')}]`;
}

if (require.main === module) {
  (async () => {
    fs.mkdirSync(OUT, {recursive: true});
    const browser = await chromium.launch();
    for (const v of variants) {
      console.log(`\n===== ${v} =====`);
      for (const [name, fn] of Object.entries(S)) {
        if (only && !only.includes(name)) {
          continue;
        }
        const t0 = Date.now();
        try {
          const res = await withTimeout(fn(browser, v), 120000);
          console.log(`${res.pass ? 'PASS' : 'FAIL'}  ${name} (${Math.round((Date.now() - t0) / 1000)} s)\n      ${res.detail}`);
        } catch (e) {
          console.log(`HARNESS-ERROR ${name}: ${e.stack.split('\n').slice(0, 3).join(' / ')}`);
        }
      }
    }
    await browser.close();
  })();
}
