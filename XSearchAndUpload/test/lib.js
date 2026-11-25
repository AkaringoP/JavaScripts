// Page builder with realistic x.com-like layout (avatar column, action row sizes) and GM stubs,
// used by the tap-target and rendering scenarios. The script is injected unchanged.
const fs = require('fs');

const path = require('path');
const {readScript} = require('./script.js');
const SCRIPT_OF = (v) => readScript(v);
const SCRIPT = SCRIPT_OF('current');
// The icon the script embeds (used as a stand-in resource for old variants).
const ICON = (SCRIPT.match(/data:image\/png;base64,[A-Za-z0-9+\/=]+/) || [''])[0];
const UA = 'Mozilla/5.0 (Android 14; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0';

const PAGE_CSS = `
  html { font-size: 15px; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--fg);
    font: 15px/20px Roboto, Helvetica, Arial, sans-serif; }
  .cell { border-bottom: 1px solid var(--line); }
  article { display: flex; flex-direction: column; padding: 0 16px; cursor: pointer; }
  .trow { display: flex; flex-direction: row; padding-top: 12px; }
  .avatar { flex: 0 0 40px; height: 40px; margin-right: 8px; border-radius: 50%; background: #8899a6; }
  .content { display: flex; flex-direction: column; flex: 1 1 0; min-width: 0; padding-bottom: 12px; }
  .hdr { display: flex; gap: 4px; color: var(--sub); }
  .hdr b { color: var(--fg); }
  .hdr a { color: inherit; text-decoration: none; }
  .media { margin-top: 12px; border-radius: 16px; overflow: hidden; border: 1px solid var(--line);
    position: relative; display: flex; flex-direction: row; gap: 2px; }
  .col { display: flex; flex-direction: column; gap: 2px; flex: 1 1 0; min-width: 0; }
  .pc { position: relative; flex: 1 1 0; min-height: 0; min-width: 0; }
  .pc > a { position: absolute; inset: 0; display: block; }
  [data-testid="tweetPhoto"] { position: absolute; inset: 0; overflow: hidden; }
  [data-testid="tweetPhoto"] .bg { position: absolute; inset: 0; }
  [data-testid="tweetPhoto"] img.ph { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; }
  .altbadge { position: absolute; left: 12px; bottom: 12px; width: 30px; height: 20px; border-radius: 4px;
    background: rgba(0,0,0,0.77); color: #fff; font: 700 13px/20px Arial; text-align: center; }
  .actions { display: flex; flex-direction: row; justify-content: space-between; gap: 4px;
    margin-top: 12px; max-width: 600px; }
  .aw { display: flex; flex: 1 1 0%; justify-content: flex-start; }
  .aw.last { flex: 0 0 auto; gap: 12px; }
  .ab { all: unset; display: flex; min-height: 20px; justify-content: center; cursor: pointer; }
  .abi { display: flex; align-items: center; font-size: 13px; line-height: 16px; color: var(--sub); }
  .ic { display: inline-flex; position: relative; }
  .circle { position: absolute; inset: 0; margin: -8px; border-radius: 9999px; }
  .ic svg { width: 18.75px; height: 18.75px; display: block; }
  .cnt { padding: 0 12px; min-width: calc(1em + 24px); }
  .actions.detail { margin-top: 0; height: 48px; align-items: center; justify-content: space-around;
    border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); }
  .actions.detail .aw { flex: 0 0 auto; }
  .actions.detail .ic svg { width: 22.5px; height: 22.5px; }
`;

const THEMES = {
  white: {bg: '#ffffff', fg: '#0f1419', sub: '#536471', line: '#eff3f4'},
  dim: {bg: '#15202b', fg: '#f7f9f9', sub: '#8b98a5', line: '#38444d'},
  black: {bg: '#000000', fg: '#e7e9ea', sub: '#71767b', line: '#2f3336'},
};

// ---- runs in the page ----
function buildTimeline(spec) {
  window.__log = window.__log || [];
  const log = (who, ev, extra) => window.__log.push(
      Object.assign({who, type: ev.type, t: Math.round(performance.now())}, extra || {}));
  const desc = (el) => {
    if (!el || !el.tagName) return String(el);
    let s = el.tagName.toLowerCase();
    if (el.dataset && el.dataset.testid) s += `[${el.dataset.testid}]`;
    if (el.className && typeof el.className === 'string') s += '.' + el.className.split(/\s+/).join('.');
    return s;
  };
  window.__desc = desc;
  // Classify what a point hits, the way a user would describe it.
  window.__who = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return 'offscreen';
    if (el.closest('.xdsu-bar-seg')) return 'segment';
    if (el.closest('.xdsu-upload-btn')) return 'uploadBtn';
    if (el.closest('.altbadge')) return 'altBadge';
    for (const n of ['like', 'unlike', 'likeX', 'reply', 'retweet', 'analytics', 'bookmark', 'share']) {
      if (el.closest(`[data-testid="${n}"]`)) return n.replace('unlike', 'like').replace('likeX', 'like');
    }
    if (el.closest('a[data-photo]')) return 'photo';
    if (el.closest('article')) return 'article';
    return 'page';
  };
  const root = document.createElement('main');
  const BG = [
    'linear-gradient(135deg,#f6d5e5,#fdf6ee)',
    'linear-gradient(135deg,#1c2533,#3b2a4a)',
    'linear-gradient(135deg,#ffe9a8,#ff9f80)',
    'linear-gradient(135deg,#bfe3ff,#e8f6ff)',
  ];
  const ICONS = {
    reply: 'M3 4h18v12H8l-5 4z', retweet: 'M4 8l4-4 4 4M8 4v12h8M20 16l-4 4-4-4M16 20V8H8',
    like: 'M12 21C5 15 3 12 3 8a4.5 4.5 0 019-1 4.5 4.5 0 019 1c0 4-2 7-9 13z',
    views: 'M4 20V10M10 20V4M16 20v-8M22 20V7', bookmark: 'M6 3h12v18l-6-5-6 5z',
    share: 'M12 3v12M7 8l5-5 5 5M5 14v6h14v-6',
  };
  const mkBtn = (name, count) => {
    const b = document.createElement(name === 'views' ? 'a' : 'button');
    b.className = 'ab';
    if (name === 'views') b.href = '#analytics'; else b.type = 'button';
    b.dataset.testid = name === 'views' ? 'analytics' : name;
    b.innerHTML = `<div class="abi"><div class="ic"><div class="circle"></div>` +
      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="${ICONS[name]}"/></svg></div>` +
      (count === null ? '' : `<span class="cnt">${count}</span>`) + `</div>`;
    b.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      log(name, ev);
      if (name === 'like' && b.dataset.testid !== 'likeX') {
        b.dataset.testid = b.dataset.testid === 'like' ? 'unlike' : 'like';
      }
    });
    return b;
  };
  const ALL = ['touchstart', 'touchend', 'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click'];
  const mkPhoto = (t, n, bgIdx) => {
    const pc = document.createElement('div');
    pc.className = 'pc';
    const a = document.createElement('a');
    a.href = `/${t.user}/status/${t.id}/${t.video ? 'video' : 'photo'}/${n}`;
    a.setAttribute('role', 'link');
    a.dataset.photo = String(n);
    const ph = document.createElement('div');
    ph.dataset.testid = 'tweetPhoto';
    const bg = document.createElement('div');
    bg.className = 'bg';
    bg.style.background = BG[bgIdx % BG.length];
    const img = document.createElement('img');
    img.className = 'ph';
    img.alt = 'Image';
    img.src = t.video ?
      `https://pbs.twimg.com/ext_tw_video_thumb/${t.id}/pu/img/${t.hashes[n - 1]}.jpg` :
      `https://pbs.twimg.com/media/${t.hashes[n - 1]}?format=jpg&name=small`;
    ph.append(bg, img);
    a.append(ph);
    for (const type of ALL) {
      a.addEventListener(type, (ev) => {
        if (type === 'click') {
          ev.preventDefault();
          ev.stopPropagation();
        } else if (!window.__verbose) {
          return;
        }
        log(`photo:${n}`, ev, {target: desc(ev.target)});
      });
    }
    pc.append(a);
    if (t.alt && n === 1) {
      const badge = document.createElement('div');
      badge.className = 'altbadge';
      badge.textContent = 'ALT';
      badge.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        log('altBadge', ev);
      });
      pc.append(badge);
    }
    return pc;
  };
  for (const t of spec.tweets) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const art = document.createElement('article');
    art.dataset.testid = 'tweet';
    art.dataset.tid = t.id;
    if (t.detail) art.setAttribute('tabindex', '-1');
    const trow = document.createElement('div');
    trow.className = 'trow';
    const av = document.createElement('div');
    av.className = 'avatar';
    const content = document.createElement('div');
    content.className = 'content';
    const hdr = document.createElement('div');
    hdr.className = 'hdr';
    hdr.innerHTML = `<b>${t.label}</b><span>@${t.user}</span><span>·</span>` +
      `<a href="/${t.user}/status/${t.id}"><time datetime="2026-11-20T00:00:00.000Z">5d</time></a>`;
    const media = document.createElement('div');
    media.className = 'media';
    const n = t.hashes.length;
    const W = spec.contentWidth;
    if (n === 1) {
      media.style.height = Math.round(W * (t.ratio || 0.75)) + 'px';
      media.append(mkPhoto(t, 1, t.bg || 0));
    } else {
      media.style.height = (W * 9 / 16) + 'px';
      const c1 = document.createElement('div');
      c1.className = 'col';
      const c2 = document.createElement('div');
      c2.className = 'col';
      if (n === 2) {
        c1.append(mkPhoto(t, 1, 0));
        c2.append(mkPhoto(t, 2, 1));
      } else if (n === 3) {
        c1.append(mkPhoto(t, 1, 0));
        c2.append(mkPhoto(t, 2, 1), mkPhoto(t, 3, 2));
      } else if (spec.gridOrder === 'row') {
        c1.append(mkPhoto(t, 1, 0), mkPhoto(t, 2, 1));
        c2.append(mkPhoto(t, 3, 2), mkPhoto(t, 4, 3));
      } else {
        // column-major DOM: column 1 = photos 1 and 3, column 2 = photos 2 and 4
        c1.append(mkPhoto(t, 1, 0), mkPhoto(t, 3, 2));
        c2.append(mkPhoto(t, 2, 1), mkPhoto(t, 4, 3));
      }
      media.append(c1, c2);
    }
    const actions = document.createElement('div');
    actions.setAttribute('role', 'group');
    actions.className = 'actions' + (t.detail ? ' detail' : '');
    const order = t.detail ? ['reply', 'retweet', 'like', 'bookmark', 'share'] :
        ['reply', 'retweet', 'like', 'views'];
    for (const name of order) {
      const w = document.createElement('div');
      w.className = 'aw';
      w.append(mkBtn(name, t.detail ? null : (name === 'views' ? '1.2K' : '12')));
      actions.append(w);
    }
    if (!t.detail) {
      const last = document.createElement('div');
      last.className = 'aw last';
      last.append(mkBtn('bookmark', null), mkBtn('share', null));
      actions.append(last);
    }
    content.append(hdr, document.createTextNode(t.text || 'tweet text'), media, actions);
    trow.append(av, content);
    art.append(trow);
    for (const type of ALL) {
      art.addEventListener(type, (ev) => {
        if (type !== 'click' && !window.__verbose) return;
        log('article', ev, {target: desc(ev.target)});
      });
    }
    cell.append(art);
    root.append(cell);
  }
  const spacer = document.createElement('div');
  spacer.style.height = '900px';
  root.append(spacer);
  document.body.append(root);
}

function installStubs(cfg) {
  window.__gm = {xhr: [], openInTab: [], menu: [], store: {}, styles: 0, t0: performance.now()};
  window.__netDelay = cfg.netDelay;
  const posts = cfg.posts; window.__posts = posts;
  window.GM_xmlhttpRequest = (d) => {
    const u = new URL(d.url);
    const tags = u.searchParams.get('tags') || '';
    const rec = {tags, t: Math.round(performance.now() - window.__gm.t0)};
    window.__gm.xhr.push(rec);
    setTimeout(() => {
      if (cfg.errorIds.some((id) => tags.includes(`status/${id}*`))) {
        rec.status = 500;
        d.onload({status: 500, responseText: 'error'});
        return;
      }
      const needles = [...tags.matchAll(/~source:\*([^*]+)\*/g)].map((m) => m[1]);
      const hits = posts.filter((p) => needles.some((nd) => p.source.includes(nd)));
      rec.status = 200;
      rec.hits = hits.length;
      d.onload({status: 200, responseText: JSON.stringify(hits)});
    }, window.__netDelay);
  };
  window.GM_addStyle = (css) => {
    const s = document.createElement('style');
    s.textContent = css;
    s.dataset.gm = '1';
    document.head.append(s);
    window.__gm.styles++;
    return s;
  };
  window.GM_getResourceURL = () => cfg.icon;
  window.GM_openInTab = (url, opts) => {
    window.__gm.openInTab.push({url, opts, t: Math.round(performance.now())});
    return {close() {}};
  };
  window.GM_getValue = (k, def) => (k in window.__gm.store ? window.__gm.store[k] : def);
  window.GM_setValue = (k, v) => { window.__gm.store[k] = v; };
  window.GM_registerMenuCommand = (name, fn) => { window.__gm.menu.push({name, fn}); };
}

const BASE_TWEETS = [
  {id: '1001', user: 'artist', label: 'T1 1img found', hashes: ['Aaaa1'], bg: 0},
  {id: '1002', user: 'artist', label: 'T2 2img', hashes: ['Bbbb1', 'Bbbb2']},
  {id: '1003', user: 'artist', label: 'T3 3img missing', hashes: ['Cccc1', 'Cccc2', 'Cccc3']},
  {id: '1004', user: 'artist', label: 'T4 4img mix', hashes: ['Dddd1', 'Dddd2', 'Dddd3', 'Dddd4']},
  {id: '1005', user: 'artist', label: 'T5 video', hashes: ['VidPoster1'], video: true, ratio: 0.5625, bg: 1},
  {id: '1006', user: 'artist', label: 'T6 plain-src', hashes: ['Ffff1'], bg: 1},
  {id: '1007', user: 'artist', label: 'T7 ALT hashhit', hashes: ['Gggg1'], alt: true, bg: 2},
  {id: '1008', user: 'artist', label: 'T8 error', hashes: ['Hhhh1'], bg: 3, ratio: 0.5625},
];

const POSTS = [
  {id: 501, source: 'https://twitter.com/artist/status/1001/photo/1', rating: 'g', score: 1},
  {id: 502, source: 'https://twitter.com/artist/status/1002/photo/1', rating: 'g', score: 1},
  {id: 541, source: 'https://twitter.com/artist/status/1004/photo/1', rating: 'g', score: 1},
  {id: 543, source: 'https://twitter.com/artist/status/1004/photo/3', rating: 'g', score: 1},
  {id: 506, source: 'https://twitter.com/artist/status/1006', rating: 'g', score: 1},
  {id: 507, source: 'https://pbs.twimg.com/media/Gggg1.jpg:orig', rating: 'g', score: 1},
  {id: 509, source: 'https://twitter.com/artist/status/1009/photo/1', rating: 'g', score: 1},
];

// opts: {tweets, gridOrder, errorIds, netDelay, icon, noInject, dsf, extraHtml}
async function newPage(browser, vp, theme, opts) {
  opts = opts || {};
  const touch = opts.touch !== false;
  const context = await browser.newContext({
    viewport: vp, hasTouch: touch, isMobile: touch, userAgent: UA, reducedMotion: opts.reducedMotion || null,
    deviceScaleFactor: opts.dsf || 1,
  });
  await context.route('**/*', (route) => {
    const url = route.request().url();
    if (url.startsWith('https://pbs.twimg.com/')) {
      return route.fulfill({status: 200, contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="3"/>'});
    }
    // serve x.com so relative status links resolve (the script reads link.pathname).
    if (url.startsWith('https://x.com/') && route.request().resourceType() === 'document') {
      return route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>'});
    }
    return route.abort();
  });
  const page = await context.newPage();
  await page.goto('https://x.com/home');
  const th = THEMES[theme];
  await page.setContent(`<!doctype html><html><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=0">
    <style>:root{--bg:${th.bg};--fg:${th.fg};--sub:${th.sub};--line:${th.line};}${PAGE_CSS}</style>
    </head><body>${opts.extraHtml || ''}</body></html>`);
  const contentWidth = vp.width - 32 - 48;
  const spec = {contentWidth, tweets: opts.tweets || BASE_TWEETS, gridOrder: opts.gridOrder || 'column'};
  await page.evaluate(buildTimeline, spec);
  const before = await page.evaluate(() => [...document.querySelectorAll('article')].map(
      (a) => ({id: a.dataset.tid, h: a.getBoundingClientRect().height})));
  await page.evaluate(installStubs, {
    netDelay: opts.netDelay || 150, posts: POSTS,
    errorIds: opts.errorIds || ['1008'],
    icon: 'icon' in opts ? opts.icon : ICON,
  });
  if (opts.beforeInject) await opts.beforeInject(page);
  if (!opts.noInject) await page.addScriptTag({content: opts.variant ? SCRIPT_OF(opts.variant) : SCRIPT});
  return {context, page, before, contentWidth};
}

const r2 = (n) => Math.round(n * 100) / 100;

// One real touch tap; returns what was activated.
async function tapAndLog(page, x, y, settle) {
  await page.evaluate(() => { window.__log.length = 0; window.__gm.openInTab.length = 0; });
  const geo = await page.evaluate(([px, py]) => window.__who(px, py), [x, y]);
  await page.touchscreen.tap(x, y);
  await page.waitForTimeout(settle || 50);
  const res = await page.evaluate(() => ({
    log: window.__log.filter((l) => l.type === 'click').map((l) => l.who.replace(/:\d+$/, '')),
    open: window.__gm.openInTab.map((o) => ({url: o.url, opts: o.opts})),
  }));
  let got = 'nothing';
  if (res.open.length) {
    got = /uploads\/new/.test(res.open[0].url) ? 'uploadBtn' : 'segment';
    if (res.open.length > 1) got += `x${res.open.length}`;
  } else if (res.log.length) {
    got = res.log.join(',');
  }
  return {geo, got, open: res.open};
}

// Compress [{k, v}] sorted by k into "v: a..b" bands.
function bands(rows) {
  const out = [];
  let cur = null;
  for (const {k, v} of rows) {
    if (!cur || cur.v !== v) { cur = {v, from: k, to: k}; out.push(cur); } else cur.to = k;
  }
  return out.map((b) => `${b.v}[${b.from}..${b.to}]`).join(' ');
}

module.exports = {SCRIPT, SCRIPT_OF, ICON, UA, THEMES, BASE_TWEETS, POSTS, newPage, tapAndLog, bands, r2};
