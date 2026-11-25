// scanTweets cost on a page with 25 media articles (x.com-like nesting), steady state (every
// article done). node perf.js base,current [rounds]
const {chromium} = require('playwright');
const fs = require('fs');
const path = require('path');
const {readScript} = require('./script.js');

const variants = (process.argv[2] || 'base,current').split(',');
const ROUNDS = parseInt(process.argv[3] || '3', 10);
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

function filler(n, depth) {
  let s = '';
  for (let i = 0; i < n; i++) {
    s += '<div class="css-175oi2r r-1iusvr4 r-16y2uox">' + (depth ? filler(2, depth - 1) : '<span>x</span>') + '</div>';
  }
  return s;
}

function tweet(i) {
  const id = String(880000 + i);
  const n = [1, 2, 4, 1, 3][i % 5];
  const video = i % 7 === 3;
  const media = video
    ? '<div data-testid="tweetPhoto" style="width:300px;height:200px"><div data-testid="videoPlayer"><video></video>'
      + `<img src="https://pbs.twimg.com/ext_tw_video_thumb/${id}/pu/img/v.jpg"></div></div>`
    : Array.from({length: n}, (_, k) => `<a href="/u/status/${id}/photo/${k + 1}" role="link"><div class="r-1p0dtai">`
      + `<div data-testid="tweetPhoto" style="width:140px;height:140px"><div class="bg"></div>`
      + `<img src="https://pbs.twimg.com/media/P${id}x${k}?format=jpg&name=small"></div></div></a>`).join('');
  const quote = i % 6 === 0 ? `<div role="link" tabindex="0"><time>q</time><div data-testid="tweetPhoto"><img src="https://pbs.twimg.com/media/Q${id}?format=jpg"></div></div>` : '';
  return `<div data-testid="cellInnerDiv"><article data-testid="tweet" tabindex="0">`
    + `<div data-testid="User-Name">${filler(3, 3)}<a href="/u/status/${id}"><time datetime="2026-01-01">1h</time></a></div>`
    + `<div data-testid="tweetText">${filler(6, 4)}</div><div class="media">${media}</div>${quote}`
    + `<div>${filler(2, 2)}<div role="group">`
    + ['reply', 'retweet', 'like', 'bookmark'].map((t) => `<div><button data-testid="${t}">${filler(1, 3)}</button></div>`).join('')
    + `</div></div></article></div>`;
}

async function measure(browser, v) {
  let src = readScript(v);
  // In memory only: expose scanTweets for timing.
  src = src.replace(/\}\)\(\);\s*$/, 'window.__x = {scanTweets, imageRefs};\n})();');
  const ctx = await browser.newContext({viewport: {width: 600, height: 900}});
  const page = await ctx.newPage();
  const cells = Array.from({length: 25}, (_, i) => tweet(i)).join('');
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (route.request().resourceType() === 'document') {
      return route.fulfill({status: 200, contentType: 'text/html',
        body: `<!doctype html><html><body><div id="chrome">${filler(40, 4)}</div><main id="tl">${cells}</main></body></html>`});
    }
    if (u.includes('twimg.com')) {
      return route.fulfill({status: 200, contentType: 'image/png', body: PNG});
    }
    return route.fulfill({status: 404, body: ''});
  });
  await page.goto('https://x.com/home');
  await page.evaluate(() => {
    window.GM_getValue = (k, d) => d;
    window.GM_setValue = () => {};
    window.GM_registerMenuCommand = () => {};
    window.GM_addStyle = (css) => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    };
    window.GM_openInTab = () => {};
    window.GM_xmlhttpRequest = (o) => setTimeout(() => o.onload({status: 200,
      responseText: o.url.includes('profile.json') ? '{"id":1,"tag_query_limit":null}' : '[]'}), 20);
  });
  await page.addScriptTag({content: src});
  // Scroll through so every lookup runs, then back.
  for (let y = 0; y < 30; y++) {
    await page.evaluate((y) => window.scrollTo(0, y * 600), y);
    await page.waitForTimeout(150);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2500);
  const info = await page.evaluate(() => ({
    elements: document.querySelectorAll('*').length,
    articles: document.querySelectorAll('article').length,
    done: document.querySelectorAll('article[data-xdsu-done]').length,
    segs: document.querySelectorAll('.xdsu-bar-seg').length,
    refs: window.__x.imageRefs.length,
  }));
  const cdp = await ctx.newCDPSession(page);
  const res = {};
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', {rate});
    const times = await page.evaluate(() => {
      const t = [];
      for (let i = 0; i < 300; i++) {
        const t0 = performance.now();
        window.__x.scanTweets();
        t.push(performance.now() - t0);
      }
      return t;
    });
    times.sort((a, b) => a - b);
    res['x' + rate] = {median: +times[150].toFixed(3), p95: +times[284].toFixed(3), mean: +(times.reduce((a, b) => a + b, 0) / 300).toFixed(3)};
  }
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});
  await ctx.close();
  return {info, ...res};
}

(async () => {
  const browser = await chromium.launch();
  for (let r = 0; r < ROUNDS; r++) {
    for (const v of variants) {
      console.log(`round ${r + 1} ${v}: ${JSON.stringify(await measure(browser, v))}`);
    }
  }
  await browser.close();
})();
