// ==UserScript==
// @name         Danbooru Artist Memo
// @namespace    http://tampermonkey.net/
// @version      0.3
// @description  Add sticky notes to artists on Danbooru with Dexie.js
// @author       You
// @match        *://danbooru.donmai.us/artists/*
// @match        *://danbooru.donmai.us/uploads/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @grant        none
// @require      https://unpkg.com/dexie@3.2.4/dist/dexie.js
// ==/UserScript==

(function () {
    'use strict';

    // --- Configuration ---
    const DB_NAME = 'DanbooruArtistMemos';
    const DB_VERSION = 1;

    // --- Database Setup ---
    const db = new Dexie(DB_NAME);
    db.version(DB_VERSION).stores({
        artists: 'id, name, memo, updated_at' // Primary key: id (Artist ID)
    });

    // --- UI Utilities ---

    /**
     * Creates and injects the Memo Widget into the DOM.
     * @param {number} artistId - The unique ID of the artist.
     * @param {string} artistName - The name of the artist.
     * @param {HTMLElement} containerElement - The DOM element to append the widget to.
     * @param {string} [initialMemo=''] - The initial text content of the memo.
     */
    function createMemoWidget(artistId, artistName, containerElement, initialMemo = '') {
        // Prevent duplicate widgets
        if (document.getElementById(`artist-memo-widget-${artistId}`)) return;

        // Wrapper for absolute positioning context if needed
        const wrapper = document.createElement('div');
        wrapper.id = `artist-memo-widget-${artistId}`;

        const isFallback = (containerElement === document.body);
        const isSubnav = (containerElement.id === 'subnav-menu');

        if (isSubnav) {
            // Flex Item Style for Subnav
            wrapper.style.cssText = `
            flex: 1; /* Grow to fill space */
            display: flex;
            align-items: center;
            margin-left: 20px; /* Space from History link */
            position: relative;
            height: 100%;
        `;
        } else if (isFallback) {
            wrapper.style.cssText = `
            position: fixed;
            top: 80px;
            right: 20px;
            z-index: 9999;
        `;
        } else {
            wrapper.style.cssText = `
            position: absolute;
            top: 10px;
            right: 0;
            z-index: 100;
            display: inline-block;
        `;
        }

        // 1. Collapsed State (The "Bar")
        const toggleBtn = document.createElement('div');
        // Icon on the left, keeping it simple. User asked for wider button.
        const iconSpan = document.createElement('span');
        iconSpan.textContent = initialMemo ? '📝' : '🗒️';
        toggleBtn.appendChild(iconSpan);

        toggleBtn.title = 'Artist Memo';

        // Button Style
        const btnCommon = `
        height: 24px;
        background-color: #f5e6a8;
        border: 1px solid #e0d080;
        border-radius: 4px;
        cursor: pointer;
        box-shadow: 1px 1px 3px rgba(0,0,0,0.1);
        display: flex;
        align-items: center;
        justify-content: flex-start; /* Icon on left */
        padding-left: 8px; /* Spacing */
        font-size: 14px;
        user-select: none;
    `;

        if (isSubnav) {
            toggleBtn.style.cssText = `
            ${btnCommon}
            width: 100%; /* Fill the wrapper (which is flex:1) */
            max-width: 400px; /* Sensible limit */
        `;
        } else {
            toggleBtn.style.cssText = `
            ${btnCommon}
            width: 80px;
        `;
        }

        // 2. Expanded State (The "Post-it")
        const memoContainer = document.createElement('div');
        // For subnav, it drops down (top: 100% usually works if wrapper is relative)
        // For absolute/fixed, top: 30px is fine.
        const topPos = isSubnav ? '100%' : '30px';
        const marginTop = isSubnav ? '5px' : '0';

        memoContainer.style.cssText = `
      display: none; 
      position: absolute;
      top: ${topPos};
      margin-top: ${marginTop};
      right: 0; /* Anchor to right */
      left: auto;
      width: 250px;
      min-height: 200px;
      background-color: #fff7d1;
      border: 1px solid #e0d080;
      box-shadow: 3px 3px 10px rgba(0,0,0,0.2);
      z-index: 1000;
      flex-direction: column;
      border-radius: 2px;
      transform-origin: top right;
    `;

        const textarea = document.createElement('textarea');
        textarea.value = initialMemo;
        textarea.style.cssText = `
      flex-grow: 1;
      width: 100%;
      min-height: 160px;
      border: none;
      background-color: transparent;
      padding: 12px;
      resize: vertical;
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
      font-family: 'Segoe UI Emoji', 'Segoe UI Symbol', sans-serif;
      color: #333;
      line-height: 1.4;
    `;
        textarea.placeholder = 'Write a note about this artist...';

        const controls = document.createElement('div');
        controls.style.cssText = `
      padding: 8px;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      border-top: 1px solid rgba(0,0,0,0.05);
    `;

        const btnStyle = `
      border: 1px solid rgba(0,0,0,0.1);
      background: rgba(255,255,255,0.6);
      padding: 4px 10px;
      border-radius: 3px;
      cursor: pointer;
      font-size: 12px;
      font-weight: bold;
      color: #555;
    `;

        const saveBtn = document.createElement('button');
        saveBtn.textContent = 'Save';
        saveBtn.style.cssText = btnStyle;

        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = btnStyle;

        const statusLabel = document.createElement('span');
        statusLabel.style.cssText = 'font-size: 11px; color: #888; margin-right: auto; align-self: center;';

        controls.appendChild(statusLabel);
        controls.appendChild(cancelBtn);
        controls.appendChild(saveBtn);

        memoContainer.appendChild(textarea);
        memoContainer.appendChild(controls);

        wrapper.appendChild(toggleBtn);
        wrapper.appendChild(memoContainer);

        // --- Logic ---
        let dbMemoValue = initialMemo; // Should always match DB
        let isOpen = false;

        function toggleMemo() {
            isOpen = !isOpen;
            if (isOpen) {
                memoContainer.style.display = 'flex';
                toggleBtn.style.backgroundColor = '#fff0b3'; // Active state
                textarea.focus();
            } else {
                memoContainer.style.backgroundColor = '#f5e6a8';
                memoContainer.style.display = 'none';
            }
        }

        toggleBtn.onclick = toggleMemo;

        saveBtn.onclick = async () => {
            const newValue = textarea.value.trim();
            statusLabel.textContent = 'Saving...';
            try {
                if (newValue) {
                    await db.artists.put({
                        id: artistId,
                        name: artistName,
                        memo: newValue,
                        updated_at: new Date()
                    });
                    dbMemoValue = newValue;
                } else {
                    await db.artists.delete(artistId);
                    dbMemoValue = '';
                }
                statusLabel.textContent = 'Saved!';
                iconSpan.textContent = dbMemoValue ? '📝' : '🗒️';
                setTimeout(() => statusLabel.textContent = '', 1500);
            } catch (e) {
                console.error(e);
                statusLabel.textContent = 'Error!';
            }
        };

        cancelBtn.onclick = () => {
            if (!dbMemoValue) {
                // No saved data -> Close and clear
                textarea.value = '';
                toggleMemo(); // Closes it
            } else {
                // Saved data exists -> Revert text
                textarea.value = dbMemoValue;
                statusLabel.textContent = 'Reverted';
                setTimeout(() => statusLabel.textContent = '', 1500);
            }
        };

        // Inject into body always
        document.body.appendChild(wrapper);
    }

    // --- UI Utilities (Helper) ---

    /**
     * Waits for an element matching one of the selectors to appear in the DOM.
     * @param {string|string[]} selectors - Single CSS selector or array of selectors.
     * @param {number} [timeout=1500] - Time in ms to wait before giving up.
     * @returns {Promise<HTMLElement|null>} Resolves with the found element or null.
     */
    function waitForElement(selectors, timeout = 1500) {
        if (!Array.isArray(selectors)) selectors = [selectors];

        return new Promise((resolve) => {
            const find = () => {
                for (const s of selectors) {
                    const el = document.querySelector(s);
                    if (el) return el;
                }
                return null;
            };

            const initial = find();
            if (initial) return resolve(initial);

            const observer = new MutationObserver(() => {
                const el = find();
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                resolve(null);
            }, timeout);
        });
    }

    // --- Page Logic: Artists ---

    /**
   * Handles initialization on Artist Profile pages.
   */
    async function handleArtistPage() {
        const pathParts = window.location.pathname.split('/');
        const idStr = pathParts[2];
        if (!idStr) return;
        const artistId = parseInt(idStr, 10);
        if (isNaN(artistId)) return;

        console.log('Danbooru Artist Memo: handleArtistPage starting for ID', artistId);

        // 1. Find the Name (Independent of container)
        let artistName = 'Artist';
        const nameHeader = document.querySelector('h1[itemprop="name"], h1.artist-name, #c-artists h1');
        if (nameHeader) {
            artistName = nameHeader.textContent.replace('Artist:', '').trim();
        } else {
            const titleMatch = document.title.match(/(.*?) \|/);
            if (titleMatch) artistName = titleMatch[1].replace('Artist:', '').trim();
        }

        // 2. Find the Container (Priority: Subnav > Content > Body)

        // A. Priority Search: Subnav
        let target = await waitForElement(['#subnav-menu', 'menu#subnav-menu'], 2000);

        if (!target) {
            console.log('Danbooru Artist Memo: Subnav not found, trying content containers...');
            // B. Secondary Search: Content Area
            target = await waitForElement(['#c-artists', 'div#page'], 1000);
        }

        if (!target) {
            console.warn('Danbooru Artist Memo: Could not find content container. Using body.');
            target = document.body;
        }

        // Ensure relative positioning for absolute child (if not subnav/body)
        if (target !== document.body && target.id !== 'subnav-menu') {
            const style = window.getComputedStyle(target);
            if (style.position === 'static') {
                target.style.position = 'relative';
            }
        }

        const record = await db.artists.get(artistId);
        createMemoWidget(artistId, artistName, target, record ? record.memo : '');
    }

    // --- Page Logic: Uploads ---

    /**
     * Handles initialization on Upload/Post pages to display relevant artist memo.
     */
    async function handleUploadPage() {
        // Wait for tags to load
        const artistTags = document.querySelectorAll('li.category-1 .search-tag');
        if (artistTags.length > 0) {
            const artistName = artistTags[0].textContent.trim();
            try {
                const searchResp = await fetch(`/artists.json?search[name]=${encodeURIComponent(artistName)}`);
                const searchData = await searchResp.json();
                const artistObj = searchData.find(a => a.name === artistName);

                if (artistObj) {
                    const record = await db.artists.get(artistObj.id);
                    // Let's try to find the specific <li> for the artist and append there?
                    const artistLi = artistTags[0].closest('li');
                    if (artistLi) {
                        // Ensure container is relative so absolute widget works
                        const style = window.getComputedStyle(artistLi);
                        if (style.position === 'static') {
                            artistLi.style.position = 'relative';
                        }
                        createMemoWidget(artistObj.id, artistObj.name, artistLi, record ? record.memo : '');
                    }
                }
            } catch (e) {
                console.error(e);
            }
        }
    }

    // --- Main Dispatch ---

    /**
     * Main initializer function.
     */
    function init() {
        console.log('Danbooru Artist Memo: Init triggered', window.location.pathname);
        const path = window.location.pathname;
        if (path.startsWith('/artists/')) {
            handleArtistPage();
        } else if (path.startsWith('/uploads/')) {
            handleUploadPage();
        }
    }

    // Initial load
    if (document.body) {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }

    // Handle Turbo/Turbolinks transitions
    document.addEventListener('turbolinks:load', init);
    document.addEventListener('turbo:load', init);

})();
