// ==UserScript==
// @name         X (Twitter) Danbooru Search and Upload
// @namespace    https://github.com/AkaringoP
// @description  Show Danbooru-presence bars under tweet images on x.com and add a one-click Danbooru upload button. Mobile-friendly (Firefox + Tampermonkey).
// @author       AkaringoP
// @license      MIT
// @match        *://x.com/*
// @match        *://twitter.com/*
// @match        *://mobile.twitter.com/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/XSearchAndUpload/XSearchAndUpload.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/XSearchAndUpload/XSearchAndUpload.user.js
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      danbooru.donmai.us
// @connect      donmai.us
// @noframes
// @version      2.0.0
// ==/UserScript==

/* Lookups also work logged out, but then a search allows only 2 terms, so they
 * take more requests. */
/* Search term limits: logged out 2, Member 3, Gold+ unlimited. The script reads
 * yours from /profile.json. */

(function() {
  'use strict';

  /**
   * @const {string} Logged at start-up. Must mirror the @version line in the
   * header above, which is what the userscript manager reads for updates.
   */
  const VERSION = '2.0.0';
  console.log(`[XDSU] v${VERSION} loaded`);

  // -------------- config --------------

  const DEFAULT_BOORU_URL = 'https://danbooru.donmai.us';

  /**
   * Normalizes a Danbooru URL setting.
   * @param {*} v The stored or typed value.
   * @return {?string} "https://host[/path]" without a trailing slash, or null
   *     if the value is not a usable URL.
   */
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
    if (u.hostname !== 'localhost' &&
        !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname)) {
      return null;
    }
    return (u.origin + u.pathname).replace(/\/+$/, '');
  }

  const storedBooru =
      normalizeBooruUrl(GM_getValue('booru', DEFAULT_BOORU_URL));
  const DANBOORU_URL = (storedBooru || DEFAULT_BOORU_URL) + '/';
  // danbooru/public/logos/danbooru-logo.png (128x128).
  const DANBOORU_ICON_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAYAAADDPmHLAAAACXBIWXMAAAsTAAALEwEAmpwYAAAFCklEQVR4nO2cP27UQBTGvyCkKKJAdJSU9BTcAOqcgxR0HCFAhYS4ANBygUQcgDOgKBKKUqBEAgnCnyJDgTaJ1zP2s+fNvOfM9ytQdu0dO/5+73lm2Q1ACCGEEEIIIYSQVtgwPv4DAPsA7hifx3VmMOMbtc4iAsN3gJUADN8JFgIwfEfUFoDhO6OmAAzfIbUEeAjgIxi+O2osA1n5tgxmfLPwwcXh39raxO7ONu7fu1v4lJbH5y9f8ez1B/w4+6M+dslbAMNXoGT4QDkBGL4CpcMHygjA8BWoET6gLwDDV6BW+ICuAAxfgSnh39razD6elgAMX4Gp4e/ubGcfU0MAhq/AnPA1rmOuAAxfAavwgTwBGL4CluED8wVg+ApYhw/ME4DhK+AhfGC6AAxfAS/hA9MEYPgKeAofkAvA8BXwFj4gE4DhK+AxfED2gZBvAG6XPhHyn6nhP3ryamyX7O8FMPxKWHRQyy+GkCtY3T4pgAMs504UwBjriTMFMMZ61UQBjLFeMlOAxsn+XsDem6ca53FtEazTTWEHaBwK0DgUoHEoQONQgMahAI1DARqHAjQOBWgcCtA4FKBxKEDjUIDGoQCNU/rPxJFMQvcfdSiAMSGkg+3nri8BBVAizKzSmACh90N0q4oOFCCBtPXmVulVcXqvTAwVFDtBUwJIqjRefQNVGt0sD2jVAXqhRoYYOYtZLFoA7Sqd1XqTVTp+XgBw3rkFhOSYZaaADgWQ3ksloY4Hldl6B8OX0Z8DhM4Ag2MpWFFcgElVGv9hZL/o1vlVOlp96XTm5NET4KIJCEbzIIDGMkYSatkqndF6Q0K2iXSuX+80Bq6t0j2hiADSCZJ08jx9gjSjSkNyhIGD5c/Hr16/eKiR66s4IVAQAFBZxkhDLVWlIXlm0YOJRpZ08RAEd8i16+tLAPkypv90PNTBm8rkCZIsVGn9a1fpeegdPDF6ugByyBYgexkzufUK227nug5X6cjM5PKZAlUaRgTo3yZ1DSgwByhXpd3xFKp0eBh0QhVPyscruvOac6l+mG6XAH0BLoKSXTHpXVqn9U6rUmnrzanS9fc90p1y/aGOBLoCTJwgJWqy/0yJUEX7rR6Uq9LOKkA2cRIXjQRVAfQmSPLWO6tKB06iv198i+RXlVTpxSogPcjwMTNREeA6VGl2603nNsh59Ly7qZcIfoXOKkB0u69Rpd0HsoY0UKfJ6ou8YvzXix8i2Q5D8fABrVuAwgRJ0nrLVWk60PRxdap06K30GuQLkLmM8VWlU0OtU6UlUX0r+OK56I7rD2VtI2+C1N9BEqpxUVZFdxWg2HpZpXXQWwVcPhPZKbkFrFJblP8vYMWcCRJDtaDgB0LYepdA0U8EEf/wu4GNQwEahwI0DgVoHArQOBSgcShA41CAxqEAjUMBGocCLJiDo5PsMSjAQjk8PsXL9/vZ41CABXJ4fIrnb/fw89ff7LHc/YUQMszB0QlevNvH2W9R+N/HdmAHWBCrtj8h/MdjO1GAhTCx7a/C/zS2IwVYAKXCByiAe0qGD1AA15QOH6AAbqkRPkABXFIrfIACuKNm+AAFcEXt8AEK4AaL8AEK4AKr8AEKYI5l+AAFMMcyfIACmGMZPkABlkCx8AEK4J2i4QPAhmAffv/bhuLhA+wAXqkSPkABPFItfIACeKNq+AAF8ET18AEK4AWT8AEK4AGz8AEKYI1p+IQQQgghhBBCCGmLfxrmmkuV3GutAAAAAElFTkSuQmCC';

  GM_registerMenuCommand(`Danbooru URL (${new URL(DANBOORU_URL).host})`, () => {
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

  // Tapping Like (or Unlike) re-checks the tweet. Read on every Like, so the
  // menu toggle applies at once.
  let likeRecheck = GM_getValue('likeRecheck', true);
  const LIKE_MENU_ID = 'xdsu-like-recheck';
  const likeMenuLabel = () => `Like = re-check: ${likeRecheck ? 'on' : 'off'}`;
  /** Flips the Like trigger, stores it and confirms with a toast. */
  function toggleLikeRecheck() {
    likeRecheck = !likeRecheck;
    GM_setValue('likeRecheck', likeRecheck);
    // A manager that supports ids returns the given one and replaces the entry
    // in place; re-registering elsewhere would add a second entry.
    if (likeMenuRelabels) {
      GM_registerMenuCommand(
          likeMenuLabel(), toggleLikeRecheck, {id: LIKE_MENU_ID});
    }
    showToast(likeRecheck ? 'Like now re-checks the tweet' :
                            'Like no longer re-checks the tweet');
  }
  const likeMenuRelabels =
      GM_registerMenuCommand(
          likeMenuLabel(), toggleLikeRecheck, {id: LIKE_MENU_ID}) ===
      LIKE_MENU_ID;

  GM_registerMenuCommand('XDSU legend', () => {
    alert([
      'Bar under each image:',
      'Solid green: on Danbooru (tap to open)',
      'Green stripes: the tweet is only partly on Danbooru (tap to open)',
      'Red outline: not on Danbooru (tap to check again)',
      'Blue dashes: lookup failed (tap to retry)',
      'Thin grey line: checking',
    ].join('\n'));
  });

  const POLL_INTERVAL_MS = 2000;
  const SCAN_DEBOUNCE_MS = 100;
  const FLUSH_DEBOUNCE_MS = 250;
  // How often a scroll checks whether queued lookups came into range.
  const SCROLL_CHECK_MS = 200;
  // Each ~source:*...* in a lookup is one search term (status:any is free). The
  // batch size is the account's tag_query_limit from /profile.json (logged out
  // 2, Member 3, Gold+ unlimited), capped at MAX_QUERY_BATCH. The last detected
  // value is stored for when the check fails.
  const MAX_QUERY_BATCH = 6;
  const BATCH_STORE_KEY = 'detectedBatch';
  // The result of the last successful account check, shared by every X tab, so
  // that a tab that starts or comes back soon after needs no check of its own.
  const ACCOUNT_STORE_KEY = 'accountCheck';
  const PROFILE_TIMEOUT_MS = 5000;
  // An account check older than this is repeated on a return to the tab, and a
  // stored one is not taken over by another tab.
  const PROFILE_MAX_AGE_MS = 10 * 60 * 1000;
  // The server itself may take ~11 s before it answers a slow search with a
  // 500.
  const FETCH_TIMEOUT_MS = 15000;
  // A 5xx, timeout or network error is retried once after this delay.
  const RETRY_DELAY_MS = 1500;
  // Pause after 401/403, 429 or two failed batches in a row.
  const PAUSE_MS = 60000;
  // Delays before a failed network/server lookup is tried again, by number of
  // failures.
  const ERROR_BACKOFF_MS = [30000, 120000, 600000];
  const ARTICLE_SELECTOR =
      'article[data-testid="tweet"], article[tabindex="-1"]';
  const LIKE_SELECTOR = '[data-testid="like"], [data-testid="unlike"]';
  const TWEET_PATH_RE = /^\/(?:i\/web|([^/]+))\/status(?:es)?\/(\d+)/;
  // A per-image upload needs a ref that names the user; otherwise Danbooru may
  // not find the tweet.
  const UPLOAD_REF_RE = /^https:\/\/x\.com\/(?!i\/)[^/]+\/status\/\d+$/;
  const UPLOAD_LOCK_MS = 1500;
  // Tiles lower than this keep the small button so it does not cover the photo
  // link.
  const SMALL_TILE_PX = 120;
  // A tweet opened for upload is watched until its post count rises, for at
  // most WATCH_MAX_AGE_MS, and for at most WATCH_MAX_CHECKS lookups started by
  // the re-checks.
  const WATCH_MAX_AGE_MS = 30 * 60 * 1000;
  const WATCH_MAX_CHECKS = 12;
  // Delays between the re-checks that follow a return to the tab.
  const RECHECK_DELAYS_MS = [5000, 15000, 40000];
  // A return noticed while the tab stayed visible (window focus, the mouse
  // entering the page) re-checks only if no re-check ran for this long. A focus
  // likewise retries failed lookups and lifts a queue pause only if no return
  // did so for this long. Focus changes and the mouse crossing the window edge
  // are frequent on a desktop.
  const RETURN_GAP_MS = 15000;
  // Bottom offset of the toast, above X's bottom navigation. Raise it while
  // another fixed control uses the same corner.
  const TOAST_BOTTOM = 'calc(64px + env(safe-area-inset-bottom))';
  // The photo viewer's pill sits in the same corner; while it is shown the
  // toast moves up to toastBottom (pill bottom + 44px pill + 8px gap).
  const PILL_POS = {
    left: '12px',
    bottom: 'calc(64px + env(safe-area-inset-bottom))',
    toastBottom: 'calc(116px + env(safe-area-inset-bottom))',
  };
  // Swiping in the viewer changes only the URL; it is checked this often while
  // the pill is shown.
  const PILL_URL_CHECK_MS = 150;
  const VIEWER_PATH_RE = /\/status(?:es)?\/\d+\/photo\/(\d+)\/?$/;

  // -------------- styles --------------

  // One palette for every X theme: each colour is at least 3:1 against white,
  // #15202b and black. Each state also has its own shape, so the bar reads
  // without colour.
  GM_addStyle(`
    :root {
      --xdsu-found: #1a8c1a;
      --xdsu-missing: #e53935;
      --xdsu-error: #5b6cff;
      --xdsu-searching: #767676;
    }
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
      position: relative;
      display: block;
      flex: 1 1 0;
      min-width: 0;
      height: 100%;
      box-sizing: border-box;
      border-radius: 3px;
      pointer-events: auto;
      cursor: pointer;
    }
    /* The tap area fills the bar's margins and the gaps between segments. */
    .xdsu-bar-seg::after {
      content: '';
      position: absolute;
      top: -6px;
      bottom: -4px;
      left: -1.5px;
      right: -1.5px;
    }
    .xdsu-bar-seg[data-state="found"] {
      background: var(--xdsu-found);
    }
    .xdsu-bar-seg[data-state="foundWeak"] {
      background: repeating-linear-gradient(
        135deg, var(--xdsu-found) 0 3px, transparent 3px 6px);
    }
    .xdsu-bar-seg[data-state="missing"] {
      background: transparent;
      box-shadow: inset 0 0 0 2px var(--xdsu-missing);
    }
    .xdsu-bar-seg[data-state="error"] {
      background: repeating-linear-gradient(
        90deg, var(--xdsu-error) 0 4px, transparent 4px 10px);
    }
    .xdsu-bar-seg[data-state="searching"] {
      background: linear-gradient(var(--xdsu-searching), var(--xdsu-searching))
        center / 100% 2px no-repeat;
    }
    .xdsu-bar-seg[data-state="searching"],
    .xdsu-bar-seg.xdsu-rechecking {
      animation: xdsu-pulse 0.8s ease-in-out infinite alternate;
    }
    @keyframes xdsu-pulse {
      from { opacity: 1; }
      to { opacity: 0.35; }
    }
    @media (prefers-reduced-motion: reduce) {
      .xdsu-bar-seg[data-state="searching"],
      .xdsu-bar-seg.xdsu-rechecking {
        animation: none;
      }
      .xdsu-bar-seg.xdsu-rechecking {
        opacity: 0.6;
      }
    }
    /* Padding, not margin: a margin can collapse into the action row's and
       let the tap area overlap the Like button. */
    @media (pointer: coarse) {
      .xdsu-bar {
        height: 24px;
        margin: 0;
        padding: 9px 0 7px;
      }
      .xdsu-bar-seg::after {
        top: -9px;
        bottom: -7px;
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
    .xdsu-upload-btn.xdsu-found { box-shadow: 0 0 0 2px var(--xdsu-found); }
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
    .xdsu-toast {
      position: fixed;
      left: 12px;
      bottom: ${TOAST_BOTTOM};
      max-width: calc(100vw - 100px);
      min-height: 44px;
      box-sizing: border-box;
      display: none;
      align-items: center;
      padding: 8px 14px;
      border-radius: 8px;
      background: rgba(15, 20, 25, 0.92);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
      color: white !important;
      font: 14px/1.35 system-ui, sans-serif;
      text-decoration: none !important;
      z-index: 2147483000;
      pointer-events: none;
    }
    .xdsu-toast.xdsu-show { display: flex; }
    .xdsu-toast.xdsu-action {
      pointer-events: auto;
      cursor: pointer;
      text-decoration: underline !important;
    }
    .xdsu-toast.xdsu-above-pill { bottom: ${PILL_POS.toastBottom}; }
    /* Photo viewer: an icon button like the tile's. Border style and colour
       follow the bar (solid found, dashed partly posted, red missing, blue
       dashes failed, grey dots checking); title and aria-label name the state.
       The background stops inside the border, so the gaps of a dashed or dotted
       border show the photo; the light ring separates it from dark photos. */
    .xdsu-pill {
      position: fixed;
      left: ${PILL_POS.left};
      bottom: ${PILL_POS.bottom};
      display: grid;
      place-items: center;
      width: 44px;
      height: 44px;
      padding: 0;
      box-sizing: border-box;
      border: 2px dotted var(--xdsu-searching);
      border-radius: 4px;
      background: rgba(0,0,0,0.55);
      background-clip: padding-box;
      box-shadow: 0 0 0 1px rgba(255,255,255,0.35);
      color: white !important;
      font-size: 22px;
      line-height: 1;
      text-decoration: none !important;
      z-index: 2147483000;
      cursor: pointer;
      touch-action: manipulation;
      user-select: none;
    }
    .xdsu-pill img {
      width: 24px;
      height: 24px;
      display: block;
      border: none;
    }
    .xdsu-pill:active { transform: scale(0.92); }
    .xdsu-pill[data-state="found"] { border: 2px solid var(--xdsu-found); }
    .xdsu-pill[data-state="foundWeak"] { border: 2px dashed var(--xdsu-found); }
    .xdsu-pill[data-state="missing"] { border: 2px solid var(--xdsu-missing); }
    .xdsu-pill[data-state="error"] { border: 2px dashed var(--xdsu-error); }
    .xdsu-pill[data-state="searching"] { cursor: default; }
    .xdsu-pill.xdsu-rechecking { opacity: 0.7; }
  `);

  // -------------- helpers --------------

  /**
   * GM_xmlhttpRequest as a promise; rejects on error, timeout and abort.
   * @param {string} url
   * @param {!Object=} params Extra request details.
   * @return {!Promise<!Object>} The response object.
   */
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

  /**
   * @param {?string} src An image URL.
   * @return {?string} The media hash of a pbs.twimg.com/media URL, or null.
   */
  function parseTwitterImageHash(src) {
    const m = src && src.match(/pbs\.twimg\.com\/media\/([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  /**
   * Reads what a post's source says about its tweet.
   * @param {?string} source
   * @return {{tweetId: (string|undefined), photoIndex: (number|undefined),
   *     imageHash: (string|undefined)}}
   */
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

  /**
   * @param {string} sourceUrl The URL to upload (a tweet or an image).
   * @param {string=} ref The page the image belongs to.
   * @return {string} The Danbooru upload page URL.
   */
  function buildUploadUrl(sourceUrl, ref) {
    const u = new URL('uploads/new', DANBOORU_URL);
    u.searchParams.set('url', sourceUrl);
    if (ref) {
      u.searchParams.set('ref', ref);
    }
    return u.href;
  }

  /**
   * Marks the lookups of a failed batch as errors. Keys whose entry was dropped
   * or replaced while the request ran (e.g. by a like refresh) are skipped;
   * tries and at drive the retry back-off (see retryFailed).
   * @param {!Object<string, !CacheEntry>} cache
   * @param {!Array<string>} keys
   * @param {!Array<(!CacheEntry|undefined)>} entries cache[keys[i]] as it was
   *     when the batch started.
   * @param {string} reason
   */
  function setKeysError(cache, keys, entries, reason) {
    const now = Date.now();
    keys.forEach((k, i) => {
      const e = entries[i];
      if (e && cache[k] === e) {
        e.state = 'error';
        e.reason = reason;
        e.at = now;
        e.tries = (e.tries || 0) + 1;
      }
    });
  }

  /**
   * Removes everything the script added to an article.
   * @param {!Element} article
   */
  function clearArticleMarkers(article) {
    delete article.dataset.xdsuTweetId;
    delete article.dataset.xdsuTweetUrl;
    delete article.dataset.xdsuDone;
    article.querySelectorAll('.xdsu-upload-btn, .xdsu-bar').forEach((el) => {
      el.remove();
    });
  }

  /**
   * @param {?string} pathname A URL path such as /user/status/1/photo/1.
   * @return {?TweetInfo} The tweet it names, with suffixes like /photo/1
   *     dropped from the URL, or null.
   */
  function parseStatusPath(pathname) {
    const m = (pathname || '').match(TWEET_PATH_RE);
    if (!m) {
      return null;
    }
    return {
      tweetId: m[2],
      tweetUrl: `https://x.com/${m[1] || 'i/web'}/status/${m[2]}`,
    };
  }

  /**
   * Reads the tweet's own permalink, never the one of a quoted tweet
   * (div[role="link"]). Only the focal tweet of a detail page
   * (article[tabindex="-1"]) falls back to the page URL.
   * @param {!Element} article
   * @return {?TweetInfo}
   */
  function extractTweetInfo(article) {
    const outsideQuote = (el) => !el.closest('div[role="link"]');
    const time = [...article.querySelectorAll('time')].find(outsideQuote);
    const links = [...article.querySelectorAll('a[href*="/status/"]')];
    const link = (time && time.closest('a[href*="/status/"]')) ||
        links.find(outsideQuote);
    if (link) {
      return parseStatusPath(link.pathname);
    }
    if (article.matches('article[tabindex="-1"]')) {
      return parseStatusPath(location.pathname);
    }
    return null;
  }

  /**
   * @param {!Element} article
   * @return {boolean} True when the image hash of a tracked segment no longer
   *     matches any image in the article, i.e. it now shows different content.
   */
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

  /**
   * Identifies an article's tweet, cached on the article. The cache is kept
   * while the live permalink still names the cached tweet (or, without a
   * permalink, while the media is unchanged); otherwise the article was
   * recycled and all related markers are cleared.
   * @param {!Element} article
   * @return {?TweetInfo}
   */
  function getTweetInfo(article) {
    const cached = article.dataset.xdsuTweetId;
    const fresh = extractTweetInfo(article);
    if (cached) {
      if (fresh ? fresh.tweetId === cached : !mediaChanged(article)) {
        return {
          tweetId: cached,
          tweetUrl: article.dataset.xdsuTweetUrl ||
              `https://x.com/i/web/status/${cached}`,
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

  /**
   * @param {!Element} article
   * @return {!Array<!Element>} The tweet's own media tiles, without those of a
   *     quoted tweet or behind an interstitial.
   */
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

  /**
   * @param {!Element} photoEl A media tile.
   * @return {?HTMLImageElement} Its pbs.twimg.com/media image, or null.
   */
  function findTweetImage(photoEl) {
    const imgs = photoEl.querySelectorAll('img');
    for (const img of imgs) {
      if (img.src && img.src.indexOf('pbs.twimg.com/media') >= 0) {
        return img;
      }
    }
    return null;
  }

  // -------------- toast --------------

  // Phones have no console or tooltips, so problems are reported here.
  const toastQueue = [];
  const toastReasons = new Set();
  let toastEl = null;
  // Whether toastQueue[0] is on screen. A toast stays queued, unshown, while
  // the tab is hidden.
  let toastShown = false;

  /**
   * Shows a short message in the bottom-left corner. A toast with a url opens
   * it when tapped and stays 8 s; any other toast lets taps through to the page
   * and stays 4 s. Toasts show one after another, and only while the tab is
   * visible: one that comes while it is hidden waits for the return.
   * @param {string} text
   * @param {{reason: (?string|undefined), url: (?string|undefined)}=} options
   *     A toast with a reason (an automatic one) shows at most once per
   *     session; one without always shows.
   */
  function showToast(text, {reason = null, url = null} = {}) {
    if (reason) {
      if (toastReasons.has(reason)) {
        return;
      }
      toastReasons.add(reason);
    }
    toastQueue.push({text, url});
    showNextToast();
  }

  /**
   * Shows the first queued toast, then the next one when it ends. Does nothing
   * while a toast is on screen or the tab is hidden; becoming visible calls it
   * again.
   */
  function showNextToast() {
    const t = toastQueue[0];
    if (!t || toastShown || document.hidden) {
      return;
    }
    if (!toastEl) {
      toastEl = document.createElement('a');
      toastEl.className = 'xdsu-toast';
      toastEl.setAttribute('aria-live', 'polite');
      toastEl.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (!toastEl.href) {
          return;
        }
        try {
          GM_openInTab(toastEl.href, {active: true, setParent: true});
        } catch (e) {
          console.error('[XDSU] open tab failed', e);
          window.open(toastEl.href, '_blank', 'noopener');
        }
        toastEl.classList.remove('xdsu-show');
      });
      (document.body || document.documentElement).appendChild(toastEl);
    }
    toastEl.textContent = t.text;
    if (t.url) {
      toastEl.href = t.url;
      toastEl.target = '_blank';
      toastEl.rel = 'noopener';
    } else {
      toastEl.removeAttribute('href');
    }
    toastEl.classList.toggle('xdsu-action', !!t.url);
    toastEl.classList.toggle('xdsu-above-pill', !!pillEl);
    toastEl.classList.add('xdsu-show');
    toastShown = true;
    // Runs on even if the tab is hidden meanwhile.
    setTimeout(() => {
      toastEl.classList.remove('xdsu-show');
      toastQueue.shift();
      toastShown = false;
      showNextToast();
    }, t.url ? 8000 : 4000);
  }

  // -------------- state --------------

  /**
   * A Danbooru post found by a lookup.
   * @typedef {{
   *   id: number,
   *   photoIndex: (number|undefined),
   *   imageHash: (string|undefined),
   *   isDeleted: boolean,
   *   isBanned: boolean,
   * }} Post
   */

  /**
   * The result of one lookup. state is 'pending', 'done' or 'error'; an error
   * entry also has reason ('network', 'server', 'blocked', 'limit' or
   * 'client'), at (time of the last failure) and tries.
   * @typedef {{
   *   state: string,
   *   posts: !Array<!Post>,
   *   reason: (string|undefined),
   *   at: (number|undefined),
   *   tries: (number|undefined),
   * }} CacheEntry
   */

  /**
   * One media tile of a tweet. bar is its bar segment and btn its upload
   * button; for the viewer button's own ref bar is that button, btn is null
   * and photoCount is set. Video and GIF tiles have imageHash null. applied is
   * the last state applyColors wrote; openedAt is when a tap last opened the
   * post.
   * @typedef {{
   *   tweetId: string,
   *   imageHash: ?string,
   *   photoIndex: number,
   *   bar: !Element,
   *   btn: ?Element,
   *   rechecking: boolean,
   *   applied: ?string,
   *   openedAt: number,
   *   photoCount: (number|undefined),
   * }} ImageRef
   */

  /** @typedef {{tweetId: string, tweetUrl: string}} TweetInfo */

  /** @const {!Object<string, !CacheEntry>} Lookup results by tweet id. */
  const tweetCache = Object.create(null);
  /**
   * @const {!Object<string, !CacheEntry>} Lookup results by media hash, the
   * fallback for tweets that returned no posts.
   */
  const hashCache = Object.create(null);

  /** @const {!Array<string>} Tweet ids waiting for a lookup. */
  const pendingTweetIds = [];
  /** @const {!Array<string>} Media hashes waiting for a lookup. */
  const pendingHashes = [];

  /** @const {!Array<!ImageRef>} Every tracked tile. */
  const imageRefs = [];

  /**
   * Reads the stored watch list, which every X tab shares.
   * @return {!Array<!Array<?>>} The [tweetId, {t0, n0}] pairs that are well
   *     formed and not older than WATCH_MAX_AGE_MS.
   */
  function readStoredWatch() {
    try {
      const saved = JSON.parse(GM_getValue('watch', '[]'));
      return (Array.isArray(saved) ? saved : []).filter(
          (e) => Array.isArray(e) && e[1] && Number.isFinite(e[1].t0) &&
              Number.isFinite(e[1].n0) &&
              Date.now() - e[1].t0 <= WATCH_MAX_AGE_MS);
    } catch {
      return [];
    }
  }

  /**
   * Reads the stored watch list, applies one change and writes it back, so the
   * entries other tabs stored meanwhile are kept. Expired and malformed entries
   * are dropped on the way.
   * @param {function(!Map<string, {t0: number, n0: number}>)} change Changes
   *     the stored entries in place.
   */
  function updateStoredWatch(change) {
    const stored = new Map(readStoredWatch());
    change(stored);
    GM_setValue('watch', JSON.stringify([...stored]));
  }

  // Tweets opened for upload: tweetId -> {t0, n0, checks}, n0 = posts known
  // when the upload was opened, checks = lookups the re-checks started for it.
  // {t0, n0} is stored too, so that the list survives the browser discarding
  // and reloading the X tab; checks is kept in this tab only. This map is this
  // tab's own view: it starts from the stored list and changes only through
  // this tab, which writes each change to the store entry by entry.
  const watch = new Map(readStoredWatch().map(
      ([id, w]) => [id, {t0: w.t0, n0: w.n0, checks: 0}]));
  // Prunes the expired entries from the store, whichever tab wrote them.
  updateStoredWatch(() => {});

  // -------------- DOM scan --------------

  /** Processes every tweet article and drops the refs of removed segments. */
  function scanTweets() {
    const articles = document.querySelectorAll(ARTICLE_SELECTOR);
    for (const article of articles) {
      try {
        processArticle(article);
      } catch (e) {
        console.error('[XDSU] article scan failed', e);
      }
    }
    // Prune disconnected segment refs. Clear their markers too, so the same
    // element is tracked again if it is re-attached later.
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

  /**
   * Adds the bar and the upload buttons to one tweet and tracks its tiles.
   * @param {!Element} article
   */
  function processArticle(article) {
    const info = getTweetInfo(article);
    if (!info) {
      return;
    }
    const photos = findPhotos(article);
    // Short-circuit articles already fully processed for this tweet, as long as
    // a re-render left the bar before the Like group, one segment per tile and
    // every button in place.
    const prevBar = article.querySelector('.xdsu-bar');
    const next = prevBar && prevBar.nextElementSibling;
    if (article.dataset.xdsuDone === info.tweetId && next &&
        prevBar.children.length === photos.length &&
        next.querySelector(LIKE_SELECTOR) &&
        photos.every((p) => p.querySelector(':scope > .xdsu-upload-btn'))) {
      return;
    }
    if (photos.length === 0) {
      return;
    }
    const bar = ensureTweetBar(article, info.tweetId, photos.length);
    const numbers = photoNumbers(photos);
    let allTracked = true;
    photos.forEach((photoEl, idx) => {
      const tracked = processPhoto(photoEl, info, numbers[idx], bar);
      if (!tracked) {
        allTracked = false;
      }
    });
    if (allTracked) {
      article.dataset.xdsuDone = info.tweetId;
    }
  }

  /**
   * Photo numbers (1-based) of a tweet's tiles, read from their /photo/N links
   * because a 4-image grid may be laid out column by column. Tiles without a
   * link take the lowest free numbers. Duplicate numbers fall back to DOM order
   * for the whole tweet.
   * @param {!Array<!Element>} photos
   * @return {!Array<number>}
   */
  function photoNumbers(photos) {
    const n = photos.length;
    const nums = photos.map((el) => {
      const a = el.closest('a[href*="/photo/"]');
      const m = a && a.getAttribute('href').match(/\/photo\/(\d+)/);
      const v = m ? parseInt(m[1], 10) : 0;
      return v >= 1 && v <= n ? v : 0;
    });
    const linked = nums.filter(Boolean);
    const used = new Set(linked);
    if (used.size !== linked.length) {
      return photos.map((_, i) => i + 1);
    }
    let next = 1;
    return nums.map((v) => {
      if (v) {
        return v;
      }
      while (used.has(next)) {
        next++;
      }
      used.add(next);
      return next;
    });
  }

  /**
   * Creates or repairs the tweet's bar: a flex row right above the action group
   * with one segment per tile.
   * @param {!Element} article
   * @param {string} tweetId
   * @param {number} photoCount
   * @return {?Element} The bar, or null while the action row is missing.
   */
  function ensureTweetBar(article, tweetId, photoCount) {
    let actionGroup = null;

    // Strategy 1: any [role="group"] that contains the like button.
    // On the timeline there is one group (the action bar) and it
    // contains Like. On the tweet detail page there are two groups
    // (engagement stats + action bar) and only the action bar contains
    // Like, so this picks the right one in both layouts.
    const groups = article.querySelectorAll('[role="group"]');
    for (const g of groups) {
      if (g.querySelector(LIKE_SELECTOR)) {
        actionGroup = g;
        break;
      }
    }
    // Strategy 2: first [role="group"] (covers the brief window before
    // the Like button is rendered; the bar moves once it is).
    if (!actionGroup && groups.length > 0) {
      actionGroup = groups[0];
    }
    // Strategy 3: walk up from the Like button until we find a
    // container that also holds Reply or Retweet -- i.e., the action
    // row -- in case Twitter dropped role="group" from it entirely.
    if (!actionGroup) {
      const likeBtn = article.querySelector(LIKE_SELECTOR);
      if (likeBtn) {
        let walk = likeBtn.parentElement;
        for (let i = 0; i < 6 && walk && walk !== article; i++) {
          const others = '[data-testid="reply"], [data-testid="retweet"]';
          if (walk.querySelector(others)) {
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
    } else if (bar.nextElementSibling !== actionGroup) {
      // Placed before the Like group existed, or moved by a re-render.
      actionGroup.parentNode.insertBefore(bar, actionGroup);
    }
    // A segment stays the same <a> for its whole life; applyColors only toggles
    // its href, so imageRefs keeps tracking it.
    while (bar.children.length < photoCount) {
      const seg = document.createElement('a');
      seg.className = 'xdsu-bar-seg';
      seg.dataset.state = 'searching';
      seg.title = 'Checking';
      seg.setAttribute('aria-label', 'Checking');
      seg.addEventListener('click', onSegmentClick);
      seg.addEventListener('auxclick', onSegmentClick);
      // Keeps x.com's tweet link from reacting to the press.
      seg.addEventListener('mousedown', (ev) => ev.stopPropagation());
      bar.appendChild(seg);
    }
    // Trim excess (e.g. if the tweet was edited to fewer images).
    while (bar.children.length > photoCount) {
      bar.lastChild.remove();
    }
    return bar;
  }

  /**
   * Attaches the upload button to a tile and starts tracking its segment.
   * @param {!Element} photoEl
   * @param {!TweetInfo} info
   * @param {number} photoIndex 1-based photo number.
   * @param {?Element} bar
   * @return {boolean} True if the tile is fully tracked (won't need
   *     re-processing).
   */
  function processPhoto(photoEl, info, photoIndex, bar) {
    // Upload button: only needs tweet URL, attach immediately (again after a
    // re-render removed it).
    let btn = photoEl.querySelector(':scope > .xdsu-upload-btn');
    const newBtn = !btn;
    if (newBtn) {
      const cs = window.getComputedStyle(photoEl);
      if (!cs.position || cs.position === 'static') {
        photoEl.style.position = 'relative';
      }
      btn = attachUploadBtn(photoEl, info);
    }
    if (!bar) {
      return false;
    }
    const segment = bar.children[photoIndex - 1];
    if (!segment) {
      return false;
    }
    if (segment.dataset.tracked) {
      // A restored button takes the segment's state at the next applyColors.
      const ref = newBtn && imageRefs.find((r) => r.bar === segment);
      if (ref) {
        ref.btn = btn;
        ref.applied = null;
      }
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
    const ref = {
      tweetId: info.tweetId,
      imageHash,
      photoIndex,
      bar: segment,
      btn,
      rechecking: false,
      applied: null,
      openedAt: 0,
    };
    imageRefs.push(ref);
    ensureHashLookup(ref);
    enqueueTweetIdSearch(info.tweetId);
    return true;
  }

  /**
   * @param {!Element} photoEl
   * @return {boolean} Whether the tile holds a video or GIF.
   */
  function isVideoTile(photoEl) {
    return !!photoEl.querySelector(
        'video, [data-testid="videoPlayer"], img[src*="_video_thumb/"]');
  }

  /**
   * @param {!Element} photoEl
   * @param {!TweetInfo} info
   * @return {!Element} The new upload button.
   */
  function attachUploadBtn(photoEl, info) {
    // The href (and so a long press "open in new tab") always uploads the whole
    // tweet.
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

    let lastOpenAt = 0;
    const onClick = (ev) => {
      if (ev.button !== undefined && ev.button > 1) {
        return;
      }
      // Cancel every tap, locked ones included, so none reaches the photo link
      // behind the button.
      ev.preventDefault();
      ev.stopPropagation();
      const now = Date.now();
      if (now - lastOpenAt < UPLOAD_LOCK_MS) {
        return;
      }
      lastOpenAt = now;
      btn.classList.add('xdsu-sent');
      // Read at tap time because the image src can arrive after the button.
      openUpload(
          ev, info.tweetId,
          imageUploadUrl(findTweetImage(photoEl), info.tweetUrl));
    };
    btn.addEventListener('click', onClick);
    btn.addEventListener('auxclick', onClick);
    // A long press may open the href in a new tab from the browser menu.
    btn.addEventListener('contextmenu', () => watchTweet(info.tweetId));
    // Prevent middle-click autoscroll and click bubbling to the tweet router
    // link.
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });

    photoEl.appendChild(btn);
    return btn;
  }

  /**
   * Upload URL for a tap: only this image when its original jpg/png can be
   * named exactly and the tweet URL names the user; otherwise the whole tweet.
   * @param {?HTMLImageElement} img
   * @param {string} tweetUrl
   * @return {string}
   */
  function imageUploadUrl(img, tweetUrl) {
    const hash = img ? parseTwitterImageHash(img.src) : null;
    if (!hash || !UPLOAD_REF_RE.test(tweetUrl)) {
      return buildUploadUrl(tweetUrl);
    }
    const src = new URL(img.src);
    const ext = src.pathname.match(/\.([^./]+)$/);
    const fmt = src.searchParams.get('format') || (ext && ext[1]);
    if (fmt !== 'jpg' && fmt !== 'png') {
      return buildUploadUrl(tweetUrl);
    }
    return buildUploadUrl(
        `https://pbs.twimg.com/media/${hash}?format=${fmt}&name=orig`,
        tweetUrl);
  }

  /**
   * Opens an upload tab and watches the tweet, so it is checked again on the
   * return to this tab.
   * @param {!Event} ev The tap.
   * @param {string} tweetId
   * @param {string} url
   */
  function openUpload(ev, tweetId, url) {
    watchTweet(tweetId);
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
    // Extra re-check trigger; the return to this tab (visibilitychange, window
    // focus, the mouse coming back) is the main one.
    if (tab) {
      tab.onclose = () => {
        refreshTweetStatus(tweetId);
      };
    }
  }

  // -------------- search queue --------------

  /**
   * Queues the lookup of a tweet unless one is cached or running.
   * @param {string} tweetId
   */
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

  /**
   * Falls back to a media-hash lookup for an image whose tweet has no posts.
   * @param {!ImageRef} ref
   */
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

  /**
   * Puts a failed lookup back in the queue. The cache entry stays the same
   * object, so its tries and at survive and a batch that is still running can
   * write into it.
   * @param {!Object<string, !CacheEntry>} cache
   * @param {!Array<string>} queue
   * @param {string} key
   */
  function retryEntry(cache, queue, key) {
    const e = cache[key];
    if (!e || e.state !== 'error') {
      return;
    }
    e.state = 'pending';
    if (!queue.includes(key)) {
      queue.push(key);
    }
    scheduleFlush();
  }

  /**
   * Goes over the failed lookups: one without a segment on screen is dropped (a
   * remount looks it up again). 'limit' and 'client' never retry on a timer.
   * @param {?Array<string>} reasons Reasons to retry at once; with null,
   *     network and server failures are retried once their back-off has passed.
   */
  function retryFailed(reasons) {
    const now = Date.now();
    [
      [tweetCache, pendingTweetIds, (ref, k) => ref.tweetId === k],
      [hashCache, pendingHashes, (ref, k) => ref.imageHash === k],
    ].forEach(([cache, queue, owns]) => {
      const isError = (k) => cache[k].state === 'error';
      Object.keys(cache).filter(isError).forEach((k) => {
        const e = cache[k];
        if (!imageRefs.some((ref) => owns(ref, k) && ref.bar.isConnected)) {
          delete cache[k];
          return;
        }
        const backoff =
            ERROR_BACKOFF_MS[Math.min(e.tries, ERROR_BACKOFF_MS.length) - 1];
        const transient = e.reason === 'network' || e.reason === 'server';
        const due = reasons ? reasons.includes(e.reason) :
                              transient && now - e.at >= backoff;
        if (due) {
          retryEntry(cache, queue, k);
        }
      });
    });
  }

  // The queue stops while offline or paused (pausedUntil). flushPending runs
  // only from the timer below, and a pause is lifted only through resumeQueue.
  let flushTimer = null;
  let flushRunning = false;
  let pausedUntil = 0;
  let failedBatches = 0;
  const isOffline = () => navigator.onLine === false;

  /**
   * Arms the queue timer unless it is armed, a flush is running or the browser
   * is offline.
   */
  function scheduleFlush() {
    // While offline the 'online' event wakes the queue.
    if (flushTimer || flushRunning || isOffline()) {
      return;
    }
    const wait = Math.max(FLUSH_DEBOUNCE_MS, pausedUntil - Date.now());
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
      // During a pause, wait above stretches to the end of the pause. Keys out
      // of range wait for a scroll or a scan to bring them in.
      const more = Date.now() < pausedUntil ?
          pendingTweetIds.length || pendingHashes.length :
          hasDueKeys();
      if (more) {
        scheduleFlush();
      }
    }, wait);
  }

  /**
   * Lifts a pause and runs the queue now (on 'online', on return to the tab or
   * window).
   */
  function resumeQueue() {
    pausedUntil = 0;
    // A running flush schedules the next one when it ends.
    if (flushRunning) {
      return;
    }
    clearTimeout(flushTimer);
    flushTimer = null;
    if (pendingTweetIds.length || pendingHashes.length) {
      scheduleFlush();
    }
  }

  const ownsTweet = (ref, k) => ref.tweetId === k;
  const ownsHash = (ref, k) => ref.imageHash === k;

  /**
   * @param {string} k A tweet id or media hash.
   * @param {function(!ImageRef, string): boolean} owns Whether a ref belongs to
   *     the key.
   * @return {number} Distance in px from the viewport to the key's nearest
   *     connected segment: 0 when one is on screen, Infinity when none is
   *     connected. A key is in range within one screen height.
   */
  function keyDistance(k, owns) {
    const mine = imageRefs.filter((r) => owns(r, k) && r.bar.isConnected);
    return Math.min(...mine.map((ref) => {
      const b = ref.bar.getBoundingClientRect();
      return Math.max(0, -b.bottom, b.top - window.innerHeight);
    }));
  }

  /** @return {boolean} Whether a queued key is in range of the viewport. */
  function hasDueKeys() {
    const due = (owns) => (k) => keyDistance(k, owns) <= window.innerHeight;
    return pendingTweetIds.some(due(ownsTweet)) ||
        pendingHashes.some(due(ownsHash));
  }

  /**
   * Takes up to queryBatch keys in range, nearest to the viewport first (newest
   * first among equals). Keys out of range stay queued. A key whose tweet is no
   * longer on screen is dropped from the queue and the cache, so it is looked
   * up again if the tweet comes back.
   * @param {!Array<string>} queue
   * @param {!Object<string, !CacheEntry>} cache
   * @param {function(!ImageRef, string): boolean} owns
   * @return {!Array<string>}
   */
  function takeBatch(queue, cache, owns) {
    const dist = new Map(queue.map((k) => [k, keyDistance(k, owns)]));
    const gone = (k) => dist.get(k) === Infinity;
    queue.filter(gone).forEach((k) => delete cache[k]);
    const batch = queue.filter((k) => dist.get(k) <= window.innerHeight)
        .reverse()
        .sort((a, b) => dist.get(a) - dist.get(b))
        .slice(0, queryBatch);
    const rest = queue.filter((k) => !gone(k) && !batch.includes(k));
    queue.splice(0, queue.length, ...rest);
    return batch;
  }

  /**
   * Runs the queue: tweet lookups before hash lookups. The profile check never
   * overlaps a lookup.
   * @return {!Promise<void>}
   */
  async function flushPending() {
    for (;;) {
      if (isOffline() || Date.now() < pausedUntil) {
        return;
      }
      if (profileWanted) {
        startProfileCheck();
      }
      if (profileCheck) {
        await profileCheck;
        continue;
      }
      const ids = takeBatch(pendingTweetIds, tweetCache, ownsTweet);
      if (ids.length) {
        await runTweetIdBatch(ids);
        imageRefs.filter((ref) => ref.bar.isConnected)
            .forEach(ensureHashLookup);
        applyColors();
        continue;
      }
      const hashes = takeBatch(pendingHashes, hashCache, ownsHash);
      if (!hashes.length) {
        return;
      }
      await runHashBatch(hashes);
      applyColors();
    }
  }

  /**
   * Looks up tweets by id. A TagLimitError splits the batch; the parts run in
   * this flush unless the queue stopped.
   * @param {!Array<string>} ids
   * @return {!Promise<void>}
   */
  async function runTweetIdBatch(ids) {
    const tagStr = 'status:any ' +
        ids.map((id) => `~source:*status/${id}*`).join(' ');
    const parts = await runBatch(
        ids, tweetCache, pendingTweetIds, tagStr, (info) => info.tweetId);
    for (const part of parts) {
      if (isOffline() || Date.now() < pausedUntil) {
        pendingTweetIds.unshift(...part);
      } else {
        await runTweetIdBatch(part);
      }
    }
  }

  /**
   * Looks up images by media hash; splits like runTweetIdBatch.
   * @param {!Array<string>} hashes
   * @return {!Promise<void>}
   */
  async function runHashBatch(hashes) {
    const tagStr = 'status:any ' +
        hashes.map((h) => `~source:*media/${h}*`).join(' ');
    const parts = await runBatch(
        hashes, hashCache, pendingHashes, tagStr, (info) => info.imageHash);
    for (const part of parts) {
      if (isOffline() || Date.now() < pausedUntil) {
        pendingHashes.unshift(...part);
      } else {
        await runHashBatch(part);
      }
    }
  }

  const warnedStatus = new Set();

  /**
   * Sorts a posts.json response. The reasons 'tagLimit' and 'rateLimited' are
   * handled by runBatch.
   * @param {?Object} resp Null after a network error or timeout.
   * @return {{posts: (!Array<!Object>|undefined), reason: (string|undefined),
   *     retry: (boolean|undefined), message: (string|undefined)}}
   */
  function classifyResponse(resp) {
    if (!resp || !resp.status) {
      return {reason: 'network', retry: true};
    }
    let body;
    try {
      body = JSON.parse(resp.responseText);
    } catch {
      body = null;
    }
    const s = resp.status;
    if (s >= 200 && s < 300) {
      // e.g. a maintenance page served with 200.
      return Array.isArray(body) ? {posts: body} : {reason: 'server'};
    }
    const error = body && body.error;
    const message = body && body.message;
    if (s === 422 && error === 'PostQuery::TagLimitError') {
      return {reason: 'tagLimit', message};
    }
    // Danbooru itself does not send these for a search, so it is Cloudflare or
    // a firewall.
    if (s === 401 || s === 403) {
      return {reason: 'blocked'};
    }
    if (s === 429) {
      return {reason: 'rateLimited'};
    }
    if (s >= 400 && s < 500) {
      if (!warnedStatus.has(s)) {
        warnedStatus.add(s);
        console.warn('[XDSU] lookup rejected', s, error, message);
      }
      return {reason: 'client'};
    }
    return {reason: 'server', retry: s >= 500};
  }

  /**
   * Runs one lookup and writes the result into the entries that existed when it
   * started.
   * @param {!Array<string>} keys
   * @param {!Object<string, !CacheEntry>} cache
   * @param {!Array<string>} queue The queue the keys came from.
   * @param {string} tagStr The search.
   * @param {function(!Object): (string|undefined)} keyOf The key a parsed
   *     source belongs to.
   * @return {!Promise<!Array<!Array<string>>>} The key groups to run again,
   *     non-empty only after a TagLimitError.
   */
  async function runBatch(keys, cache, queue, tagStr, keyOf) {
    const url = `${DANBOORU_URL}posts.json?limit=100` +
        `&only=id,source,is_deleted,is_banned` +
        `&tags=${encodeURIComponent(tagStr)}`;
    const entries = keys.map((k) => cache[k]);
    let res = classifyResponse(await gmFetch(url).catch(() => null));
    if (res.retry) {
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      res = classifyResponse(await gmFetch(url).catch(() => null));
    }
    const now = Date.now();
    if (res.posts) {
      failedBatches = 0;
      const bucket = Object.fromEntries(keys.map((k) => [k, []]));
      for (const post of res.posts) {
        const info = parseDanbooruSource(post.source);
        const k = keyOf(info);
        if (k && bucket[k]) {
          bucket[k].push({
            id: post.id,
            photoIndex: info.photoIndex,
            imageHash: info.imageHash,
            isDeleted: !!post.is_deleted,
            isBanned: !!post.is_banned,
          });
        }
      }
      keys.forEach((k, i) => {
        if (entries[i] && cache[k] === entries[i]) {
          entries[i].posts = bucket[k];
          entries[i].state = 'done';
        }
      });
      return [];
    }
    if (res.reason === 'tagLimit') {
      requestProfileCheck();
      if (keys.length === 1) {
        setKeysError(cache, keys, entries, 'limit');
        return [];
      }
      // "You cannot search for more than N tags at a time."
      const m = /more than (\d+) tags/.exec(res.message || '');
      const n = m ? parseInt(m[1], 10) : 0;
      const size = n >= 1 && n < keys.length ? n : Math.ceil(keys.length / 2);
      queryBatch = Math.min(queryBatch, size);
      const count = Math.ceil(keys.length / size);
      return Array.from(
          {length: count}, (_, i) => keys.slice(i * size, (i + 1) * size));
    }
    if (res.reason === 'rateLimited') {
      queue.unshift(...keys.filter((k) => !queue.includes(k)));
      pausedUntil = now + PAUSE_MS;
      return [];
    }
    setKeysError(cache, keys, entries, res.reason);
    if (res.reason === 'blocked') {
      // Everything still queued would be refused too.
      const queues =
          [[tweetCache, pendingTweetIds], [hashCache, pendingHashes]];
      queues.forEach(([c, q]) => {
        setKeysError(c, q, q.map((k) => c[k]), 'blocked');
        q.length = 0;
      });
      pausedUntil = now + PAUSE_MS;
      showToast(
          'Danbooru blocked the request – open Danbooru once',
          {reason: 'blocked'});
    } else if (res.reason !== 'client' && ++failedBatches >= 2) {
      failedBatches = 0;
      pausedUntil = now + PAUSE_MS;
    }
    return [];
  }

  // -------------- account check --------------

  // /profile.json answers 200 logged out too. Without a usable answer the last
  // detected size (or 2) stays in use. Instead of making its own check, a tab
  // may take over a recent one that another tab stored (adoptStoredAccount).
  const storedBatch = GM_getValue(BATCH_STORE_KEY, null);
  const batchStored = Number.isInteger(storedBatch) && storedBatch >= 1 &&
      storedBatch <= MAX_QUERY_BATCH;
  let queryBatch = batchStored ? storedBatch : 2;
  let profileBatch = null;
  let profileAnonymous = false;
  let profileCheckedAt = 0;
  let profileCheck = null;
  let profileWanted = false;

  const SAFE_MODE_TOAST =
      'Danbooru safe mode is on – only rating:g posts are visible';

  /**
   * A successful account check as stored under ACCOUNT_STORE_KEY (as JSON):
   * the Danbooru URL it was made for, when, the batch size it gave and what it
   * found. Nothing that identifies the account is kept.
   * @typedef {{
   *   host: string,
   *   at: number,
   *   batch: number,
   *   anonymous: boolean,
   *   safeMode: boolean,
   * }} StoredAccount
   */

  /**
   * Reads the stored account check.
   * @return {?StoredAccount} The stored check if it is well formed, was made
   *     for DANBOORU_URL, and is not in the future nor older than
   *     PROFILE_MAX_AGE_MS; otherwise null.
   */
  function readStoredAccount() {
    const raw = GM_getValue(ACCOUNT_STORE_KEY, null);
    let a;
    try {
      a = typeof raw === 'string' ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
    if (!a || typeof a !== 'object' || Array.isArray(a)) {
      return null;
    }
    const age = Date.now() - a.at;
    const ok = a.host === DANBOORU_URL &&
        Number.isInteger(a.at) &&
        age >= 0 &&
        age <= PROFILE_MAX_AGE_MS &&
        Number.isInteger(a.batch) &&
        a.batch >= 1 &&
        a.batch <= MAX_QUERY_BATCH &&
        typeof a.anonymous === 'boolean' &&
        typeof a.safeMode === 'boolean';
    return ok ? a : null;
  }

  /**
   * Takes over the stored account check (at start-up and when the tab becomes
   * visible) if it is recent, found the account logged in with safe mode off,
   * and is newer than this tab's own check, as if this tab had made it: its age
   * counts from when it was made and its batch size applies. A check that found
   * anything else is not taken over, since another tab may have logged in or
   * switched safe mode off since; so stored data never raises a toast.
   * detectedBatch is left to the tab that made the check.
   * @return {boolean} Whether a stored check was taken over.
   */
  function adoptStoredAccount() {
    const a = readStoredAccount();
    if (!a || a.anonymous || a.safeMode || a.at <= profileCheckedAt) {
      return false;
    }
    profileCheckedAt = a.at;
    profileAnonymous = false;
    if (a.batch !== profileBatch) {
      profileBatch = a.batch;
      queryBatch = a.batch;
      retryFailed(['limit']);
    }
    return true;
  }

  /**
   * Reads the account's search term limit and safe-mode setting from
   * /profile.json, sets the batch size and stores the result for the other tabs
   * (ACCOUNT_STORE_KEY).
   * @return {!Promise<void>}
   */
  async function checkProfile() {
    let p = null;
    try {
      const resp = await gmFetch(
          `${DANBOORU_URL}profile.json`, {timeout: PROFILE_TIMEOUT_MS});
      const ok = resp.status >= 200 && resp.status < 300;
      p = ok ? JSON.parse(resp.responseText) : null;
    } catch {
      p = null;
    }
    if (!p || typeof p !== 'object' || !('tag_query_limit' in p)) {
      return;
    }
    // null means unlimited.
    const limit = p.tag_query_limit ?? MAX_QUERY_BATCH;
    if (!Number.isFinite(limit)) {
      return;
    }
    profileCheckedAt = Date.now();
    profileAnonymous = p.id === null || p.id === undefined;
    const batch = Math.max(1, Math.min(Math.floor(limit), MAX_QUERY_BATCH));
    if (batch !== profileBatch) {
      profileBatch = batch;
      queryBatch = batch;
      GM_setValue(BATCH_STORE_KEY, batch);
      retryFailed(['limit']);
    }
    // Replaces what any tab stored before, whatever it found.
    GM_setValue(ACCOUNT_STORE_KEY, JSON.stringify({
      host: DANBOORU_URL,
      at: profileCheckedAt,
      batch,
      anonymous: profileAnonymous,
      safeMode: p.enable_safe_mode === true,
    }));
    if (profileAnonymous) {
      showToast(
          'Not logged in to Danbooru – lookups limited',
          {reason: 'anonymous', url: `${DANBOORU_URL}login`});
    }
    if (p.enable_safe_mode === true) {
      showToast(SAFE_MODE_TOAST, {reason: 'safeMode'});
    }
  }

  /**
   * Starts the account check unless one is running or the browser is offline.
   */
  function startProfileCheck() {
    if (profileCheck || isOffline()) {
      return;
    }
    profileWanted = false;
    profileCheck = checkProfile().finally(() => {
      profileCheck = null;
    });
  }

  /** Checks the account now, or between two lookups when a flush is running. */
  function requestProfileCheck() {
    profileWanted = true;
    if (!flushRunning) {
      startProfileCheck();
    }
  }

  // -------------- coloring --------------

  /**
   * @param {!ImageRef} ref
   * @return {number} The tweet's tile count, read at judgement time because a
   *     tile that arrives late adds a segment. The viewer's own ref carries its
   *     count (see syncPill).
   */
  function photoCountOf(ref) {
    if (ref === pillRef) {
      return ref.photoCount;
    }
    return ref.bar.parentElement ? ref.bar.parentElement.children.length : 1;
  }

  /**
   * @param {!Array<!Post>} posts
   * @return {number} The number of posts a tweet has on Danbooru: the live
   *     ones, or all when every one is deleted. Children are counted: a child
   *     with the same tweet source is another image of the tweet (a deleted
   *     lower-quality duplicate is not live).
   */
  function countPosts(posts) {
    const live = posts.filter((p) => !p.isDeleted);
    return live.length || posts.length;
  }

  /**
   * @param {!ImageRef} ref
   * @param {!Array<!Post>} posts
   * @return {(!Post|undefined)} A post whose source names this very image
   *     (media hash or /photo/N).
   */
  function strictMatch(ref, posts) {
    return posts.find((p) => (p.imageHash && p.imageHash === ref.imageHash) ||
      (p.photoIndex && p.photoIndex === ref.photoIndex));
  }

  /**
   * @param {!ImageRef} ref
   * @param {!Array<!Post>} posts
   * @return {?Post} The post a segment links to directly: its strict match,
   *     else the tweet's only post, picking a normal post before a deleted one
   *     before a banned one (a banned post page is HTTP 451 below Approver).
   *     Null when the tweet has several posts.
   */
  function directPost(ref, posts) {
    const exact = strictMatch(ref, posts);
    if (exact || countPosts(posts) !== 1) {
      return exact || null;
    }
    const rank = (p) => (p.isBanned ? 2 : p.isDeleted ? 1 : 0);
    return posts.reduce((best, p) => (rank(p) < rank(best) ? p : best));
  }

  /**
   * @param {!ImageRef} ref
   * @return {string} 'searching', 'found', 'foundWeak', 'missing' or 'error'.
   */
  function resolveState(ref) {
    const tc = tweetCache[ref.tweetId];
    if (!tc || tc.state === 'pending') {
      return 'searching';
    }
    // Video/GIF refs have no hash and are judged on the tweet result alone.
    const hc = ref.imageHash ? hashCache[ref.imageHash] : null;
    if (tc.state === 'error') {
      if (hc && hc.state === 'done' && hc.posts.length) {
        return 'found';
      }
      return 'error';
    }
    // No post for the tweet: missing at once; the hash lookup makes it found if
    // it finds one.
    if (tc.posts.length === 0) {
      if (hc && hc.state === 'done' && hc.posts.length) {
        return 'found';
      }
      if (hc && hc.state === 'error') {
        return 'error';
      }
      // A re-check keeps the old state until the hash lookup answers, so a post
      // found only by its hash does not blink green -> red -> green.
      if (ref.rechecking && ref.imageHash && (!hc || hc.state === 'pending')) {
        return 'searching';
      }
      // Before, during or after an empty hash lookup, and video tiles (no
      // hash).
      return 'missing';
    }
    if (strictMatch(ref, tc.posts)) {
      return 'found';
    }
    // Posts saved from a tweet name only the tweet, so the number of posts
    // decides: a one-image tweet with any post, or as many posts as images, is
    // fully posted.
    const photoCount = photoCountOf(ref);
    const k = countPosts(tc.posts);
    if ((photoCount === 1 && k >= 1) || k >= photoCount) {
      return 'found';
    }
    return 'foundWeak';
  }

  /**
   * @param {!ImageRef} ref
   * @return {!Array<!Post>} The posts the segment is judged on: the tweet's,
   *     else those found by the image's media hash.
   */
  function matchedPosts(ref) {
    const tc = tweetCache[ref.tweetId];
    if (tc && tc.state === 'done' && tc.posts.length) {
      return tc.posts;
    }
    const hc = ref.imageHash ? hashCache[ref.imageHash] : null;
    if (hc && hc.state === 'done' && hc.posts.length) {
      return hc.posts.filter((p) => p.imageHash === ref.imageHash);
    }
    return [];
  }

  /**
   * @param {!ImageRef} ref
   * @return {?string} The Danbooru URL a tap on the segment opens, or null.
   */
  function resolveMatchUrl(ref) {
    const posts = matchedPosts(ref);
    if (!posts.length) {
      return null;
    }
    const post = directPost(ref, posts);
    if (post) {
      return `${DANBOORU_URL}posts/${post.id}`;
    }
    // Several posts of the tweet: link to its search results on Danbooru.
    const tags = `status:any source:*status/${ref.tweetId}*`;
    return `${DANBOORU_URL}posts?tags=${encodeURIComponent(tags)}`;
  }

  /**
   * @param {!ImageRef} ref
   * @param {string} state
   * @return {string} Text for the segment's title and aria-label.
   */
  function resolveLabel(ref, state) {
    if (state === 'searching') {
      return 'Checking';
    }
    if (state === 'missing') {
      return 'Not on Danbooru';
    }
    if (state === 'error') {
      return 'Lookup failed';
    }
    const posts = matchedPosts(ref);
    if (state === 'foundWeak') {
      return `${countPosts(posts)} of ${photoCountOf(ref)} images posted`;
    }
    const post = directPost(ref, posts);
    if (!post) {
      return `On Danbooru: ${countPosts(posts)} posts`;
    }
    if (post.isBanned) {
      return `post #${post.id} (banned)`;
    }
    if (post.isDeleted) {
      return `post #${post.id} (deleted)`;
    }
    return `On Danbooru: post #${post.id}`;
  }

  /**
   * The only writer of segment state. A segment being re-checked keeps its
   * previous state, link and label (and pulses) until the new answer is in.
   * Found segments are links; missing and failed ones are buttons (a tap checks
   * again).
   */
  function applyColors() {
    for (const ref of imageRefs) {
      if (!ref.bar.isConnected) {
        continue;
      }
      const state = resolveState(ref);
      const hold = ref.rechecking && state === 'searching';
      if (!hold) {
        ref.rechecking = false;
      }
      // The pill is not a segment; renderPill draws it below.
      if (ref === pillRef) {
        continue;
      }
      const linked = state === 'found' || state === 'foundWeak';
      const matchUrl = linked ? resolveMatchUrl(ref) : null;
      const label = resolveLabel(ref, state);
      const key = `${state}|${matchUrl || ''}|${label}|${hold ? 1 : 0}`;
      if (ref.applied === key) {
        continue;
      }
      ref.applied = key;
      ref.bar.classList.toggle('xdsu-rechecking', hold);
      if (hold) {
        continue;
      }
      ref.bar.dataset.state = state;
      ref.bar.title = label;
      ref.bar.setAttribute('aria-label', label);
      if (matchUrl) {
        ref.bar.href = matchUrl;
        ref.bar.target = '_blank';
        ref.bar.rel = 'noopener';
      } else {
        ref.bar.removeAttribute('href');
      }
      if (state === 'missing' || state === 'error') {
        ref.bar.setAttribute('role', 'button');
      } else {
        ref.bar.removeAttribute('role');
      }
      if (ref.btn) {
        const found = state === 'found';
        const label = found ? 'Already on Danbooru' : 'Upload to Danbooru';
        ref.btn.classList.toggle('xdsu-found', found);
        ref.btn.title = label;
        ref.btn.setAttribute('aria-label', label);
      }
    }
    if (pillEl) {
      renderPill();
    }
  }

  // -------------- bar segment taps --------------

  // Why a lookup failed, for the toast shown when a failed segment is tapped.
  const ERROR_TEXT = {
    network: 'Could not reach Danbooru.',
    server: 'Danbooru had a server error.',
    blocked: 'Danbooru blocked the request. Open Danbooru once.',
    limit: 'The search had too many terms for this account.',
    client: 'Danbooru refused the search.',
  };

  /**
   * Every tap on a segment stops here, so none reaches the tweet or x.com's
   * links. A found segment opens its post, a missing one checks again, a failed
   * one retries now, a searching one does nothing.
   * @param {!Event} ev
   */
  function onSegmentClick(ev) {
    if (ev.button !== undefined && ev.button > 1) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const seg = ev.currentTarget;
    const ref = imageRefs.find((r) => r.bar === seg);
    if (!ref) {
      return;
    }
    const state = seg.dataset.state;
    if (state === 'found' || state === 'foundWeak') {
      openPost(ev, ref, seg.getAttribute('href'));
    } else if (state === 'missing') {
      refreshTweetStatus(ref.tweetId);
    } else if (state === 'error') {
      retryLookup(ref);
    }
  }

  /**
   * Opens a ref's post link, at most once per UPLOAD_LOCK_MS.
   * @param {!Event} ev
   * @param {!ImageRef} ref
   * @param {?string} url
   */
  function openPost(ev, ref, url) {
    const now = Date.now();
    if (!url || now - ref.openedAt < UPLOAD_LOCK_MS) {
      return;
    }
    ref.openedAt = now;
    try {
      GM_openInTab(url, {
        active: ev.button === 0 && !ev.ctrlKey,
        setParent: true,
      });
    } catch (e) {
      console.error('[XDSU] open post failed', e);
      window.open(url, '_blank', 'noopener');
    }
  }

  /**
   * Runs the failed lookups of a ref's tweet and images again now and says why
   * they failed.
   * @param {!ImageRef} ref
   */
  function retryLookup(ref) {
    const tc = tweetCache[ref.tweetId];
    const hc = ref.imageHash ? hashCache[ref.imageHash] : null;
    const failed = [tc, hc].find((e) => e && e.state === 'error');
    // Already being checked again.
    if (!failed) {
      return;
    }
    retryEntry(tweetCache, pendingTweetIds, ref.tweetId);
    imageRefs.filter((r) => r.tweetId === ref.tweetId && r.imageHash)
        .forEach((r) => retryEntry(hashCache, pendingHashes, r.imageHash));
    resumeQueue();
    applyColors();
    const why = ERROR_TEXT[failed.reason] || 'The lookup failed.';
    showToast(`${why} Trying again.`);
  }

  // -------------- photo viewer pill --------------

  // On /<user>/status/<id>/photo/<n> one fixed pill shows photo n of that
  // tweet. It mirrors the tracked segment of that photo when its article is
  // still mounted under the viewer; otherwise it owns a ref in imageRefs (bar =
  // the pill, so the queue sees it on screen) and is looked up by itself.
  // Everything is driven by the URL; the viewer's markup is not relied on.
  let pillEl = null;
  // The pill's own ref, or null while it mirrors a segment.
  let pillRef = null;
  // {ref, tweetUrl}: the ref the pill shows and the tweet URL for uploads.
  let pillSrc = null;
  // [ref, key] of the last render.
  let pillShown = [null, ''];
  let pillPath = '';
  let pillTimer = null;
  let pillUploadAt = 0;

  /**
   * @return {!Array<!HTMLImageElement>} The media images outside any tweet and
   *     outside links to a tweet (profile media tiles).
   */
  function viewerImages() {
    const imgs = document.querySelectorAll('img[src*="pbs.twimg.com/media/"]');
    return [...imgs].filter(
        (img) => !img.closest('article') &&
            !img.closest('a[href*="/status/"]'));
  }

  /**
   * @param {!Array<!HTMLImageElement>} imgs
   * @param {number} n 1-based photo number.
   * @return {?HTMLImageElement} The viewer's image n, or null unless that image
   *     is on screen, i.e. the pick is plausible.
   */
  function viewerImage(imgs, n) {
    const img = imgs[n - 1];
    if (!img) {
      return null;
    }
    const r = img.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const onScreen = r.width > 0 && cx >= 0 && cx <= window.innerWidth &&
        cy >= 0 && cy <= window.innerHeight;
    return onScreen ? img : null;
  }

  /**
   * @return {?HTMLImageElement} The image an upload tap names: the mirrored
   *     segment's tile, else the viewer's image n.
   */
  function pillImage() {
    if (pillSrc.ref !== pillRef) {
      const tile = pillSrc.ref.btn && pillSrc.ref.btn.parentElement;
      return tile ? findTweetImage(tile) : null;
    }
    return viewerImage(viewerImages(), pillRef.photoIndex);
  }

  /** Removes the viewer button's own ref from imageRefs. */
  function dropPillRef() {
    const i = imageRefs.indexOf(pillRef);
    if (i >= 0) {
      imageRefs.splice(i, 1);
    }
    pillRef = null;
  }

  /** Removes the viewer button and everything that belongs to it. */
  function closePill() {
    if (!pillEl) {
      return;
    }
    clearInterval(pillTimer);
    pillTimer = null;
    dropPillRef();
    pillEl.remove();
    pillEl = null;
    pillSrc = null;
    pillShown = [null, ''];
    pillPath = '';
    if (toastEl) {
      toastEl.classList.remove('xdsu-above-pill');
    }
    // A lookup only the pill wanted is dropped by the next flush (see
    // takeBatch).
    if (pendingTweetIds.length || pendingHashes.length) {
      scheduleFlush();
    }
  }

  /** Shows, updates or removes the viewer button for the current URL. */
  function syncPill() {
    const m = location.pathname.match(VIEWER_PATH_RE);
    const info = m && parseStatusPath(location.pathname);
    const n = m ? parseInt(m[1], 10) : 0;
    if (!info || n < 1) {
      closePill();
      return;
    }
    pillPath = location.pathname;
    if (!pillEl) {
      pillEl = document.createElement('a');
      pillEl.className = 'xdsu-pill';
      pillEl.setAttribute('aria-label', 'Checking');
      const icon = document.createElement('img');
      icon.alt = '';
      icon.onerror = () => {
        pillEl.textContent = '↑';
      };
      icon.src = DANBOORU_ICON_URL;
      pillEl.appendChild(icon);
      pillEl.addEventListener('click', onPillClick);
      pillEl.addEventListener('auxclick', onPillClick);
      pillEl.addEventListener('contextmenu', () => {
        if (pillEl.dataset.action === 'upload') {
          watchTweet(pillSrc.ref.tweetId);
        }
      });
      pillEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      // The viewer may react to a press on its own (swipe, hide its controls).
      ['touchstart', 'pointerdown'].forEach((type) => {
        pillEl.addEventListener(
            type, (e) => e.stopPropagation(), {passive: true});
      });
      pillTimer = setInterval(() => {
        if (location.pathname !== pillPath) {
          syncPill();
        }
      }, PILL_URL_CHECK_MS);
      if (toastEl) {
        toastEl.classList.add('xdsu-above-pill');
      }
    }
    if (!pillEl.isConnected) {
      (document.body || document.documentElement).appendChild(pillEl);
    }
    const seg = imageRefs.find(
        (r) => r !== pillRef && r.tweetId === info.tweetId &&
            r.photoIndex === n && r.bar.isConnected);
    if (seg) {
      dropPillRef();
      const art = seg.bar.closest('article');
      const artUrl = art && art.dataset.xdsuTweetUrl;
      pillSrc = {ref: seg, tweetUrl: artUrl || info.tweetUrl};
    } else {
      const imgs = viewerImages();
      const img = viewerImage(imgs, n);
      const hash = img ? parseTwitterImageHash(img.src) : null;
      if (!pillRef || !imageRefs.includes(pillRef) ||
          pillRef.tweetId !== info.tweetId || pillRef.photoIndex !== n ||
          (hash && hash !== pillRef.imageHash)) {
        dropPillRef();
        pillRef = {
          tweetId: info.tweetId,
          imageHash: hash,
          photoIndex: n,
          bar: pillEl,
          btn: null,
          rechecking: false,
          applied: null,
          openedAt: 0,
          photoCount: n,
        };
        imageRefs.push(pillRef);
      }
      // Photo count: the bar of a mounted article of the tweet, else the
      // viewer's images when image n was found among them, else n. Never less
      // than n.
      const bar = [...document.querySelectorAll('.xdsu-bar')].find(
          (b) => b.dataset.tweetId === info.tweetId);
      const seen = img ? imgs.length : 0;
      pillRef.photoCount = Math.max(n, bar ? bar.children.length : seen);
      pillSrc = {ref: pillRef, tweetUrl: info.tweetUrl};
      enqueueTweetIdSearch(info.tweetId);
      ensureHashLookup(pillRef);
    }
    renderPill();
  }

  /**
   * Draws the viewer button from its ref. While the ref is re-checked the
   * button keeps what it showed.
   */
  function renderPill() {
    if (!pillSrc.ref.bar.isConnected) {
      syncPill();
      return;
    }
    const ref = pillSrc.ref;
    const state = resolveState(ref);
    const hold = ref.rechecking && state === 'searching';
    if (hold && pillShown[0] === ref) {
      pillEl.classList.add('xdsu-rechecking');
      return;
    }
    let label = 'Checking';
    let href = null;
    let action = null;
    if (state === 'found') {
      label = 'On Danbooru';
      href = resolveMatchUrl(ref);
      action = 'open';
    } else if (state === 'foundWeak') {
      const posted = countPosts(matchedPosts(ref));
      label =
          `Upload to Danbooru · ${posted} of ${photoCountOf(ref)} posted`;
      href = buildUploadUrl(pillSrc.tweetUrl);
      action = 'upload';
    } else if (state === 'missing') {
      label = 'Upload to Danbooru';
      href = buildUploadUrl(pillSrc.tweetUrl);
      action = 'upload';
    } else if (state === 'error') {
      label = 'Lookup failed – tap to retry';
      action = 'retry';
    }
    const key = `${state}|${href || ''}|${label}`;
    pillEl.classList.remove('xdsu-rechecking');
    if (pillShown[0] === ref && pillShown[1] === key) {
      return;
    }
    pillShown = [ref, key];
    pillEl.dataset.state = state;
    pillEl.title = label;
    pillEl.setAttribute('aria-label', label);
    if (action) {
      pillEl.dataset.action = action;
    } else {
      delete pillEl.dataset.action;
    }
    if (href) {
      pillEl.href = href;
      pillEl.target = '_blank';
      pillEl.rel = 'noopener';
    } else {
      pillEl.removeAttribute('href');
    }
    // Without an href the <a> has no role of its own, so its label would not be
    // its name.
    if (href) {
      pillEl.removeAttribute('role');
    } else {
      pillEl.setAttribute('role', 'button');
    }
    if (action) {
      pillEl.removeAttribute('aria-disabled');
    } else {
      pillEl.setAttribute('aria-disabled', 'true');
    }
  }

  /**
   * Every tap on the viewer button stops here, so none reaches the viewer or
   * x.com's handlers.
   * @param {!Event} ev
   */
  function onPillClick(ev) {
    if (ev.button !== undefined && ev.button > 1) {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const ref = pillShown[0];
    const action = pillEl.dataset.action;
    if (!ref) {
      return;
    }
    if (action === 'open') {
      openPost(ev, ref, pillEl.getAttribute('href'));
    } else if (action === 'upload') {
      const now = Date.now();
      if (now - pillUploadAt < UPLOAD_LOCK_MS) {
        return;
      }
      pillUploadAt = now;
      openUpload(
          ev, ref.tweetId, imageUploadUrl(pillImage(), pillSrc.tweetUrl));
    } else if (action === 'retry') {
      retryLookup(ref);
    }
  }

  // -------------- re-check after an upload --------------

  const lastRefresh = Object.create(null);
  const REFRESH_DEBOUNCE_MS = 1500;

  /**
   * @param {string} tweetId
   * @return {boolean} Whether the tweet's lookup or one of its hash lookups is
   *     pending.
   */
  function isLookupPending(tweetId) {
    const tc = tweetCache[tweetId];
    if (tc && tc.state === 'pending') {
      return true;
    }
    return imageRefs.some((ref) => {
      const hc = ref.tweetId === tweetId && ref.imageHash &&
          hashCache[ref.imageHash];
      return hc && hc.state === 'pending';
    });
  }

  /**
   * Drops the cached result of a tweet and queries it again. The segments keep
   * showing the old result while the query runs (see applyColors).
   * @param {string} tweetId
   * @return {boolean} Whether a lookup was queued: false when the tweet has no
   *     segment in the page, a lookup of it is pending, or it was refreshed
   *     less than REFRESH_DEBOUNCE_MS ago.
   */
  function refreshTweetStatus(tweetId) {
    const refs = imageRefs.filter(
        (ref) => ref.tweetId === tweetId && ref.bar.isConnected);
    // Nothing on screen to update (e.g. a text-only tweet), or a lookup is
    // already running.
    if (!refs.length || isLookupPending(tweetId)) {
      return false;
    }
    const now = Date.now();
    if ((lastRefresh[tweetId] || 0) > now - REFRESH_DEBOUNCE_MS) {
      return false;
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
    return true;
  }

  /**
   * @param {string} tweetId
   * @return {number} Posts currently known for a tweet: its tweet-id lookup
   *     plus the hash lookups of its images.
   */
  function knownPostCount(tweetId) {
    const tc = tweetCache[tweetId];
    const hashes = new Set(
        imageRefs.filter((ref) => ref.tweetId === tweetId && ref.imageHash)
            .map((ref) => ref.imageHash));
    const found = (h) => (hashCache[h] ? hashCache[h].posts.length : 0);
    return [...hashes].reduce(
        (n, h) => n + found(h), tc ? tc.posts.length : 0);
  }

  /**
   * Remembers a tweet opened for upload, so it is re-checked on return. A tweet
   * already watched starts afresh.
   * @param {string} tweetId
   */
  function watchTweet(tweetId) {
    const t0 = Date.now();
    const n0 = knownPostCount(tweetId);
    watch.set(tweetId, {t0, n0, checks: 0});
    updateStoredWatch((stored) => stored.set(tweetId, {t0, n0}));
  }

  // Re-checks of the watched tweets come in passes. A return to the tab
  // (visibilitychange, pageshow) starts a ladder: a pass at once, then one
  // after each of RECHECK_DELAYS_MS on a single timer while the tab stays
  // visible. A return noticed while the tab stayed visible runs a single pass
  // (onVisibleReturn). An entry is dropped once its post count rose, after
  // WATCH_MAX_AGE_MS, or once the passes queued WATCH_MAX_CHECKS lookups for
  // it. The end of a ladder does not drop it, so a later return checks it
  // again.
  let recheckTimer = null;
  let lastPassAt = 0;

  /**
   * Re-checks every watched tweet once and drops the entries that are done,
   * here and in the store.
   */
  function recheckPass() {
    if (!watch.size) {
      return;
    }
    const now = Date.now();
    lastPassAt = now;
    const dropped = [];
    for (const [id, w] of watch) {
      let done = now - w.t0 > WATCH_MAX_AGE_MS || knownPostCount(id) > w.n0;
      // Only a queued lookup counts. None is queued while the tweet is not
      // mounted, while it is being looked up, or right after a refresh.
      if (!done && refreshTweetStatus(id)) {
        w.checks++;
        done = w.checks >= WATCH_MAX_CHECKS;
      }
      if (done) {
        watch.delete(id);
        dropped.push([id, w.t0]);
      }
    }
    if (dropped.length) {
      // An entry another tab stored for the same tweet since (another t0)
      // stays.
      updateStoredWatch((stored) => dropped.forEach(([id, t0]) => {
        const s = stored.get(id);
        if (s && s.t0 === t0) {
          stored.delete(id);
        }
      }));
    }
  }

  /**
   * One step of the ladder: a pass, then the timer for the next step unless
   * this was the last step or nothing is left to watch.
   * @param {number} step 0 when the tab becomes visible; later steps follow on
   *     the timer.
   */
  function recheckWatched(step) {
    recheckTimer = null;
    if (document.hidden) {
      return;
    }
    recheckPass();
    if (watch.size && step < RECHECK_DELAYS_MS.length) {
      recheckTimer = setTimeout(
          () => recheckWatched(step + 1), RECHECK_DELAYS_MS[step]);
    }
  }

  /**
   * Runs one pass when the user comes back to a tab that stayed visible: the
   * window gets the focus back, or the mouse comes back over the page. Skipped
   * within RETURN_GAP_MS of the last pass of any kind; a running ladder goes on
   * unchanged.
   */
  function onVisibleReturn() {
    if (document.hidden || !watch.size ||
        Date.now() - lastPassAt < RETURN_GAP_MS) {
      return;
    }
    recheckPass();
  }

  let lastReturnAt = 0;
  /** Starts a ladder of re-checks when the tab becomes visible again. */
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

  /**
   * Re-checks the tweet whose Like (or Unlike) button was clicked.
   * @param {!Event} ev
   */
  function handleLikeClick(ev) {
    if (!likeRecheck) {
      return;
    }
    const target = ev.target;
    if (!target || !target.closest) {
      return;
    }
    const likeBtn = target.closest(LIKE_SELECTOR);
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

  // -------------- MutationObserver + polling fallback --------------

  let scanTimer = null;
  /** Schedules a scan unless one is pending. */
  function scheduleScan() {
    if (scanTimer) {
      return;
    }
    scanTimer = setTimeout(() => {
      scanTimer = null;
      tick();
    }, SCAN_DEBOUNCE_MS);
  }

  /** Runs one scan: tweets, dropped lookups, retries, repaint. */
  function tick() {
    if (document.hidden) {
      return;
    }
    try {
      scanTweets();
      syncPill();
      // A lookup dropped while its tweet was off screen (see takeBatch) runs
      // again if the same segment came back before a scan saw it leave.
      imageRefs.filter((ref) => ref.bar.isConnected).forEach((ref) => {
        enqueueTweetIdSearch(ref.tweetId);
        ensureHashLookup(ref);
      });
      retryFailed(null);
      // A queued key can come into range without a scroll (remount, layout
      // change).
      if (hasDueKeys()) {
        scheduleFlush();
      }
      applyColors();
    } catch (e) {
      console.error('[XDSU] tick error', e);
    }
  }

  // Scrolling brings queued keys into range. Capture also sees an inner element
  // scrolling.
  let scrollTimer = null;
  window.addEventListener('scroll', () => {
    if (scrollTimer) {
      return;
    }
    scrollTimer = setTimeout(() => {
      scrollTimer = null;
      if (hasDueKeys()) {
        scheduleFlush();
      }
    }, SCROLL_CHECK_MS);
  }, {capture: true, passive: true});

  /** Watches the page for added nodes that are not the script's own. */
  function startObserver() {
    if (!document.body) {
      setTimeout(startObserver, 50);
      return;
    }
    // The script's own insertions, and text it writes into its elements, need
    // no scan.
    const ownSelector =
        '.xdsu-bar, .xdsu-bar-seg, .xdsu-upload-btn, .xdsu-toast, .xdsu-pill';
    const own = (n) =>
      n.nodeType === Node.ELEMENT_NODE && n.matches(ownSelector);
    const observer = new MutationObserver((mutations) => {
      const foreign = (mut) => mut.addedNodes.length > 0 &&
          ![...mut.addedNodes].every(own) &&
          !mut.target.closest(ownSelector);
      if (mutations.some(foreign)) {
        scheduleScan();
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

  // When a return last retried failed lookups and lifted a queue pause
  // (visibilitychange, focus).
  let lastRetryAt = 0;

  // Every visibility change cancels the pending re-check; becoming visible
  // re-scans, starts a new ladder of re-checks and shows the toasts that waited
  // while the tab was hidden. A return to the tab also retries failed lookups
  // at once (always, whatever lastRetryAt says). It takes over a newer account
  // check that another tab stored (adoptStoredAccount), then checks the account
  // again when it is logged out, the last check (this tab's or the one it took
  // over) is old, or lookups failed in a way that logging in or a Cloudflare
  // check in another tab can fix. A tab that started hidden has no check yet
  // (profileCheckedAt is 0), so here it takes over a stored one or makes its
  // first one, before the scan queues any lookup.
  document.addEventListener('visibilitychange', () => {
    clearTimeout(recheckTimer);
    recheckTimer = null;
    if (!document.hidden) {
      const needsAccount = (e) => e.state === 'error' &&
          (e.reason === 'limit' || e.reason === 'blocked');
      // Read before the take-over, which retries the 'limit' failures when the
      // batch size changes; they still call for a check of this tab's own.
      const failedForAccount = [tweetCache, hashCache].some(
          (cache) => Object.values(cache).some(needsAccount));
      adoptStoredAccount();
      const recheckProfile = profileAnonymous ||
          Date.now() - profileCheckedAt > PROFILE_MAX_AGE_MS ||
          failedForAccount;
      retryFailed(['network', 'server', 'blocked']);
      resumeQueue();
      lastRetryAt = Date.now();
      if (recheckProfile) {
        requestProfileCheck();
      }
      scheduleScan();
      onReturn();
      showNextToast();
    }
  });
  // Returns that leave the tab visible: the window gets the focus back (a click
  // into it, Alt+Tab), or the mouse comes back over the page (an upload posted
  // in a window on another screen). Each runs one re-check pass, not a ladder.
  // The focus also retries failed lookups and lifts a queue pause, as a return
  // to the tab does (a browser check may have been passed in the other
  // window), but at most once per RETURN_GAP_MS: focus changes are frequent,
  // and while Danbooru refuses, each retry fails again and pauses anew. A tab
  // switch fires both visibilitychange and focus; when the focus comes second,
  // its retry and its pass fall within RETURN_GAP_MS, so it sends nothing.
  window.addEventListener('focus', () => {
    if (document.hidden) {
      return;
    }
    const now = Date.now();
    if (now - lastRetryAt >= RETURN_GAP_MS) {
      lastRetryAt = now;
      retryFailed(['network', 'server', 'blocked']);
      resumeQueue();
    }
    onVisibleReturn();
  });
  document.documentElement.addEventListener('pointerenter', (ev) => {
    if (ev.pointerType === 'mouse') {
      onVisibleReturn();
    }
  });
  window.addEventListener('pageshow', (ev) => {
    retryFailed(['blocked']);
    if (ev.persisted) {
      onReturn();
    }
  });
  window.addEventListener('online', () => {
    retryFailed(['network', 'server', 'blocked']);
    resumeQueue();
    if (profileWanted) {
      requestProfileCheck();
    }
  });

  // A recent check stored by another tab (or by an earlier load of this one)
  // takes the place of this tab's own. Without one, a tab that starts hidden
  // (opened in the background) sends nothing until it is first shown, when the
  // visibilitychange handler takes over a check stored meanwhile or checks. It
  // is not marked wanted (profileWanted), or an 'online' event would send the
  // check while it is still hidden.
  if (!adoptStoredAccount() && !document.hidden) {
    requestProfileCheck();
  }
  if (new URL(DANBOORU_URL).hostname === 'safebooru.donmai.us') {
    showToast(SAFE_MODE_TOAST, {reason: 'safeMode'});
  }
  startObserver();
  scheduleScan(); // initial
})();
