// Before/after identity: the same fixed page on each variant; records every lookup sent, every
// tab opened, toasts, and the final DOM state of every segment and button.
// node compare.js base,current  -> writes out/identity_<variant>.json and diffs them.
const {chromium, inject, sleep} = require('./h.js');
const fs = require('fs');
const path = require('path');
const F = require('./run_markers.js');

const variants = (process.argv[2] || 'base,current').split(',');

async function run(browser, v) {
  const r = await F.setup(browser, {profile: {id: 1, name: 't', level: 20, tag_query_limit: 2, enable_safe_mode: false}});
  const {page} = r;
  await page.addStyleTag({content: '[data-testid="tweetPhoto"] { height: 60px !important; }'});
  await page.evaluate(() => {
    const S = (id, p) => `https://twitter.com/u/status/${id}` + (p ? `/photo/${p}` : '');
    window.__db = [
      {id: 101, source: S(9701, 1)},
      {id: 102, source: S(9702)},
      {id: 104, source: S(9704)},
      {id: 106, source: 'https://pbs.twimg.com/media/IDH6x1?format=jpg&name=orig'},
      {id: 171, source: S(9707)}, {id: 172, source: S(9707)}, {id: 173, source: S(9707)}, {id: 174, source: S(9707)},
      {id: 181, source: S(9708, 1), is_deleted: true}, {id: 182, source: S(9708, 2), is_banned: true},
      {id: 191, source: S(9709, 2)},
    ];
    window.__fail = (u) => u.includes('status/9705');
    window.__toasts = [];
    setInterval(() => {
      const t = document.querySelector('.xdsu-toast.xdsu-show');
      if (t && window.__toasts[window.__toasts.length - 1] !== t.textContent) {
        window.__toasts.push(t.textContent);
      }
    }, 20);
    window.addN('9701', 1, 'IDH1x');
    window.addN('9702', 3, 'IDH2x');
    window.addN('9703', 2, 'IDH3x');
    window.addCustom('9704', [{hash: 'IDV4', link: 'video/1', video: true}]);
    window.addN('9705', 1, 'IDH5x');
    window.addN('9706', 1, 'IDH6x');
    window.addN('9707', 4, 'IDH7x');
    window.addN('9708', 2, 'IDH8x');
    window.addN('9709', 2, 'IDH9x');
  });
  await inject(page, v);
  await sleep(5000);
  const snap = async () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('article')]
      .map((a) => [a.id, window.artState(a.id.slice(1))])));
  const out = {stage1: await snap()};
  // Interactions: tap a missing segment (re-check), Like on a found tweet, tap an upload button,
  // tap a found segment, tap the failed segment.
  await page.evaluate(() => {
    window.__db.push({id: 131, source: 'https://twitter.com/u/status/9703/photo/2'});
    document.querySelector('#t9703 .xdsu-bar-seg').click();
  });
  await sleep(1500);
  await page.evaluate(() => {
    window.__db.push({id: 201, source: 'https://twitter.com/u/status/9702/photo/3'});
    document.querySelector('#t9702 [data-testid="like"]').click();
  });
  await sleep(1500);
  await page.evaluate(() => {
    document.querySelector('#t9709 .xdsu-upload-btn').click();
    document.querySelector('#t9701 .xdsu-bar-seg').click();
    window.__fail = null;
    document.querySelector('#t9705 .xdsu-bar-seg').click();
  });
  await sleep(3000);
  out.stage2 = await snap();
  out.lookups = await page.evaluate(() => window.__lookups.map((u) => u.replace(/^.*tags=/, '')));
  out.opened = await page.evaluate(() => window.__opened);
  out.toasts = await page.evaluate(() => window.__toasts);
  out.store = await page.evaluate(() => Object.keys(window.__store).sort());
  out.errors = r.errors;
  await r.ctx.close();
  return out;
}

(async () => {
  const browser = await chromium.launch();
  const res = {};
  for (const v of variants) {
    res[v] = await run(browser, v);
    fs.writeFileSync(path.join(__dirname, 'out', `identity_${v}.json`), JSON.stringify(res[v], null, 1));
  }
  await browser.close();
  const [a, b] = variants;
  const ja = JSON.stringify(res[a], null, 1).split('\n');
  const jb = JSON.stringify(res[b], null, 1).split('\n');
  const diffs = ja.map((l, i) => (l === jb[i] ? null : `${i}: ${l}  |  ${jb[i]}`)).filter(Boolean);
  console.log(`lines ${ja.length} vs ${jb.length}; differing lines: ${diffs.length}`);
  diffs.slice(0, 40).forEach((d) => console.log(d));
  console.log(`lookups (${res[a].lookups.length}): ${JSON.stringify(res[a].lookups)}`);
  console.log(`opened: ${JSON.stringify(res[a].opened)}`);
  console.log(`toasts: ${JSON.stringify(res[a].toasts)}`);
  for (const st of ['stage1', 'stage2']) {
    console.log(st + ': ' + Object.entries(res[a][st]).map(([k, s]) => `${k}: ${s.segs.map((g) => g.state).join(',')}`
      + ` btn=${s.btns.map((x) => (x ? (x.cls.includes('found') ? 'F' : '-') : 'none')).join('')}`).join(' | '));
  }
  console.log('errors: ' + JSON.stringify([res[a].errors, res[b].errors]));
})();
