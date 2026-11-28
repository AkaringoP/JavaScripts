// Re-check after an upload, the Like trigger, the upload button, per-image upload URLs.
// node run_upload.js [variant,..] [scenario,..]
const {chromium, newPage, inject, colors, sleep, withTimeout} = require('./h.js');
const variants = (process.argv[2] || 'current').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;

const FOUND = ['GREEN', 'LGREEN'];

async function setup(browser, opts = {}) {
  const r = await newPage(browser, opts);
  r.popups = [];
  r.ctx.on('page', (p) => r.popups.push(p.url()));
  await r.page.evaluate(() => {
    const m = document.createElement('meta');
    m.name = 'viewport';
    m.content = 'width=device-width, initial-scale=1';
    document.head.appendChild(m);
    window.__clicks = [];
    // Clicks that reach x.com's own elements (photo link, article) in the bubble phase.
    document.addEventListener('click', (e) => {
      const photo = e.target.closest && e.target.closest('a[href*="/photo/"]');
      if (photo) {
        window.__clicks.push('photo');
      }
    });
    window.__watchArticleClicks = () => document.querySelectorAll('article').forEach((a) => {
      a.addEventListener('click', () => window.__clicks.push('article:' + a.id));
    });
    window.setVis = (hidden) => {
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => hidden});
      Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => (hidden ? 'hidden' : 'visible')});
      window.__hiddenNow = hidden;
      document.dispatchEvent(new Event('visibilitychange'));
    };
    // Tag every request with the visibility at send time.
    const orig = window.GM_xmlhttpRequest;
    window.__reqLog = [];
    window.GM_xmlhttpRequest = (d) => {
      window.__reqLog.push({hidden: !!window.__hiddenNow, url: decodeURIComponent(d.url)});
      return orig(d);
    };
    window.countReq = (needle) => window.__reqLog.filter((r) => r.url.includes(needle)).length;
    // Colour sampler: records colour sequence of the segments of one article every 10 ms.
    window.sample = (artId) => {
      const names = {'rgb(154, 154, 154)': 'GREY', 'rgb(26, 140, 26)': 'GREEN', 'rgb(126, 201, 126)': 'LGREEN',
        'rgb(229, 57, 53)': 'RED', 'rgb(61, 78, 232)': 'BLUE'};
      const out = {seq: [], pulse: false, t0: performance.now(), firstFound: null};
      out.iv = setInterval(() => {
        const segs = [...document.querySelectorAll(`#${artId} .xdsu-bar-seg`)];
        const c = segs.map((s) => names[window.segColor(s)] || window.segColor(s)).join(',');
        if (segs.some((s) => s.classList.contains('xdsu-rechecking'))) {
          out.pulse = true;
        }
        if (out.firstFound === null && /GREEN/.test(c)) {
          out.firstFound = Math.round(performance.now() - out.t0);
        }
        if (out.seq[out.seq.length - 1] !== c) {
          out.seq.push(c);
        }
      }, 10);
      return out;
    };
  });
  return r;
}

async function fin(r, pass, extra = '', ignoreErr = null) {
  const {page, errors} = r;
  const reqs = await page.evaluate(() => window.__reqs);
  const unh = await page.evaluate(() => window.__unhandled);
  const errs = errors.filter((e) => !e.includes('Failed to load resource') && !(ignoreErr && ignoreErr.test(e)));
  await page.context().close();
  return {pass: pass && !errs.length && !unh.length,
    detail: `${extra} | reqs(${reqs.length})=${JSON.stringify(reqs)}`
      + (unh.length ? ` | unhandled=${JSON.stringify(unh)}` : '') + (errs.length ? ` | errors=${JSON.stringify(errs)}` : '')};
}

// Centre of the upload button on photo n of article #t<id>.
async function btnCenter(page, id, n = 1) {
  return page.evaluate(([id, n]) => {
    const tiles = document.querySelectorAll(`#t${id} [data-testid="tweetPhoto"]`);
    const b = tiles[n - 1].querySelector('.xdsu-upload-btn');
    b.scrollIntoView({block: 'center'});
    const r = b.getBoundingClientRect();
    return {x: r.left + r.width / 2, y: r.top + r.height / 2};
  }, [id, n]);
}
async function tapBtn(page, id, n = 1) {
  const p = await btnCenter(page, id, n);
  await page.touchscreen.tap(p.x, p.y);
}
const dec = (u) => decodeURIComponent((u || '').replace(/^.*uploads\/new\?/, ''));
const tweetPost = (id, extra = '') => JSON.stringify([{id: 500, source: `https://x.com/u/status/${id}${extra}`}]);

const S = {
  // ---------- T16 ----------
  // (a) red -> upload tap -> hidden -> post created -> visible: found within 2 s.
  async t16a_return_found(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.add({id: '1201', hashes: ['U1']}));
    await inject(r.page, v);
    await sleep(1500);
    const before = (await colors(r.page))[0].join();
    await tapBtn(r.page, '1201');
    await r.page.evaluate(() => window.setVis(true));
    await sleep(1000);
    await r.page.evaluate((body) => {
      window.__responder = (u) => (u.includes('status/1201') ? {body} : {body: '[]'});
      window.__s = window.sample('t1201');
      window.setVis(false);
    }, tweetPost(1201, '/photo/1'));
    await sleep(2000);
    const s = await r.page.evaluate(() => {
      clearInterval(window.__s.iv);
      return {seq: window.__s.seq, firstFound: window.__s.firstFound};
    });
    const pass = before === 'RED' && s.firstFound !== null && s.firstFound <= 2000 && !s.seq.some((c) => c.includes('GREY'));
    return fin(r, pass, `before=${before} seq=${s.seq.join(' > ')} foundAfter=${s.firstFound}ms`);
  },
  // (b) slow network, one tweet becomes found, one stays missing: never grey, no pulse left behind.
  async t16b_no_grey(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.add({id: '1211', hashes: ['V1']});
      window.add({id: '1212', hashes: ['V2']});
    });
    await inject(r.page, v);
    await sleep(1500);
    await tapBtn(r.page, '1211');
    await tapBtn(r.page, '1212');
    await r.page.evaluate(() => window.setVis(true));
    await sleep(800);
    await r.page.evaluate((body) => {
      window.__responder = (u) => (u.includes('status/1211') ? {body, delay: 800} : {body: '[]', delay: 800});
      window.__s1 = window.sample('t1211');
      window.__s2 = window.sample('t1212');
      window.setVis(false);
    }, tweetPost(1211, '/photo/1'));
    await sleep(3500);
    const s = await r.page.evaluate(() => {
      clearInterval(window.__s1.iv);
      clearInterval(window.__s2.iv);
      return {a: window.__s1.seq, b: window.__s2.seq, pa: window.__s1.pulse, pb: window.__s2.pulse,
        left: document.querySelectorAll('.xdsu-rechecking').length, n1211: window.countReq('status/1211'),
        n1212: window.countReq('status/1212')};
    });
    const grey = [...s.a, ...s.b].some((c) => c.includes('GREY'));
    const pass = !grey && s.a[s.a.length - 1] === 'GREEN' && s.b[s.b.length - 1] === 'RED' && s.left === 0
      && s.n1211 >= 2 && s.n1212 >= 2;
    return fin(r, pass, `1211: ${s.a.join(' > ')} (pulse seen=${s.pa}) | 1212: ${s.b.join(' > ')} (pulse seen=${s.pb})`
      + ` | .xdsu-rechecking left=${s.left} | tweet requests 1211=${s.n1211} 1212=${s.n1212}`);
  },
  // (c) six 1 s looks back without a post, then 45 s hidden: nothing sent while hidden,
  // one re-check per return, total <= returns x (1 tweet + 1 hash batch).
  async t16c_request_bound(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.add({id: '1203', hashes: ['W1', 'W2']}));
    await inject(r.page, v);
    await sleep(1500);
    await tapBtn(r.page, '1203');
    const base = await r.page.evaluate(() => window.__reqLog.length);
    for (let i = 0; i < 6; i++) {
      await r.page.evaluate(() => window.setVis(true));
      await sleep(2000);
      await r.page.evaluate(() => window.setVis(false));
      await sleep(1000);
    }
    await r.page.evaluate(() => window.setVis(true));
    await sleep(45000);
    const s = await r.page.evaluate((base) => {
      const after = window.__reqLog.slice(base);
      return {total: after.length, hidden: after.filter((x) => x.hidden).length,
        tweet: after.filter((x) => x.url.includes('status/1203')).length, pulse: document.querySelectorAll('.xdsu-rechecking').length};
    }, base);
    const c = (await colors(r.page))[0].join();
    const pass = s.hidden === 0 && s.total <= 6 * 2 && s.tweet === 6 && c === 'RED,RED';
    return fin(r, pass, `after tap: total=${s.total} whileHidden=${s.hidden} tweetLookups=${s.tweet} colours=${c} pulseLeft=${s.pulse}`);
  },
  // (d) 4 images, image 1 already on Danbooru (found at registration). Upload another, return:
  // the display updates and the entry is dropped (post count rose), so the ladder stops.
  async t16d_partial(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate((body) => {
      window.__responder = (u) => (u.includes('status/1204') ? {body} : {body: '[]'});
      window.add({id: '1204', hashes: ['P1', 'P2', 'P3', 'P4']});
    }, tweetPost(1204, '/photo/1'));
    await inject(r.page, v);
    await sleep(1500);
    const before = (await colors(r.page))[0].join();
    await tapBtn(r.page, '1204', 3);
    await r.page.evaluate(() => window.setVis(true));
    await sleep(800);
    await r.page.evaluate(() => {
      window.__responder = (u) => (u.includes('status/1204') ? {body: JSON.stringify([
        {id: 500, source: 'https://x.com/u/status/1204/photo/1'}, {id: 501, source: 'https://x.com/u/status/1204/photo/3'}])}
        : {body: '[]'});
      window.setVis(false);
    });
    await sleep(2000);
    const mid = (await colors(r.page))[0].join();
    const n1 = await r.page.evaluate(() => window.countReq('status/1204'));
    await sleep(6000); // past the 5 s ladder step
    const n2 = await r.page.evaluate(() => window.countReq('status/1204'));
    const store = await r.page.evaluate(() => window.__store.watch);
    const pass = before === 'GREEN,LGREEN,LGREEN,LGREEN' && mid === 'GREEN,LGREEN,GREEN,LGREEN' && n2 === n1 && store === '[]';
    return fin(r, pass, `before=${before} after=${mid} tweetLookups@2s=${n1} @8s=${n2} stored watch=${store}`);
  },
  // Default Like trigger still re-checks a tweet with a connected ref, without going grey.
  async t16_like_default_found(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate((body) => {
      window.__responder = (u) => (u.includes('status/1221') ? {body, delay: 800} : {body: '[]', delay: 800});
      window.add({id: '1221', hashes: ['K1']});
    }, tweetPost(1221, '/photo/1'));
    await inject(r.page, v);
    await sleep(2500);
    const n0 = await r.page.evaluate(() => window.countReq('status/1221'));
    await r.page.evaluate(() => {
      window.__s = window.sample('t1221');
      document.querySelector('#t1221 [data-testid="like"]').click();
    });
    await sleep(2500);
    const s = await r.page.evaluate(() => {
      clearInterval(window.__s.iv);
      return {seq: window.__s.seq, pulse: window.__s.pulse, n: window.countReq('status/1221'),
        left: document.querySelectorAll('.xdsu-rechecking').length};
    });
    const pass = s.n === n0 + 1 && !s.seq.some((c) => c.includes('GREY')) && s.seq[s.seq.length - 1] === 'GREEN' && !s.left;
    return fin(r, pass, `requests before like=${n0} after=${s.n} seq=${s.seq.join(' > ')} pulseSeen=${s.pulse}`);
  },
  // Like on a text-only tweet, and Like while the tweet lookup / hash lookup is pending: no request.
  async t16_like_ignored(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 1000});
      window.add({id: '1231', hashes: []});
      window.add({id: '1232', hashes: ['L1']});
    });
    await inject(r.page, v);
    // flush ~350 ms; tweet lookup in flight until ~1350, hash lookup ~1350..2350.
    await sleep(700);
    await r.page.evaluate(() => {
      document.querySelector('#t1231 [data-testid="like"]').click();
      document.querySelector('#t1232 [data-testid="like"]').click();
    });
    await sleep(1100);
    const hashPending = await r.page.evaluate(() => window.countReq('media/L1'));
    await r.page.evaluate(() => document.querySelector('#t1232 [data-testid="like"]').click());
    await sleep(4000);
    const s = await r.page.evaluate(() => ({t1231: window.countReq('1231'), t1232: window.countReq('status/1232'),
      h: window.countReq('media/L1')}));
    const c = (await colors(r.page)).flat().join();
    const pass = s.t1231 === 0 && s.t1232 === 1 && s.h === 1 && hashPending === 1 && c === 'RED';
    return fin(r, pass, `text-only requests=${s.t1231} tweet lookups 1232=${s.t1232} hash lookups=${s.h}`
      + ` (hash request already sent at 2nd like: ${hashPending}) colours=${c}`);
  },
  // likeRecheck=false turns the Like trigger off.
  async t16_like_off(browser, v) {
    const r = await setup(browser, {store: {likeRecheck: false}});
    await r.page.evaluate(() => window.add({id: '1241', hashes: ['M1']}));
    await inject(r.page, v);
    await sleep(2000);
    await r.page.evaluate(() => document.querySelector('#t1241 [data-testid="like"]').click());
    await sleep(2500);
    const n = await r.page.evaluate(() => window.countReq('status/1241'));
    return fin(r, n === 1, `tweet lookups=${n}`);
  },
  // Watch list survives a reload (GM storage kept, script re-injected); entries older than 30 min are dropped.
  async t16_watch_reload(browser, v) {
    const r1 = await setup(browser);
    await r1.page.evaluate(() => window.add({id: '1205', hashes: ['N1']}));
    await inject(r1.page, v);
    await sleep(1500);
    await tapBtn(r1.page, '1205');
    await sleep(200);
    const store = await r1.page.evaluate(() => Object.assign({}, window.__store));
    await r1.page.context().close();
    let saved = [];
    try {
      saved = JSON.parse(store.watch || '[]');
    } catch {}
    saved.push(['1206', {t0: Date.now() - 31 * 60 * 1000, n0: 0}]);
    store.watch = JSON.stringify(saved);
    const r = await setup(browser, {store});
    await r.page.evaluate(() => {
      window.add({id: '1205', hashes: ['N1']});
      window.add({id: '1206', hashes: ['N2']});
    });
    await inject(r.page, v);
    await sleep(1500);
    const atLoad = await r.page.evaluate(() => window.__store.watch);
    await r.page.evaluate(() => window.setVis(true));
    await sleep(500);
    await r.page.evaluate(() => window.setVis(false));
    await sleep(1500);
    const s = await r.page.evaluate(() => ({a: window.countReq('status/1205'), b: window.countReq('status/1206')}));
    const ids = (() => {
      try {
        return JSON.parse(atLoad).map((e) => e[0]).join(',');
      } catch {
        return String(atLoad);
      }
    })();
    const pass = s.a === 2 && s.b === 1 && ids === '1205';
    return fin(r, pass, `stored before reload=${JSON.stringify(saved.map((e) => e[0]))} stored after load=${ids}`
      + ` tweet lookups 1205=${s.a} 1206(old)=${s.b}`);
  },
  // (e) T2: back in X for longer than the ladder of re-checks (0, 5, 20, 60 s) before posting.
  // The entry outlives the ladder, so the return after the post still re-checks the tweet.
  // v2.0.0 dropped the entry at the ladder's last step.
  async t16e_ladder_outlived(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.add({id: '1251', hashes: ['X1']}));
    await inject(r.page, v);
    await sleep(1500);
    const before = (await colors(r.page))[0].join();
    await tapBtn(r.page, '1251');
    await r.page.evaluate(() => window.setVis(true));
    await sleep(500);
    const n0 = await r.page.evaluate(() => window.countReq('status/1251'));
    // Back in X, still without a post. Fixed: the ladder runs in real time, its last step 60 s
    // after the return; that time passing is the point. Then 5 s more in which nothing may be sent.
    await r.page.evaluate(() => window.setVis(false));
    const ladder = await r.page.waitForFunction((n) => window.countReq('status/1251') >= n + 4, n0,
        {timeout: 70000, polling: 100}).then(() => true, () => false);
    await sleep(5000);
    const mid = await r.page.evaluate(() => ({n: window.countReq('status/1251'), watch: window.__store.watch}));
    // Off to post, the post exists, back to X.
    await r.page.evaluate((body) => {
      window.setVis(true);
      window.__responder = (u) => (u.includes('status/1251') ? {body} : {body: '[]'});
    }, tweetPost(1251, '/photo/1'));
    await sleep(500);
    await r.page.evaluate(() => {
      window.__s = window.sample('t1251');
      window.setVis(false);
    });
    await sleep(2000);
    const s = await r.page.evaluate(() => {
      clearInterval(window.__s.iv);
      return {seq: window.__s.seq, firstFound: window.__s.firstFound, n: window.countReq('status/1251')};
    });
    const pass = before === 'RED' && ladder && mid.n - n0 === 4 && (mid.watch || '').includes('"1251"')
      && s.firstFound !== null && s.firstFound <= 2000 && s.n === mid.n + 1;
    return fin(r, pass, `before=${before} ladder lookups (until 5 s after its end)=${mid.n - n0} stored watch then=${mid.watch}`
      + ` | return after the post: lookups ${mid.n}->${s.n} seq=${s.seq.join(' > ')} foundAfter=${s.firstFound}ms`);
  },
  // (f) T2: a watched tweet that never gets a post is dropped, from memory and from the store, once
  // the re-checks have queued WATCH_MAX_CHECKS (12) lookups for it; a return after that sends
  // nothing. Returns that cannot look it up (X unmounted the tweet) do not use up the 12. Date.now
  // is stepped (+2 s a return) past the 1.5 s refresh debounce instead of waiting.
  async t16f_check_cap(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      const realNow = Date.now;
      window.__dnOff = 0;
      Date.now = () => realNow() + window.__dnOff;
      // Requests in flight: a re-check of a tweet without posts is a tweet lookup, then a hash lookup.
      const orig = window.GM_xmlhttpRequest;
      window.__inflight = 0;
      window.GM_xmlhttpRequest = (d) => {
        window.__inflight++;
        const end = (fn) => (x) => {
          window.__inflight--;
          if (fn) {
            fn(x);
          }
        };
        return orig(Object.assign({}, d, {onload: end(d.onload), onerror: end(d.onerror), ontimeout: end(d.ontimeout)}));
      };
      window.settled = () => window.__inflight === 0 && !document.querySelector('.xdsu-rechecking');
      window.storedIds = () => {
        try {
          return JSON.parse(window.__store.watch).map((e) => e[0]);
        } catch {
          return null;
        }
      };
      window.add({id: '1261', hashes: ['Y1']});
    });
    await inject(r.page, v);
    await sleep(1500);
    const before = (await colors(r.page))[0].join();
    await tapBtn(r.page, '1261');
    await r.page.evaluate(() => window.setVis(true));
    const count = () => r.page.evaluate(() => window.countReq('status/1261'));
    const n0 = await count();
    // X unmounts the tweet: three returns, each with a fixed 0.5 s for a lookup that must not come.
    await r.page.evaluate(() => document.getElementById('t1261').remove());
    for (let i = 0; i < 3; i++) {
      await r.page.evaluate(() => {
        window.__dnOff += 2000;
        window.setVis(false);
      });
      await sleep(500);
      await r.page.evaluate(() => window.setVis(true));
    }
    // A fourth return mounts it again; the pass runs before the scan sees the new tweet.
    await r.page.evaluate(() => {
      window.__dnOff += 2000;
      window.setVis(false);
      window.add({id: '1261', hashes: ['Y1']});
    });
    const back = await r.page.waitForFunction(() => !!document.querySelector('#t1261 .xdsu-bar-seg'), null,
        {timeout: 3000, polling: 20}).then(() => true, () => false);
    await sleep(300);
    await r.page.evaluate(() => window.setVis(true));
    const off = (await count()) - n0;
    // Returns until the entry has left the store. Each ends long before the ladder's 5 s step; were
    // one to come, it would be a counted lookup as well.
    const per = [];
    let leftAt = null;
    for (let i = 0; i < 16 && leftAt === null; i++) {
      const b = await count();
      await r.page.evaluate(() => {
        window.__dnOff += 2000;
        window.setVis(false);
      });
      await r.page.waitForFunction((b) => window.countReq('status/1261') > b && window.settled(), b,
          {timeout: 3000, polling: 20}).catch(() => {});
      const n = (await count()) - n0;
      const stored = await r.page.evaluate(() => window.storedIds());
      per.push(n);
      if (stored && !stored.includes('1261')) {
        leftAt = n;
      }
      await r.page.evaluate(() => window.setVis(true));
    }
    // One more return. Fixed: 1.5 s for a lookup that must not come.
    const b = await count();
    await r.page.evaluate(() => {
      window.__dnOff += 2000;
      window.setVis(false);
    });
    await sleep(1500);
    const extra = (await count()) - b;
    const c = (await colors(r.page))[0].join();
    const pass = before === 'RED' && off === 0 && back && leftAt === 12 && extra === 0 && c === 'RED';
    return fin(r, pass, `before=${before} lookups during 4 returns while unmounted=${off} remounted=${back}`
      + ` | lookups after each later return=${JSON.stringify(per)} left the store at lookup ${leftAt} (want 12)`
      + ` | a return after that: lookups ${extra} colours=${c}`);
  },

  // ---------- T19 ----------
  // S14: two taps 120 ms apart -> one tab, no click reaches the photo link or the article.
  async s14_double_tap(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.add({id: '1301', hashes: ['B1']}));
    await inject(r.page, v);
    await sleep(1200);
    await r.page.evaluate(() => window.__watchArticleClicks());
    const p = await btnCenter(r.page, '1301');
    await r.page.touchscreen.tap(p.x, p.y);
    await sleep(120);
    await r.page.touchscreen.tap(p.x, p.y);
    await sleep(800);
    const s = await r.page.evaluate(() => ({gm: window.__opened.length, clicks: window.__clicks}));
    const tabs = s.gm + r.popups.length;
    return fin(r, tabs === 1 && s.clicks.length === 0, `GM_openInTab=${s.gm} newPages=${r.popups.length} clicksReachingX=${JSON.stringify(s.clicks)}`);
  },
  // Pressed feedback while the finger is down, sent mark after the tap.
  async t19_pressed(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.add({id: '1302', hashes: ['B2']}));
    await inject(r.page, v);
    await sleep(1200);
    const p = await btnCenter(r.page, '1302');
    // Headless CDP touches never get :active (no show-press gesture), so the held press is a mouse press.
    await r.page.mouse.move(p.x, p.y);
    await r.page.mouse.down();
    await sleep(150);
    const down = await r.page.evaluate(() => {
      const b = document.querySelector("#t1302 .xdsu-upload-btn");
      return {active: b.matches(":active"), transform: getComputedStyle(b).transform};
    });
    await r.page.mouse.up();
    await sleep(300);
    const after = await r.page.evaluate(() => {
      const b = document.querySelector('#t1302 .xdsu-upload-btn');
      return {sent: b.classList.contains('xdsu-sent'), opacity: getComputedStyle(b).opacity, opened: window.__opened.length};
    });
    const pass = /matrix\(0\.92/.test(down.transform) && after.sent && after.opened === 1;
    return fin(r, pass, `while down: ${JSON.stringify(down)} after: ${JSON.stringify(after)}`);
  },
  async t19_a11y(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.add({id: '1303', hashes: ['B3']}));
    await inject(r.page, v);
    await sleep(1200);
    const n = await r.page.getByRole('link', {name: 'Upload to Danbooru', exact: true}).and(r.page.locator('.xdsu-upload-btn')).count();
    const a = await r.page.evaluate(() => {
      const b = document.querySelector('.xdsu-upload-btn');
      return {title: b.title, aria: b.getAttribute('aria-label'), rel: b.rel};
    });
    return fin(r, n === 1 && a.title === 'Upload to Danbooru' && a.rel === 'noopener', `links named "Upload to Danbooru"=${n} ${JSON.stringify(a)}`);
  },
  async t19_position(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.add({id: '1304', hashes: ['B4']}));
    await inject(r.page, v);
    await sleep(1200);
    const d = await r.page.evaluate(() => {
      const t = document.querySelector('#t1304 [data-testid="tweetPhoto"]').getBoundingClientRect();
      const b = document.querySelector('#t1304 .xdsu-upload-btn').getBoundingClientRect();
      return {top: b.top - t.top, left: b.left - t.left};
    });
    return fin(r, d.top === 6 && d.left === 6, JSON.stringify(d));
  },
  // Under a coarse pointer: 40 px box (52 px tap area) on a tile >= 120 px high, 32 px (40 px) on a lower one.
  async t19_size(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      const a = window.mkTweet({id: '1305', hashes: ['B5']});
      a.querySelector('[data-testid="tweetPhoto"]').style.cssText = 'width:280px;height:200px';
      document.getElementById('root').appendChild(a);
      const b = window.mkTweet({id: '1306', hashes: ['B6']});
      b.querySelector('[data-testid="tweetPhoto"]').style.cssText = 'width:138px;height:77px';
      document.getElementById('root').appendChild(b);
    });
    await inject(r.page, v);
    await sleep(1200);
    const d = await r.page.evaluate(() => {
      const m = (id) => {
        const b = document.querySelector(`#t${id} .xdsu-upload-btn`);
        const box = b.getBoundingClientRect();
        const after = getComputedStyle(b, '::after');
        return {box: `${box.width}x${box.height}`, afterInset: after.content === 'none' ? null : after.top};
      };
      return {coarse: matchMedia('(pointer: coarse)').matches, hover: matchMedia('(hover: hover)').matches,
        big: m('1305'), small: m('1306')};
    });
    const pass = d.coarse && d.big.box === '40x40' && d.big.afterInset === '-6px' && d.small.box === '32x32'
      && d.small.afterInset === '-4px';
    return fin(r, pass, JSON.stringify(d));
  },
  async t19_found_mirror(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate((body) => {
      window.__responder = (u) => (u.includes('status/1307') ? {body} : {body: '[]'});
      window.add({id: '1307', hashes: ['B7']});
      window.add({id: '1308', hashes: ['B8']});
    }, tweetPost(1307, '/photo/1'));
    await inject(r.page, v);
    await sleep(2000);
    const d = await r.page.evaluate(() => ['1307', '1308'].map((id) => {
      const b = document.querySelector(`#t${id} .xdsu-upload-btn`);
      return {found: b.classList.contains('xdsu-found'), aria: b.getAttribute('aria-label'), shadow: getComputedStyle(b).boxShadow};
    }));
    const c = (await colors(r.page)).map((x) => x.join()).join(' ');
    const pass = c === 'GREEN RED' && d[0].found && d[0].aria === 'Already on Danbooru' && !d[1].found
      && d[1].aria === 'Upload to Danbooru';
    return fin(r, pass, `colours=${c} ${JSON.stringify(d)}`);
  },
  // GM_openInTab throws -> window.open fallback opens exactly one page.
  async t19_throw_fallback(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.GM_openInTab = () => {
        throw new Error('stub failure');
      };
      window.add({id: '1309', hashes: ['B9']});
    });
    await inject(r.page, v);
    await sleep(1200);
    await tapBtn(r.page, '1309');
    // The browser can report the fallback's page late under load: wait for the first one, bounded.
    const t0 = Date.now();
    while (!r.popups.length && Date.now() - t0 < 8000) {
      await sleep(50);
    }
    const first = r.popups.length ? `first after ${Date.now() - t0} ms` : 'none within 8 s';
    // Fixed on purpose: 1.5 s more in which a second page must not appear.
    await sleep(1500);
    return fin(r, r.popups.length === 1, `newPages=${JSON.stringify(r.popups.map(dec))} (${first})`, /open tab failed/);
  },

  // ---------- T20 ----------
  // 4-image tweet: tap the third button (touch) -> that image with the tweet ref; also png by path extension.
  async t20_per_image(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      const a = window.mkTweet({id: '1401', hashes: ['Q1', 'Q2', 'Q3', 'Q4']});
      const imgs = a.querySelectorAll('[data-testid="tweetPhoto"] img');
      imgs[3].setAttribute('src', 'https://pbs.twimg.com/media/Q4.png');
      document.getElementById('root').appendChild(a);
    });
    await inject(r.page, v);
    await sleep(1200);
    await tapBtn(r.page, '1401', 3);
    await r.page.evaluate(() => document.querySelectorAll('#t1401 .xdsu-upload-btn')[3].click());
    await sleep(300);
    const s = await r.page.evaluate(() => ({opened: window.__opened,
      hrefs: [...document.querySelectorAll('#t1401 .xdsu-upload-btn')].map((b) => b.href)}));
    const got = s.opened.map(dec);
    const want3 = 'url=https://pbs.twimg.com/media/Q3?format=jpg&name=orig&ref=https://x.com/u/status/1401';
    const want4 = 'url=https://pbs.twimg.com/media/Q4?format=png&name=orig&ref=https://x.com/u/status/1401';
    const hrefOk = s.hrefs.every((h) => dec(h) === 'url=https://x.com/u/status/1401');
    return fin(r, got[0] === want3 && got[1] === want4 && hrefOk, `opened=${JSON.stringify(got)} hrefsTweetLevel=${hrefOk}`);
  },
  // Fallbacks to the tweet URL: video tile, format=webp, unknown path extension, /i/web/status tweet.
  // Tile 1 of the first tweet is a jpg control that must be per-image.
  async t20_fallbacks(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      const a = window.mkTweet({id: '1402', hashes: ['R1', 'R2', 'R3', 'R4']});
      const imgs = a.querySelectorAll('[data-testid="tweetPhoto"] img');
      imgs[1].setAttribute('src', 'https://pbs.twimg.com/ext_tw_video_thumb/1999/pu/img/Vid.jpg');
      imgs[2].setAttribute('src', 'https://pbs.twimg.com/media/R3?format=webp&name=small');
      imgs[3].setAttribute('src', 'https://pbs.twimg.com/media/R4.heic');
      document.getElementById('root').appendChild(a);
      const b = window.mkTweet({id: '1403', hashes: ['R5']});
      b.querySelectorAll('a').forEach((x) => x.setAttribute('href', x.getAttribute('href').replace('/u/', '/i/web/')));
      document.getElementById('root').appendChild(b);
    });
    await inject(r.page, v);
    await sleep(1200);
    await r.page.evaluate(() => document.querySelectorAll('.xdsu-upload-btn').forEach((b) => b.click()));
    await sleep(300);
    const got = (await r.page.evaluate(() => window.__opened)).map(dec);
    const T = 'url=https://x.com/u/status/1402';
    const want = ['url=https://pbs.twimg.com/media/R1?format=jpg&name=orig&ref=https://x.com/u/status/1402', T, T, T,
      'url=https://x.com/i/web/status/1403'];
    return fin(r, JSON.stringify(got) === JSON.stringify(want), `opened=${JSON.stringify(got)}`);
  },
  // Image src arrives after the button was attached: the tap still uses the per-image URL.
  async t20_late_src(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      const a = window.mkTweet({id: '1404', hashes: ['S1']});
      a.querySelector('[data-testid="tweetPhoto"] img').removeAttribute('src');
      document.getElementById('root').appendChild(a);
    });
    await inject(r.page, v);
    await sleep(1000);
    const hadBtn = await r.page.evaluate(() => !!document.querySelector('#t1404 .xdsu-upload-btn'));
    await r.page.evaluate(() => document.querySelector('#t1404 [data-testid="tweetPhoto"] img')
        .setAttribute('src', 'https://pbs.twimg.com/media/S1?format=png&name=small'));
    await tapBtn(r.page, '1404');
    await sleep(300);
    const got = (await r.page.evaluate(() => window.__opened)).map(dec);
    const want = 'url=https://pbs.twimg.com/media/S1?format=png&name=orig&ref=https://x.com/u/status/1404';
    return fin(r, hadBtn && got.length === 1 && got[0] === want, `button before src=${hadBtn} opened=${JSON.stringify(got)}`);
  },

  // ---------- T23: GM_openInTab handle ----------
  async t23_onclose(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => {
      window.__handles = [];
      window.GM_openInTab = (u) => {
        window.__opened.push(u);
        const h = {closed: false, close() {}};
        window.__handles.push(h);
        return h;
      };
      window.add({id: '1501', hashes: ['T1']});
    });
    await inject(r.page, v);
    await sleep(1500);
    await tapBtn(r.page, '1501');
    await sleep(2000);
    const n0 = await r.page.evaluate(() => window.countReq('status/1501'));
    const hasOnclose = await r.page.evaluate(() => typeof window.__handles[0].onclose === 'function');
    await r.page.evaluate(() => {
      const h = window.__handles[0];
      if (h.onclose) {
        h.onclose();
        h.onclose(); // a second call must not add a request
      }
    });
    await sleep(1500);
    const n1 = await r.page.evaluate(() => window.countReq('status/1501'));
    return fin(r, hasOnclose && n1 === n0 + 1, `onclose set=${hasOnclose} tweet lookups before=${n0} after onclose=${n1}`);
  },
  // Stub returns undefined (the h.js default): one open, watch registered, no error.
  async t23_no_handle(browser, v) {
    const r = await setup(browser);
    await r.page.evaluate(() => window.add({id: '1502', hashes: ['T2']}));
    await inject(r.page, v);
    await sleep(1500);
    await tapBtn(r.page, '1502');
    await sleep(500);
    const s = await r.page.evaluate(() => ({opened: window.__opened.length, watch: window.__store.watch || null}));
    let ids = '';
    try {
      ids = JSON.parse(s.watch).map((e) => e[0]).join(',');
    } catch {}
    return fin(r, s.opened === 1 && ids === '1502' && r.popups.length === 0,
        `GM_openInTab=${s.opened} newPages=${r.popups.length} stored watch ids=${ids || s.watch}`);
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
        const r = await withTimeout(fn(browser, v), 90000);
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name}\n      ${r.detail}`);
      } catch (e) {
        console.log(`HARNESS-ERROR ${name}: ${e.message.split('\n')[0]}`);
      }
    }
  }
  await browser.close();
})();
