// scanTweets cost on a page with 25 media articles (x.com-like nesting), steady state (every
// article done). node perf.js base,current [rounds] [--viewport=WxH] [--churn]
//   --viewport=WxH  window size (default 600x900)
//   --churn         instead: how often tick() runs and how many ms it and the MutationObserver
//                   callback take while the page changes outside every article. 10 s each of
//                   idle (no change, for reference), a node added and one removed about 30 times a
//                   second in a plain container, and the same inside a contenteditable (a reply
//                   box being typed in); at CPU throttle 1 and 4.
// The script is instrumented in memory only.
const {chromium} = require('playwright');
const fs = require('fs');
const path = require('path');
const {readScript} = require('./script.js');

const args = process.argv.slice(2);
const flags = args.filter((a) => a.startsWith('--'));
const pos = args.filter((a) => !a.startsWith('--'));
const variants = (pos[0] || 'base,current').split(',');
const ROUNDS = parseInt(pos[1] || '3', 10);
const vpFlag = flags.find((f) => f.startsWith('--viewport='));
const VIEWPORT = vpFlag ? (() => {
  const m = /^--viewport=(\d+)x(\d+)$/.exec(vpFlag);
  if (!m) {
    throw new Error('expected --viewport=WIDTHxHEIGHT, got ' + vpFlag);
  }
  return {width: +m[1], height: +m[2]};
})() : {width: 600, height: 900};
const CHURN = flags.includes('--churn');
const unknown = flags.filter((f) => f !== '--churn' && !f.startsWith('--viewport='));
if (unknown.length) {
  throw new Error('unknown option ' + unknown.join(' '));
}
const CHURN_MS = 10000;
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

// The page in steady state (every lookup done). With churn, tick() and the observer callback are
// timed into window.__tk and window.__mo.
async function load(browser, v, churn) {
  let src = readScript(v);
  // In memory only: expose scanTweets for timing.
  src = src.replace(/\}\)\(\);\s*$/, 'window.__x = {scanTweets, imageRefs};\n})();');
  if (churn) {
    // In memory only: tick() becomes a timed wrapper around the original body.
    const anchor = '  function tick() {';
    if (src.split(anchor).length !== 2) {
      throw new Error('tick() declaration not found once');
    }
    src = src.replace(anchor, '  function tick() {\n    const t0 = performance.now();\n    try {\n      return tickBody();\n'
      + '    } finally {\n      window.__tk.n++;\n      window.__tk.ms += performance.now() - t0;\n    }\n  }\n  function tickBody() {');
  }
  const ctx = await browser.newContext({viewport: VIEWPORT});
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
  await page.evaluate((churn) => {
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
    if (churn) {
      window.__tk = {n: 0, ms: 0};
      window.__mo = {n: 0, ms: 0};
      // The script creates the page's only MutationObserver; its callback is timed.
      const MO = window.MutationObserver;
      window.MutationObserver = class extends MO {
        constructor(cb) {
          super((muts, obs) => {
            const t0 = performance.now();
            try {
              cb(muts, obs);
            } finally {
              window.__mo.n++;
              window.__mo.ms += performance.now() - t0;
            }
          });
        }
      };
    }
  }, churn);
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
  return {ctx, page, info};
}

async function measure(browser, v) {
  const {ctx, page, info} = await load(browser, v, false);
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

// One CHURN_MS run of a churn mode: 'idle', 'plain' or 'editable'.
function churnRun([mode, ms]) {
  return new Promise((done) => {
    let host = null;
    if (mode === 'plain') {
      host = document.createElement('div');
      host.id = 'churn';
      document.getElementById('chrome').appendChild(host);
    } else if (mode === 'editable') {
      host = document.createElement('div');
      host.id = 'churn';
      host.setAttribute('contenteditable', 'true');
      host.setAttribute('role', 'textbox');
      host.innerHTML = '<div data-block="true"></div>';
      document.body.appendChild(host);
    }
    // The host's own insertion settles before the counters start.
    setTimeout(() => {
      const line = host && (host.firstElementChild || host);
      let adds = 0;
      window.__tk.n = 0;
      window.__tk.ms = 0;
      window.__mo.n = 0;
      window.__mo.ms = 0;
      const t0 = performance.now();
      const iv = !host ? null : setInterval(() => {
        const n = document.createElement('span');
        if (mode === 'editable') {
          n.dataset.text = 'true';
          n.textContent = 'abcdefghij'[adds % 10];
        } else {
          n.className = 'css-1jxf684';
          n.textContent = String(adds);
        }
        line.appendChild(n);
        adds++;
        if (line.childNodes.length > 20) {
          line.firstChild.remove();
        }
      }, 33);
      setTimeout(() => {
        clearInterval(iv);
        const out = {secs: +((performance.now() - t0) / 1000).toFixed(1), adds,
          ticks: window.__tk.n, tickMs: +window.__tk.ms.toFixed(2),
          observerCalls: window.__mo.n, observerMs: +window.__mo.ms.toFixed(2)};
        if (host) {
          host.remove();
        }
        setTimeout(() => done(out), 500);
      }, ms);
    }, 500);
  });
}

async function measureChurn(browser, v) {
  const {ctx, page, info} = await load(browser, v, true);
  const cdp = await ctx.newCDPSession(page);
  const res = {};
  for (const rate of [1, 4]) {
    await cdp.send('Emulation.setCPUThrottlingRate', {rate});
    res['x' + rate] = {};
    for (const mode of ['idle', 'plain', 'editable']) {
      res['x' + rate][mode] = await page.evaluate(churnRun, [mode, CHURN_MS]);
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', {rate: 1});
  await ctx.close();
  return {info, ...res};
}

(async () => {
  const browser = await chromium.launch();
  const vp = vpFlag ? ` @${VIEWPORT.width}x${VIEWPORT.height}` : '';
  for (let r = 0; r < ROUNDS; r++) {
    for (const v of variants) {
      if (CHURN) {
        console.log(`round ${r + 1} ${v} churn${vp}: ${JSON.stringify(await measureChurn(browser, v))}`);
      } else {
        console.log(`round ${r + 1} ${v}${vp}: ${JSON.stringify(await measure(browser, v))}`);
      }
    }
  }
  await browser.close();
})();
