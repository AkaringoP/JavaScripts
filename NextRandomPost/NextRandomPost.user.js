// ==UserScript==
// @name         Danbooru Next Random Post
// @namespace    https://github.com/AkaringoP
// @version      1.0
// @description  Navigates to a random post while keeping the current search context. Supports Alt+Shift+RightArrow shortcut.
// @author       AkaringoP
// @license      MIT
// @match        *://danbooru.donmai.us/posts/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/NextRandomPost/NextRandomPost.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/NextRandomPost/NextRandomPost.user.js
// @grant        none
// ==/UserScript==


(() => {
  'use strict';

  /**
   * Core logic to find and navigate to a random post.
   *
   * @param {HTMLElement} uiElement - The element to show status text (e.g., the link).
   */
  const executeRandomNavigation = async (uiElement) => {
    // Show 'Finding...' text on the link if provided
    const originalText = uiElement ? uiElement.innerText : '';
    if (uiElement) uiElement.innerText = 'Finding...';

    try {
      // 1. Parse current URL parameters
      // In the browser URL, the parameter is 'q'
      const urlParams = new URLSearchParams(window.location.search);
      const currentQuery = urlParams.get('q') || '';

      // 2. Modify query for API: Replace specific order with 'order:random'
      const orderRegex = /order:[^\s]+/;
      let apiQuery = currentQuery;

      if (orderRegex.test(apiQuery)) {
        apiQuery = apiQuery.replace(orderRegex, 'order:random');
      } else {
        apiQuery += ' order:random';
      }

      // 3. Fetch random post ID (limit=1, only=id for performance)
      // FIX: The API endpoint uses 'tags=' parameter, NOT 'q='
      const apiUrl = `/posts.json?tags=${encodeURIComponent(apiQuery)}&limit=1&only=id`;

      const response = await fetch(apiUrl);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data && data.length > 0) {
        const nextId = data[0].id;
        // 4. Navigate to the new post
        // IMPORTANT: We append window.location.search to keep the original user query (e.g., order:change)
        window.location.href = `/posts/${nextId}${window.location.search}`;
      } else {
        alert('No random post found.');
        if (uiElement) uiElement.innerText = originalText;
      }
    } catch (error) {
      console.error('Next Random Post Script Error:', error);
      alert('An error occurred. Please check the console.');
      if (uiElement) uiElement.innerText = originalText;
    }
  };

  /**
   * Initializes the script: creates the UI link and sets up shortcuts.
   */
  const init = () => {
    // 1. Find the container for the link (Options menu)
    const optionsList = document.querySelector('#post-options > ul');
    if (!optionsList) return;

    // 2. Create the 'Next random post' link (UI Label)
    const listItem = document.createElement('li');
    const link = document.createElement('a');

    link.href = '#';
    link.innerText = 'Next random post';
    link.style.cursor = 'pointer';
    // Tooltip to inform the user about the shortcut
    link.title = 'Shortcut: Alt + Shift + →';

    listItem.appendChild(link);
    optionsList.appendChild(listItem);

    // 3. Add Click Event Listener (Mouse support)
    link.addEventListener('click', (event) => {
      event.preventDefault();
      executeRandomNavigation(link);
    });

    // 4. Add Keyboard Shortcut Listener (Keyboard support)
    // Shortcut: Alt + Shift + ArrowRight
    document.addEventListener('keydown', (event) => {
      // Prevent triggering when typing in input fields
      const target = event.target;
      const isInput = target.tagName === 'INPUT' ||
                      target.tagName === 'TEXTAREA' ||
                      target.isContentEditable;

      if (isInput) return;

      // Check for Alt + Shift + ArrowRight
      if (event.altKey && event.shiftKey && event.key === 'ArrowRight') {
        event.preventDefault(); // Prevent default browser behavior
        executeRandomNavigation(link);
      }
    });
  };

  // Run the initialization
  init();
})();
