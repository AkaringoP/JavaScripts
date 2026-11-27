// The observer ignoring the script's own nodes; bars and buttons restored after re-renders.
// node run_markers.js [variant,..] [scenario,..]
const {chromium, newPage, inject, sleep, withTimeout} = require('./h.js');

const variants = (process.argv[2] || 'current').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;
const ARTICLE_SELECTOR = 'article[data-testid="tweet"], article[tabindex="-1"]';

// Fake post table, tile builder, scan counter, menu capture. Optionally stops the 2 s poll (kept in
// window.__poll so a scenario can fire it by hand).
async function setup(browser, {noPoll = false, profile = null} = {}) {
  const r = await newPage(browser);
  await r.page.evaluate(({noPoll, profile, SEL}) => {
    if (profile) {
      window.__profile = profile;
    }
    window.__db = [];
    window.__fail = null;
    window.__responder = (u) => {
      if (window.__fail && window.__fail(u)) {
        return {error: true};
      }
      const ids = [...u.matchAll(/source:\*status\/(\d+)\*/g)].map((m) => m[1]);
      const hs = [...u.matchAll(/source:\*media\/([A-Za-z0-9_-]+)\*/g)].map((m) => m[1]);
      const out = window.__db.filter((p) => ids.some((id) => new RegExp(`status/${id}(?!\\d)`).test(p.source))
        || hs.some((h) => p.source.includes('media/' + h)));
      return {body: JSON.stringify(out)};
    };
    window.__lookups = [];
    const orig = window.GM_xmlhttpRequest;
    window.GM_xmlhttpRequest = (d) => {
      if (!d.url.includes('/profile.json')) {
        window.__lookups.push(decodeURIComponent(d.url));
      }
      return orig(d);
    };
    // A scan starts with document.querySelectorAll(ARTICLE_SELECTOR).
    window.__scans = 0;
    const qsa = document.querySelectorAll.bind(document);
    document.querySelectorAll = (s) => {
      if (s === SEL) {
        window.__scans++;
      }
      return qsa(s);
    };
    window.__menus = {};
    window.GM_registerMenuCommand = (label, fn) => {
      window.__menus[label.split(':')[0]] = fn;
      return undefined;
    };
    if (noPoll) {
      const si = window.setInterval;
      window.setInterval = (fn, ms, ...a) => {
        if (ms === 2000) {
          window.__poll = fn;
          return 0;
        }
        return si(fn, ms, ...a);
      };
    }
    window.tileHtml = (id, t) => {
      const src = t.video
        ? `https://pbs.twimg.com/ext_tw_video_thumb/${id}/pu/img/${t.hash}.jpg`
        : `https://pbs.twimg.com/media/${t.hash}?format=jpg&name=small`;
      const tile = `<div data-testid="tweetPhoto" data-tile="${t.hash}" style="width:150px;height:150px">`
        + `<img src="${src}">` + (t.video ? '<video></video>' : '') + '</div>';
      return t.link ? `<a href="/u/status/${id}/${t.link}">${tile}</a>` : tile;
    };
    const LIKE_GROUP = '<div role="group" data-g="like"><button data-testid="reply">r</button>'
      + '<button data-testid="retweet">rt</button><button data-testid="like">like</button></div>';
    window.LIKE_GROUP = LIKE_GROUP;
    // groups: html after the media (default: the Like group).
    window.addCustom = (id, tiles, groups = LIKE_GROUP) => {
      const a = document.createElement('article');
      a.setAttribute('data-testid', 'tweet');
      a.setAttribute('tabindex', '0');
      a.id = 't' + id;
      a.innerHTML = `<a href="/u/status/${id}"><time datetime="2026-01-01">1h</time></a>`
        + `<div class="media">${tiles.map((t) => window.tileHtml(id, t)).join('')}</div>`
        + `<div class="groups">${groups}</div>`;
      document.getElementById('root').appendChild(a);
      return a;
    };
    window.addN = (id, n, prefix) => window.addCustom(id, Array.from({length: n},
        (_, i) => ({hash: `${prefix}${i + 1}`, link: `photo/${i + 1}`})));
    // Full DOM state of an article's segments and buttons.
    window.artState = (id) => {
      const a = document.getElementById('t' + id);
      const bar = a.querySelector('.xdsu-bar');
      return {
        done: a.dataset.xdsuDone || null,
        bar: !!bar,
        barNext: bar && bar.nextElementSibling ? (bar.nextElementSibling.dataset.g || bar.nextElementSibling.tagName) : null,
        segs: [...a.querySelectorAll('.xdsu-bar-seg')].map((s) => ({
          state: s.dataset.state,
          href: s.getAttribute('href'),
          title: s.getAttribute('title'),
          aria: s.getAttribute('aria-label'),
          role: s.getAttribute('role'),
          target: s.getAttribute('target'),
          rel: s.getAttribute('rel'),
          cls: s.className,
        })),
        btns: [...a.querySelectorAll('[data-testid="tweetPhoto"]')].map((p) => {
          const bs = p.querySelectorAll(':scope > .xdsu-upload-btn');
          const b = bs[0];
          return b ? {n: bs.length, href: b.getAttribute('href'), title: b.getAttribute('title'),
            aria: b.getAttribute('aria-label'), cls: b.className, target: b.getAttribute('target'),
            rel: b.getAttribute('rel'), text: b.textContent, img: b.querySelectorAll('img').length} : null;
        }),
      };
    };
  }, {noPoll, profile, SEL: ARTICLE_SELECTOR});
  return r;
}

const ST = (s) => `${s.bar ? 'bar' : 'NOBAR'}${s.barNext ? '>' + s.barNext : ''} segs=[${s.segs.map((g) => g.state
    + (g.href ? '>' + g.href.replace('https://danbooru.donmai.us/', '') : '') + (g.state.startsWith('found') ? ` "${g.aria}"` : '')).join(', ')}]`
  + ` btns=[${s.btns.map((b) => (b ? `${b.n}${b.cls.includes('xdsu-found') ? 'F' : ''}` : 'none')).join(',')}]`;

const S = {
  // T24b: own insertions (bar, segments, buttons, toast) cause no scan; a foreign node inside a tweet
  // does. Since desktop task T7 a foreign node outside every tweet (here a span in the timeline)
  // causes none either; f27_observer_filter covers that rule.
  async f24_own_mutations(browser, v) {
    const r = await setup(browser, {noPoll: true});
    const {page} = r;
    await page.evaluate(() => {
      window.__db = [{id: 11, source: 'https://twitter.com/u/status/9001'},
        {id: 12, source: 'https://twitter.com/u/status/9001'}];
      window.addN('9001', 2, 'OWNA');
      window.addN('9002', 1, 'OWNB');
    });
    await inject(page, v);
    await sleep(1500);
    const a = await page.evaluate(() => ({scans: window.__scans, segs: document.querySelectorAll('.xdsu-bar-seg').length,
      btns: document.querySelectorAll('.xdsu-upload-btn').length, bars: document.querySelectorAll('.xdsu-bar').length}));
    // A toast (the Like toggle shows one), twice: creates the toast element, then rewrites its text.
    const t = await page.evaluate(async () => {
      const n0 = window.__scans;
      window.__menus['Like = re-check']();
      await new Promise((res) => setTimeout(res, 400));
      const n1 = window.__scans;
      window.__menus['Like = re-check']();
      await new Promise((res) => setTimeout(res, 4500));
      return {first: n1 - n0, second: window.__scans - n1,
        toast: !!document.querySelector('.xdsu-toast')};
    });
    // Re-render: a bar and a button removed; the poll (fired by hand) restores them. The restoring
    // insertions must not cause another scan.
    const rr = await page.evaluate(async () => {
      document.querySelector('#t9001 .xdsu-bar').remove();
      document.querySelector('#t9002 .xdsu-upload-btn').remove();
      await new Promise((res) => setTimeout(res, 300));
      const n0 = window.__scans;
      window.__poll();
      await new Promise((res) => setTimeout(res, 500));
      return {scans: window.__scans - n0, bars: document.querySelectorAll('.xdsu-bar').length,
        btns: document.querySelectorAll('.xdsu-upload-btn').length};
    });
    // A foreign node.
    const f = await page.evaluate(async () => {
      const n0 = window.__scans;
      document.getElementById('root').appendChild(document.createElement('span'));
      await new Promise((res) => setTimeout(res, 400));
      const n1 = window.__scans;
      document.querySelector('#t9002 .media').appendChild(document.createElement('div'));
      await new Promise((res) => setTimeout(res, 400));
      return {span: n1 - n0, div: window.__scans - n1};
    });
    const pass = a.scans === 1 && a.segs === 3 && a.btns === 3 && t.first === 0 && t.second === 0 && t.toast
      && f.span === 0 && f.div === 1 && rr.scans === 1;
    await r.ctx.close();
    return {pass, detail: `initial: scans=${a.scans} (bars=${a.bars} segs=${a.segs} btns=${a.btns}) | toast: +${t.first} then +${t.second}`
      + ` | poll restoring bar+button: scans=${rr.scans} (bars=${rr.bars} btns=${rr.btns}) | foreign span outside tweets: +${f.span}, foreign div in article: +${f.div}`
      + (r.errors.length ? ' errors=' + JSON.stringify(r.errors) : '')};
  },

  // T26: bar removed from a done article -> restored and coloured within one poll.
  async f26_bar_restored(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate(() => {
      window.__db = [{id: 21, source: 'https://twitter.com/u/status/9101/photo/1'},
        {id: 22, source: 'https://twitter.com/u/status/9101/photo/2'}];
      window.addN('9101', 2, 'BARA');
    });
    await inject(page, v);
    await sleep(1500);
    const before = await page.evaluate(() => window.artState('9101'));
    const reqs0 = await page.evaluate(() => window.__lookups.length);
    await page.evaluate(() => document.querySelector('#t9101 .xdsu-bar').remove());
    await sleep(2300);
    const after = await page.evaluate(() => window.artState('9101'));
    const reqs1 = await page.evaluate(() => window.__lookups.length);
    const pass = before.done === '9101' && after.bar && after.barNext === 'like'
      && JSON.stringify(after.segs) === JSON.stringify(before.segs) && after.segs.every((g) => g.state === 'found')
      && reqs1 === reqs0;
    await r.ctx.close();
    return {pass, detail: `before: ${ST(before)} | 2.3 s after bar removed: ${ST(after)} | new lookups=${reqs1 - reqs0}`
      + (r.errors.length ? ' errors=' + JSON.stringify(r.errors) : '')};
  },

  // T26: button removed from a tile of a done article -> restored, with the segment's state.
  async f26_btn_restored(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate(() => {
      window.__db = [{id: 31, source: 'https://twitter.com/u/status/9201/photo/1'}];
      window.addN('9201', 2, 'BTNA');
    });
    await inject(page, v);
    await sleep(1500);
    const before = await page.evaluate(() => window.artState('9201'));
    await page.evaluate(() => document.querySelectorAll('#t9201 .xdsu-upload-btn').forEach((b) => b.remove()));
    await sleep(2300);
    const after = await page.evaluate(() => window.artState('9201'));
    const pass = before.done === '9201' && JSON.stringify(after.btns) === JSON.stringify(before.btns)
      && after.btns[0].cls.includes('xdsu-found') && JSON.stringify(after.segs) === JSON.stringify(before.segs);
    await r.ctx.close();
    return {pass, detail: `before: ${ST(before)} | 2.3 s after both buttons removed: ${ST(after)}`
      + ` btn0=${JSON.stringify(after.btns[0] && {aria: after.btns[0].aria, cls: after.btns[0].cls})}`
      + (r.errors.length ? ' errors=' + JSON.stringify(r.errors) : '')};
  },

  // T26: bar placed before the first role=group (no Like yet); the Like group appears later.
  async f26_like_group_late(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate(() => {
      window.__db = [{id: 41, source: 'https://twitter.com/u/status/9301'}];
      window.addCustom('9301', [{hash: 'LATE1', link: 'photo/1'}], '<div role="group" data-g="stats">stats</div>');
    });
    await inject(page, v);
    await sleep(1500);
    const before = await page.evaluate(() => window.artState('9301'));
    await page.evaluate(() => document.querySelector('#t9301 .groups').insertAdjacentHTML('beforeend', window.LIKE_GROUP));
    await sleep(2300);
    const after = await page.evaluate(() => window.artState('9301'));
    // A later re-render that puts something between the bar and the Like group.
    await page.evaluate(() => {
      const g = document.querySelector('#t9301 [data-g="like"]');
      const x = document.createElement('div');
      x.dataset.g = 'inserted';
      g.parentNode.insertBefore(x, g);
    });
    await sleep(2300);
    const after2 = await page.evaluate(() => window.artState('9301'));
    const pass = before.barNext === 'stats' && after.barNext === 'like' && after2.barNext === 'like'
      && after.segs[0].state === 'found' && after2.segs.length === 1;
    await r.ctx.close();
    return {pass, detail: `before: ${ST(before)} | Like group added: ${ST(after)} | node inserted before Like group: ${ST(after2)}`
      + (r.errors.length ? ' errors=' + JSON.stringify(r.errors) : '')};
  },

  // T26: a tile added to an article after it was marked done gets a segment and a button, and the
  // segments are judged with the new count.
  async f26_tile_added(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate(() => {
      window.__db = [{id: 51, source: 'https://twitter.com/u/status/9401'}];
      window.addN('9401', 1, 'ADDA');
    });
    await inject(page, v);
    await sleep(1500);
    const before = await page.evaluate(() => window.artState('9401'));
    const reqs0 = await page.evaluate(() => window.__lookups.slice());
    await page.evaluate(() => {
      document.querySelector('#t9401 .media').insertAdjacentHTML('beforeend',
          window.tileHtml('9401', {hash: 'ADDA2', link: 'photo/2'}));
    });
    await sleep(2300);
    const after = await page.evaluate(() => window.artState('9401'));
    const reqs1 = await page.evaluate(() => window.__lookups.slice());
    const pass = before.done === '9401' && before.segs.length === 1 && before.segs[0].state === 'found'
      && after.segs.length === 2 && after.btns.every((b) => b && b.n === 1)
      && after.segs.every((g) => g.state === 'foundWeak' && g.aria === '1 of 2 images posted')
      && after.done === '9401';
    await r.ctx.close();
    return {pass, detail: `before: ${ST(before)} | 2.3 s after tile 2 added: ${ST(after)} done=${after.done}`
      + ` | lookups before=${reqs0.length} after=${reqs1.length}`
      + (r.errors.length ? ' errors=' + JSON.stringify(r.errors) : '')};
  },

  // Desktop task T7. The poll is stopped, so only the observer can start a scan. Changes outside
  // every tweet (nodes coming and going in a side column, typing in a reply box) and text rewritten
  // inside a tweet (a like count) start none. A tweet added in two steps (an empty cell, then the
  // article in it), a re-render inside a tweet and a photo viewer opening each start one at once,
  // so the bar, its restoration and the viewer button do not wait for the poll.
  async f27_observer_filter(browser, v) {
    const r = await setup(browser, {noPoll: true});
    const {page} = r;
    const until = (fn, ms) => page.waitForFunction(fn, null, {timeout: ms, polling: 20}).then(() => true, () => false);
    await page.evaluate(() => {
      window.__db = [{id: 61, source: 'https://twitter.com/u/status/9601/photo/1'}];
      window.addN('9601', 1, 'OBSA');
      document.querySelector('#t9601 .groups').insertAdjacentHTML('beforeend', '<span class="count">0</span>');
      const side = document.createElement('aside');
      side.innerHTML = '<div class="trends"></div><div class="reply" contenteditable="true"><div></div></div>';
      document.body.appendChild(side);
      // 30 changes a second for ms, of one kind; resolves with the scans they started (after 300 ms
      // more, for a scan already scheduled).
      window.churn = (kind, ms) => new Promise((done) => {
        const n0 = window.__scans;
        let i = 0;
        const iv = setInterval(() => {
          i++;
          if (kind === 'side') {
            const box = document.querySelector('aside .trends');
            box.appendChild(document.createElement('div')).textContent = 'trend ' + i;
            if (box.children.length > 10) {
              box.firstElementChild.remove();
            }
          } else if (kind === 'typing') {
            const line = document.querySelector('aside .reply > div');
            const s = document.createElement('span');
            s.textContent = 'abcdefghij'[i % 10];
            line.appendChild(s);
          } else {
            document.querySelector('#t9601 .count').textContent = String(i);
          }
        }, 33);
        setTimeout(() => {
          clearInterval(iv);
          setTimeout(() => done(window.__scans - n0), 300);
        }, ms);
      });
    });
    await inject(page, v);
    // The first scan comes from the observer's start-up call; without a poll, nothing else rescans.
    const ready = await until(() => !!document.querySelector('#t9601 .xdsu-bar-seg[data-state="found"]'), 3000);
    const quiet = {};
    for (const kind of ['side', 'typing', 'count']) {
      quiet[kind] = await page.evaluate((kind) => window.churn(kind, 1500), kind);
    }
    // A new tweet: an empty cell first (nothing to scan), then the article in it.
    const cellScans = await page.evaluate(async () => {
      const n0 = window.__scans;
      const cell = document.createElement('div');
      cell.id = 'cell9602';
      document.getElementById('root').appendChild(cell);
      await new Promise((res) => setTimeout(res, 300));
      return window.__scans - n0;
    });
    const t0 = Date.now();
    await page.evaluate(() => {
      const a = document.createElement('article');
      a.setAttribute('data-testid', 'tweet');
      a.setAttribute('tabindex', '0');
      a.id = 't9602';
      a.innerHTML = '<a href="/u/status/9602"><time datetime="2026-01-01">1h</time></a>'
        + `<div class="media">${window.tileHtml('9602', {hash: 'OBSB1', link: 'photo/1'})}</div>`
        + `<div class="groups">${window.LIKE_GROUP}</div>`;
      document.getElementById('cell9602').appendChild(a);
    });
    const newBar = await until(() => !!document.querySelector('#t9602 .xdsu-bar-seg'), 3000);
    const msNew = Date.now() - t0;
    // A re-render: the bar is gone and an element is added in the tweet.
    const t1 = Date.now();
    await page.evaluate(() => {
      document.querySelector('#t9601 .xdsu-bar').remove();
      document.querySelector('#t9601 .groups').appendChild(document.createElement('div'));
    });
    const restored = await until(() => !!document.querySelector('#t9601 .xdsu-bar-seg[data-state="found"]'), 3000);
    const msRestored = Date.now() - t1;
    // The viewer: the URL changes and a layer with the media image is added outside the tweets.
    const t2 = Date.now();
    await page.evaluate(() => {
      history.pushState({}, '', '/u/status/9601/photo/1');
      const layer = document.createElement('div');
      layer.setAttribute('role', 'dialog');
      layer.innerHTML = '<img src="https://pbs.twimg.com/media/OBSA1?format=jpg&name=large">';
      document.body.appendChild(layer);
    });
    const pill = await until(() => !!document.querySelector('.xdsu-pill'), 3000);
    const msPill = Date.now() - t2;
    const quietOk = Object.values(quiet).every((n) => n === 0) && cellScans === 0;
    const fastOk = newBar && msNew < 1000 && restored && msRestored < 1000 && pill && msPill < 1000;
    await r.ctx.close();
    return {pass: ready && quietOk && fastOk,
      detail: `ready=${ready} | scans during 1.5 s of 30 changes/s: side column ${quiet.side}, reply box ${quiet.typing},`
        + ` like count text ${quiet.count}; empty cell added ${cellScans}${quietOk ? '' : ' <-- want 0 each'}`
        + ` | without a poll: new tweet's bar ${newBar ? 'after ' + msNew + ' ms' : 'NOT within 3 s'},`
        + ` re-rendered bar back ${restored ? 'after ' + msRestored + ' ms' : 'NOT within 3 s'},`
        + ` viewer button ${pill ? 'after ' + msPill + ' ms' : 'NOT within 3 s'}${fastOk ? '' : ' <-- want each within 1 s'}`
        + (r.errors.length ? ' errors=' + JSON.stringify(r.errors) : '')};
  },

  // an article recycled to a tweet without photos keeps no bar.
  async f26_recycled_no_photos(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate(() => {
      window.__db = [{id: 77, source: 'https://twitter.com/u/status/9501'}];
      window.addN('9501', 1, 'RECA');
    });
    await inject(page, v);
    await sleep(1500);
    const before = await page.evaluate(() => window.artState('9501'));
    await page.evaluate(() => {
      const a = document.getElementById('t9501');
      a.querySelector('time').closest('a').setAttribute('href', '/u/status/9502');
      a.querySelectorAll('[data-testid="tweetPhoto"]').forEach((p) => p.closest('a').remove());
      a.appendChild(document.createElement('span'));
    });
    await sleep(2500);
    const after = await page.evaluate(() => {
      const a = document.getElementById('t9501');
      return {bars: a.querySelectorAll('.xdsu-bar').length, btns: a.querySelectorAll('.xdsu-upload-btn').length,
        tweetId: a.dataset.xdsuTweetId, done: a.dataset.xdsuDone || null};
    });
    const pass = before.bar && after.bars === 0 && after.btns === 0 && after.tweetId === '9502';
    await r.ctx.close();
    return {pass, detail: `before: ${ST(before)} | recycled to 9502 without photos: ${JSON.stringify(after)}`};
  },

  // T25 probe: is resolveState's "tweet lookup failed but the hash lookup found a post" reachable?
  // Two tweets share a media hash; the first has no post by tweet id, so its hash is looked up
  // and found; the second tweet's own lookup fails.
  async probe_err_hash_found(browser, v) {
    const r = await setup(browser);
    const {page} = r;
    await page.evaluate(() => {
      window.__db = [{id: 88, source: 'https://pbs.twimg.com/media/SHARED1?format=jpg&name=orig'}];
      window.addCustom('9601', [{hash: 'SHARED1', link: 'photo/1'}]);
    });
    await inject(page, v);
    await sleep(1500);
    const first = await page.evaluate(() => window.artState('9601'));
    await page.evaluate(() => {
      window.__fail = (u) => u.includes('status/9602');
      window.addCustom('9602', [{hash: 'SHARED1', link: 'photo/1'}]);
    });
    await sleep(3500);
    const second = await page.evaluate(() => window.artState('9602'));
    const reqs = await page.evaluate(() => window.__lookups.map((u) => u.split('tags=')[1]));
    await r.ctx.close();
    // Reports what happens; "pass" means the branch was taken (segment found despite the error).
    return {pass: second.segs[0] && second.segs[0].state === 'found',
      detail: `9601 (empty by id, hash found): ${ST(first)} | 9602 (same hash, own lookup fails): ${ST(second)} | lookups=${JSON.stringify(reqs)}`};
  },
};

module.exports = {setup};

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  for (const v of variants) {
    console.log(`\n===== ${v} =====`);
    for (const [name, fn] of Object.entries(S)) {
      if (only && !only.includes(name)) {
        continue;
      }
      const t0 = Date.now();
      try {
        const r = await withTimeout(fn(browser, v), 60000);
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name} (${Math.round((Date.now() - t0) / 1000)} s)\n      ${r.detail}`);
      } catch (e) {
        console.log(`HARNESS-ERROR ${name}: ${e.stack}`);
      }
    }
  }
  await browser.close();
})();
