// Whole-body DOM after load + a re-check round, no viewer open: two versions that should behave
// the same must give identical output. node compare_dom.js base,current
const {chromium, inject, sleep} = require('./h.js');
const F = require('./run_markers.js');
(async () => {
  const browser = await chromium.launch();
  const out = {};
  const [A, B] = (process.argv[2] || 'base,current').split(',');
  for (const v of [A, B]) {
    const r = await F.setup(browser);
    await r.page.evaluate(() => {
      window.__db = [{id: 1, source: 'https://twitter.com/u/status/9901/photo/1'}];
      window.__fail = (u) => u.includes('status/9903');
      window.addN('9901', 2, 'DOMA');
      window.addN('9902', 1, 'DOMB');
      window.addN('9903', 1, 'DOMC');
      window.__iv = 0;
      const si = window.setInterval;
      window.setInterval = (...a) => { window.__iv++; return si(...a); };
    });
    await inject(r.page, v);
    await sleep(4000);
    await r.page.evaluate(() => {
      history.pushState({}, '', '/u/status/9901');
      document.querySelector('#t9902 .xdsu-bar-seg').click();
      document.querySelector('#t9901 .xdsu-upload-btn').click();
    });
    await sleep(3000);
    out[v] = await r.page.evaluate(() => ({body: document.body.outerHTML, iv: window.__iv,
      lookups: window.__lookups, opened: window.__opened}));
    out[v].errors = r.errors;
    await r.ctx.close();
  }
  await browser.close();
  for (const k of ['body', 'iv', 'lookups', 'opened', 'errors']) {
    const same = JSON.stringify(out[A][k]) === JSON.stringify(out[B][k]);
    console.log(`${k}: ${same ? 'identical' : 'DIFFERENT'} (${JSON.stringify(out[A][k]).length} chars)`);
  }
  console.log('setInterval calls:', out[A].iv, out[B].iv);
})();
