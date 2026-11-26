// Shared harness: Playwright Chromium with a phone viewport and touch, stub GM_* functions
// (the request stub answers with whatever window.__responder returns), synthetic tweets.
// newPage(browser, {ctxOpts: DESKTOP}) gives a desktop browser instead (mouse, no touch).
const {chromium} = require('playwright');
const fs = require('fs');
const path = require('path');
const {readScript} = require('./script.js');

const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

const NAMES = {
  'rgb(154, 154, 154)': 'GREY',
  'rgb(26, 140, 26)': 'GREEN',
  'rgb(126, 201, 126)': 'LGREEN',
  'rgb(229, 57, 53)': 'RED',
  'rgb(61, 78, 232)': 'BLUE',
};

function loadScript(variant) {
  return readScript(variant);
}

// Context profiles for newPage's ctxOpts. PHONE is the default. The desktop ones have no touch,
// so (pointer: fine) and (hover: hover) match.
const PHONE = {viewport: {width: 360, height: 800}, hasTouch: true, isMobile: true};
const DESKTOP = {viewport: {width: 1280, height: 800}, hasTouch: false, isMobile: false};
const DESKTOP_WIDE = {viewport: {width: 1920, height: 1080}, hasTouch: false, isMobile: false};

async function newPage(browser, {urlPath = '/home', store = {}, ctxOpts = {}} = {}) {
  const ctx = await browser.newContext(Object.assign({}, PHONE, ctxOpts));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') {
      errors.push('console.error: ' + m.text().split('\n')[0]);
    }
  });
  await page.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('https://x.com/') && route.request().resourceType() === 'document') {
      return route.fulfill({status: 200, contentType: 'text/html',
        body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>'});
    }
    if (u.includes('twimg.com')) {
      return route.fulfill({status: 200, contentType: 'image/png', body: PNG});
    }
    return route.fulfill({status: 404, body: ''});
  });
  await page.goto('https://x.com' + urlPath);
  await page.evaluate((store) => {
    window.__store = Object.assign({}, store);
    window.__reqs = [];
    window.GM_getValue = (k, d) => (k in window.__store ? window.__store[k] : d);
    window.GM_setValue = (k, v) => {
      window.__store[k] = v;
    };
    window.GM_registerMenuCommand = () => {};
    window.GM_addStyle = (css) => {
      const s = document.createElement('style');
      s.textContent = css;
      document.head.appendChild(s);
    };
    window.GM_getResourceURL = () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
    // __opened: the URLs. __openedOpts: {url, opts} per call in the same order, opts copied.
    window.__opened = [];
    window.__openedOpts = [];
    window.GM_openInTab = (u, o) => {
      window.__opened.push(u);
      window.__openedOpts.push({url: u, opts: o ? Object.assign({}, o) : null});
    };
    window.__responder = null;
    // /profile.json answers a logged-in Member by default. __profile may be an object,
    // 'fail' (network error) or a function returning either. Not logged in __reqs.
    window.__profile = {id: 1, name: 'tester', level: 20, tag_query_limit: 3, enable_safe_mode: false};
    window.__profileReqs = [];
    window.GM_xmlhttpRequest = (d) => {
      if (d.url.includes('/profile.json')) {
        window.__profileReqs.push(Math.round(performance.now() - (window.__t0 || 0)));
        const p = typeof window.__profile === 'function' ? window.__profile() : window.__profile;
        setTimeout(() => {
          if (p === 'fail') {
            d.onerror({status: 0});
          } else {
            d.onload({status: 200, responseText: JSON.stringify(p)});
          }
        }, 50);
        return;
      }
      const dec = decodeURIComponent(d.url);
      const tags = dec.split('tags=')[1] || dec;
      window.__reqs.push(Math.round(performance.now() - (window.__t0 || 0)) + ' ' + tags.replace('status:any ', '')
          .replace(/~source:\*/g, '').replace(/\*/g, ''));
      const r = (window.__responder && window.__responder(dec)) || {};
      setTimeout(() => {
        if (r.error) {
          d.onerror({status: 0});
        } else {
          d.onload({status: r.status || 200, responseText: r.body === undefined ? '[]' : r.body});
        }
      }, r.delay === undefined ? 50 : r.delay);
    };
    window.__unhandled = [];
    window.addEventListener('unhandledrejection', (e) => {
      window.__unhandled.push(String((e.reason && e.reason.message) || e.reason));
    });
    window.__btnAdds = 0;
    new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.classList && n.classList.contains('xdsu-upload-btn')) {
            window.__btnAdds++;
          }
        }
      }
    }).observe(document.body, {childList: true, subtree: true});

    // segment state comes from data-state (old versions: inline background colour). Both map
    // to the old colour strings so every NAMES lookup and rgb comparison keeps working.
    const STATE_RGB = {searching: "rgb(154, 154, 154)", found: "rgb(26, 140, 26)", foundWeak: "rgb(126, 201, 126)",
      missing: "rgb(229, 57, 53)", error: "rgb(61, 78, 232)"};
    window.segColor = (s) => (s.dataset.state ? STATE_RGB[s.dataset.state] : s.style.backgroundColor);
    // Link of a segment: href (bundle E) or data-match-url (HEAD).
    window.segUrl = (s) => s.getAttribute("href") || s.dataset.matchUrl || null;
    // Synthetic tweet, the minimal markup the script recognises.
    window.mkTweet = ({id, hashes = [], time = true, before = '', after = '', tabindex = '0', photoLinks = true}) => {
      const a = document.createElement('article');
      a.setAttribute('data-testid', 'tweet');
      a.setAttribute('tabindex', tabindex);
      a.id = 't' + id;
      let h = before;
      if (time) {
        h += `<a href="/u/status/${id}"><time datetime="2026-01-01">1h</time></a>`;
      }
      hashes.forEach((hash, i) => {
        const tile = `<div data-testid="tweetPhoto" style="width:150px;height:100px">`
          + `<img src="https://pbs.twimg.com/media/${hash}?format=jpg&name=small"></div>`;
        h += photoLinks ? `<a href="/u/status/${id}/photo/${i + 1}">${tile}</a>` : tile;
      });
      h += after;
      h += `<div role="group"><button data-testid="reply">r</button><button data-testid="retweet">rt</button>`
        + `<button data-testid="like">like</button></div>`;
      a.innerHTML = h;
      return a;
    };
    window.add = (o) => document.getElementById('root').appendChild(window.mkTweet(o));
    window.snap = () => [...document.querySelectorAll('article')].map((a) => ({
      id: a.id,
      tweetId: a.dataset.xdsuTweetId,
      done: a.dataset.xdsuDone,
      btns: a.querySelectorAll('.xdsu-upload-btn').length,
      href: (a.querySelector('.xdsu-upload-btn') || {}).href,
      segs: [...a.querySelectorAll('.xdsu-bar-seg')].map((s) => ({
        color: window.segColor(s),
        url: window.segUrl(s),
      })),
    }));
  }, store);
  return {page, errors, ctx};
}

async function inject(page, variant) {
  await page.evaluate(() => {
    window.__t0 = performance.now();
  });
  await page.addScriptTag({content: loadScript(variant)});
}

async function state(page) {
  const s = await page.evaluate(() => window.snap());
  return s.map((a) => `${a.id}[${a.segs.map((g) => (NAMES[g.color] || g.color)
      + (g.url ? '>' + g.url.replace('https://danbooru.donmai.us/', '').slice(0, 40) : '')).join(',')}]`
      + (a.btns === (a.segs.length || 0) ? '' : ` btns=${a.btns}`)).join(' ');
}
async function colors(page) {
  const s = await page.evaluate(() => window.snap());
  return s.map((a) => a.segs.map((g) => NAMES[g.color] || g.color));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {chromium, newPage, inject, state, colors, sleep, NAMES, PHONE, DESKTOP, DESKTOP_WIDE};
