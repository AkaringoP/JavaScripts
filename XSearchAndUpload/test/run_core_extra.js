// More interleavings of the core scenarios. node run_core_extra.js [variant,..] [scenario,..]
const {chromium, newPage, inject, state, colors, sleep} = require('./h.js');
const variants = (process.argv[2] || 'current').split(',');
const only = process.argv[3] ? process.argv[3].split(',') : null;

async function fin(page, errors, pass, extra = '') {
  const st = await state(page);
  const reqs = await page.evaluate(() => window.__reqs);
  const unh = await page.evaluate(() => window.__unhandled);
  const errs = errors.filter((e) => !e.includes('Failed to load resource'));
  await page.context().close();
  return {pass: pass && !errs.length && !unh.length, detail: `${st}${extra ? ' | ' + extra : ''} | reqs(${reqs.length})=${JSON.stringify(reqs)}`
    + (unh.length ? ` | unhandled=${JSON.stringify(unh)}` : '') + (errs.length ? ` | errors=${JSON.stringify(errs)}` : '')};
}

const S = {
  // zero-post tweet re-mounts while ANOTHER batch is in flight (flushRunning === true).
  async x1_remount_during_flush(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 700});
      window.add({id: '401', hashes: ['FFF1']});
      setTimeout(() => {
        document.getElementById('t401').remove();
        document.getElementById('root').appendChild(document.createElement('div'));
      }, 500);
      setTimeout(() => window.add({id: '402', hashes: ['FFF2']}), 2500); // flush ~2850, in flight until ~3550
      setTimeout(() => window.add({id: '401', hashes: ['FFF1']}), 3000);
    });
    await inject(page, v);
    await sleep(8000);
    const c = await colors(page);
    return fin(page, errors, c.flat().join() === 'RED,RED');
  },
  // no overlapping requests ever (single-flush invariant), measured over a busy mix.
  async x2_no_overlap(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__inflight = 0;
      window.__maxInflight = 0;
      const orig = window.GM_xmlhttpRequest;
      window.GM_xmlhttpRequest = (d) => {
        window.__inflight++;
        window.__maxInflight = Math.max(window.__maxInflight, window.__inflight);
        const ol = d.onload;
        d.onload = (r) => {
          window.__inflight--;
          ol(r);
        };
        orig(d);
      };
      window.__responder = () => ({body: '[]', delay: 200});
      for (let i = 0; i < 8; i++) {
        window.add({id: String(5000 + i), hashes: ['Z' + i]});
      }
      [400, 700, 900, 1300, 2100, 2600].forEach((t, i) => setTimeout(() => {
        document.querySelector(`#t${5000 + i} [data-testid="like"]`).click();
        window.add({id: String(6000 + i), hashes: ['Y' + i]});
      }, t));
      setTimeout(() => {
        document.getElementById('t5007').remove();
      }, 600);
      setTimeout(() => window.add({id: '5007', hashes: ['Z7']}), 1500);
    });
    await inject(page, v);
    await sleep(9000);
    const c = await colors(page);
    const max = await page.evaluate(() => window.__maxInflight);
    const ok = c.flat().every((x) => ['RED', 'GREEN', 'LGREEN'].includes(x));
    return fin(page, errors, ok && max === 1, `max concurrent requests=${max}`);
  },
  // T04 step 2: article recycled into content with NO status link at all (e.g. an ad).
  async x3_recycle_to_unidentified(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.add({id: '901', hashes: ['JJJ1']});
    });
    await inject(page, v);
    await sleep(1500);
    await page.evaluate(() => {
      const art = document.getElementById('t901');
      art.querySelector('time').closest('a').remove();
      const pl = art.querySelector('[data-testid="tweetPhoto"]').closest('a');
      pl.removeAttribute('href');
      pl.querySelector('img').setAttribute('src', 'https://pbs.twimg.com/media/ADVERT?format=jpg&name=small');
      art.appendChild(document.createElement('span'));
    });
    await sleep(1000);
    const a = await page.evaluate(() => window.__btnAdds);
    await sleep(3000);
    const b = await page.evaluate(() => window.__btnAdds);
    const s = await page.evaluate(() => window.snap());
    const stale = s[0].btns > 0 && /status\/901/.test(decodeURIComponent(s[0].href || ''));
    return fin(page, errors, !stale && b - a === 0,
        `btn insertions in 3s=${b - a} tweetId=${s[0].tweetId} btns=${s[0].btns} href=${decodeURIComponent(s[0].href || '')}`);
  },
  // recycle into a photo-less tweet: old bar must not survive (this is T26, not T04).
  async x4_recycle_photoless(browser, v) {
    const {page, errors} = await newPage(browser);
    await page.evaluate(() => {
      window.__responder = () => ({body: JSON.stringify([{id: 77, source: 'https://x.com/u/status/901'}])});
      window.add({id: '901', hashes: ['JJJ1']});
    });
    await inject(page, v);
    await sleep(1500);
    await page.evaluate(() => {
      const art = document.getElementById('t901');
      art.querySelector('time').closest('a').setAttribute('href', '/u/status/902');
      art.querySelectorAll('[data-testid="tweetPhoto"]').forEach((p) => p.closest('a').remove());
      art.appendChild(document.createElement('span'));
    });
    await sleep(3000);
    const bar = await page.evaluate(() => {
      const b = document.querySelector('.xdsu-bar');
      return b ? b.dataset.tweetId : null;
    });
    return fin(page, errors, bar === null, `stale bar data-tweet-id=${bar}`);
  },
  // like on an article the scanner has not seen yet (same tick as mount).
  async x5_like_before_scan(browser, v) {
    const {page, errors} = await newPage(browser);
    await inject(page, v);
    await sleep(600);
    await page.evaluate(() => {
      window.__responder = () => ({body: '[]', delay: 100});
      window.add({id: '777', hashes: ['LK1']});
      document.querySelector('#t777 [data-testid="like"]').click();
    });
    await sleep(4000);
    const c = await colors(page);
    return fin(page, errors, c.flat().join() === 'RED');
  },
};

(async () => {
  const browser = await chromium.launch();
  for (const v of variants) {
    console.log(`\n===== ${v} =====`);
    for (const [name, fn] of Object.entries(S)) {
      if (only && !only.includes(name)) continue;
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
