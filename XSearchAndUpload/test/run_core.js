// Core state scenarios: happy path, remount, refresh races, tweet identification.
// node run_core.js [variant[,variant...]] [scenario[,scenario...]]
const {chromium, newPage, inject, state, colors, sleep} = require('./h.js');

const variants = (process.argv[2] || 'current').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;

const flat = (c) => c.flat();
const allIn = (c, set) => flat(c).length > 0 && flat(c).every((x) => set.includes(x));
const RESOLVED = ['RED', 'GREEN', 'LGREEN'];

async function finish(page, errors, pass, extra = '') {
  const st = await state(page);
  const reqs = await page.evaluate(() => window.__reqs);
  const unh = await page.evaluate(() => window.__unhandled);
  const errs = errors.filter((e) => !e.includes('Failed to load resource'));
  await page.context().close();
  return {pass, detail: `${st}${extra ? ' | ' + extra : ''} | reqs(${reqs.length})=${JSON.stringify(reqs)}`
    + (unh.length ? ` | unhandled=${JSON.stringify(unh)}` : '') + (errs.length ? ` | errors=${JSON.stringify(errs)}` : ''),
  errs, unh};
}

const S = {
  // ---------- happy path ----------
  async happy(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = (u) => {
        if (u.includes('status/111')) {
          return {body: JSON.stringify([{id: 9, source: 'https://x.com/u/status/111'}])};
        }
        if (u.includes('media/HHH3')) {
          return {body: JSON.stringify([{id: 33, source: 'https://pbs.twimg.com/media/HHH3.jpg'}])};
        }
        return {body: '[]'};
      };
      window.add({id: '111', hashes: ['HHH1']}); // found via tweet URL
      window.add({id: '112', hashes: ['HHH2']}); // missing
      window.add({id: '113', hashes: ['HHH3']}); // hash-only hit
    });
    await inject(page, v);
    await sleep(2500);
    const c = await colors(page);
    const pass = c[0][0] === 'GREEN' && c[1][0] === 'RED' && c[2][0] === 'GREEN';
    return finish(page, errors, pass);
  },

  // ---------- S2 / T02 ----------
  // (a) article removed while its request is in flight, re-inserted 3 s later as a NEW element.
  async s2_remount(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 700});
      window.add({id: '401', hashes: ['FFF1']});
    });
    await inject(page, v);
    await sleep(500);
    await page.evaluate(() => {
      document.getElementById('t401').remove();
      document.getElementById('root').appendChild(document.createElement('div'));
    });
    await sleep(3000);
    await page.evaluate(() => window.add({id: '401', hashes: ['FFF1']}));
    await sleep(6000);
    const c = await colors(page);
    return finish(page, errors, c[0][0] === 'RED');
  },
  // same, but the image IS on Danbooru under its media hash -> must end GREEN, not red.
  async s2_remount_hashhit(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = (u) => (u.includes('media/FFF1')
        ? {body: JSON.stringify([{id: 7, source: 'https://pbs.twimg.com/media/FFF1.png'}]), delay: 100}
        : {body: '[]', delay: 700});
      window.add({id: '401', hashes: ['FFF1']});
    });
    await inject(page, v);
    await sleep(500);
    await page.evaluate(() => {
      document.getElementById('t401').remove();
      document.getElementById('root').appendChild(document.createElement('div'));
    });
    await sleep(3000);
    await page.evaluate(() => window.add({id: '401', hashes: ['FFF1']}));
    await sleep(6000);
    const c = await colors(page);
    return finish(page, errors, c[0][0] === 'GREEN');
  },
  // same as s2_remount, but the SAME article element is re-attached (not a fresh one).
  async s2_remount_same_el(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 700});
      window.add({id: '401', hashes: ['FFF1']});
    });
    await inject(page, v);
    await sleep(500);
    await page.evaluate(() => {
      window.__kept = document.getElementById('t401');
      window.__kept.remove();
      document.getElementById('root').appendChild(document.createElement('div'));
    });
    await sleep(3000);
    await page.evaluate(() => document.getElementById('root').appendChild(window.__kept));
    await sleep(6000);
    const c = await colors(page);
    return finish(page, errors, c[0][0] === 'RED');
  },
  // (b) second image src arrives 1.5 s late in a zero-post tweet.
  async s2_late_src(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 50});
      const a = window.mkTweet({id: '411', hashes: ['GGG1', 'GGG2']});
      const img2 = a.querySelectorAll('[data-testid="tweetPhoto"] > img')[1];
      window.__late = img2.getAttribute('src');
      img2.removeAttribute('src');
      document.getElementById('root').appendChild(a);
    });
    await inject(page, v);
    await sleep(1500);
    await page.evaluate(() => {
      document.querySelectorAll('#t411 [data-testid="tweetPhoto"] > img')[1].setAttribute('src', window.__late);
    });
    await sleep(6000);
    const c = await colors(page);
    return finish(page, errors, c[0].join() === 'RED,RED');
  },

  // ---------- S3 / T03 ----------
  async s3_like_inflight(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 600});
      ['301', '302', '303'].forEach((id, i) => window.add({id, hashes: ['DDD' + i]}));
      setTimeout(() => document.querySelector('#t301 [data-testid="like"]').click(), 600);
    });
    await inject(page, v);
    await sleep(8000);
    const c = await colors(page);
    const r = await finish(page, errors, false);
    r.pass = allIn(c, RESOLVED) && !r.errs.length && !r.unh.length;
    return r;
  },
  async s3_like_hash_inflight(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = (u) => (u.includes('media/') ? {body: '[]', delay: 800} : {body: '[]', delay: 50});
      ['311', '312', '313'].forEach((id, i) => window.add({id, hashes: ['EEE' + i]}));
      setTimeout(() => document.querySelector('#t311 [data-testid="like"]').click(), 700);
    });
    await inject(page, v);
    await sleep(8000);
    const c = await colors(page);
    const r = await finish(page, errors, false);
    r.pass = allIn(c, RESOLVED) && !r.errs.length && !r.unh.length;
    return r;
  },
  // like, then un-like 1.6 s later (second criterion of T03); a new tweet shares the re-query batch.
  async s3_like_unlike(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 600});
      window.add({id: '351', hashes: ['SS1']});
      setTimeout(() => document.querySelector('#t351 [data-testid="like"]').click(), 3500);
      setTimeout(() => window.add({id: '352', hashes: ['SS2']}), 4400);
      setTimeout(() => document.querySelector('#t351 [data-testid="like"]').click(), 5100);
    });
    await inject(page, v);
    await sleep(12500);
    const c = await colors(page);
    const r = await finish(page, errors, false);
    r.pass = allIn(c, RESOLVED) && !r.errs.length && !r.unh.length;
    return r;
  },
  // like on a tweet that is still QUEUED; its batch starts and finishes inside the 1 s re-enqueue delay.
  async s3_like_queued_fast(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 300});
      for (let i = 0; i < 6; i++) {
        window.add({id: String(1600 + i), hashes: ['R' + i]});
      }
      // scan@100, flush@350: batch1 [1600-1602] 350..650, batch2 [1603-1605] 650..950.
      setTimeout(() => document.querySelector('#t1604 [data-testid="like"]').click(), 450);
    });
    await inject(page, v);
    await sleep(8000);
    const c = await colors(page);
    const r = await finish(page, errors, false);
    r.pass = allIn(c, RESOLVED) && !r.errs.length && !r.unh.length;
    return r;
  },
  // like on a queued tweet; the 1 s re-enqueue fires BEFORE its batch starts (id would be queued twice).
  async s3_like_queued_slow(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 1500});
      for (let i = 0; i < 6; i++) {
        window.add({id: String(1600 + i), hashes: ['R' + i]});
      }
      setTimeout(() => document.querySelector('#t1604 [data-testid="like"]').click(), 500);
    });
    await inject(page, v);
    await sleep(11000);
    const c = await colors(page);
    const r = await finish(page, errors, false);
    const reqs = await Promise.resolve(r.detail);
    r.pass = allIn(c, RESOLVED) && !r.errs.length && !r.unh.length;
    r.dup = (reqs.match(/status\/1604/g) || []).length;
    r.detail += ` | requests naming 1604: ${r.dup}`;
    return r;
  },
  // like on a tweet whose HASH is still queued; the hash batch starts and finishes inside the 1 s delay.
  async s3_like_hash_queued_fast(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = (u) => (u.includes('media/') ? {body: '[]', delay: 300} : {body: '[]', delay: 20});
      for (let i = 0; i < 6; i++) {
        window.add({id: String(1700 + i), hashes: ['Q' + i]});
      }
      // tweets done by ~420; hash batch1 [Q0-Q2] ~420..720, hash batch2 [Q3-Q5] ~720..1020.
      setTimeout(() => document.querySelector('#t1704 [data-testid="like"]').click(), 520);
    });
    await inject(page, v);
    await sleep(8000);
    const c = await colors(page);
    const r = await finish(page, errors, false);
    r.pass = allIn(c, RESOLVED) && !r.errs.length && !r.unh.length;
    return r;
  },
  async s3_like_text_only(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.add({id: '801', hashes: []});
      setTimeout(() => document.querySelector('#t801 [data-testid="like"]').click(), 800);
    });
    await inject(page, v);
    await sleep(3300);
    const n = await page.evaluate(() => window.__reqs.length);
    return finish(page, errors, n === 0);
  },

  // ---------- S4 / T04 ----------
  async s4_no_time(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.add({id: '222', hashes: ['CCC1'], time: false});
    });
    await inject(page, v);
    await sleep(1000);
    const a = await page.evaluate(() => window.__btnAdds);
    await sleep(5000);
    const b = await page.evaluate(() => window.__btnAdds);
    // real presses on the button
    const box = await page.locator('.xdsu-upload-btn').first().boundingBox();
    for (let i = 0; i < 10; i++) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await sleep(120);
      await page.mouse.up();
      await sleep(1500); // bundle B: T19 1.5 s lock between opens (was 137)
    }
    const opened = await page.evaluate(() => window.__opened);
    const href = await page.evaluate(() => document.querySelector('.xdsu-upload-btn').href);
    return finish(page, errors, b - a === 0 && opened.length === 10,
        `btn insertions in 5s=${b - a}, 10 presses -> ${opened.length} opens, href=${decodeURIComponent(href)}`);
  },
  // quote card <time> (not in an anchor) comes first, the tweet's own <a><time> later.
  async s4_quote_time_first(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.add({id: '250', hashes: ['QT1'], time: false,
        after: '<div role="link" tabindex="0"><span>quoted</span><time datetime="2026-01-01">2h</time>'
          + '<div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/QQQ9?format=jpg&name=small"></div></div>'
          + '<div><a href="/u/status/250"><time datetime="2026-01-02">3h</time></a></div>'});
    });
    await inject(page, v);
    await sleep(1000);
    const a = await page.evaluate(() => window.__btnAdds);
    await sleep(5000);
    const b = await page.evaluate(() => window.__btnAdds);
    const s = await page.evaluate(() => window.snap());
    return finish(page, errors, b - a === 0 && s[0].tweetId === '250', `btn insertions in 5s=${b - a} tweetId=${s[0].tweetId}`);
  },
  // quote card first AND the tweet has no <time> of its own; quote card contains a status link to another tweet.
  async s4_quote_link_inside_card(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.add({id: '260', hashes: ['QT2'], time: false,
        before: '<div role="link" tabindex="0"><a href="/other/status/999"><time datetime="2026-01-01">2h</time></a></div>'});
    });
    await inject(page, v);
    await sleep(1000);
    const a = await page.evaluate(() => window.__btnAdds);
    await sleep(3000);
    const b = await page.evaluate(() => window.__btnAdds);
    const s = await page.evaluate(() => window.snap());
    return finish(page, errors, b - a === 0 && s[0].tweetId === '260', `btn insertions in 3s=${b - a} tweetId=${s[0].tweetId}`);
  },
  // genuine recycle: same article element becomes another tweet -> one clean-up, then stable.
  async s4_recycle(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = (u) => (u.includes('status/901')
        ? {body: JSON.stringify([{id: 77, source: 'https://x.com/u/status/901'}])} : {body: '[]'});
      window.add({id: '901', hashes: ['JJJ1']});
    });
    await inject(page, v);
    await sleep(1500);
    const before = await state(page);
    const a = await page.evaluate(() => window.__btnAdds);
    await page.evaluate(() => {
      const art = document.getElementById('t901');
      art.querySelector('time').closest('a').setAttribute('href', '/u/status/902');
      const pl = art.querySelector('[data-testid="tweetPhoto"]').closest('a');
      pl.setAttribute('href', '/u/status/902/photo/1');
      pl.querySelector('img').setAttribute('src', 'https://pbs.twimg.com/media/JJJ2?format=jpg&name=small');
      art.appendChild(document.createElement('span'));
    });
    await sleep(4000);
    const b = await page.evaluate(() => window.__btnAdds);
    const s = await page.evaluate(() => window.snap());
    const c = await colors(page);
    return finish(page, errors, b - a === 1 && s[0].tweetId === '902' && c[0][0] === 'RED' && s[0].btns === 1,
        `before=${before} btn insertions after recycle=${b - a} tweetId=${s[0].tweetId} href=${decodeURIComponent(s[0].href)}`);
  },
  // detail page: focal article (tabindex=-1) without any status link -> pathname fallback;
  // a second, unidentifiable article (ad) must NOT inherit the page's tweet id.
  async s4_detail_page(browser, v) {
    const {page, errors} = await newPage(browser, {urlPath: '/alice/status/3003'});
    await page.evaluate(() => {
      window.add({id: 'focal', hashes: ['FOC1'], time: false, tabindex: '-1', photoLinks: false});
      window.add({id: 'ad', hashes: ['ADV1'], time: false, tabindex: '0', photoLinks: false});
    });
    await inject(page, v);
    await sleep(1000);
    const a = await page.evaluate(() => window.__btnAdds);
    await sleep(3000);
    const b = await page.evaluate(() => window.__btnAdds);
    const s = await page.evaluate(() => window.snap());
    return finish(page, errors, b - a === 0 && s[0].tweetId === '3003' && s[1].tweetId === undefined && s[1].btns === 0,
        `btn insertions in 3s=${b - a} focal.tweetId=${s[0].tweetId} focal.href=${decodeURIComponent(s[0].href || '')}`
        + ` ad.tweetId=${s[1].tweetId} ad.btns=${s[1].btns}`);
  },
  // normal tweet: URL stored without suffix; absolute href variant.
  async s4_abs_href(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      const a = window.mkTweet({id: '555', hashes: ['ABS1']});
      a.querySelectorAll('a').forEach((x) => x.setAttribute('href', 'https://x.com' + x.getAttribute('href')));
      document.getElementById('root').appendChild(a);
    });
    await inject(page, v);
    await sleep(2500);
    const s = await page.evaluate(() => window.snap());
    const c = await colors(page);
    return finish(page, errors, s[0].tweetId === '555' && c[0][0] === 'RED', `tweetId=${s[0].tweetId} btns=${s[0].btns}`);
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
