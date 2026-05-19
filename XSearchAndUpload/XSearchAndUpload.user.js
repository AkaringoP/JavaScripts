// ==UserScript==
// @name         X (Twitter) Danbooru Search and Upload
// @namespace    https://github.com/akaringop/uploading
// @description  Show Danbooru-presence bars under tweet images on x.com and add a one-click Danbooru upload button. Mobile-friendly (Firefox + Tampermonkey).
// @match        *://x.com/*
// @match        *://twitter.com/*
// @match        *://mobile.twitter.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_getResourceURL
// @grant        GM_openInTab
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.7.1/jquery.min.js
// @resource     danbooru_icon https://github.com/danbooru/danbooru/raw/master/public/images/danbooru-logo.png
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

  const rawBooru = GM_getValue('booru', 'https://danbooru.donmai.us') || '';
  const DANBOORU_URL = rawBooru.replace(/\/+$/, '') + '/';
  const DANBOORU_ICON_URL = GM_getResourceURL('danbooru_icon');

  GM_registerMenuCommand('Set Danbooru domain', () => {
    const cur = GM_getValue('booru', 'https://danbooru.donmai.us');
    const input = prompt('Danbooru domain:', cur);
    if (input && input.trim()) {
      GM_setValue('booru', input.trim().replace(/\/+$/, ''));
      location.reload();
    }
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
  const QUERY_BATCH = Math.max(1, Math.min(5, GM_getValue('queryBatch', 3)));
  const FETCH_TIMEOUT_MS = 20000;
  const MAX_ATTEMPTS = 5;
  const ARTICLE_SELECTOR = 'article[data-testid="tweet"], article[tabindex="-1"]';
  const STATUS_RE = /\/status(?:es)?\/(\d+)/;

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
    .xdsu-upload-btn {
      display: inline-flex;
      align-items: center;
      position: absolute;
      bottom: 6px;
      left: 6px;
      z-index: 5;
      padding: 5px;
      background: rgba(0,0,0,0.55);
      border-radius: 4px;
      cursor: pointer;
      text-decoration: none !important;
      color: white !important;
      line-height: 1;
    }
    .xdsu-upload-btn:hover { background: rgba(0,0,0,0.78); }
    .xdsu-upload-btn img {
      height: 1.4em;
      vertical-align: middle;
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

  function setKeysError(cache, keys) {
    for (const k of keys) {
      cache[k].state = 'error';
    }
  }

  function clearArticleMarkers(article) {
    delete article.dataset.xdsuTweetId;
    delete article.dataset.xdsuTweetUrl;
    delete article.dataset.xdsuDone;
    article.querySelectorAll('[data-xdsu-btn]').forEach((el) => {
      el.removeAttribute('data-xdsu-btn');
    });
    article.querySelectorAll('.xdsu-upload-btn').forEach((el) => {
      el.remove();
    });
  }

  // Combined tweetId + tweetUrl extraction with per-article caching.
  // Validates cache by checking the live <time> anchor href against the cached id;
  // clears all related markers if the article was recycled to a different tweet.
  function getTweetInfo(article) {
    const cached = article.dataset.xdsuTweetId;
    let liveHref = null;
    const time = article.querySelector('time');
    if (time) {
      const a = time.closest('a');
      if (a) {
        liveHref = a.getAttribute('href');
      }
    }
    if (cached) {
      if (liveHref && new RegExp(`/status(?:es)?/${cached}(?:[/?#]|$)`).test(liveHref)) {
        return {
          tweetId: cached,
          tweetUrl: article.dataset.xdsuTweetUrl || `https://x.com/i/web/status/${cached}`,
        };
      }
      // Stale cache: article was recycled. Wipe markers and re-extract.
      clearArticleMarkers(article);
    }

    let href = liveHref;
    if (!href) {
      const anyA = article.querySelector('a[href*="/status/"]');
      if (anyA) {
        href = anyA.getAttribute('href');
      }
    }
    let tweetId = null;
    let tweetUrl = null;
    if (href) {
      const m = href.match(STATUS_RE);
      if (m) {
        tweetId = m[1];
      }
      try {
        tweetUrl = new URL(href, 'https://x.com').href;
      } catch {
        // ignore
      }
    }
    if (!tweetId) {
      const pm = location.pathname.match(STATUS_RE);
      if (pm) {
        tweetId = pm[1];
      }
    }
    if (!tweetId) {
      return null;
    }
    if (!tweetUrl) {
      tweetUrl = `https://x.com/i/web/status/${tweetId}`;
    }
    article.dataset.xdsuTweetId = tweetId;
    article.dataset.xdsuTweetUrl = tweetUrl;
    return {tweetId, tweetUrl};
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

  // [{tweetId, imageHash, photoIndex, bar}] where bar is the segment element.
  const imageRefs = [];

  // -------------- DOM scan --------------

  function scanTweets() {
    const articles = document.querySelectorAll(ARTICLE_SELECTOR);
    for (const article of articles) {
      processArticle(article);
    }
    // Prune disconnected segment refs.
    for (let i = imageRefs.length - 1; i >= 0; i--) {
      if (!imageRefs[i].bar.isConnected) {
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
      photoEl.setAttribute('data-xdsu-btn', '1');
      const cs = window.getComputedStyle(photoEl);
      if (!cs.position || cs.position === 'static') {
        photoEl.style.position = 'relative';
      }
      attachUploadBtn(photoEl, info);
    }
    if (!bar) {
      return false;
    }
    const segment = bar.children[photoIndex - 1];
    if (!segment) {
      return false;
    }
    if (segment.dataset.imageHash) {
      return true; // already tracked
    }
    const img = findTweetImage(photoEl);
    if (!img) {
      return false;
    }
    const imageHash = parseTwitterImageHash(img.src);
    if (!imageHash) {
      return false;
    }
    segment.dataset.imageHash = imageHash;
    segment.dataset.photoIndex = String(photoIndex);
    imageRefs.push({
      tweetId: info.tweetId,
      imageHash,
      photoIndex,
      bar: segment,
    });
    enqueueTweetIdSearch(info.tweetId);
    return true;
  }

  function attachUploadBtn(photoEl, info) {
    const uploadUrl = buildUploadUrl(info.tweetUrl);

    const btn = document.createElement('a');
    btn.className = 'xdsu-upload-btn';
    btn.target = '_blank';
    btn.href = uploadUrl;

    const icon = document.createElement('img');
    icon.title = 'Upload to Danbooru';
    icon.alt = '';
    icon.src = DANBOORU_ICON_URL;
    btn.appendChild(icon);

    let ready = true;
    const onClick = (ev) => {
      if (!ready) {
        return;
      }
      if (ev.button !== undefined && ev.button > 1) {
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();
      ready = false;
      btn.style.cursor = 'wait';
      try {
        GM_openInTab(uploadUrl, {
          active: ev.button === 0 && !ev.ctrlKey,
          setParent: true,
        });
      } catch (e) {
        console.error('[XDSU] open tab failed', e);
      }
      btn.style.cursor = '';
      ready = true;
    };
    btn.addEventListener('click', onClick);
    btn.addEventListener('auxclick', onClick);
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
    pendingTweetIds.push(tweetId);
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
      applyColors();
    }
    // Second pass: tweets with no posts -> retry via image hash.
    for (const ref of imageRefs) {
      const tc = tweetCache[ref.tweetId];
      if (!tc || tc.state !== 'done' || tc.posts.length > 0) {
        continue;
      }
      if (!hashCache[ref.imageHash]) {
        hashCache[ref.imageHash] = {state: 'pending', posts: []};
        pendingHashes.push(ref.imageHash);
      }
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
      setKeysError(cache, keys);
      return;
    }
    let data;
    try {
      data = JSON.parse(resp.responseText);
    } catch {
      data = null;
    }
    if (!Array.isArray(data)) {
      setKeysError(cache, keys);
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
    for (const k of keys) {
      cache[k].posts = bucket[k];
      cache[k].state = 'done';
    }
  }

  // -------------- coloring + F2 link annotation --------------

  function resolveColor(ref) {
    const tc = tweetCache[ref.tweetId];
    if (!tc || tc.state === 'pending') {
      return COLORS.searching;
    }
    if (tc.state === 'error') {
      const hc = hashCache[ref.imageHash];
      if (hc && hc.state === 'done' && hc.posts.length) {
        return COLORS.found;
      }
      return COLORS.error;
    }
    if (tc.posts.length === 0) {
      const hc = hashCache[ref.imageHash];
      if (!hc || hc.state === 'pending') {
        return COLORS.searching;
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
    const hc = hashCache[ref.imageHash];
    if (hc && hc.state === 'done' && hc.posts.length) {
      const exact = hc.posts.find((p) => p.imageHash === ref.imageHash);
      if (exact) {
        return `${DANBOORU_URL}posts/${exact.id}`;
      }
    }
    return null;
  }

  function applyColors() {
    for (const ref of imageRefs) {
      if (!ref.bar.isConnected) {
        continue;
      }
      const color = resolveColor(ref);
      if (ref.bar.style.backgroundColor !== color) {
        ref.bar.style.backgroundColor = color;
      }
      const matchUrl = resolveMatchUrl(ref);
      if (matchUrl) {
        ref.bar.dataset.matchUrl = matchUrl;
        ref.bar.classList.add('xdsu-clickable');
        ref.bar.title = matchUrl.replace(/^https?:\/\//, '');
      } else {
        delete ref.bar.dataset.matchUrl;
        ref.bar.classList.remove('xdsu-clickable');
        ref.bar.removeAttribute('title');
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

  // -------------- Like-button refresh trigger --------------

  // When the user clicks Like (or Unlike) on a tweet we've already searched,
  // invalidate that tweet's cached search result and re-query. Fits the
  // workflow of: upload via the icon -> finish on the Danbooru tab -> come
  // back and like the tweet -> the bar updates to green to confirm.
  const lastRefresh = Object.create(null);
  const REFRESH_DEBOUNCE_MS = 1500;
  const REFRESH_QUERY_DELAY_MS = 1000;

  function refreshTweetStatus(tweetId) {
    if (!tweetId) {
      return;
    }
    const hashes = new Set();
    for (const ref of imageRefs) {
      if (ref.tweetId === tweetId) {
        hashes.add(ref.imageHash);
      }
    }
    delete tweetCache[tweetId];
    for (const h of hashes) {
      delete hashCache[h];
    }
    // Immediate visual feedback: matching segments go back to "searching".
    for (const ref of imageRefs) {
      if (ref.tweetId === tweetId && ref.bar.isConnected) {
        ref.bar.style.backgroundColor = COLORS.searching;
        ref.bar.classList.remove('xdsu-clickable');
        delete ref.bar.dataset.matchUrl;
        ref.bar.removeAttribute('title');
      }
    }
    // Slight delay so Danbooru's search index has a chance to pick up a
    // freshly-completed upload before we query.
    setTimeout(() => enqueueTweetIdSearch(tweetId), REFRESH_QUERY_DELAY_MS);
  }

  function handleLikeClick(ev) {
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
    const now = Date.now();
    if ((lastRefresh[tweetId] || 0) > now - REFRESH_DEBOUNCE_MS) {
      return;
    }
    lastRefresh[tweetId] = now;
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

  // Re-scan when the tab becomes visible again.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      scheduleScan();
    }
  });

  startObserver();
  scheduleScan(); // initial
})();
