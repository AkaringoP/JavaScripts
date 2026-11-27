// Icon fallback, video/GIF tiles, the Danbooru URL setting, failed hash lookups.
// node run_fixes.js [variant,..] [scenario,..]
const {chromium, newPage, inject, state, colors, sleep, withTimeout} = require('./h.js');
const variants = (process.argv[2] || 'current').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;

async function fin(page, errors, pass, extra = '') {
  const st = await state(page);
  const reqs = await page.evaluate(() => window.__reqs);
  const urls = await page.evaluate(() => (window.__urls || []).map((u) => u.split('?')[0]));
  const unh = await page.evaluate(() => window.__unhandled);
  const errs = errors.filter((e) => !e.includes('Failed to load resource'));
  await page.context().close();
  return {pass: pass && !errs.length && !unh.length,
    detail: `${st}${extra ? ' | ' + extra : ''} | reqs(${reqs.length})=${JSON.stringify(reqs)}`
      + (urls.length ? ` | endpoints=${JSON.stringify([...new Set(urls)])}` : '')
      + (unh.length ? ` | unhandled=${JSON.stringify(unh)}` : '') + (errs.length ? ` | errors=${JSON.stringify(errs)}` : '')};
}

// Records full request URLs in window.__urls.
async function recordUrls(page) {
  await page.evaluate(() => {
    window.__urls = [];
    const orig = window.GM_xmlhttpRequest;
    window.GM_xmlhttpRequest = (d) => {
      window.__urls.push(d.url);
      orig(d);
    };
  });
}

const btnBox = (page) => page.evaluate(() => {
  const b = document.querySelector('.xdsu-upload-btn');
  if (!b) {
    return null;
  }
  const r = b.getBoundingClientRect();
  const img = b.querySelector('img');
  return {w: r.width, h: r.height, text: b.textContent, hasImg: !!img,
    imgW: img ? img.getBoundingClientRect().width : null, natural: img ? img.naturalWidth : null};
});

const VIDEO_POSTER = 'https://pbs.twimg.com/ext_tw_video_thumb/1999/pu/img/AbCdEf.jpg';

const S = {
  // ---------- S1 / T01 ----------
  async s1_icon_normal(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => window.add({id: '1', hashes: ['A1']}));
    await inject(page, v);
    await sleep(1200);
    const b = await btnBox(page);
    return fin(page, errors, !!b && b.w === 32 && b.h === 32 && b.natural === 128 && b.imgW === 20, JSON.stringify(b));
  },
  // orig: GM_getResourceURL gives nothing (the 404 resource). new: error event on the icon.
  async s1_icon_failure(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.GM_getResourceURL = () => undefined;
      window.add({id: '1', hashes: ['A1']});
    });
    await inject(page, v);
    await sleep(1200);
    await page.evaluate(() => {
      const img = document.querySelector('.xdsu-upload-btn img');
      if (img) {
        img.dispatchEvent(new Event('error'));
      }
    });
    await sleep(100);
    const b = await btnBox(page);
    return fin(page, errors, !!b && b.w === 32 && b.h === 32 && b.text === '↑', JSON.stringify(b));
  },

  // ---------- S5 / T05 ----------
  async s5_video_only(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate((poster) => {
      const a = window.mkTweet({id: '700', hashes: ['X']});
      a.querySelector('[data-testid="tweetPhoto"] img').setAttribute('src', poster);
      document.getElementById('root').appendChild(a);
    }, VIDEO_POSTER);
    await inject(page, v);
    await sleep(2500);
    const s = await page.evaluate(() => window.snap());
    const reqs = await page.evaluate(() => window.__reqs);
    const c = await colors(page);
    const pass = c[0].join() === 'RED' && s[0].done === '700' && reqs.some((r) => r.includes('status/700'))
      && !reqs.some((r) => r.includes('null'));
    return fin(page, errors, pass, `done=${s[0].done}`);
  },
  // video tile rendered as <video poster> inside a videoPlayer, no <img>; tweet has a post -> light green + search link.
  async s5_video_player_found(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate((poster) => {
      window.__responder = (u) => (u.includes('status/701')
        ? {body: JSON.stringify([{id: 61, source: 'https://x.com/u/status/701'}])} : {body: '[]'});
      const a = window.mkTweet({id: '701', hashes: ['X']});
      a.querySelector('[data-testid="tweetPhoto"]').innerHTML
        = `<div data-testid="videoPlayer"><video poster="${poster}"></video></div>`;
      document.getElementById('root').appendChild(a);
    }, VIDEO_POSTER);
    await inject(page, v);
    await sleep(2500);
    const s = await page.evaluate(() => window.snap());
    const c = await colors(page);
    return fin(page, errors, c[0].join() === 'GREEN' && s[0].done === '701' && s[0].segs[0].url === 'https://danbooru.donmai.us/posts/61', `done=${s[0].done}`);
  },
  // photo + video in one tweet, nothing on Danbooru -> both segments resolve; one hash lookup for the photo only.
  async s5_mixed(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate((poster) => {
      const a = window.mkTweet({id: '702', hashes: ['MIX1', 'X']});
      a.querySelectorAll('[data-testid="tweetPhoto"] img')[1].setAttribute('src', poster);
      document.getElementById('root').appendChild(a);
    }, VIDEO_POSTER);
    await inject(page, v);
    await sleep(2500);
    const s = await page.evaluate(() => window.snap());
    const reqs = await page.evaluate(() => window.__reqs);
    const c = await colors(page);
    const pass = c[0].join() === 'RED,RED' && s[0].done === '702' && reqs.some((r) => r.includes('status/702'))
      && !reqs.some((r) => r.includes('null'));
    return fin(page, errors, pass, `done=${s[0].done}`);
  },
  // photo + video, the photo is on Danbooru by media hash only -> photo GREEN, video RED.
  async s5_mixed_hashhit(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate((poster) => {
      window.__responder = (u) => (u.includes('media/MIX2')
        ? {body: JSON.stringify([{id: 62, source: 'https://pbs.twimg.com/media/MIX2.jpg'}])} : {body: '[]'});
      const a = window.mkTweet({id: '703', hashes: ['MIX2', 'X']});
      a.querySelectorAll('[data-testid="tweetPhoto"] img')[1].setAttribute('src', poster);
      document.getElementById('root').appendChild(a);
    }, VIDEO_POSTER);
    await inject(page, v);
    await sleep(2500);
    const s = await page.evaluate(() => window.snap());
    const c = await colors(page);
    return fin(page, errors, c[0].join() === 'GREEN,RED' && s[0].done === '703', `done=${s[0].done}`);
  },
  // like on a video-only tweet -> re-query, no null hash lookup, no errors.
  async s5_video_like(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate((poster) => {
      const a = window.mkTweet({id: '704', hashes: ['X']});
      a.querySelector('[data-testid="tweetPhoto"] img').setAttribute('src', poster);
      document.getElementById('root').appendChild(a);
      setTimeout(() => document.querySelector('#t704 [data-testid="like"]').click(), 1500);
    }, VIDEO_POSTER);
    await inject(page, v);
    await sleep(4500);
    const reqs = await page.evaluate(() => window.__reqs);
    const c = await colors(page);
    const n = reqs.filter((r) => r.includes('status/704')).length;
    return fin(page, errors, c[0].join() === 'RED' && n === 2 && !reqs.some((r) => r.includes('null')),
        `tweet requests=${n}`);
  },

  // ---------- S6 / T06 ----------
  ...Object.fromEntries([
    ['s6_no_scheme', 'danbooru.donmai.us', 'https://danbooru.donmai.us/'],
    ['s6_garbage_asdf', 'asdf', 'https://danbooru.donmai.us/'],
    ['s6_garbage_empty', '', 'https://danbooru.donmai.us/'],
    ['s6_garbage_space', 'foo bar', 'https://danbooru.donmai.us/'],
    ['s6_garbage_number', 42, 'https://danbooru.donmai.us/'],
    ['s6_custom_valid', 'https://testbooru.donmai.us/', 'https://testbooru.donmai.us/'],
  ].map(([name, stored, base]) => [name, async (browser, v) => {
    const {page, errors} = await newPage(browser, {store: {booru: stored}});
    await recordUrls(page);
    await page.evaluate(() => {
      window.add({id: '601', hashes: ['S61', 'S62']});
      window.add({id: '602', hashes: ['S63']});
    });
    await inject(page, v);
    await sleep(2000);
    const s = await page.evaluate(() => window.snap());
    const urls = await page.evaluate(() => window.__urls);
    const btns = s.reduce((n, a) => n + a.btns, 0);
    const hrefOk = s.every((a) => (a.href || '').startsWith(base + 'uploads/new?url='));
    const c = await colors(page);
    const pass = btns === 3 && hrefOk && urls.length > 0 && urls.some((u) => u.startsWith(base + 'posts.json'))
      // bundle C: the account check goes to the same base
      && urls.every((u) => u.startsWith(base + 'posts.json') || u === base + 'profile.json')
      && c.flat().every((x) => x === 'RED');
    return fin(page, errors, pass, `stored=${JSON.stringify(stored)} buttons=${btns} href=${s[0].href || ''}`);
  }])),
  // non-integer stored batch size -> falls back to 3 (orig would loop forever on 'abc'; run on new file only).
  async s6_batch_garbage(browser, v) {
    const {page, errors} = await newPage(browser, {store: {queryBatch: 'abc'}});
    await page.evaluate(() => {
      for (let i = 0; i < 4; i++) {
        window.add({id: String(620 + i), hashes: ['B' + i]});
      }
    });
    await inject(page, v);
    await sleep(2500);
    const reqs = await page.evaluate(() => window.__reqs);
    const c = await colors(page);
    return fin(page, errors, c.flat().every((x) => x === 'RED') && reqs[0].split(' ').length === 4, '');
  },
  // menu handler: invalid input keeps the old value with an alert, valid input is stored normalized.
  async s6_menu(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__menus = {};
      window.GM_registerMenuCommand = (name, fn) => {
        window.__menus[name] = fn;
      };
      // the label became "Danbooru URL (<host>)".
      window.__domainMenu = () => window.__menus[Object.keys(window.__menus)
          .find((n) => n === "Set Danbooru domain" || n.startsWith("Danbooru URL ("))];
    });
    await inject(page, v);
    await sleep(300);
    const r = await page.evaluate(() => {
      const out = {};
      window.__alerts = [];
      window.alert = (m) => window.__alerts.push(m);
      window.__prompts = [];
      window.prompt = (label, cur) => {
        window.__prompts.push(label);
        return window.__answer;
      };
      const fn = window.__domainMenu();
      for (const ans of ['foo bar', '', null]) {
        window.__answer = ans;
        fn();
      }
      out.alerts = window.__alerts;
      out.label = window.__prompts[0];
      out.booru = window.__store.booru;
      return out;
    });
    // valid answer: GM_setValue then location.reload(); read the stored value through a console message.
    const stored = new Promise((res) => page.on('console', (m) => {
      if (m.text().startsWith('SET booru=')) {
        res(m.text());
      }
    }));
    await page.evaluate(() => {
      window.GM_setValue = (k, val) => console.log(`SET ${k}=${val}`);
      window.__answer = ' safebooru.donmai.us/ ';
      window.__domainMenu()();
    });
    const setMsg = await Promise.race([stored, sleep(2000).then(() => 'none')]);
    const pass = r.alerts.length === 2 && r.booru === undefined && setMsg === 'SET booru=https://safebooru.donmai.us';
    // the page reloaded, so report without the DOM snapshot.
    await page.context().close();
    const errs = errors.filter((e) => !e.includes('Failed to load resource'));
    return {pass: pass && !errs.length,
      detail: `label=${JSON.stringify(r.label)} alerts=${r.alerts.length} kept=${r.booru} valid->${setMsg}`
        + (errs.length ? ` | errors=${JSON.stringify(errs)}` : '')};
  },

  // ---------- S7 / T07 ----------
  async s7_hash_500(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = (u) => (u.includes('media/') ? {status: 500, body: 'oops'} : {body: '[]'});
      window.add({id: '770', hashes: ['H500']});
    });
    await inject(page, v);
    await sleep(13000);
    const c = await colors(page);
    return fin(page, errors, c[0].join() === 'BLUE');
  },

  // ---------- T04 detail: /i/web/status links keep i/web in the URL ----------
  async t04_iweb_link(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      const a = window.mkTweet({id: '880', hashes: ['IW1']});
      a.querySelectorAll('a').forEach((x) => x.setAttribute('href', x.getAttribute('href').replace('/u/', '/i/web/')));
      document.getElementById('root').appendChild(a);
    });
    await inject(page, v);
    await sleep(1500);
    const s = await page.evaluate(() => window.snap());
    const href = decodeURIComponent(s[0].href || '');
    return fin(page, errors, s[0].tweetId === '880' && href.endsWith('url=https://x.com/i/web/status/880'), `href=${href}`);
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
      if (v === 'orig' && name === 's6_batch_garbage') {
        console.log(`SKIP  ${name} (original hangs: splice(0, NaN) loops forever)`);
        continue;
      }
      try {
        const r = await withTimeout(fn(browser, v), 30000);
        console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name}\n      ${r.detail}`);
      } catch (e) {
        console.log(`HARNESS-ERROR ${name}: ${e.message.split('\n')[0]}`);
      }
    }
  }
  await browser.close();
})();
