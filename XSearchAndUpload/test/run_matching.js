// Judging a tweet by its post count, links and labels, photo numbers from /photo/N links.
// node run_matching.js [variant,..] [scenario,..]
const {chromium, newPage, inject, sleep, NAMES} = require('./h.js');

const variants = (process.argv[2] || 'current').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;
const B = 'https://danbooru.donmai.us/';
const SEARCH = (id) => `${B}posts?tags=${encodeURIComponent(`status:any source:*status/${id}*`)}`;
const POST = (id) => `${B}posts/${id}`;

// Installs a fake post table (window.__db) and the tile builder.
async function setup(page) {
  await page.evaluate(() => {
    window.__db = [];
    window.__responder = (u) => {
      const ids = [...u.matchAll(/source:\*status\/(\d+)\*/g)].map((m) => m[1]);
      const hs = [...u.matchAll(/source:\*media\/([A-Za-z0-9_-]+)\*/g)].map((m) => m[1]);
      const out = window.__db.filter((p) => ids.some((id) => new RegExp(`status/${id}(?!\\d)`).test(p.source))
        || hs.some((h) => p.source.includes('media/' + h)));
      return {body: JSON.stringify(out)};
    };
    // tiles: [{hash, link: 'photo/N' | 'video/N' | null, video, noSrc}]
    window.tileHtml = (id, t) => {
      const src = t.video
        ? `https://pbs.twimg.com/ext_tw_video_thumb/${id}/pu/img/${t.hash}.jpg`
        : `https://pbs.twimg.com/media/${t.hash}?format=jpg&name=small`;
      const tile = `<div data-testid="tweetPhoto" data-tile="${t.hash}" style="width:150px;height:70px">`
        + (t.noSrc ? '<img>' : `<img src="${src}">`) + (t.video ? '<video></video>' : '') + '</div>';
      return t.link ? `<a href="/u/status/${id}/${t.link}">${tile}</a>` : tile;
    };
    window.addCustom = (id, tiles) => {
      const a = document.createElement('article');
      a.setAttribute('data-testid', 'tweet');
      a.setAttribute('tabindex', '0');
      a.id = 't' + id;
      a.innerHTML = `<a href="/u/status/${id}"><time datetime="2026-01-01">1h</time></a>`
        + `<div class="media">${tiles.map((t) => window.tileHtml(id, t)).join('')}</div>`
        + '<div role="group"><button data-testid="reply">r</button><button data-testid="retweet">rt</button>'
        + '<button data-testid="like">like</button></div>';
      document.getElementById('root').appendChild(a);
    };
    // n image tiles linked /photo/1..n with hashes <prefix>1..n.
    window.addN = (id, n, prefix) => window.addCustom(id, Array.from({length: n},
        (_, i) => ({hash: `${prefix}${i + 1}`, link: `photo/${i + 1}`})));
    window.segInfo = (id) => {
      const a = document.getElementById('t' + id);
      return {
        done: a.dataset.xdsuDone || null,
        segs: [...a.querySelectorAll('.xdsu-bar-seg')].map((s) => ({
          color: window.segColor(s),
          url: window.segUrl(s),
          title: s.getAttribute('title'),
          aria: s.getAttribute('aria-label'),
          hash: s.dataset.imageHash || null,
          tracked: !!s.dataset.tracked,
        })),
        // Upload buttons in segment order is not guaranteed; keyed by tile hash.
        btns: Object.fromEntries([...a.querySelectorAll('[data-testid="tweetPhoto"]')].map((p) => {
          const b = p.querySelector(':scope > .xdsu-upload-btn');
          return [p.dataset.tile, b ? {found: b.classList.contains('xdsu-found'), aria: b.getAttribute('aria-label')} : null];
        })),
      };
    };
  });
}

async function info(page, id) {
  const r = await page.evaluate((id) => window.segInfo(id), id);
  r.segs.forEach((s) => {
    s.c = NAMES[s.color] || s.color || 'NONE';
  });
  return r;
}
const fmt = (r) => r.segs.map((s) => `${s.c}${s.hash ? '(' + s.hash + ')' : ''}${s.url ? '>' + s.url.replace(B, '').slice(0, 30) : ''}`
    + `${s.title !== null ? ' "' + s.title + '"' : ''}`).join(', ') + (r.done ? ' done' : ' NOT-done');
const labelOk = (s, text) => s.title === text && s.aria === text;

async function start(browser, v, build) {
  const {page, errors} = await newPage(browser);
  await setup(page);
  await page.evaluate(build);
  await inject(page, v);
  return {page, errors};
}

async function fin(page, errors, pass, detail) {
  const unh = await page.evaluate(() => window.__unhandled);
  const reqs = await page.evaluate(() => window.__reqs);
  const errs = errors.filter((e) => !e.includes('Failed to load resource'));
  await page.context().close();
  return {pass: pass && !errs.length && !unh.length,
    detail: `${detail} | reqs(${reqs.length})=${JSON.stringify(reqs)}`
      + (unh.length ? ` | unhandled=${JSON.stringify(unh)}` : '') + (errs.length ? ` | errors=${JSON.stringify(errs)}` : '')};
}

const like = (page, id) => page.evaluate((id) => document.querySelector(`#t${id} [data-testid="like"]`).click(), id);

const S = {
  // ---------- T13 ----------
  async d13_one_image_one_post(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [{id: 123, source: 'https://x.com/u/status/1301', is_deleted: false, is_banned: false}];
      window.addN('1301', 1, 'A');
    });
    await sleep(2500);
    const r = await info(page, '1301');
    const s = r.segs[0];
    return fin(page, errors, s.c === 'GREEN' && s.url === POST(123) && labelOk(s, 'On Danbooru: post #123'), fmt(r));
  },

  async d13_four_one_post(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [{id: 140, source: 'https://x.com/u/status/1302', is_deleted: false, is_banned: false}];
      window.addN('1302', 4, 'B');
    });
    await sleep(2500);
    const r = await info(page, '1302');
    const pass = r.segs.length === 4 && r.segs.every((s) => s.c === 'LGREEN' && s.url === POST(140)
      && labelOk(s, '1 of 4 images posted'));
    return fin(page, errors, pass, fmt(r));
  },

  // 1 parent + 3 children, all live, all with the tweet URL as source.
  async d13_four_four_family(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [
        {id: 150, parent_id: null, source: 'https://x.com/u/status/1303', is_deleted: false, is_banned: false},
        {id: 151, parent_id: 150, source: 'https://x.com/u/status/1303', is_deleted: false, is_banned: false},
        {id: 152, parent_id: 150, source: 'https://x.com/u/status/1303', is_deleted: false, is_banned: false},
        {id: 153, parent_id: 150, source: 'https://x.com/u/status/1303', is_deleted: false, is_banned: false},
      ];
      window.addN('1303', 4, 'C');
    });
    await sleep(2500);
    const r = await info(page, '1303');
    const pass = r.segs.length === 4 && r.segs.every((s) => s.c === 'GREEN' && s.url === SEARCH('1303')
      && labelOk(s, 'On Danbooru: 4 posts'));
    return fin(page, errors, pass, fmt(r));
  },

  async d13_four_live_deleted_child(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [
        {id: 160, parent_id: null, source: 'https://x.com/u/status/1304', is_deleted: false, is_banned: false},
        {id: 161, parent_id: 160, source: 'https://x.com/u/status/1304', is_deleted: true, is_banned: false},
      ];
      window.addN('1304', 4, 'D');
    });
    await sleep(2500);
    const r = await info(page, '1304');
    const pass = r.segs.length === 4 && r.segs.every((s) => s.c === 'LGREEN' && s.url === POST(160)
      && labelOk(s, '1 of 4 images posted'));
    return fin(page, errors, pass, fmt(r));
  },

  async d13_deleted_only(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [{id: 170, source: 'https://x.com/u/status/1305', is_deleted: true, is_banned: false}];
      window.addN('1305', 1, 'E');
    });
    await sleep(2500);
    const s = (await info(page, '1305')).segs[0];
    return fin(page, errors, s.c === 'GREEN' && s.url === POST(170) && labelOk(s, 'post #170 (deleted)'),
        fmt(await info(page, '1305')));
  },

  async d13_banned_only(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [{id: 180, source: 'https://x.com/u/status/1306', is_deleted: false, is_banned: true}];
      window.addN('1306', 1, 'F');
    });
    await sleep(2500);
    const s = (await info(page, '1306')).segs[0];
    return fin(page, errors, s.c === 'GREEN' && s.url === POST(180) && labelOk(s, 'post #180 (banned)'),
        fmt(await info(page, '1306')));
  },

  // Link priority: not banned and not deleted -> deleted -> banned, applied when the tweet counts
  // as having one post.
  async d13_link_priority(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      const p = (id, t, d, b) => ({id, source: `https://x.com/u/status/${t}`, is_deleted: d, is_banned: b});
      window.__db = [
        // a: deleted + live -> the live one
        p(201, '1311', true, false), p(202, '1311', false, false),
        // b: banned (not deleted) + deleted -> k = 1, the deleted one
        p(211, '1312', false, true), p(212, '1312', true, false),
        // c: live + banned + deleted -> k = 2 -> found, search link
        p(221, '1313', false, false), p(222, '1313', false, true), p(223, '1313', true, false),
        // d: 2 images, banned + deleted -> 1 of 2, the deleted one
        p(231, '1314', false, true), p(232, '1314', true, false),
        // e: deleted + banned-and-deleted + banned... all deleted -> k = 3? no: one live banned
        p(241, '1315', true, true), p(242, '1315', false, true),
      ];
      window.addN('1311', 1, 'Ga');
      window.addN('1312', 1, 'Gb');
      window.addN('1313', 1, 'Gc');
      window.addN('1314', 2, 'Gd');
      window.addN('1315', 1, 'Ge');
    });
    await sleep(2500);
    const a = (await info(page, '1311')).segs[0];
    const b = (await info(page, '1312')).segs[0];
    const c = (await info(page, '1313')).segs[0];
    const d = (await info(page, '1314')).segs;
    const e = (await info(page, '1315')).segs[0];
    const pass = a.c === 'GREEN' && a.url === POST(202) && labelOk(a, 'On Danbooru: post #202')
      && b.c === 'GREEN' && b.url === POST(212) && labelOk(b, 'post #212 (deleted)')
      && c.c === 'GREEN' && c.url === SEARCH('1313') && labelOk(c, 'On Danbooru: 2 posts')
      && d.every((s) => s.c === 'LGREEN' && s.url === POST(232) && labelOk(s, '1 of 2 images posted'))
      // 241 is deleted and banned (rank banned), 242 banned only: k = 1 (live = [242]); both rank
      // banned, so the first one in the response order wins.
      && e.c === 'GREEN' && [POST(241), POST(242)].includes(e.url) && /^post #24[12] \(banned\)$/.test(e.title);
    const all = [];
    for (const id of ['1311', '1312', '1313', '1314', '1315']) {
      all.push(`${id}: ${fmt(await info(page, id))}`);
    }
    return fin(page, errors, pass, all.join(' || '));
  },

  async d13_two_images_three_posts(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [250, 251, 252].map((id) => ({id, source: 'https://x.com/u/status/1320', is_deleted: false, is_banned: false}));
      window.addN('1320', 2, 'H');
    });
    await sleep(2500);
    const r = await info(page, '1320');
    const pass = r.segs.length === 2 && r.segs.every((s) => s.c === 'GREEN' && s.url === SEARCH('1320')
      && labelOk(s, 'On Danbooru: 3 posts'));
    return fin(page, errors, pass, fmt(r));
  },

  // Strict matches still win: (a) by media hash through the hash lookup, (b) by /photo/N in the
  // tweet lookup, among several posts.
  async d13_strict_wins(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [
        {id: 260, source: 'https://pbs.twimg.com/media/Ia2.jpg', is_deleted: false, is_banned: false},
        {id: 270, source: 'https://x.com/u/status/1322', is_deleted: false, is_banned: false},
        {id: 271, source: 'https://twitter.com/u/status/1322/photo/3', is_deleted: false, is_banned: false},
      ];
      window.addN('1321', 4, 'Ia');
      window.addN('1322', 4, 'Ib');
    });
    await sleep(3000);
    const a = await info(page, '1321');
    const b = await info(page, '1322');
    const pass = a.segs.map((s) => s.c).join() === 'RED,GREEN,RED,RED' && a.segs[1].url === POST(260)
      && labelOk(a.segs[1], 'On Danbooru: post #260') && labelOk(a.segs[0], 'Not on Danbooru')
      && b.segs.map((s) => s.c).join() === 'LGREEN,LGREEN,GREEN,LGREEN' && b.segs[2].url === POST(271)
      && labelOk(b.segs[2], 'On Danbooru: post #271') && b.segs[0].url === SEARCH('1322')
      && labelOk(b.segs[0], '2 of 4 images posted');
    return fin(page, errors, pass, `1321: ${fmt(a)} || 1322: ${fmt(b)}`);
  },

  // A re-check changes only the label: (a) colour and URL kept (post deleted meanwhile),
  // (b) 1 of 4 -> 2 of 4.
  async d13_label_change(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [
        {id: 280, source: 'https://x.com/u/status/1330', is_deleted: false, is_banned: false},
        {id: 290, source: 'https://x.com/u/status/1331', is_deleted: false, is_banned: false},
      ];
      window.addN('1330', 1, 'J');
      window.addN('1331', 4, 'K');
    });
    await sleep(2500);
    const a0 = await info(page, '1330');
    const b0 = await info(page, '1331');
    await page.evaluate(() => {
      window.__db[0].is_deleted = true;
      window.__db.push({id: 291, source: 'https://x.com/u/status/1331', is_deleted: false, is_banned: false});
    });
    await like(page, '1330');
    await like(page, '1331');
    await sleep(2500);
    const a1 = await info(page, '1330');
    const b1 = await info(page, '1331');
    const pass = a0.segs[0].c === 'GREEN' && labelOk(a0.segs[0], 'On Danbooru: post #280')
      && a1.segs[0].c === 'GREEN' && a1.segs[0].url === POST(280) && labelOk(a1.segs[0], 'post #280 (deleted)')
      && b0.segs.every((s) => s.c === 'LGREEN' && labelOk(s, '1 of 4 images posted'))
      && b1.segs.every((s) => s.c === 'LGREEN' && labelOk(s, '2 of 4 images posted'));
    return fin(page, errors, pass, `1330: ${fmt(a0)} -> ${fmt(a1)} || 1331: ${fmt(b0)} -> ${fmt(b1)}`);
  },

  // 2 tiles at first (the second image not loaded, so the tweet is not done), 4 later.
  async d13_late_tiles(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [{id: 300, source: 'https://x.com/u/status/1340', is_deleted: false, is_banned: false}];
      window.addCustom('1340', [{hash: 'L1', link: 'photo/1'}, {hash: 'L2', link: 'photo/2', noSrc: true}]);
    });
    await sleep(2500);
    const r0 = await info(page, '1340');
    await page.evaluate(() => {
      const a = document.getElementById('t1340');
      a.querySelector('[data-tile="L2"] img').src = 'https://pbs.twimg.com/media/L2?format=jpg&name=small';
      a.querySelector('.media').insertAdjacentHTML('beforeend',
          window.tileHtml('1340', {hash: 'L3', link: 'photo/3'}) + window.tileHtml('1340', {hash: 'L4', link: 'photo/4'}));
    });
    await sleep(3000);
    const r1 = await info(page, '1340');
    const pass = r0.segs.length === 2 && r0.segs[0].c === 'LGREEN' && labelOk(r0.segs[0], '1 of 2 images posted')
      && r0.segs[0].url === POST(300) && !r0.done
      && r1.segs.length === 4 && r1.segs.every((s) => s.c === 'LGREEN' && s.url === POST(300)
        && labelOk(s, '1 of 4 images posted')) && r1.done === '1340';
    return fin(page, errors, pass, `${fmt(r0)} -> ${fmt(r1)}`);
  },

  // A video tile (no media hash) takes part in the count like any other tile.
  async d13_video_count(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      const p = (id, t) => ({id, source: `https://x.com/u/status/${t}`, is_deleted: false, is_banned: false});
      window.__db = [p(310, '1350'), p(320, '1351'), p(321, '1351')];
      window.addCustom('1350', [{hash: 'M1', link: 'photo/1'}, {hash: 'MV', link: 'video/1', video: true}]);
      window.addCustom('1351', [{hash: 'NV', link: 'video/1', video: true}, {hash: 'N2', link: 'photo/2'}]);
    });
    await sleep(3000);
    const a = await info(page, '1350');
    const b = await info(page, '1351');
    const pass = a.segs.length === 2 && a.segs.every((s) => s.c === 'LGREEN' && s.tracked && s.url === POST(310)
      && labelOk(s, '1 of 2 images posted')) && a.done === '1350'
      && b.segs.length === 2 && b.segs.every((s) => s.c === 'GREEN' && s.tracked && s.url === SEARCH('1351')
        && labelOk(s, 'On Danbooru: 2 posts')) && b.done === '1351'
      && b.segs[1].hash === 'N2';
    return fin(page, errors, pass, `1350: ${fmt(a)} || 1351: ${fmt(b)}`);
  },

  // The upload button mirrors the final found colour.
  async d13_button_mirror(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      const p = (id, t) => ({id, source: `https://x.com/u/status/${t}`, is_deleted: false, is_banned: false});
      window.__db = [p(330, '1360'), p(340, '1361'), p(350, '1362'), p(351, '1362'), p(352, '1362'), p(353, '1362')];
      window.addN('1360', 1, 'O');
      window.addN('1361', 4, 'P');
      window.addN('1362', 4, 'Q');
    });
    await sleep(3000);
    const a = await info(page, '1360');
    const b = await info(page, '1361');
    const c = await info(page, '1362');
    const all = (r, found) => Object.values(r.btns).every((x) => x && x.found === found
      && x.aria === (found ? 'Already on Danbooru' : 'Upload to Danbooru'));
    const pass = all(a, true) && all(b, false) && all(c, true) && Object.keys(c.btns).length === 4;
    return fin(page, errors, pass, `btns 1360=${JSON.stringify(a.btns)} 1361=${JSON.stringify(b.btns)} 1362=${JSON.stringify(c.btns)}`);
  },

  // ---------- T14 ----------
  // Column-first 4-image grid: DOM order /photo/1, /photo/3, /photo/2, /photo/4. The tile of
  // /photo/N has hash <prefix>N. (a) tweet post /photo/2, (b) a post found by the hash of photo 2.
  async d14_column_grid(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      const col = (id, pre) => window.addCustom(id, [1, 3, 2, 4].map((n) => ({hash: `${pre}${n}`, link: `photo/${n}`})));
      window.__db = [
        {id: 400, source: 'https://twitter.com/u/status/1400/photo/2', is_deleted: false, is_banned: false},
        {id: 410, source: 'https://pbs.twimg.com/media/S2.jpg', is_deleted: false, is_banned: false},
      ];
      col('1400', 'R');
      col('1401', 'S');
    });
    await sleep(3000);
    const a = await info(page, '1400');
    const b = await info(page, '1401');
    const pass = a.segs.map((s) => s.hash).join() === 'R1,R2,R3,R4' && a.done === '1400'
      && a.segs.map((s) => s.c).join() === 'LGREEN,GREEN,LGREEN,LGREEN' && a.segs[1].url === POST(400)
      && b.segs.map((s) => s.hash).join() === 'S1,S2,S3,S4' && b.done === '1401'
      && b.segs.map((s) => s.c).join() === 'RED,GREEN,RED,RED' && b.segs[1].url === POST(410);
    return fin(page, errors, pass, `1400: ${fmt(a)} || 1401: ${fmt(b)}`);
  },

  // A tile without a /photo/N link mixed in: DOM /photo/1, (none), /photo/2, /photo/4 ->
  // numbers 1, 3, 2, 4. Every segment is tracked and the article is done.
  async d14_linkless_tile(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.addCustom('1410', [{hash: 'T1', link: 'photo/1'}, {hash: 'Tx', link: null},
        {hash: 'T2', link: 'photo/2'}, {hash: 'T4', link: 'photo/4'}]);
    });
    await sleep(3000);
    const r = await info(page, '1410');
    const pass = r.segs.map((s) => s.hash).join() === 'T1,T2,Tx,T4' && r.segs.every((s) => s.tracked && s.c === 'RED')
      && r.done === '1410';
    return fin(page, errors, pass, fmt(r));
  },

  // Duplicate link numbers -> DOM order for the whole tweet; an out-of-range number is treated
  // like a missing link (lowest free number); all out of range -> DOM order.
  async d14_bad_links(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      const t = (pre, links) => links.map((l, i) => ({hash: `${pre}${i + 1}`, link: l}));
      window.addCustom('1420', t('U', ['photo/1', 'photo/1', 'photo/3', 'photo/2']));
      window.addCustom('1421', t('V', ['photo/1', 'photo/7', 'photo/2', 'photo/4']));
      window.addCustom('1422', t('W', ['photo/0', 'photo/9']));
    });
    await sleep(3000);
    const a = await info(page, '1420');
    const b = await info(page, '1421');
    const c = await info(page, '1422');
    const ok = (r, hashes, id) => r.segs.map((s) => s.hash).join() === hashes && r.segs.every((s) => s.tracked && s.c === 'RED')
      && r.done === id;
    const pass = ok(a, 'U1,U2,U3,U4', '1420') && ok(b, 'V1,V3,V2,V4', '1421') && ok(c, 'W1,W2', '1422');
    return fin(page, errors, pass, `1420: ${fmt(a)} || 1421: ${fmt(b)} || 1422: ${fmt(c)}`);
  },

  // Normal row-order 1-, 2- and 3-image tweets keep DOM order, also without any links.
  async d14_normal(browser, v) {
    const {page, errors} = await start(browser, v, () => {
      window.__db = [{id: 500, source: 'https://twitter.com/u/status/1432/photo/3', is_deleted: false, is_banned: false}];
      window.addN('1430', 1, 'X');
      window.addN('1431', 2, 'Y');
      window.addN('1432', 3, 'Z');
      window.addCustom('1433', [{hash: 'Q1', link: null}, {hash: 'Q2', link: null}, {hash: 'Q3', link: null}]);
    });
    await sleep(3000);
    const r = [];
    for (const id of ['1430', '1431', '1432', '1433']) {
      r.push(await info(page, id));
    }
    const pass = r[0].segs.map((s) => s.hash).join() === 'X1' && r[1].segs.map((s) => s.hash).join() === 'Y1,Y2'
      && r[2].segs.map((s) => s.hash).join() === 'Z1,Z2,Z3' && r[3].segs.map((s) => s.hash).join() === 'Q1,Q2,Q3'
      && r[2].segs.map((s) => s.c).join() === 'LGREEN,LGREEN,GREEN' && r.every((x) => x.done);
    return fin(page, errors, pass, r.map(fmt).join(' || '));
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
      try {
        const r = await fn(browser, v);
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name}\n      ${r.detail}`);
      } catch (e) {
        console.log(`HARNESS-ERROR ${name}: ${e.stack}`);
      }
    }
  }
  await browser.close();
})();
