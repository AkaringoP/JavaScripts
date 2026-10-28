// ==UserScript==
// @name         Pixiv Image Searches and Stuff
// @description  Searches Danbooru for pixiv IDs and source mismatches, adds IQDB image search links, and filters images based on pixiv favorites.
// @match        *://www.pixiv.net/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_xmlhttpRequest
// @downloadURL  https://github.com/nottalulah/userscripts/raw/master/Pixiv_Image_Searches_and_Stuff.user.js
// @require      https://cdnjs.cloudflare.com/ajax/libs/jquery/3.2.1/jquery.min.js
// @version      2026.04.16
// ==/UserScript==

/* You must be logged into Danbooru (or your preferred site mirror) for all features to work! */

var danbooruURL = "https://danbooru.donmai.us/";
var iqdbURL = "https://danbooru.donmai.us/iqdb_queries?url=";
var sauceURL = "https://saucenao.com/search.php?db=999&url=";
var addIQDBSearch = true;
var addSourceSearch = true;
var ignoreMismatch = false;
var ignoreBadRevision = false;

/* CSS Styling + Other Options */
var styleSourceFound = "color:green; font-weight: bold;";
var styleSourceMismatch = "color:purple; font-weight: bold;";
var styleSourceBadRevision = "color:darkorange; font-weight: bold; font-style: italic;";
var styleSourceMissing = "color:red;";
var sourceTimeout = 20;
var maxAttempts = 10;
var imageCheckPeriod = 1000;
var thumbCheckPeriod = 1000;
var pixivTransparentSrc = "https://s.pximg.net/www/images/common/transparent.gif";

/* Mobile Options */
var mobileBreakpoint = 768;
var mobileBarHeight = "4px";

/* Debug — set to true to show a floating debug panel on the page */
var PISAS_DEBUG = false;

//////////////////////////////////////////////////////////////////////////////////////

function isMobile() {
    return window.innerWidth <= mobileBreakpoint;
}

// Mobile color map
var colorMap = {
    found:       "#22cc22",
    mismatch:    "#800080",
    badRevision: "#ff8c00",
    missing:     "#ff3333",
    searching:   "#888888",
    error:       "#4444ff",
};

const xsearchselectors = [
    "descendant-or-self::div/a[contains(@href,'mode=medium')]//img[not(@pisas)]", // 0
    "descendant-or-self::div/a[contains(@href,'artworks') and not(contains(@class,'ex-utb-upload-button'))]/div/div/img[not(@pisas)]", // 1
    "descendant-or-self::div/a[contains(@class,'gtm-illust-recommend-thumbnail-link') and contains(@href,'artworks')]//img[not(@pisas)]", // 2
    "descendant-or-self::section/div/div/ul/li//div/a[contains(@href,'artworks') and not(contains(@class,'ex-utb-upload-button'))]/div/div/img[not(@pisas)]", // 3
    "descendant-or-self::section/div/div/ul/li//div/a[contains(@href,'artworks') and not(contains(@class,'ex-utb-upload-button'))]/div/img[not(@pisas)]", // 5
    "descendant-or-self::ol/li/div/a[contains(@href,'artworks') and not(contains(@class,'ex-utb-upload-button'))]/img[not(@pisas)]", // 7
    "descendant-or-self::section//figure//a[not(contains(@class,'ex-utb-upload-button'))]/img[not(@pisas)]", // 8
    "descendant-or-self::div[@data-ga4-label = 'works_content']//a[contains(@href,'artworks') and not(contains(@class,'ex-utb-upload-button'))]//img[not(@pisas) and not(contains(@class,'ex-utb-upload-button-icon'))]", // 7 (for real)
    "descendant-or-self::section[@data-ga4-label = 'tag_works_content']//ul/li//a[contains(@href,'artworks') and not(contains(@class,'ex-utb-upload-button'))]//img[not(@pisas) and not(contains(@class,'ex-utb-upload-button-icon'))]", // 8, latest
    "descendant-or-self::div[@data-ga4-label = 'page_root']/div/div/div/section//a[contains(@href,'artworks') and not(contains(@class,'ex-utb-upload-button'))]//img[not(@pisas) and not(contains(@class,'ex-utb-upload-button-icon'))]", // 9, recommended
    "descendant-or-self::a[@data-ga4-label = 'thumbnail_link']/img[not(@pisas) and not(contains(@class,'ex-utb-upload-button-icon'))]", // 10, mobile pixiv search (direct child)
    "descendant-or-self::a[@data-ga4-label = 'thumbnail_link']//img[not(@pisas) and not(contains(@class,'ex-utb-upload-button-icon'))]", // 11, mobile pixiv artwork page (descendant)
];

const pageselectors = [
    { regex: /^\/(?:\w+\/)?artworks\//, selectors: [1, 2, 6, 10, 11] },
    { regex: /^\/bookmark_new_illust\.php/, selectors: [1, 10, 11] },
    { regex: /^\/discovery/, selectors: [1, 10, 11] },
    { regex: /^\/stacc/, selectors: [0] },
    { regex: /^\/ranking\.php/, selectors: [1, 5, 10, 11] },
    { regex: /^\/(?:\w+\/)?tags\//, selectors: [1, 7, 10, 11] },
    { regex: /^\/search/, selectors: [1, 7, 8, 10, 11] },
    { regex: /^\/(?:\w+\/)?users\//, selectors: [1, 10, 11] },
    { regex: /^\/(?:en\/)?$/, selectors: [1, 8, 9, 10, 11] },
    { regex: /^\/(?:\w+\/)?request/, selectors: [5, 10, 11] },
];

if (window == window.top) {
    var style = document.createElement('style');
    style.type = 'text/css';
    style.innerHTML = [
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
    document.getElementsByTagName('head')[0].appendChild(style);

    setInterval(async () => {
        await processThumbs();
        await processMainArtwork();
    }, imageCheckPeriod);
}

// Debug panel
var _debugPanel = null;
var _debugLines = [];
var _debugSeen = {};
function debugLog(msg) {
    if (!PISAS_DEBUG) return;
    if (_debugSeen[msg]) return; // dedupe: same message shown once
    _debugSeen[msg] = true;
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

//====================================== Functions ======================================

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function pageNumber(thumbImg) {
    if (!$(".gtm-medium-work-expanded-view").length) {
        return -1;
    } else if (thumbImg.closest("a")?.classList?.contains("gtm-illust-recommend-thumbnail-link")) {
        return -1;
    } else {
        return pixivPageNumber(thumbImg.src || thumbImg.href);
    }
}

function pixivIllustID(url) {
    var matcher = url.match(/\/(\d+)(?:-[a-f0-9]+)?(_|\.)[^\/]+$/) || url.match(/\/artworks\/(\d+)/);
    return matcher && matcher[1];
}

function pixivPageNumber(url) {
    url = url.replace(/custom/g, "master").replace(/square/g, "master");
    var matcher = url.match(/_p(\d+)(_master\d+)?\./);
    return matcher ? matcher[1] : "x";
}

function GM_fetch(url, params) {
    return new Promise((resolve) => {
        GM_xmlhttpRequest({
            url: url,
            method: "GET",
            ...params,
            onload: resolve,
        });
    });
}

function tokenizePixivURL(url) {
    var matcher = url.match(/(\d+\/\d+\/\d+\/\d+\/\d+\/\d+)\/(\d+)(?:-[a-f0-9]+)?(?:_big)?_p(\d+)(?:_\w*\d*)?[^\/]+$/);
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

function createDummyDiv(thumbUrl, styles) {
    styles = styles || {};
    var mobile = isMobile();

    if (mobile) {
        // Mobile: just a colored bar, no links, no text
        // Class (abs vs flow) will be set by the placement code
        var bar = document.createElement("div");
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
    var src = thumbUrl
        .replace(/c\/.+\/custom-thumb/, "img-master")
        .replace(/square1200/, "master1200")
        .replace(/custom1200/, "master1200");

    var dummyDiv = document.createElement("div");
    dummyDiv.className = "pisas-dummydiv";
    for (let name in styles) {
        dummyDiv.style[name] = styles[name];
    }

    var iqdbLink = document.createElement("a");
    iqdbLink.textContent = "(Q)";
    iqdbLink.href = iqdbURL + src;
    var sauceNaoLink = document.createElement("a");
    sauceNaoLink.textContent = "(S)";
    sauceNaoLink.href = sauceURL + src;

    dummyDiv.appendChild(iqdbLink);
    dummyDiv.appendChild(sauceNaoLink);

    return dummyDiv;
}

var _runCount = 0;
// Main functions
async function processThumbs() {
    _runCount++;
    var isNew = /\/((?:en\/)?$)|request/.test(window.location.pathname);
    var mobile = isMobile();

    var thumbSearch = [],
        thumbList = [];

    var matchedSelectors = pageselectors.filter(function(it) { return it.regex.test(location.pathname); })[0];
    if (!matchedSelectors) {
        debugLog("NO MATCH for path: " + location.pathname);
        return;
    }
    debugLog("path: " + location.pathname + " → selectors: [" + matchedSelectors.selectors.join(",") + "]");

    var xpathSelector = matchedSelectors.selectors.map(function(i) { return xsearchselectors[i]; }).join(" | ");
    var results = document.evaluate(xpathSelector, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < results.snapshotLength; i++) {
        var item = results.snapshotItem(i);
        thumbSearch.push(item);
        item.setAttribute("pisas", "done");
    }
    if (thumbSearch.length === 0) {
        // Debug: dump DOM around artwork links to find correct selector
        var allArtLinks = document.querySelectorAll('a[href*="artworks"]');
        // Filter to actual illust links (/artworks/<number>), skip tag-overview links
        var artLinks = Array.prototype.filter.call(allArtLinks, function(a) {
            return /\/artworks\/\d+/.test(a.href);
        });
        debugLog("XPath found 0 imgs. illust links: " + artLinks.length + " / total a[artworks]: " + allArtLinks.length);
        if (artLinks.length > 0) {
            // Show DOM chain for up to 2 distinct samples
            var shownChains = {};
            var shownCount = 0;
            for (var s = 0; s < artLinks.length && shownCount < 2; s++) {
                var sample = artLinks[s];
                var el = sample.querySelector("img") || sample;
                var chain = [];
                var walk = el;
                for (var d = 0; d < 10 && walk && walk !== document.body; d++) {
                    var tag = walk.tagName.toLowerCase();
                    var cls = walk.className ? "." + String(walk.className).split(" ").slice(0,2).join(".") : "";
                    var ga4 = walk.getAttribute("data-ga4-label");
                    var info = tag + cls;
                    if (ga4) info += '[@data-ga4-label="' + ga4 + '"]';
                    chain.unshift(info);
                    walk = walk.parentElement;
                }
                var key = chain.join(">");
                if (shownChains[key]) continue;
                shownChains[key] = true;
                shownCount++;
                debugLog("sample #" + s + " href: " + sample.href);
                debugLog("chain: " + chain.join(" > "));
                debugLog("innerHTML(150): " + sample.innerHTML.substring(0, 150));
            }
        }
        return;
    }
    debugLog("r" + _runCount + ": found " + thumbSearch.length + " imgs (mobile=" + mobile + ")");
    for (let t = 0; t < thumbSearch.length; t++) {
        var thumbImg = thumbSearch[t];

        // Skip UI icons (badges, nav arrows) from s.pximg.net — these are NOT thumbnails
        // even though they may be inside an a[thumbnail_link] anchor.
        var imgSrc = thumbImg.src || "";
        if (imgSrc.indexOf("s.pximg.net") >= 0) {
            continue;
        }

        // Walk up to find the correct anchor. Prefer one with data-ga4-label="thumbnail_link"
        // to avoid picking up anchors injected by other userscripts (e.g. Upload To Danbooru).
        var anchorEl = null;
        var fallbackAnchor = null;
        var walk = thumbImg.parentElement;
        var walkTrace = [];
        while (walk && walk.tagName !== "BODY") {
            if (t === 0) {
                var lbl = walk.getAttribute && walk.getAttribute("data-ga4-label");
                walkTrace.push(walk.tagName + (lbl ? "[" + lbl + "]" : ""));
            }
            if (walk.tagName === "A") {
                var isUploadBtn = walk.classList && walk.classList.contains("ex-utb-upload-button");
                if (walk.getAttribute && walk.getAttribute("data-ga4-label") === "thumbnail_link") {
                    anchorEl = walk;
                    break;
                }
                if (!fallbackAnchor && !isUploadBtn) fallbackAnchor = walk;
            }
            walk = walk.parentElement;
        }
        if (!anchorEl) anchorEl = fallbackAnchor;
        if (t === 0) {
            debugLog("r" + _runCount + " walk: " + walkTrace.slice(0, 8).join(" > "));
            debugLog("r" + _runCount + " anchor: " + (anchorEl ? (anchorEl.tagName + " href=" + (anchorEl.href || "").substring(0, 60)) : "NONE"));
        }
        if (!anchorEl) continue; // no anchor at all — skip

        var thumbCont = anchorEl.parentNode;

        // For mobile: walk up to find the thumbnail cell wrapper
        // (marked with data-ga4-label="thumbnail"), fall back to anchor if not found
        var mobileCell = null;
        var hasRealCell = false;
        if (mobile) {
            var walk = anchorEl;
            for (var lvl = 0; lvl < 6 && walk; lvl++) {
                if (walk.getAttribute && walk.getAttribute("data-ga4-label") === "thumbnail") {
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
        var sourceUrl = thumbImg.src || anchorEl.href;
        var pixivId = pixivIllustID(sourceUrl);
        if (!pixivId && anchorEl.href) {
            try { pixivId = pixivIllustID(decodeURIComponent(anchorEl.href)); } catch (e) {}
        }
        if (t < 2) {
            debugLog("r" + _runCount + " img#" + t + " src: " + (thumbImg.src || "(empty)").substring(0, 80));
            debugLog("r" + _runCount + " img#" + t + " a.href: " + (anchorEl.href || "(empty)").substring(0, 80));
            debugLog("r" + _runCount + " img#" + t + " pixivId: " + pixivId);
        }
        // If no pixivId, skip — don't place a bar we can't resolve
        if (!pixivId) continue;

        if (!mobile) {
            thumbCont.style.marginBottom = isNew ? "" : "1em";
        }

        // Determine the container where the bar will go (mobile only)
        // This must be computed BEFORE the skip check so both use the same element.
        var barContainer = null;
        if (mobile) {
            barContainer = hasRealCell ? mobileCell : anchorEl;
            if (!hasRealCell) {
                // anchorEl on artwork pages often is display:inline, which doesn't work as
                // a proper positioning context for absolute children. Or it can be tiny
                // (display:contents). Fall back to the img's direct parent DIV which is
                // reliably block-level.
                var anchorRect = anchorEl.getBoundingClientRect();
                var anchorDisplay = window.getComputedStyle(anchorEl).display;
                var anchorUnusable = anchorRect.height < 10 || anchorRect.width < 10 ||
                    anchorDisplay === "inline" || anchorDisplay === "contents";
                if (anchorUnusable) {
                    var imgParent = thumbImg.parentElement;
                    if (imgParent && imgParent.tagName === "DIV") {
                        barContainer = imgParent;
                    }
                }
            }
        }

        // Already-processed check
        if (mobile) {
            if ($(".pisas-dummydiv", barContainer).length > 0) {
                if (t < 2) debugLog("r" + _runCount + " img#" + t + " SKIP: container already has bar");
                continue;
            }
        } else {
            if ($(".pisas-dummydiv", thumbCont).length > 0) {
                if (!isNew || $(thumbCont).next(".pisas-dummydiv").length > 0) {
                    continue;
                }
            }
        }

        var paddingBottom = (isNew || mobile) ? "" : "1em";
        var dummyDiv = createDummyDiv(thumbImg.src, { paddingBottom: paddingBottom });

        if (mobile) {
            dummyDiv.classList.add("pisas-mobile-bar-abs");
            var curPos = window.getComputedStyle(barContainer).position;
            if (curPos === "static" || !curPos) {
                barContainer.style.position = "relative";
            }
            barContainer.appendChild(dummyDiv);
            // Log placement info for first few images to diagnose visibility
            if (t < 2) {
                var rect = barContainer.getBoundingClientRect();
                var cs = window.getComputedStyle(barContainer);
                debugLog("r" + _runCount + " img#" + t + " placed in " + barContainer.tagName +
                    " " + Math.round(rect.width) + "x" + Math.round(rect.height) +
                    " d=" + cs.display + " p=" + cs.position + " o=" + cs.overflow);
            }
        } else if (isNew) {
            thumbCont.insertAdjacentElement("afterend", dummyDiv);
        } else {
            thumbCont.appendChild(dummyDiv);
        }

        if (addSourceSearch && (!thumbImg.src || thumbImg.src.indexOf("/novel/") < 0)) {
            var page = pageNumber(thumbImg);
            if (mobile) {
                // Mobile: no <a>, dummyDiv itself is the target
                thumbList.push({
                    dummyDiv: dummyDiv,
                    pixiv_id: pixivId,
                    src: thumbImg.src,
                    page: page,
                    posts: [],
                });
            } else {
                dummyDiv.appendChild(document.createTextNode(" "));
                thumbList.push({
                    link: dummyDiv.appendChild(document.createElement("a")),
                    dummyDiv: dummyDiv,
                    pixiv_id: pixivId,
                    src: thumbImg.src,
                    page: page,
                });
            }
        }
    }
    debugLog("r" + _runCount + " thumbList size: " + thumbList.length);
    await sourceSearch(thumbList);
}

// Process the CURRENT artwork's main image (not thumbnails) on /artworks/:id pages.
// Shows a colored bar indicating whether this artwork exists on Danbooru.
var _mainArtworkProcessed = null; // holds the artworkId that is currently being processed / done
async function processMainArtwork() {
    if (!isMobile()) return;

    var pathMatch = location.pathname.match(/\/artworks\/(\d+)/);
    if (!pathMatch) {
        _mainArtworkProcessed = null; // reset when leaving artwork page
        return;
    }
    var artworkId = pathMatch[1];

    // Prevent duplicate runs: once we're processing (or done) for this artworkId, don't run again
    if (_mainArtworkProcessed === artworkId) return;
    _mainArtworkProcessed = artworkId;

    // Remove any stale bars from other artwork IDs (e.g. after navigation)
    document.querySelectorAll(".pisas-main-bar").forEach(function(el) {
        if (el.getAttribute("data-pixiv-id") !== artworkId) el.remove();
    });

    // Extra safety: if a bar for this ID somehow already exists, don't create another
    if (document.querySelector(".pisas-main-bar[data-pixiv-id='" + artworkId + "']")) return;

    // Find a placement target. We want the bar to appear BELOW the main artwork image
    // but ABOVE the action bar (좋아요 row). Try several strategies in priority order.
    var target = null;
    var targetDesc = "";

    // Strategy 1: find an element with "좋아요!" / "いいね!" / "Like!" text
    // Walk up to the row that contains it, then place bar BEFORE that row
    var likeLabels = ["좋아요!", "いいね!", "Like!"];
    var allEls = document.querySelectorAll("button, a, div, span");
    for (var i = 0; i < allEls.length && !target; i++) {
        var txt = (allEls[i].textContent || "").trim();
        if (likeLabels.indexOf(txt) >= 0 && allEls[i].children.length <= 2) {
            target = allEls[i];
            // Walk up to a row-wide container
            for (var up = 0; up < 5 && target.parentElement; up++) {
                var rect = target.getBoundingClientRect();
                if (rect.width >= 200) break;
                target = target.parentElement;
            }
            targetDesc = "like-row (" + Math.round(target.getBoundingClientRect().width) + "w)";
        }
    }

    // Strategy 2: fall back to h1.work-title (bar goes between action row and title)
    if (!target) {
        target = document.querySelector("h1.work-title")
            || document.querySelector(".work-title")
            || document.querySelector('[class*="work-title"]');
        if (target) targetDesc = "work-title";
    }

    if (!target) {
        debugLog("main artwork: no placement target found");
        _mainArtworkProcessed = null; // allow retry next tick
        return;
    }

    // Create the bar
    var bar = document.createElement("div");
    bar.className = "pisas-main-bar";
    bar.setAttribute("data-pixiv-id", artworkId);
    bar.style.backgroundColor = colorMap.searching;
    target.parentNode.insertBefore(bar, target);
    debugLog("main artwork bar placed for pixivId " + artworkId + " via " + targetDesc);

    // Query Danbooru
    var url = danbooruURL + 'posts.json?limit=100&tags=status:any+pixiv:' + artworkId;
    try {
        var resp = await GM_fetch(url);
        var result = JSON.parse(resp.responseText);
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

var _searchSeq = 0;
async function sourceSearch(thumbList, attempt, page, seq) {
    var mobile = isMobile();
    if (seq === undefined) seq = ++_searchSeq;

    if (page === undefined) {
        attempt = page = 1;
        for (let i = 0; i < thumbList.length; i++) {
            if (!mobile) {
                if (!thumbList[i].status) {
                    thumbList[i].status = thumbList[i].link.parentNode.appendChild(document.createElement("span"));
                }
                thumbList[i].link.textContent = "Searching...";
            }
            thumbList[i].posts = thumbList[i].posts || [];
        }
    }

    if (attempt >= maxAttempts) {
        for (let i = 0; i < thumbList.length; i++) {
            if (mobile) {
                thumbList[i].dummyDiv.style.backgroundColor = colorMap.error;
            } else {
                thumbList[i].status.style.display = "none";
                if (thumbList[i].link.textContent[0] != '(') {
                    thumbList[i].link.textContent = "(error)";
                }
                thumbList[i].link.setAttribute("style", "color:blue; font-weight: bold;");
            }
        }
        return;
    }

    if (thumbList.length === 0) {
        return;
    }

    var retry = (function (a, b, c, s) {
        return function () {
            setTimeout(function () {
                sourceSearch(a, b, c, s);
            }, maxAttempts === 0 ? 0 : 1000);
        };
    })(thumbList, attempt + 1, page, seq);
    var sourceTimer = setTimeout(retry, sourceTimeout * 1000);

    var idList = [];
    for (let i = 0; i < thumbList.length; i++) {
        if (!mobile) {
            thumbList[i].status.textContent = " [" + attempt + "]";
        }
        if (idList.indexOf(thumbList[i].pixiv_id) < 0) {
            idList.push(thumbList[i].pixiv_id);
        }
    }

    var url = danbooruURL + 'posts.json?limit=100&tags=status:any+pixiv:' + idList.join() + '&page=' + page;
    debugLog("[#" + seq + "] API call: " + idList.length + " IDs, attempt " + attempt + ", page " + page);
    var responseDetails = await GM_fetch(url, { onerror: retry, onabort: retry });
    clearTimeout(sourceTimer);

    var result = false, status = null;

    if (/^ *$/.test(responseDetails.responseText)) {
        status = "(error)";
    } else if (responseDetails.status == 503) {
        addSourceSearch = maxAttempts = 0;
        status = "(Downbooru)";
    } else {
        try {
            result = JSON.parse(responseDetails.responseText);
            if (result.success !== false) {
                status = "Searching...";
            } else {
                status = "(" + (result.message || "error") + ")";
                addSourceSearch = maxAttempts = 0;
                result = false;
            }
        } catch (err) {
            result = false;
            status = "(parse error)";
        }
    }
    debugLog("[#" + seq + "] API resp: http=" + responseDetails.status + ", status=" + status + ", count=" + (result ? result.length : "N/A"));
    if (!mobile) {
        for (let i = 0; i < thumbList.length; i++) {
            thumbList[i].link.textContent = status;
        }
    }

    if (result === false) {
        return retry();
    }

    // Resolve result color for a thumb
    function resolveColor(thumb) {
        if (thumb.posts.length === 0) return null; // not resolved yet
        // If thumb.src is a placeholder (data URL, blob, empty), we can't parse a version
        // to compare against Danbooru's source. Default to "found" rather than wrongly flagging
        // everything as mismatch.
        var hasUsableSrc = thumb.src && !/^(data:|blob:)/.test(thumb.src);
        if (thumb.posts.length === 1) {
            if (!ignoreMismatch && hasUsableSrc && tokenizePixivURL(thumb.src)[1] !== tokenizePixivURL(thumb.posts[0].src)[1]) {
                if (!ignoreBadRevision && thumb.posts[0].isBadRevision) return "badRevision";
                return "mismatch";
            }
            return "found";
        }
        // multi
        if (ignoreMismatch || !hasUsableSrc) return "found";
        var postsMap = thumb.posts.map(function (x) {
            return [tokenizePixivURL(x.src), x.isBadRevision];
        });
        var revDate = tokenizePixivURL(thumb.src)[1];
        var store = {};
        postsMap.forEach(function (post) {
            store[post[0][3]] = store[post[0][3]] || [];
            store[post[0][3]].push([post[0][1], post[1]]);
        });
        var matchArray = [];
        for (let pageIndex in store) {
            var isMatch = false, seenBadRevision = false;
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

    var _appliedFound = 0;
    for (let i = 0; i < thumbList.length; i++) {
        for (let j = 0; j < result.length; j++) {
            if (thumbList[i].pixiv_id == result[j].pixiv_id &&
                thumbList[i].posts.map(function(p){return p.id;}).indexOf(result[j].id) < 0 &&
                (thumbList[i].page < 0 || thumbList[i].page == pixivPageNumber(result[j].source))) {
                if (!mobile) {
                    thumbList[i].link.title = result[j].tag_string + " rating:" + result[j].rating + " score:" + result[j].score;
                }
                thumbList[i].posts.push({
                    "id": result[j].id,
                    "src": result[j].source,
                    "isBadRevision": result[j].tag_string.split(" ").includes("has_bad_revision"),
                });
            }
        }

        if (thumbList[i].posts.length >= 1) {
            var colorKey = resolveColor(thumbList[i]);
            if (mobile) {
                thumbList[i].dummyDiv.style.backgroundColor = colorMap[colorKey];
                _appliedFound++;
            } else {
                if (thumbList[i].posts.length === 1) {
                    thumbList[i].link.textContent = "post #" + thumbList[i].posts[0].id;
                    thumbList[i].link.href = danbooruURL + "posts/" + thumbList[i].posts[0].id;
                } else {
                    thumbList[i].link.textContent = "(" + thumbList[i].posts.length + " sources)";
                    thumbList[i].link.href = danbooruURL + "posts?tags=status:any+pixiv:" + thumbList[i].pixiv_id;
                    thumbList[i].link.removeAttribute("title");
                }
                thumbList[i].link.setAttribute("style", desktopStyleStr(colorKey));
            }
        }
    }
    debugLog("[#" + seq + "] colors applied: " + _appliedFound + "/" + thumbList.length);

    if (result.length === 100) {
        sourceSearch(thumbList, attempt + 1, page + 1, seq);
    } else {
        var _missingCount = 0;
        for (let i = 0; i < thumbList.length; i++) {
            if (!mobile && thumbList[i].status) {
                thumbList[i].status.style.display = "none";
            }
            if (thumbList[i].posts.length === 0) {
                if (mobile) {
                    thumbList[i].dummyDiv.style.backgroundColor = colorMap.missing;
                    _missingCount++;
                } else {
                    thumbList[i].link.textContent = "(no sources)";
                    thumbList[i].link.setAttribute("style", styleSourceMissing);
                }
            }
        }
        debugLog("[#" + seq + "] final: missing=" + _missingCount + "/" + thumbList.length);
    }
}
