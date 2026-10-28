// ==UserScript==
// @name         Pixiv Image Searches and Stuff (Mod)
// @description  Searches Danbooru for pixiv IDs and source mismatches, adds IQDB image search links, and filters images based on pixiv favorites.
// @match        *://www.pixiv.net/*
// @grant        GM_xmlhttpRequest
// @connect      donmai.us
// @noframes
// @downloadURL  none
// @version      2026.04.16
// ==/UserScript==

/* You must be logged into Danbooru (or your preferred site mirror) for all features to work! */

/*
 * Locally maintained copy (AkaringoP/JavaScripts, ExternalScripts/).
 * The file as originally received is kept in ExternalScripts/archives/.
 * See ExternalScripts/README.md for the list of local changes.
 */

const danbooruURL = "https://danbooru.donmai.us/";
const iqdbURL = "https://danbooru.donmai.us/iqdb_queries?url=";
const sauceURL = "https://saucenao.com/search.php?db=999&url=";
let addSourceSearch = true; // turned off at runtime when Danbooru is down or rejects the API call
const ignoreMismatch = false;
const ignoreBadRevision = false;

/* CSS Styling + Other Options */
const styleSourceFound = "color:green; font-weight: bold;";
const styleSourceMismatch = "color:purple; font-weight: bold;";
const styleSourceBadRevision = "color:darkorange; font-weight: bold; font-style: italic;";
const styleSourceMissing = "color:red;";
const sourceTimeout = 20; // seconds per Danbooru request
let maxAttempts = 10; // set to 0 at runtime when Danbooru is down or rejects the API call
const maxIdAttempts = 10; // polls to wait for a thumbnail whose pixiv ID can't be read yet
const imageCheckPeriod = 1000;

/* Mobile Options */
const mobileBreakpoint = 768;
const mobileBarHeight = "4px";

/* Debug — set to true to show a floating debug panel on the page */
const PISAS_DEBUG = false;

//////////////////////////////////////////////////////////////////////////////////////

function isMobile() {
    return window.innerWidth <= mobileBreakpoint;
}

// Mobile color map
const colorMap = {
    found:       "#22cc22",
    mismatch:    "#800080",
    badRevision: "#ff8c00",
    missing:     "#ff3333",
    searching:   "#888888",
    error:       "#4444ff",
};

// Thumbnail selectors. Each one picks thumbnail <img>s that have not been handled
// yet (no `pisas` attribute). Keys are referenced by pageSelectors below.
const NOT_UPLOAD_BUTTON = ':not([class*="ex-utb-upload-button"])';
const ARTWORK_LINK = 'a[href*="artworks"]' + NOT_UPLOAD_BUTTON;
const NEW_IMG = "img:not([pisas])";
const NEW_IMG_NOT_ICON = NEW_IMG + ':not([class*="ex-utb-upload-button-icon"])';

const thumbSelectors = {
    // Legacy /stacc feed (mode=medium links).
    mediumLink: 'div > a[href*="mode=medium"] ' + NEW_IMG,
    // Generic artwork thumbnail: a > div > div > img.
    artworkThumb: "div > " + ARTWORK_LINK + " > div > div > " + NEW_IMG,
    // "Recommended" thumbnails under an artwork.
    recommendThumb: 'div > a[class*="gtm-illust-recommend-thumbnail-link"][href*="artworks"] ' + NEW_IMG,
    // Ranking and request lists: ol > li > div > a > img.
    orderedListThumb: "ol > li > div > " + ARTWORK_LINK + " > " + NEW_IMG,
    // Images inside a <figure> (artwork page).
    figureImage: "section figure a" + NOT_UPLOAD_BUTTON + " > " + NEW_IMG,
    // Tag and search result grids.
    worksContent: 'div[data-ga4-label="works_content"] ' + ARTWORK_LINK + " " + NEW_IMG_NOT_ICON,
    // Search results and the home page "latest" grid.
    tagWorksContent: 'section[data-ga4-label="tag_works_content"] ul > li ' + ARTWORK_LINK + " " + NEW_IMG_NOT_ICON,
    // Home page "recommended" sections.
    homeRecommended: 'div[data-ga4-label="page_root"] > div > div > div > section ' + ARTWORK_LINK + " " + NEW_IMG_NOT_ICON,
    // Mobile search results (img is a direct child of the link).
    mobileThumbChild: 'a[data-ga4-label="thumbnail_link"] > ' + NEW_IMG_NOT_ICON,
    // Mobile artwork page (img nested deeper inside the link).
    mobileThumbNested: 'a[data-ga4-label="thumbnail_link"] ' + NEW_IMG_NOT_ICON,
};

const pageSelectors = [
    { regex: /^\/(?:\w+\/)?artworks\//, keys: ["artworkThumb", "recommendThumb", "figureImage", "mobileThumbChild", "mobileThumbNested"] },
    { regex: /^\/bookmark_new_illust\.php/, keys: ["artworkThumb", "mobileThumbChild", "mobileThumbNested"] },
    { regex: /^\/discovery/, keys: ["artworkThumb", "mobileThumbChild", "mobileThumbNested"] },
    { regex: /^\/stacc/, keys: ["mediumLink"] },
    { regex: /^\/ranking\.php/, keys: ["artworkThumb", "orderedListThumb", "mobileThumbChild", "mobileThumbNested"] },
    { regex: /^\/(?:\w+\/)?tags\//, keys: ["artworkThumb", "worksContent", "mobileThumbChild", "mobileThumbNested"] },
    { regex: /^\/search/, keys: ["artworkThumb", "worksContent", "tagWorksContent", "mobileThumbChild", "mobileThumbNested"] },
    { regex: /^\/(?:\w+\/)?users\//, keys: ["artworkThumb", "mobileThumbChild", "mobileThumbNested"] },
    { regex: /^\/(?:en\/)?$/, keys: ["artworkThumb", "tagWorksContent", "homeRecommended", "mobileThumbChild", "mobileThumbNested"] },
    { regex: /^\/(?:\w+\/)?request/, keys: ["orderedListThumb", "mobileThumbChild", "mobileThumbNested"] },
];
for (const entry of pageSelectors) {
    entry.selector = entry.keys.map(function(key) { return thumbSelectors[key]; }).join(", ");
}

const GLOBAL_CSS = [
    'li.image-item { overflow:visible !important }',
    '.pisas-mobile-bar-abs {',
    '  position: absolute; bottom: 0; left: 0; right: 0;',
    '  height: ' + mobileBarHeight + ';',
    '  z-index: 10;',
    '  pointer-events: none;',
    '  transition: background-color 0.3s ease;',
    '}',
    '.pisas-mobile-bar-flow {',
    '  display: block; width: 100%;',
    '  height: ' + mobileBarHeight + ';',
    '  transition: background-color 0.3s ease;',
    '}',
    '.pisas-main-bar {',
    '  display: block; width: 100%;',
    '  height: 6px;',
    '  margin: 8px 0;',
    '  border-radius: 3px;',
    '  transition: background-color 0.3s ease;',
    '}',
].join('\n');

// Debug panel
let _debugPanel = null;
const _debugLines = [];
const _debugSeen = new Set();
function debugLog(msg) {
    if (!PISAS_DEBUG) return;
    if (_debugSeen.has(msg)) return; // dedupe: same message shown once
    _debugSeen.add(msg);
    console.log("[PISAS]", msg);
    _debugLines.push(msg);
    if (_debugLines.length > 30) _debugLines.shift();
    if (!_debugPanel) {
        _debugPanel = document.createElement("div");
        _debugPanel.id = "pisas-debug";
        Object.assign(_debugPanel.style, {
            position: "fixed", bottom: "0", left: "0", right: "0",
            maxHeight: "50vh", overflowY: "auto", zIndex: "99999",
            background: "rgba(0,0,0,0.9)", color: "#0f0",
            fontSize: "11px", fontFamily: "monospace", padding: "6px",
            whiteSpace: "pre-wrap", wordBreak: "break-all",
            pointerEvents: "auto",
        });
        // tap to dismiss
        _debugPanel.addEventListener("click", function() {
            _debugPanel.style.display = _debugPanel.style.display === "none" ? "" : "none";
        });
        document.body.appendChild(_debugPanel);
    }
    _debugPanel.textContent = _debugLines.slice().reverse().join("\n");
    _debugPanel.scrollTop = 0; // keep newest visible
}

// Debug only: dump the DOM around artwork links to help find a working selector.
function debugDumpArtworkLinks() {
    const allArtLinks = document.querySelectorAll('a[href*="artworks"]');
    // Filter to actual illust links (/artworks/<number>), skip tag-overview links
    const artLinks = Array.prototype.filter.call(allArtLinks, function(a) {
        return /\/artworks\/\d+/.test(a.href);
    });
    debugLog("No thumbnails found. illust links: " + artLinks.length + " / total a[artworks]: " + allArtLinks.length);
    // Show DOM chain for up to 2 distinct samples
    const shownChains = new Set();
    for (let s = 0; s < artLinks.length && shownChains.size < 2; s++) {
        const sample = artLinks[s];
        const chain = [];
        let walk = sample.querySelector("img") || sample;
        for (let d = 0; d < 10 && walk && walk !== document.body; d++) {
            const tag = walk.tagName.toLowerCase();
            const cls = walk.className ? "." + String(walk.className).split(" ").slice(0, 2).join(".") : "";
            const ga4 = walk.getAttribute("data-ga4-label");
            let info = tag + cls;
            if (ga4) info += '[@data-ga4-label="' + ga4 + '"]';
            chain.unshift(info);
            walk = walk.parentElement;
        }
        const key = chain.join(">");
        if (shownChains.has(key)) continue;
        shownChains.add(key);
        debugLog("sample #" + s + " href: " + sample.href);
        debugLog("chain: " + chain.join(" > "));
        debugLog("innerHTML(150): " + sample.innerHTML.substring(0, 150));
    }
}

//====================================== Functions ======================================

function pageNumber(thumbImg, hasExpandedView) {
    if (!hasExpandedView) {
        return -1;
    }
    const link = thumbImg.closest("a");
    if (link && link.classList.contains("gtm-illust-recommend-thumbnail-link")) {
        return -1;
    }
    const url = thumbImg.src || thumbImg.href;
    // No real image URL to read the page from (empty src, or a data:/blob:
    // placeholder while lazy loading): match posts for any page.
    if (!url || /^(data:|blob:)/.test(url)) {
        return -1;
    }
    return pixivPageNumber(url);
}

function pixivIllustID(url) {
    if (!url) return null;
    const matcher = url.match(/\/(\d+)(?:-[a-f0-9]+)?(_|\.)[^\/]+$/) || url.match(/\/artworks\/(\d+)/);
    return matcher && matcher[1];
}

function pixivPageNumber(url) {
    if (!url) return "x";
    url = url.replace(/custom/g, "master").replace(/square/g, "master");
    const matcher = url.match(/_p(\d+)(_master\d+)?\./);
    return matcher ? matcher[1] : "x";
}

// GET via GM_xmlhttpRequest. Resolves with the response on load and rejects on
// network error, abort, or timeout, so every request settles exactly once.
function GM_fetch(url) {
    return new Promise((resolve, reject) => {
        const timeoutMs = sourceTimeout * 1000;
        let watchdog = null;
        const settle = (fn) => (arg) => {
            clearTimeout(watchdog);
            fn(arg);
        };
        const fail = (kind) => settle(() => reject(new Error("GM_xmlhttpRequest " + kind + ": " + url)));
        const request = GM_xmlhttpRequest({
            url: url,
            method: "GET",
            timeout: timeoutMs,
            onload: settle(resolve),
            onerror: fail("error"),
            onabort: fail("abort"),
            ontimeout: fail("timeout"),
        });
        // Fallback for script managers that ignore `timeout`.
        watchdog = setTimeout(() => {
            reject(new Error("GM_xmlhttpRequest timeout (watchdog): " + url));
            if (request && typeof request.abort === "function") request.abort();
        }, timeoutMs + 1000);
    });
}

function tokenizePixivURL(url) {
    let matcher = url.match(/(\d+\/\d+\/\d+\/\d+\/\d+\/\d+)\/(\d+)(?:-[a-f0-9]+)?(?:_big)?_p(\d+)(?:_\w*\d*)?[^\/]+$/);
    if (!matcher) {
        matcher = url.match(/(\d+\/\d+\/\d+\/\d+\/\d+\/\d+)\/(\d+)(?:-[a-f0-9]+)?(?:_big)?(?:_\w*\d*)?[^\/]+$/);
    }
    if (!matcher) {
        matcher = url.match(/([a-z0-9]+)\/(\d+)(?:_big)?_p(\d+)(?:_\w*\d*)?[^\/]+$/);
    }
    if (!matcher) {
        matcher = url.match(/([a-z0-9]+)\/(\d+)(?:_\w*\d*)?[^\/]+$/);
    }
    if (matcher) {
        matcher[3] = matcher[3] || 0;
    }
    return matcher ? matcher : [url, "", "", ""];
}

function createDummyDiv(thumbUrl, styles, mobile) {
    styles = styles || {};

    if (mobile) {
        // Mobile: just a colored bar, no links, no text
        // Class (abs vs flow) will be set by the placement code
        const bar = document.createElement("div");
        bar.className = "pisas-dummydiv";
        bar.style.backgroundColor = colorMap.searching;
        return bar;
    }

    // Desktop: original behavior
    styles = Object.assign(styles, {
        justifyContent: "center",
        display: "flex",
        paddingBottom: "1em",
    });
    const src = thumbUrl
        .replace(/c\/.+\/custom-thumb/, "img-master")
        .replace(/square1200/, "master1200")
        .replace(/custom1200/, "master1200");

    const dummyDiv = document.createElement("div");
    dummyDiv.className = "pisas-dummydiv";
    for (const name in styles) {
        dummyDiv.style[name] = styles[name];
    }

    const iqdbLink = document.createElement("a");
    iqdbLink.textContent = "(Q)";
    iqdbLink.href = iqdbURL + encodeURIComponent(src);
    const sauceNaoLink = document.createElement("a");
    sauceNaoLink.textContent = "(S)";
    sauceNaoLink.href = sauceURL + encodeURIComponent(src);

    dummyDiv.appendChild(iqdbLink);
    dummyDiv.appendChild(sauceNaoLink);

    return dummyDiv;
}

// A thumbnail whose pixiv ID can't be read yet (e.g. lazy src and href not set):
// clear the `pisas` mark so it is picked up again, up to maxIdAttempts polls.
function retryIdLater(thumbImg) {
    const tries = Number(thumbImg.getAttribute("data-pisas-id-tries")) + 1;
    thumbImg.setAttribute("data-pisas-id-tries", String(tries));
    if (tries < maxIdAttempts) {
        thumbImg.removeAttribute("pisas");
    }
}

// pixiv's SPA reuses thumbnail elements when navigating: the same <img> (or a
// new <img> in the same cell) can start showing another artwork. These track
// what each thumbnail and bar was made for, so leftovers can be replaced.
const thumbState = new WeakMap(); // img -> {anchor, key, bar}
const barInfo = new WeakMap(); // status bar -> {owner: img, pixivId}

function thumbKey(thumbImg, anchorEl) {
    return thumbImg.src + "\n" + (anchorEl ? anchorEl.href : "");
}

// Clears the `pisas` mark on images whose src/link changed since they were
// processed, so this poll picks them up again.
function resetReusedThumbs() {
    for (const img of document.querySelectorAll("img[pisas]")) {
        const state = thumbState.get(img);
        if (!state) continue;
        if ((state.anchor && !state.anchor.contains(img)) || thumbKey(img, state.anchor) !== state.key) {
            img.removeAttribute("pisas");
            img.removeAttribute("data-pisas-id-tries");
        }
    }
}

// This image shows nothing to search right now (UI icon, restricted-work
// placeholder, no link, or no readable pixiv ID). Drop the bar it still owns from
// an earlier artwork, and record its current src/href so it is only looked at
// again when they change.
function releaseThumb(thumbImg, anchorEl) {
    const previous = thumbState.get(thumbImg);
    if (previous && previous.bar) {
        const info = barInfo.get(previous.bar);
        if (info && info.owner === thumbImg) previous.bar.remove();
    }
    const anchor = anchorEl || (previous ? previous.anchor : null);
    thumbState.set(thumbImg, { anchor: anchor, key: thumbKey(thumbImg, anchor), bar: null });
}

// Looks at bars this image or its slot already has. A bar made for the same
// artwork is kept (returns true: nothing more to do). A bar made for another
// artwork whose owner image changed or is gone is removed. Bars that belong to
// another live thumbnail are left for the already-processed check.
function reconcileExistingBars(thumbImg, pixivId, state, bars) {
    let kept = null;
    for (const bar of bars) {
        const info = barInfo.get(bar);
        if (!info || (info.owner !== thumbImg && info.owner.isConnected)) continue;
        if (!kept && info.pixivId === pixivId) {
            kept = bar;
            continue;
        }
        bar.remove();
    }
    state.bar = kept;
    if (kept) barInfo.get(kept).owner = thumbImg;
    return kept !== null;
}

let _runCount = 0;
// Main functions
async function processThumbs() {
    _runCount++;
    const isNew = /^\/(?:en\/)?$|request/.test(location.pathname);
    const mobile = isMobile();

    const matchedSelectors = pageSelectors.find(function(it) { return it.regex.test(location.pathname); });
    if (!matchedSelectors) {
        debugLog("NO MATCH for path: " + location.pathname);
        return;
    }
    debugLog("path: " + location.pathname + " → selectors: [" + matchedSelectors.keys.join(",") + "]");

    resetReusedThumbs();
    const thumbSearch = document.querySelectorAll(matchedSelectors.selector);
    for (const item of thumbSearch) {
        item.setAttribute("pisas", "done");
    }
    if (thumbSearch.length === 0) {
        if (PISAS_DEBUG) debugDumpArtworkLinks();
        return;
    }
    debugLog("r" + _runCount + ": found " + thumbSearch.length + " imgs (mobile=" + mobile + ")");

    const ctx = {
        mobile: mobile,
        isNew: isNew,
        hasExpandedView: document.querySelector(".gtm-medium-work-expanded-view") !== null,
    };
    const thumbList = [];
    for (let t = 0; t < thumbSearch.length; t++) {
        // Isolate failures so one bad thumbnail doesn't drop the rest of the batch.
        try {
            const entry = prepareThumb(thumbSearch[t], t, ctx);
            if (entry) thumbList.push(entry);
        } catch (e) {
            console.error("[PISAS] failed to process a thumbnail:", e);
        }
    }
    debugLog("r" + _runCount + " thumbList size: " + thumbList.length);
    await sourceSearch(thumbList, mobile);
}

// Places the status bar for one thumbnail. Returns the entry to search for on
// Danbooru, or null when the thumbnail is skipped or source search is off.
function prepareThumb(thumbImg, t, ctx) {
    const mobile = ctx.mobile;
    const isNew = ctx.isNew;

    // Skip UI icons (badges, nav arrows) from s.pximg.net — these are NOT thumbnails
    // even though they may be inside an a[thumbnail_link] anchor.
    const imgSrc = thumbImg.src || "";
    if (imgSrc.indexOf("s.pximg.net") >= 0) {
        releaseThumb(thumbImg, null);
        return null;
    }

    // Walk up to find the correct anchor. Prefer one with data-ga4-label="thumbnail_link"
    // to avoid picking up anchors injected by other userscripts (e.g. Upload To Danbooru).
    let anchorEl = null;
    let fallbackAnchor = null;
    const walkTrace = [];
    for (let walk = thumbImg.parentElement; walk && walk.tagName !== "BODY"; walk = walk.parentElement) {
        if (PISAS_DEBUG && t === 0) {
            const lbl = walk.getAttribute("data-ga4-label");
            walkTrace.push(walk.tagName + (lbl ? "[" + lbl + "]" : ""));
        }
        if (walk.tagName === "A") {
            if (walk.getAttribute("data-ga4-label") === "thumbnail_link") {
                anchorEl = walk;
                break;
            }
            if (!fallbackAnchor && !walk.classList.contains("ex-utb-upload-button")) fallbackAnchor = walk;
        }
    }
    if (!anchorEl) anchorEl = fallbackAnchor;
    if (PISAS_DEBUG && t === 0) {
        debugLog("r" + _runCount + " walk: " + walkTrace.slice(0, 8).join(" > "));
        debugLog("r" + _runCount + " anchor: " + (anchorEl ? (anchorEl.tagName + " href=" + (anchorEl.href || "").substring(0, 60)) : "NONE"));
    }
    if (!anchorEl) { // no anchor at all — skip
        releaseThumb(thumbImg, null);
        return null;
    }

    // Remember what this image shows now, so a later reuse is noticed.
    const previous = thumbState.get(thumbImg);
    const state = { anchor: anchorEl, key: thumbKey(thumbImg, anchorEl), bar: previous ? previous.bar : null };
    thumbState.set(thumbImg, state);

    const thumbCont = anchorEl.parentNode;

    // For mobile: walk up to find the thumbnail cell wrapper
    // (marked with data-ga4-label="thumbnail"), fall back to anchor if not found
    let mobileCell = null;
    let hasRealCell = false;
    if (mobile) {
        let walk = anchorEl;
        for (let lvl = 0; lvl < 6 && walk; lvl++) {
            if (walk.getAttribute("data-ga4-label") === "thumbnail") {
                mobileCell = walk;
                hasRealCell = true;
                break;
            }
            walk = walk.parentElement;
        }
        if (!mobileCell) mobileCell = anchorEl; // fallback
    }

    // Extract pixiv ID BEFORE placing the bar.
    // Try img.src first, then anchor href. If that fails, try URL-decoded anchor href
    // (to handle other scripts that wrap the img in a Danbooru upload <a> with the
    // original pixiv URL URL-encoded in a query parameter).
    const sourceUrl = thumbImg.src || anchorEl.href;
    let pixivId = pixivIllustID(sourceUrl);
    if (!pixivId && anchorEl.href) {
        try { pixivId = pixivIllustID(decodeURIComponent(anchorEl.href)); } catch (e) {}
    }
    if (PISAS_DEBUG && t < 2) {
        debugLog("r" + _runCount + " img#" + t + " src: " + (thumbImg.src || "(empty)").substring(0, 80));
        debugLog("r" + _runCount + " img#" + t + " a.href: " + (anchorEl.href || "(empty)").substring(0, 80));
        debugLog("r" + _runCount + " img#" + t + " pixivId: " + pixivId);
    }
    // If no pixivId, don't place a bar we can't resolve; look at it again on a later poll.
    if (!pixivId) {
        releaseThumb(thumbImg, anchorEl);
        retryIdLater(thumbImg);
        return null;
    }

    if (!mobile) {
        thumbCont.style.marginBottom = isNew ? "" : "1em";
    }

    // Determine the container where the bar will go (mobile only)
    // This must be computed BEFORE the skip check so both use the same element.
    let barContainer = null;
    if (mobile) {
        barContainer = hasRealCell ? mobileCell : anchorEl;
        if (!hasRealCell) {
            // anchorEl on artwork pages often is display:inline, which doesn't work as
            // a proper positioning context for absolute children. Or it can be tiny
            // (display:contents). Fall back to the img's direct parent DIV which is
            // reliably block-level.
            const anchorRect = anchorEl.getBoundingClientRect();
            const anchorDisplay = window.getComputedStyle(anchorEl).display;
            const anchorUnusable = anchorRect.height < 10 || anchorRect.width < 10 ||
                anchorDisplay === "inline" || anchorDisplay === "contents";
            if (anchorUnusable) {
                const imgParent = thumbImg.parentElement;
                if (imgParent && imgParent.tagName === "DIV") {
                    barContainer = imgParent;
                }
            }
        }
    }

    // Bars already here from an earlier pass: this image's own bar and any in its slot.
    const existingBars = new Set();
    if (state.bar && state.bar.isConnected) existingBars.add(state.bar);
    (mobile ? barContainer : thumbCont).querySelectorAll(".pisas-dummydiv").forEach(function(bar) {
        existingBars.add(bar);
    });
    const nextSibling = thumbCont.nextElementSibling;
    if (!mobile && isNew && nextSibling && nextSibling.classList.contains("pisas-dummydiv")) {
        existingBars.add(nextSibling);
    }
    if (reconcileExistingBars(thumbImg, pixivId, state, existingBars)) {
        return null;
    }

    // Already-processed check
    if (mobile) {
        if (barContainer.querySelector(".pisas-dummydiv")) {
            if (t < 2) debugLog("r" + _runCount + " img#" + t + " SKIP: container already has bar");
            return null;
        }
    } else if (thumbCont.querySelector(".pisas-dummydiv")) {
        const next = thumbCont.nextElementSibling;
        if (!isNew || (next && next.classList.contains("pisas-dummydiv"))) {
            return null;
        }
    }

    const paddingBottom = (isNew || mobile) ? "" : "1em";
    const dummyDiv = createDummyDiv(thumbImg.src, { paddingBottom: paddingBottom }, mobile);
    barInfo.set(dummyDiv, { owner: thumbImg, pixivId: pixivId });
    state.bar = dummyDiv;

    if (mobile) {
        dummyDiv.classList.add("pisas-mobile-bar-abs");
        const curPos = window.getComputedStyle(barContainer).position;
        if (curPos === "static" || !curPos) {
            barContainer.style.position = "relative";
        }
        barContainer.appendChild(dummyDiv);
        // Log placement info for first few images to diagnose visibility
        if (PISAS_DEBUG && t < 2) {
            const rect = barContainer.getBoundingClientRect();
            const cs = window.getComputedStyle(barContainer);
            debugLog("r" + _runCount + " img#" + t + " placed in " + barContainer.tagName +
                " " + Math.round(rect.width) + "x" + Math.round(rect.height) +
                " d=" + cs.display + " p=" + cs.position + " o=" + cs.overflow);
        }
    } else if (isNew) {
        thumbCont.insertAdjacentElement("afterend", dummyDiv);
    } else {
        thumbCont.appendChild(dummyDiv);
    }

    if (!addSourceSearch || (thumbImg.src && thumbImg.src.indexOf("/novel/") >= 0)) {
        return null;
    }
    const page = pageNumber(thumbImg, ctx.hasExpandedView);
    if (mobile) {
        // Mobile: no <a>, dummyDiv itself is the target
        return {
            dummyDiv: dummyDiv,
            pixiv_id: pixivId,
            src: thumbImg.src,
            page: page,
            posts: [],
        };
    }
    dummyDiv.appendChild(document.createTextNode(" "));
    return {
        link: dummyDiv.appendChild(document.createElement("a")),
        dummyDiv: dummyDiv,
        pixiv_id: pixivId,
        src: thumbImg.src,
        page: page,
    };
}

// Process the CURRENT artwork's main image (not thumbnails) on /artworks/:id pages.
// Shows a colored bar indicating whether this artwork exists on Danbooru.
const likeLabels = ["좋아요!", "いいね!", "Like!"];

// Finds where the main artwork bar goes: BELOW the main artwork image but ABOVE the
// action bar (좋아요 row). Returns {target, desc} (insert before target) or null.
function findMainArtworkTarget() {
    // Strategy 1: find an element with "좋아요!" / "いいね!" / "Like!" text
    // Walk up to the row that contains it, then place bar BEFORE that row
    const allEls = document.querySelectorAll("button, a, div, span");
    for (let i = 0; i < allEls.length; i++) {
        const el = allEls[i];
        // Check the cheap child count first: textContent concatenates the whole subtree.
        if (el.children.length > 2) continue;
        if (likeLabels.indexOf((el.textContent || "").trim()) < 0) continue;
        let target = el;
        // Walk up to a row-wide container
        for (let up = 0; up < 5 && target.parentElement; up++) {
            if (target.getBoundingClientRect().width >= 200) break;
            target = target.parentElement;
        }
        return { target: target, desc: "like-row" };
    }

    // Strategy 2: fall back to h1.work-title (bar goes between action row and title)
    const title = document.querySelector("h1.work-title")
        || document.querySelector(".work-title")
        || document.querySelector('[class*="work-title"]');
    return title ? { target: title, desc: "work-title" } : null;
}

function describeTarget(placement) {
    if (placement.desc !== "like-row") return placement.desc;
    return "like-row (" + Math.round(placement.target.getBoundingClientRect().width) + "w)";
}

let _mainArtwork = null; // {id, bar}: the artwork whose bar is placed (and possibly still being searched)
async function processMainArtwork() {
    if (!isMobile()) return;

    const pathMatch = location.pathname.match(/\/artworks\/(\d+)/);
    if (!pathMatch) {
        _mainArtwork = null; // reset when leaving artwork page
        return;
    }
    const artworkId = pathMatch[1];

    // Once a bar exists for this artworkId, don't run again. If a page re-render
    // dropped the bar, put the same element back so its result (or the pending
    // search that will color it) is kept.
    if (_mainArtwork && _mainArtwork.id === artworkId) {
        if (!_mainArtwork.bar.isConnected) {
            const placement = findMainArtworkTarget();
            if (placement) {
                placement.target.parentNode.insertBefore(_mainArtwork.bar, placement.target);
                debugLog("main artwork bar re-attached for pixivId " + artworkId);
            }
        }
        return;
    }

    // Remove any stale bars from other artwork IDs (e.g. after navigation)
    document.querySelectorAll(".pisas-main-bar").forEach(function(el) {
        if (el.getAttribute("data-pixiv-id") !== artworkId) el.remove();
    });

    // Extra safety: if a bar for this ID somehow already exists, don't create another
    const existing = document.querySelector(".pisas-main-bar[data-pixiv-id='" + artworkId + "']");
    if (existing) {
        _mainArtwork = { id: artworkId, bar: existing };
        return;
    }

    const placement = findMainArtworkTarget();
    if (!placement) {
        debugLog("main artwork: no placement target found");
        return; // retry next tick
    }

    // Create the bar
    const bar = document.createElement("div");
    bar.className = "pisas-main-bar";
    bar.setAttribute("data-pixiv-id", artworkId);
    bar.style.backgroundColor = colorMap.searching;
    placement.target.parentNode.insertBefore(bar, placement.target);
    _mainArtwork = { id: artworkId, bar: bar }; // set before awaiting so later ticks skip this artwork
    if (PISAS_DEBUG) debugLog("main artwork bar placed for pixivId " + artworkId + " via " + describeTarget(placement));

    // Query Danbooru
    const url = danbooruURL + 'posts.json?limit=100&only=id&tags=status:any+pixiv:' + artworkId;
    try {
        const resp = await GM_fetch(url);
        const result = JSON.parse(resp.responseText);
        if (!result || !Array.isArray(result)) {
            bar.style.backgroundColor = colorMap.error;
            return;
        }
        if (result.length === 0) {
            bar.style.backgroundColor = colorMap.missing;
            debugLog("main artwork " + artworkId + ": missing");
        } else {
            bar.style.backgroundColor = colorMap.found;
            debugLog("main artwork " + artworkId + ": found (" + result.length + " posts)");
        }
    } catch (e) {
        bar.style.backgroundColor = colorMap.error;
        debugLog("main artwork " + artworkId + ": error");
    }
}

// Resolve result color for a thumb
function resolveColor(thumb) {
    if (thumb.posts.length === 0) return null; // not resolved yet
    // If thumb.src is a placeholder (data URL, blob, empty), we can't parse a version
    // to compare against Danbooru's source. Default to "found" rather than wrongly flagging
    // everything as mismatch.
    const hasUsableSrc = thumb.src && !/^(data:|blob:)/.test(thumb.src);
    if (thumb.posts.length === 1) {
        if (!ignoreMismatch && hasUsableSrc && tokenizePixivURL(thumb.src)[1] !== tokenizePixivURL(thumb.posts[0].src)[1]) {
            if (!ignoreBadRevision && thumb.posts[0].isBadRevision) return "badRevision";
            return "mismatch";
        }
        return "found";
    }
    // multi
    if (ignoreMismatch || !hasUsableSrc) return "found";
    const postsMap = thumb.posts.map(function (x) {
        return [tokenizePixivURL(x.src), x.isBadRevision];
    });
    const revDate = tokenizePixivURL(thumb.src)[1];
    const store = {};
    postsMap.forEach(function (post) {
        store[post[0][3]] = store[post[0][3]] || [];
        store[post[0][3]].push([post[0][1], post[1]]);
    });
    const matchArray = [];
    for (const pageIndex in store) {
        let isMatch = false, seenBadRevision = false;
        for (let j = 0; j < store[pageIndex].length; j++) {
            if (store[pageIndex][j][0] === revDate) { isMatch = true; break; }
            else if (store[pageIndex][j][1] && !ignoreBadRevision) { seenBadRevision = true; }
        }
        if (isMatch) matchArray.push(true);
        else if (!seenBadRevision) matchArray.push(false);
        else matchArray.push("bad revision");
    }
    if (matchArray.includes(false)) return "mismatch";
    if (matchArray.includes("bad revision")) return "badRevision";
    return "found";
}

// Desktop style helpers (unchanged logic)
function desktopStyleStr(colorKey) {
    if (colorKey === "found") return styleSourceFound;
    if (colorKey === "mismatch") return styleSourceMismatch;
    if (colorKey === "badRevision") return styleSourceBadRevision;
    if (colorKey === "missing") return styleSourceMissing;
    return "color:blue; font-weight: bold;";
}

// Groups Danbooru posts by pixiv ID (as a string) and precomputes the per-post
// values the matching loop needs.
function indexPostsByPixivId(posts) {
    const byId = new Map();
    for (const post of posts) {
        const key = String(post.pixiv_id);
        let list = byId.get(key);
        if (!list) {
            list = [];
            byId.set(key, list);
        }
        list.push({
            post: post,
            page: pixivPageNumber(post.source),
            isBadRevision: (post.tag_string || "").split(" ").includes("has_bad_revision"),
        });
    }
    return byId;
}

function isThumbAttached(thumb) {
    return thumb.dummyDiv.isConnected;
}

// Fields of posts.json that sourceSearch reads.
const SOURCE_SEARCH_FIELDS = "id,pixiv_id,source,tag_string,rating,score";

let _searchSeq = 0;
// `mobile` is fixed per batch: the entries were built for one layout, so it must
// not be re-read from the window width on retries or later pages.
async function sourceSearch(thumbList, mobile, attempt, page, seq) {
    if (seq === undefined) seq = ++_searchSeq;

    if (page === undefined) {
        attempt = page = 1;
        for (const thumb of thumbList) {
            if (!mobile) {
                if (!thumb.status) {
                    thumb.status = thumb.link.parentNode.appendChild(document.createElement("span"));
                }
                thumb.link.textContent = "Searching...";
            }
            thumb.posts = thumb.posts || [];
        }
    } else {
        // Retry or next page: stop for thumbnails whose bar is no longer on the page
        // (e.g. removed by a page re-render).
        const live = thumbList.filter(isThumbAttached);
        if (live.length === 0) return;
        // Narrowing the ID list is only safe on page 1; later pages must keep the
        // same query or results would shift between pages.
        if (page === 1) thumbList = live;
    }

    if (attempt >= maxAttempts) {
        for (const thumb of thumbList) {
            if (mobile) {
                thumb.dummyDiv.style.backgroundColor = colorMap.error;
            } else {
                thumb.status.style.display = "none";
                if (thumb.link.textContent[0] !== '(') {
                    thumb.link.textContent = "(error)";
                }
                thumb.link.setAttribute("style", "color:blue; font-weight: bold;");
            }
        }
        return;
    }

    if (thumbList.length === 0) {
        return;
    }

    const batch = thumbList;
    const retry = function () {
        setTimeout(function () {
            sourceSearch(batch, mobile, attempt + 1, page, seq);
        }, maxAttempts === 0 ? 0 : 1000);
    };

    const idSet = new Set();
    for (const thumb of thumbList) {
        if (!mobile) {
            thumb.status.textContent = " [" + attempt + "]";
        }
        idSet.add(thumb.pixiv_id);
    }

    const url = danbooruURL + 'posts.json?limit=100&only=' + SOURCE_SEARCH_FIELDS +
        '&tags=status:any+pixiv:' + Array.from(idSet).join() + '&page=' + page;
    debugLog("[#" + seq + "] API call: " + idSet.size + " IDs, attempt " + attempt + ", page " + page);
    let responseDetails;
    try {
        responseDetails = await GM_fetch(url);
    } catch (e) {
        debugLog("[#" + seq + "] API request failed: " + e.message);
        return retry();
    }

    let result = false, status = null;

    if (/^ *$/.test(responseDetails.responseText)) {
        status = "(error)";
    } else if (responseDetails.status === 503) {
        addSourceSearch = false;
        maxAttempts = 0;
        status = "(Downbooru)";
    } else {
        try {
            result = JSON.parse(responseDetails.responseText);
            if (result.success !== false) {
                status = "Searching...";
            } else {
                status = "(" + (result.message || "error") + ")";
                addSourceSearch = false;
                maxAttempts = 0;
                result = false;
            }
        } catch (err) {
            result = false;
            status = "(parse error)";
        }
    }
    debugLog("[#" + seq + "] API resp: http=" + responseDetails.status + ", status=" + status + ", count=" + (result ? result.length : "N/A"));
    if (!mobile) {
        for (const thumb of thumbList) {
            thumb.link.textContent = status;
        }
    }

    if (result === false) {
        return retry();
    }

    const postsById = indexPostsByPixivId(result);
    let appliedFound = 0;
    for (const thumb of thumbList) {
        const candidates = postsById.get(String(thumb.pixiv_id)) || [];
        for (const candidate of candidates) {
            const post = candidate.post;
            if (thumb.posts.some(function(p) { return p.id === post.id; })) continue;
            if (!(thumb.page < 0 || thumb.page === candidate.page)) continue;
            if (!mobile) {
                thumb.link.title = post.tag_string + " rating:" + post.rating + " score:" + post.score;
            }
            thumb.posts.push({
                "id": post.id,
                "src": post.source,
                "isBadRevision": candidate.isBadRevision,
            });
        }

        if (thumb.posts.length >= 1) {
            const colorKey = resolveColor(thumb);
            if (mobile) {
                thumb.dummyDiv.style.backgroundColor = colorMap[colorKey];
                appliedFound++;
            } else {
                if (thumb.posts.length === 1) {
                    thumb.link.textContent = "post #" + thumb.posts[0].id;
                    thumb.link.href = danbooruURL + "posts/" + thumb.posts[0].id;
                } else {
                    thumb.link.textContent = "(" + thumb.posts.length + " sources)";
                    thumb.link.href = danbooruURL + "posts?tags=status:any+pixiv:" + thumb.pixiv_id;
                    thumb.link.removeAttribute("title");
                }
                thumb.link.setAttribute("style", desktopStyleStr(colorKey));
            }
        }
    }
    debugLog("[#" + seq + "] colors applied: " + appliedFound + "/" + thumbList.length);

    if (result.length === 100) {
        sourceSearch(thumbList, mobile, attempt + 1, page + 1, seq);
    } else {
        let missingCount = 0;
        for (const thumb of thumbList) {
            if (!mobile && thumb.status) {
                thumb.status.style.display = "none";
            }
            if (thumb.posts.length === 0) {
                if (mobile) {
                    thumb.dummyDiv.style.backgroundColor = colorMap.missing;
                    missingCount++;
                } else {
                    thumb.link.textContent = "(no sources)";
                    thumb.link.setAttribute("style", styleSourceMissing);
                }
            }
        }
        debugLog("[#" + seq + "] final: missing=" + missingCount + "/" + thumbList.length);
    }
}

//====================================== Start ======================================

if (window === window.top) {
    const style = document.createElement('style');
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);

    setInterval(async () => {
        try {
            await processThumbs();
        } catch (e) {
            console.error("[PISAS] processThumbs failed:", e);
        }
        try {
            await processMainArtwork();
        } catch (e) {
            console.error("[PISAS] processMainArtwork failed:", e);
        }
    }, imageCheckPeriod);
}
