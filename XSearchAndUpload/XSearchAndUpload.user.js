// ==UserScript==
// @name         X (Twitter) Danbooru Search and Upload
// @namespace    https://github.com/AkaringoP
// @description  Show Danbooru-presence bars under tweet images on x.com and add a one-click Danbooru upload button. Mobile-friendly (Firefox + Tampermonkey).
// @match        *://x.com/*
// @match        *://twitter.com/*
// @match        *://mobile.twitter.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js
// @connect      danbooru.donmai.us
// @noframes
// @version      1.0.0
// ==/UserScript==

/* You must be logged into Danbooru for the search to work. */
/* Gold+ account is recommended so OR-tag batching can use up to 6 tags per query. */

(function() {
  'use strict';

  const VERSION = '1.0.0';
  console.log(`[XDSU] v${VERSION} loaded`);

  // -------------- config --------------

  const DEFAULT_BOORU_URL = 'https://danbooru.donmai.us';

  // Returns "https://host[/path]" without a trailing slash, or null if the value is not a usable URL.
  function normalizeBooruUrl(v) {
    if (typeof v !== 'string') {
      return null;
    }
    let s = v.trim();
    if (!s) {
      return null;
    }
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
      s = 'https://' + s;
    }
    let u;
    try {
      u = new URL(s);
    } catch {
      return null;
    }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') {
      return null;
    }
    if (u.hostname !== 'localhost' && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) {
      return null;
    }
    return (u.origin + u.pathname).replace(/\/+$/, '');
  }

  const DANBOORU_URL = (normalizeBooruUrl(GM_getValue('booru', DEFAULT_BOORU_URL)) || DEFAULT_BOORU_URL) + '/';
  // danbooru/public/logos/danbooru-logo.png (128x128).
  const DANBOORU_ICON_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAAsTAAALEwEAmpwYAAAFCklEQVR4nO2cP27UQBTGvyCkKKJAdJSU9BTcAOqcgxR0HCFAhYS4ANBygUQcgDOgKBKKUqBEAgnCnyJDgTaJ1zP2s+fNvOfM9ytQdu0dO/5+73lm2Q1ACCGEEEIIIYSQVtgwPv4DAPsA7hifx3VmMOMbtc4iAsN3gJUADN8JFgIwfEfUFoDhO6OmAAzfIbUEeAjgIxi+O2osA1n5tgxmfLPwwcXh39raxO7ONu7fu1v4lJbH5y9f8ez1B/w4+6M+dslbAMNXoGT4QDkBGL4CpcMHygjA8BWoET6gLwDDV6BW+ICuAAxfgSnh39razD6elgAMX4Gp4e/ubGcfU0MAhq/AnPA1rmOuAAxfAavwgTwBGL4CluED8wVg+ApYhw/ME4DhK+AhfGC6AAxfAS/hA9MEYPgKeAofkAvA8BXwFj4gE4DhK+AxfED2gZBvAG6XPhHyn6nhP3ryamyX7O8FMPxKWHRQyy+GkCtY3T4pgAMs504UwBjriTMFMMZ61UQBjLFeMlOAxsn+XsDem6ca53FtEazTTWEHaBwK0DgUoHEoQONQgMahAI1DARqHAjQOBWgcCtA4FKBxKEDjUIDGoQCNU/rPxJFMQvcfdSiAMSGkg+3nri8BBVAizKzSmACh90N0q4oOFCCBtPXmVulVcXqvTAwVFDtBUwJIqjRefQNVGt0sD2jVAXqhRoYYOYtZLFoA7Sqd1XqTVTp+XgBw3rkFhOSYZaaADgWQ3ksloY4Hldl6B8OX0Z8DhM4Ag2MpWFFcgElVGv9hZL/o1vlVOlp96XTm5NET4KIJCEbzIIDGMkYSatkqndF6Q0K2iXSuX+80Bq6t0j2hiADSCZJ08jx9gjSjSkNyhIGD5c/Hr16/eKiR66s4IVAQAFBZxkhDLVWlIXlm0YOJRpZ08RAEd8i16+tLAPkypv90PNTBm8rkCZIsVGn9a1fpeegdPDF6ugByyBYgexkzufUK227nug5X6cjM5PKZAlUaRgTo3yZ1DSgwByhXpd3xFKp0eBh0QhVPyscruvOac6l+mG6XAH0BLoKSXTHpXVqn9U6rUmnrzanS9fc90p1y/aGOBLoCTJwgJWqy/0yJUEX7rR6Uq9LOKkA2cRIXjQRVAfQmSPLWO6tKB06iv198i+RXlVTpxSogPcjwMTNREeA6VGl2603nNsh59Ly7qZcIfoXOKkB0u69Rpd0HsoY0UKfJ6ou8YvzXix8i2Q5D8fABrVuAwgRJ0nrLVWk60PRxdap06K30GuQLkLmM8VWlU0OtU6UlUX0r+OK56I7rD2VtI2+C1N9BEqpxUVZFdxWg2HpZpXXQWwVcPhPZKbkFrFJblP8vYMWcCRJDtaDgB0LYepdA0U8EEf/wu4GNQwEahwI0DgVoHArQOBSgcShA41CAxqEAjUMBGocCLJiDo5PsMSjAQjk8PsXL9/vZ41CABXJ4fIrnb/fw89ff7LHc/YUQMszB0QlevNvH2W9R+N/HdmAHWBCrtj8h/MdjO1GAhTCx7a/C/zS2IwVYAKXCByiAe0qGD1AA15QOH6AAbqkRPkABXFIrfIACuKNm+AAFcEXt8AEK4AaL8AEK4AKr8AEKYI5l+AAFMMcyfIACmGMZPkABlkCx8AEK4J2i4QPAhmAffv/bhuLhA+wAXqkSPkABPFItfIACeKNq+AAF8ET18AEK4AWT8AEK4AGz8AEKYI1p+IQQQgghhBBCCGmLfxrmmkuV3GutAAAAAElFTkSuQmCC';

  GM_registerMenuCommand('Set Danbooru domain', () => {
    const cur = GM_getValue('booru', DEFAULT_BOORU_URL);
    const input = prompt('Danbooru URL (including https://)', cur);
    if (input === null) {
      return;
    }
    const url = normalizeBooruUrl(input);
    if (!url) {
      alert('Enter a full URL such as https://danbooru.donmai.us');
      return;
    }
    GM_setValue('booru', url);
    location.reload();
  });

  GM_registerMenuCommand('Set query batch size', () => {
    const cur = GM_getValue('queryBatch', 3);
    const msg = 'Wildcards per Danbooru query (1-5).\n'
      + 'Lower = more requests but works on Member accounts (limit 6 wildcards).\n'
      + 'Each unit uses 2 wildcards. 3 = 6 wildcards (Gold-safe), 1 = 2 wildcards (Member-safe).';
    const input = prompt(msg, String(cur));
    const n = parseInt(input, 10);
    if (n >= 1 && n <= 5) {
      GM_setValue('queryBatch', n);
      location.reload();
    }
  });

  const COLORS = {
    searching: '#9a9a9a',
    found: '#1a8c1a',
    foundWeak: '#7ec97e',
    missing: '#e53935',
    error: '#3d4ee8',
  };

  const POLL_INTERVAL_MS = 2000;
  const SCAN_DEBOUNCE_MS = 100;
  const FLUSH_DEBOUNCE_MS = 250;
  // Each batched ~source:*foo* uses 2 wildcards. Danbooru limits:
  //   Member: 6 wildcards (batch up to 3), Gold: 12 (up to 5+), Platinum: more.
  // Default 3 is Member-safe; users on higher tiers can raise via menu.
  const storedBatch = GM_getValue('queryBatch', 3);
  const QUERY_BATCH = Math.max(1, Math.min(5, Number.isInteger(storedBatch) ? storedBatch : 3));
  const FETCH_TIMEOUT_MS = 20000;
  const MAX_ATTEMPTS = 5;
  const ARTICLE_SELECTOR = 'article[data-testid="tweet"], article[tabindex="-1"]';
  const TWEET_PATH_RE = /^\/(?:i\/web|([^/]+))\/status(?:es)?\/(\d+)/;
  // A per-image upload needs a ref that names the user; otherwise Danbooru may not find the tweet.
  const UPLOAD_REF_RE = /^https:\/\/x\.com\/(?!i\/)[^/]+\/status\/\d+$/;
  const UPLOAD_LOCK_MS = 1500;
  // Tiles lower than this keep the small button so it does not cover the photo link.
  const SMALL_TILE_PX = 120;
  const WATCH_MAX_AGE_MS = 30 * 60 * 1000;
  // Delays between the re-checks that follow a return to the tab.
  const RECHECK_DELAYS_MS = [5000, 15000, 40000];
  const LIKE_RECHECK = GM_getValue('likeRecheck', true);

  // -------------- styles --------------

  GM_addStyle(`
    .xdsu-bar {
      display: flex;
      gap: 3px;
      width: 100%;
      height: 6px;
      margin: 6px 0 4px 0;
      pointer-events: none;
      box-sizing: border-box;
    }
    .xdsu-bar-seg {
      flex: 1 1 0;
      min-width: 0;
      height: 100%;
      border-radius: 3px;
      background-color: ${COLORS.searching};
      transition: background-color 0.3s ease;
      pointer-events: none;
    }
    .xdsu-bar-seg.xdsu-clickable {
      pointer-events: auto;
      cursor: pointer;
    }
    .xdsu-bar-seg.xdsu-rechecking {
      animation: xdsu-pulse 0.8s ease-in-out infinite alternate;
    }
    @keyframes xdsu-pulse {
      from { opacity: 1; }
      to { opacity: 0.35; }
    }
    @media (prefers-reduced-motion: reduce) {
      .xdsu-bar-seg.xdsu-rechecking {
        animation: none;
        opacity: 0.6;
      }
    }
    .xdsu-upload-btn {
      display: grid;
      place-items: center;
      width: 32px;
      height: 32px;
      padding: 0;
      box-sizing: border-box;
      font-size: 18px;
      position: absolute;
      top: 6px;
      left: 6px;
      z-index: 5;
      background: rgba(0,0,0,0.55);
      border-radius: 4px;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.35);
      cursor: pointer;
      touch-action: manipulation;
      text-decoration: none !important;
      color: white !important;
      line-height: 1;
    }
    .xdsu-upload-btn::after {
      content: '';
      position: absolute;
      inset: -4px;
    }
    .xdsu-upload-btn:active { transform: scale(0.92); }
    .xdsu-upload-btn.xdsu-sent { opacity: 0.6; }
    .xdsu-upload-btn.xdsu-found { box-shadow: 0 0 0 2px ${COLORS.found}; }
    @media (hover: hover) {
      .xdsu-upload-btn:hover { background: rgba(0,0,0,0.78); }
    }
    @media (pointer: coarse) {
      .xdsu-upload-btn:not(.xdsu-small) {
        width: 40px;
        height: 40px;
      }
      .xdsu-upload-btn:not(.xdsu-small)::after { inset: -6px; }
    }
    .xdsu-upload-btn img {
      width: 20px;
      height: 20px;
      display: block;
      border: none;
    }
  `);

  // -------------- helpers --------------

  function gmFetch(url, params) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        url,
        method: 'GET',
        timeout: FETCH_TIMEOUT_MS,
        onload: resolve,
        onerror: reject,
        ontimeout: reject,
        onabort: reject,
        ...(params || {}),
      });
    });
  }

  function parseTwitterImageHash(src) {
    const m = src && src.match(/pbs\.twimg\.com\/media\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  function parseDanbooruSource(source) {
    const out = {};
    if (!source) {
      return out;
    }
    const tweet = source.match(/status(?:es)?\/(\d+)/);
    if (tweet) {
      out.tweetId = tweet[1];
    }
    const photo = source.match(/\/photo\/(\d+)/);
    if (photo) {
      out.photoIndex = parseInt(photo[1], 10);
    }
    const media = source.match(/pbs\.twimg\.com\/media\/([A-Za-z0-9_-]+)/);
    if (media) {
      out.imageHash = media[1];
    }
    return out;
  }

  function buildUploadUrl(sourceUrl, ref) {
    const u = new URL('uploads/new', DANBOORU_URL);
    u.searchParams.set('url', sourceUrl);
    if (ref) {
      u.searchParams.set('ref', ref);
    }
    return u.href;
  }

  // entries[i] is cache[keys[i]] as it was when the batch started; skip keys whose
  // entry was dropped or replaced (e.g. by a like refresh) while the request ran.
  function setKeysError(cache, keys, entries) {
    keys.forEach((k, i) => {
      if (entries[i] && cache[k] === entries[i]) {
        entries[i].state = 'error';
      }
    });
  }

  function clearArticleMarkers(article) {
    delete article.dataset.xdsuTweetId;
    delete article.dataset.xdsuTweetUrl;
    delete article.dataset.xdsuDone;
    article.querySelectorAll('[data-xdsu-btn]').forEach((el) => {
      el.removeAttribute('data-xdsu-btn');
    });
    article.querySelectorAll('.xdsu-upload-btn, .xdsu-bar').forEach((el) => {
      el.remove();
    });
  }

  // Builds {tweetId, tweetUrl} from a URL path; the URL drops suffixes like /photo/1.
  function parseStatusPath(pathname) {
    const m = (pathname || '').match(TWEET_PATH_RE);
    if (!m) {
      return null;
    }
    return {tweetId: m[2], tweetUrl: `https://x.com/${m[1] || 'i/web'}/status/${m[2]}`};
  }

  // Reads the tweet's own permalink, never the one of a quoted tweet (div[role="link"]).
  // Only the focal tweet of a detail page (article[tabindex="-1"]) falls back to the page URL.
  function extractTweetInfo(article) {
    const time = [...article.querySelectorAll('time')].find((t) => !t.closest('div[role="link"]'));
    const link = (time && time.closest('a[href*="/status/"]'))
      || [...article.querySelectorAll('a[href*="/status/"]')].find((a) => !a.closest('div[role="link"]'));
    if (link) {
      return parseStatusPath(link.pathname);
    }
    if (article.matches('article[tabindex="-1"]')) {
      return parseStatusPath(location.pathname);
    }
    return null;
  }

  // True when the image hash of a tracked segment no longer matches any image in the
  // article, i.e. the article now shows different content.
  function mediaChanged(article) {
    const seg = article.querySelector('.xdsu-bar-seg[data-image-hash]');
    if (!seg) {
      return false;
    }
    const now = findPhotos(article).map((p) => {
      const img = findTweetImage(p);
      return img ? parseTwitterImageHash(img.src) : null;
    }).filter(Boolean);
    return now.length > 0 && !now.includes(seg.dataset.imageHash);
  }

  // Combined tweetId + tweetUrl extraction with per-article caching.
  // Keeps the cache while the live permalink still names the cached tweet (or, without a
  // permalink, while the media is unchanged); otherwise the article was recycled, so all
  // related markers are cleared.
  function getTweetInfo(article) {
    const cached = article.dataset.xdsuTweetId;
    const fresh = extractTweetInfo(article);
    if (cached) {
      if (fresh ? fresh.tweetId === cached : !mediaChanged(article)) {
        return {
          tweetId: cached,
          tweetUrl: article.dataset.xdsuTweetUrl || `https://x.com/i/web/status/${cached}`,
        };
      }
      clearArticleMarkers(article);
    }
    if (!fresh) {
      return null;
    }
    article.dataset.xdsuTweetId = fresh.tweetId;
    article.dataset.xdsuTweetUrl = fresh.tweetUrl;
    return fresh;
  }

  function findPhotos(article) {
    const all = article.querySelectorAll('[data-testid="tweetPhoto"]');
    const out = [];
    for (const el of all) {
      if (el.closest('div[role="link"]')) {
        continue;
      }
      if (el.closest('[data-testid="previewInterstitial"]')) {
        continue;
      }
      out.push(el);
    }
    return out;
  }

  function findTweetImage(photoEl) {
    const imgs = photoEl.querySelectorAll('img');
    for (const img of imgs) {
      if (img.src && img.src.indexOf('pbs.twimg.com/media') >= 0) {
        return img;
      }
    }
    return null;
  }

  // -------------- state --------------

  // tweetId -> { state: 'pending'|'done'|'error',
  //              posts: [{id, source, tweetId, photoIndex, imageHash, rating, score}] }
  const tweetCache = Object.create(null);
  // imageHash -> same shape (fallback for tweets that returned no posts).
  const hashCache = Object.create(null);

  const pendingTweetIds = [];
  const pendingHashes = [];

  // [{tweetId, imageHash, kind, photoIndex, bar, btn, rechecking, applied}] where bar is the
  // segment element and btn the tile's upload button. Video/GIF tiles have kind 'video' and
  // imageHash null. applied is the last state written to the DOM by applyColors.
  const imageRefs = [];

  // Tweets opened for upload: tweetId -> {t0, n0}, n0 = posts known when the upload was opened.
  // Stored so that it survives Firefox discarding and reloading the X tab.
  const watch = new Map((() => {
    try {
      const saved = JSON.parse(GM_getValue('watch', '[]'));
      return (Array.isArray(saved) ? saved : []).filter((e) => Array.isArray(e) && e[1]
        && Number.isFinite(e[1].t0) && Number.isFinite(e[1].n0)
        && Date.now() - e[1].t0 <= WATCH_MAX_AGE_MS);
    } catch {
      return [];
    }
  })());

  function saveWatch() {
    GM_setValue('watch', JSON.stringify([...watch]));
  }
  saveWatch();

  // -------------- DOM scan --------------

  function scanTweets() {
    const articles = document.querySelectorAll(ARTICLE_SELECTOR);
    for (const article of articles) {
      try {
        processArticle(article);
      } catch (e) {
        console.error('[XDSU] article scan failed', e);
      }
    }
    // Prune disconnected segment refs. Clear their markers too, so the same element
    // is tracked again if it is re-attached later.
    for (let i = imageRefs.length - 1; i >= 0; i--) {
      const seg = imageRefs[i].bar;
      if (!seg.isConnected) {
        delete seg.dataset.tracked;
        delete seg.dataset.imageHash;
        const art = seg.closest('article');
        if (art) {
          delete art.dataset.xdsuDone;
        }
        imageRefs.splice(i, 1);
      }
    }
  }

  function processArticle(article) {
    const info = getTweetInfo(article);
    if (!info) {
      return;
    }
    // Short-circuit articles already fully processed for this tweet.
    if (article.dataset.xdsuDone === info.tweetId) {
      return;
    }
    const photos = findPhotos(article);
    if (photos.length === 0) {
      return;
    }
    const bar = ensureTweetBar(article, info.tweetId, photos.length);
    let allTracked = true;
    photos.forEach((photoEl, idx) => {
      const tracked = processPhoto(photoEl, info, idx + 1, bar);
      if (!tracked) {
        allTracked = false;
      }
    });
    if (allTracked) {
      article.dataset.xdsuDone = info.tweetId;
    }
  }

  // The tweet bar sits as a flex row right above the action group
  // and has one segment per image.
  function ensureTweetBar(article, tweetId, photoCount) {
    let actionGroup = null;

    // Strategy 1: any [role="group"] that contains the like button.
    // On the timeline there is one group (the action bar) and it
    // contains Like. On the tweet detail page there are two groups
    // (engagement stats + action bar) and only the action bar contains
    // Like, so this picks the right one in both layouts.
    const groups = article.querySelectorAll('[role="group"]');
    for (const g of groups) {
      if (g.querySelector('[data-testid="like"], [data-testid="unlike"]')) {
        actionGroup = g;
        break;
      }
    }
    // Strategy 2: first [role="group"] (covers the brief window before
    // the Like button is rendered; identical to pre-v8 behavior).
    if (!actionGroup && groups.length > 0) {
      actionGroup = groups[0];
    }
    // Strategy 3: walk up from the Like button until we find a
    // container that also holds Reply or Retweet -- i.e., the action
    // row -- in case Twitter dropped role="group" from it entirely.
    if (!actionGroup) {
      const likeBtn = article.querySelector('[data-testid="like"], [data-testid="unlike"]');
      if (likeBtn) {
        let walk = likeBtn.parentElement;
        for (let i = 0; i < 6 && walk && walk !== article; i++) {
          if (walk.querySelector('[data-testid="reply"], [data-testid="retweet"]')) {
            actionGroup = walk;
            break;
          }
          walk = walk.parentElement;
        }
      }
    }

    if (!actionGroup || !actionGroup.parentNode) {
      return null;
    }

    let bar = article.querySelector('.xdsu-bar');
    if (!bar || bar.dataset.tweetId !== tweetId) {
      if (bar) {
        bar.remove();
      }
      bar = document.createElement('div');
      bar.className = 'xdsu-bar';
      bar.dataset.tweetId = tweetId;
      actionGroup.parentNode.insertBefore(bar, actionGroup);
    }
    while (bar.children.length < photoCount) {
      const seg = document.createElement('div');
      seg.className = 'xdsu-bar-seg';
      seg.style.backgroundColor = COLORS.searching;
      bar.appendChild(seg);
    }
    // Trim excess (e.g. if the tweet was edited to fewer images).
    while (bar.children.length > photoCount) {
      bar.lastChild.remove();
    }
    return bar;
  }

  // Returns true if the photo is fully tracked (won't need re-processing).
  function processPhoto(photoEl, info, photoIndex, bar) {
    // Upload button: only needs tweet URL, attach immediately.
    if (!photoEl.hasAttribute('data-xdsu-btn')) {
      const cs = window.getComputedStyle(photoEl);
      if (!cs.position || cs.position === 'static') {
        photoEl.style.position = 'relative';
      }
      attachUploadBtn(photoEl, info);
      photoEl.setAttribute('data-xdsu-btn', '1');
    }
    if (!bar) {
      return false;
    }
    const segment = bar.children[photoIndex - 1];
    if (!segment) {
      return false;
    }
    if (segment.dataset.tracked) {
      return true;
    }
    const img = findTweetImage(photoEl);
    const imageHash = img ? parseTwitterImageHash(img.src) : null;
    // Video/GIF tiles have no media hash; they are looked up by tweet id only.
    // A tile that is neither is an image that has not loaded yet.
    if (!imageHash && !isVideoTile(photoEl)) {
      return false;
    }
    segment.dataset.tracked = '1';
    if (imageHash) {
      segment.dataset.imageHash = imageHash;
    }
    segment.dataset.photoIndex = String(photoIndex);
    const ref = {
      tweetId: info.tweetId,
      imageHash,
      kind: imageHash ? 'image' : 'video',
      photoIndex,
      bar: segment,
      btn: photoEl.querySelector(':scope > .xdsu-upload-btn'),
      rechecking: false,
      applied: null,
    };
    imageRefs.push(ref);
    ensureHashLookup(ref);
    enqueueTweetIdSearch(info.tweetId);
    return true;
  }

  function isVideoTile(photoEl) {
    return !!photoEl.querySelector('video, [data-testid="videoPlayer"], img[src*="_video_thumb/"]');
  }

  function attachUploadBtn(photoEl, info) {
    // The href (and so a long press "open in new tab") always uploads the whole tweet.
    const tweetUploadUrl = buildUploadUrl(info.tweetUrl);

    const btn = document.createElement('a');
    btn.className = 'xdsu-upload-btn';
    if (photoEl.clientHeight < SMALL_TILE_PX) {
      btn.classList.add('xdsu-small');
    }
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.href = tweetUploadUrl;
    btn.title = 'Upload to Danbooru';
    btn.setAttribute('aria-label', 'Upload to Danbooru');

    const icon = document.createElement('img');
    icon.alt = '';
    icon.onerror = () => {
      btn.textContent = '↑';
    };
    icon.src = DANBOORU_ICON_URL;
    btn.appendChild(icon);

    // A tap uploads only this image when its original jpg/png can be named exactly; otherwise
    // the whole tweet. Read at tap time because the image src can arrive after the button.
    const uploadUrl = () => {
      const img = findTweetImage(photoEl);
      const hash = img ? parseTwitterImageHash(img.src) : null;
      if (!hash || !UPLOAD_REF_RE.test(info.tweetUrl)) {
        return tweetUploadUrl;
      }
      const src = new URL(img.src);
      const ext = src.pathname.match(/\.([^./]+)$/);
      const fmt = src.searchParams.get('format') || (ext && ext[1]);
      if (fmt !== 'jpg' && fmt !== 'png') {
        return tweetUploadUrl;
      }
      return buildUploadUrl(`https://pbs.twimg.com/media/${hash}?format=${fmt}&name=orig`, info.tweetUrl);
    };

    let lastOpenAt = 0;
    const onClick = (ev) => {
      if (ev.button !== undefined && ev.button > 1) {
        return;
      }
      // Cancel every tap, locked ones included, so none reaches the photo link behind the button.
      ev.preventDefault();
      ev.stopPropagation();
      const now = Date.now();
      if (now - lastOpenAt < UPLOAD_LOCK_MS) {
        return;
      }
      lastOpenAt = now;
      btn.classList.add('xdsu-sent');
      watchTweet(info.tweetId);
      const url = uploadUrl();
      let tab = null;
      try {
        tab = GM_openInTab(url, {
          active: ev.button === 0 && !ev.ctrlKey,
          setParent: true,
        });
      } catch (e) {
        console.error('[XDSU] open tab failed', e);
        window.open(url, '_blank', 'noopener');
      }
      // Extra re-check trigger; the return to this tab (visibilitychange) is the main one.
      if (tab) {
        tab.onclose = () => refreshTweetStatus(info.tweetId);
      }
    };
    btn.addEventListener('click', onClick);
    btn.addEventListener('auxclick', onClick);
    // A long press may open the href in a new tab from the browser menu.
    btn.addEventListener('contextmenu', () => watchTweet(info.tweetId));
    // Prevent middle-click autoscroll and click bubbling to the tweet router link.
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    photoEl.appendChild(btn);
  }

  // -------------- search queue --------------

  function enqueueTweetIdSearch(tweetId) {
    if (tweetCache[tweetId]) {
      return;
    }
    tweetCache[tweetId] = {state: 'pending', posts: []};
    if (!pendingTweetIds.includes(tweetId)) {
      pendingTweetIds.push(tweetId);
    }
    scheduleFlush();
  }

  // Falls back to a media-hash lookup for an image whose tweet has no posts.
  function ensureHashLookup(ref) {
    if (!ref.imageHash || hashCache[ref.imageHash]) {
      return;
    }
    const tc = tweetCache[ref.tweetId];
    if (!tc || tc.state !== 'done' || tc.posts.length) {
      return;
    }
    hashCache[ref.imageHash] = {state: 'pending', posts: []};
    if (!pendingHashes.includes(ref.imageHash)) {
      pendingHashes.push(ref.imageHash);
    }
    scheduleFlush();
  }

  let flushTimer = null;
  let flushRunning = false;
  function scheduleFlush() {
    if (flushTimer || flushRunning) {
      return;
    }
    flushTimer = setTimeout(async () => {
      flushTimer = null;
      flushRunning = true;
      try {
        await flushPending();
      } catch (e) {
        console.error('[XDSU] flush failed', e);
      } finally {
        flushRunning = false;
      }
      if (pendingTweetIds.length || pendingHashes.length) {
        scheduleFlush();
      }
    }, FLUSH_DEBOUNCE_MS);
  }

  async function flushPending() {
    while (pendingTweetIds.length) {
      const batch = pendingTweetIds.splice(0, QUERY_BATCH);
      await runTweetIdBatch(batch);
      imageRefs.filter((ref) => ref.bar.isConnected).forEach(ensureHashLookup);
      applyColors();
    }
    while (pendingHashes.length) {
      const hBatch = pendingHashes.splice(0, QUERY_BATCH);
      await runHashBatch(hBatch);
      applyColors();
    }
  }

  async function runTweetIdBatch(ids) {
    const tagStr = 'status:any '
        + ids.map((id) => `~source:*status/${id}*`).join(' ');
    await runBatch(ids, tweetCache, tagStr, (info) => info.tweetId);
  }

  async function runHashBatch(hashes) {
    const tagStr = 'status:any '
        + hashes.map((h) => `~source:*media/${h}*`).join(' ');
    await runBatch(hashes, hashCache, tagStr, (info) => info.imageHash);
  }

  async function runBatch(keys, cache, tagStr, keyOf) {
    const url = `${DANBOORU_URL}posts.json?limit=100&tags=${encodeURIComponent(tagStr)}`;
    // Results are only written into the entries that existed when the batch started.
    const entries = keys.map((k) => cache[k]);
    let resp = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        resp = await gmFetch(url);
        if (resp && resp.status >= 200 && resp.status < 400) {
          break;
        }
        resp = null;
      } catch {
        resp = null;
      }
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
    if (!resp) {
      setKeysError(cache, keys, entries);
      return;
    }
    let data;
    try {
      data = JSON.parse(resp.responseText);
    } catch {
      data = null;
    }
    if (!Array.isArray(data)) {
      setKeysError(cache, keys, entries);
      return;
    }
    const bucket = Object.create(null);
    for (const k of keys) {
      bucket[k] = [];
    }
    for (const post of data) {
      const info = parseDanbooruSource(post.source);
      const k = keyOf(info);
      if (k && bucket[k]) {
        bucket[k].push({
          id: post.id,
          source: post.source,
          tweetId: info.tweetId,
          photoIndex: info.photoIndex,
          imageHash: info.imageHash,
          rating: post.rating,
          score: post.score,
        });
      }
    }
    keys.forEach((k, i) => {
      if (entries[i] && cache[k] === entries[i]) {
        entries[i].posts = bucket[k];
        entries[i].state = 'done';
      }
    });
  }

  // -------------- coloring + F2 link annotation --------------

  function resolveColor(ref) {
    const tc = tweetCache[ref.tweetId];
    if (!tc || tc.state === 'pending') {
      return COLORS.searching;
    }
    // Video/GIF refs have no hash and are judged on the tweet result alone.
    const hc = ref.imageHash ? hashCache[ref.imageHash] : null;
    if (tc.state === 'error') {
      if (hc && hc.state === 'done' && hc.posts.length) {
        return COLORS.found;
      }
      return COLORS.error;
    }
    if (tc.posts.length === 0) {
      if (!ref.imageHash) {
        return COLORS.missing;
      }
      if (!hc || hc.state === 'pending') {
        return COLORS.searching;
      }
      if (hc.state === 'error') {
        return COLORS.error;
      }
      if (hc.state === 'done' && hc.posts.length) {
        return COLORS.found;
      }
      return COLORS.missing;
    }
    const strict = tc.posts.some((p) => {
      if (p.imageHash && p.imageHash === ref.imageHash) {
        return true;
      }
      if (p.photoIndex && p.photoIndex === ref.photoIndex) {
        return true;
      }
      return false;
    });
    return strict ? COLORS.found : COLORS.foundWeak;
  }

  // Returns a Danbooru URL to navigate to when the segment is clicked, or null.
  function resolveMatchUrl(ref) {
    const tc = tweetCache[ref.tweetId];
    if (tc && tc.state === 'done' && tc.posts.length) {
      const exact = tc.posts.find((p) =>
        (p.imageHash && p.imageHash === ref.imageHash)
        || (p.photoIndex && p.photoIndex === ref.photoIndex));
      if (exact) {
        return `${DANBOORU_URL}posts/${exact.id}`;
      }
      // No exact image match: link to the tweet's search results on Danbooru.
      const tags = `status:any source:*status/${ref.tweetId}*`;
      return `${DANBOORU_URL}posts?tags=${encodeURIComponent(tags)}`;
    }
    const hc = ref.imageHash ? hashCache[ref.imageHash] : null;
    if (hc && hc.state === 'done' && hc.posts.length) {
      const exact = hc.posts.find((p) => p.imageHash === ref.imageHash);
      if (exact) {
        return `${DANBOORU_URL}posts/${exact.id}`;
      }
    }
    return null;
  }

  // The only writer of segment state. A segment being re-checked keeps its previous colour,
  // link and label (and pulses) until the new answer is in.
  function applyColors() {
    for (const ref of imageRefs) {
      if (!ref.bar.isConnected) {
        continue;
      }
      const color = resolveColor(ref);
      const hold = ref.rechecking && color === COLORS.searching;
      if (!hold) {
        ref.rechecking = false;
      }
      const matchUrl = resolveMatchUrl(ref);
      const key = `${color}|${matchUrl || ''}|${hold ? 1 : 0}`;
      if (ref.applied === key) {
        continue;
      }
      ref.applied = key;
      ref.bar.classList.toggle('xdsu-rechecking', hold);
      if (hold) {
        continue;
      }
      ref.bar.style.backgroundColor = color;
      if (matchUrl) {
        ref.bar.dataset.matchUrl = matchUrl;
        ref.bar.classList.add('xdsu-clickable');
        ref.bar.title = matchUrl.replace(/^https?:\/\//, '');
      } else {
        delete ref.bar.dataset.matchUrl;
        ref.bar.classList.remove('xdsu-clickable');
        ref.bar.removeAttribute('title');
      }
      if (ref.btn) {
        const found = color === COLORS.found;
        const label = found ? 'Already on Danbooru' : 'Upload to Danbooru';
        ref.btn.classList.toggle('xdsu-found', found);
        ref.btn.title = label;
        ref.btn.setAttribute('aria-label', label);
      }
    }
  }

  // -------------- F2: bar segment click delegation --------------

  // Capture-phase listener so we win over Twitter's router.
  document.addEventListener('click', handleBarClick, true);
  document.addEventListener('auxclick', handleBarClick, true);
  document.addEventListener('mousedown', (ev) => {
    if (ev.target.closest && ev.target.closest('.xdsu-bar-seg.xdsu-clickable')) {
      ev.stopPropagation();
    }
  }, true);

  function handleBarClick(ev) {
    const seg = ev.target.closest && ev.target.closest('.xdsu-bar-seg.xdsu-clickable');
    if (!seg) {
      return;
    }
    if (ev.button !== undefined && ev.button > 1) {
      return;
    }
    const url = seg.dataset.matchUrl;
    if (!url) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    try {
      GM_openInTab(url, {
        active: ev.button === 0 && !ev.ctrlKey,
        setParent: true,
      });
    } catch (e) {
      console.error('[XDSU] open post failed', e);
    }
  }

  // -------------- re-check after an upload --------------

  const lastRefresh = Object.create(null);
  const REFRESH_DEBOUNCE_MS = 1500;

  function isLookupPending(tweetId) {
    const tc = tweetCache[tweetId];
    if (tc && tc.state === 'pending') {
      return true;
    }
    return imageRefs.some((ref) => ref.tweetId === tweetId && ref.imageHash
      && hashCache[ref.imageHash] && hashCache[ref.imageHash].state === 'pending');
  }

  // Drops the cached result of a tweet and queries it again. The segments keep showing the old
  // result while the query runs (see applyColors).
  function refreshTweetStatus(tweetId) {
    const refs = imageRefs.filter((ref) => ref.tweetId === tweetId && ref.bar.isConnected);
    // Nothing on screen to update (e.g. a text-only tweet), or a lookup is already running.
    if (!refs.length || isLookupPending(tweetId)) {
      return;
    }
    const now = Date.now();
    if ((lastRefresh[tweetId] || 0) > now - REFRESH_DEBOUNCE_MS) {
      return;
    }
    lastRefresh[tweetId] = now;
    delete tweetCache[tweetId];
    for (const ref of imageRefs) {
      if (ref.tweetId === tweetId && ref.imageHash) {
        delete hashCache[ref.imageHash];
      }
    }
    for (const ref of refs) {
      ref.rechecking = true;
    }
    // New posts are searchable at once, so there is no delay before the query.
    enqueueTweetIdSearch(tweetId);
    applyColors();
  }

  // Posts currently known for a tweet: its tweet-id lookup plus the hash lookups of its images.
  function knownPostCount(tweetId) {
    const tc = tweetCache[tweetId];
    const hashes = new Set(imageRefs.filter((ref) => ref.tweetId === tweetId && ref.imageHash)
        .map((ref) => ref.imageHash));
    return [...hashes].reduce((n, h) => n + (hashCache[h] ? hashCache[h].posts.length : 0),
        tc ? tc.posts.length : 0);
  }

  function watchTweet(tweetId) {
    watch.set(tweetId, {t0: Date.now(), n0: knownPostCount(tweetId)});
    saveWatch();
  }

  // One round of re-checks for the watched tweets. Step 0 runs when the tab becomes visible,
  // the next steps follow on a single timer; an entry is dropped once its post count rose,
  // after 30 minutes, or after the last step.
  let recheckTimer = null;
  function recheckWatched(step) {
    recheckTimer = null;
    if (document.hidden) {
      return;
    }
    const now = Date.now();
    const sizeBefore = watch.size;
    for (const [id, w] of watch) {
      if (now - w.t0 > WATCH_MAX_AGE_MS || knownPostCount(id) > w.n0) {
        watch.delete(id);
        continue;
      }
      refreshTweetStatus(id);
      if (step >= RECHECK_DELAYS_MS.length) {
        watch.delete(id);
      }
    }
    if (watch.size !== sizeBefore) {
      saveWatch();
    }
    if (watch.size) {
      recheckTimer = setTimeout(() => recheckWatched(step + 1), RECHECK_DELAYS_MS[step]);
    }
  }

  let lastReturnAt = 0;
  function onReturn() {
    const now = Date.now();
    // A bfcache restore fires both pageshow and visibilitychange.
    if (recheckTimer && now - lastReturnAt < 500) {
      return;
    }
    lastReturnAt = now;
    clearTimeout(recheckTimer);
    recheckWatched(0);
  }

  // -------------- Like-button refresh trigger --------------

  // Clicking Like (or Unlike) on a tweet re-queries it. On by default; set the stored value
  // likeRecheck to false to turn it off.
  function handleLikeClick(ev) {
    if (!LIKE_RECHECK) {
      return;
    }
    const target = ev.target;
    if (!target || !target.closest) {
      return;
    }
    const likeBtn = target.closest('[data-testid="like"], [data-testid="unlike"]');
    if (!likeBtn) {
      return;
    }
    const article = likeBtn.closest('article');
    if (!article) {
      return;
    }
    // Prefer cached tweetId; fall back to live extraction so the refresh
    // works even if the article was just mounted (e.g. right after SPA
    // navigation to a single-tweet page) and hasn't been scanned yet.
    let tweetId = article.dataset.xdsuTweetId;
    if (!tweetId) {
      const info = getTweetInfo(article);
      if (info) {
        tweetId = info.tweetId;
      }
    }
    if (!tweetId) {
      return;
    }
    refreshTweetStatus(tweetId);
  }

  // Capture phase so we run before any Twitter handler that may
  // stopPropagation on the bubble. Also catches both pre-like and
  // post-like states since the testid toggles after the click.
  document.addEventListener('click', handleLikeClick, true);

  // -------------- F6: MutationObserver + polling fallback --------------

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) {
      return;
    }
    scanTimer = setTimeout(() => {
      scanTimer = null;
      tick();
    }, SCAN_DEBOUNCE_MS);
  }

  function tick() {
    if (document.hidden) {
      return;
    }
    try {
      scanTweets();
      applyColors();
    } catch (e) {
      console.error('[XDSU] tick error', e);
    }
  }

  function startObserver() {
    if (!document.body) {
      setTimeout(startObserver, 50);
      return;
    }
    const observer = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        if (mut.addedNodes.length > 0) {
          scheduleScan();
          return;
        }
      }
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  // Slow polling fallback catches img.src lazy-loads (attribute changes which
  // we deliberately don't observe globally for perf reasons) and other state
  // that doesn't manifest as a DOM addition.
  setInterval(scheduleScan, POLL_INTERVAL_MS);

  // Every visibility change cancels the pending re-check; becoming visible re-scans and
  // starts a new round of re-checks.
  document.addEventListener('visibilitychange', () => {
    clearTimeout(recheckTimer);
    recheckTimer = null;
    if (!document.hidden) {
      scheduleScan();
      onReturn();
    }
  });
  window.addEventListener('pageshow', (ev) => {
    if (ev.persisted) {
      onReturn();
    }
  });

  startObserver();
  scheduleScan(); // initial
})();
