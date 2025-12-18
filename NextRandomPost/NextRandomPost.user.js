// ==UserScript==
// @name         Danbooru Next Random Post
// @namespace    https://github.com/AkaringoP
// @version      2.0
// @description  Navigates to a random post using the current input context.
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

  // --- Constants ---
  const TOAST_DURATION_MS = 2500;

  // --- State Management ---
  let cachedNextId = null;
  let cachedQuerySource = '';
  let isNavigating = false;
  let isFetching = false;
  let toastElement = null;
  let toastTimeout = null; // To handle clearing previous timeouts

  // --- UI Utilities (Toast) ---

  const createToast = () => {
    const toast = document.createElement('div');
    const style = toast.style;

    style.position = 'fixed';
    style.top = '20px';
    style.left = '50%';
    style.transform = 'translateX(-50%)';
    
    // Style adjustments requested
    style.backgroundColor = 'rgba(0, 0, 0, 0.8)';
    style.color = '#fff';
    style.padding = '10px 24px'; // Slightly wider padding
    style.borderRadius = '8px';  // Rounded rectangle (not pill)
    style.fontFamily = 'Verdana, sans-serif';
    style.fontSize = '14px';
    style.fontWeight = 'normal'; // Normal font weight
    style.whiteSpace = 'nowrap'; // Force single line
    
    style.zIndex = '10000';
    style.opacity = '0';
    style.transition = 'opacity 0.4s ease'; // Smooth fade effect
    style.pointerEvents = 'none';
    style.boxShadow = '0 4px 6px rgba(0,0,0,0.15)';

    document.body.appendChild(toast);
    return toast;
  };

  const showToast = (message, type = 'info') => {
    if (!toastElement) {
      toastElement = createToast();
    }

    // Clear any pending fade-out to prevent flickering if triggered quickly
    if (toastTimeout) {
      clearTimeout(toastTimeout);
      toastTimeout = null;
    }

    toastElement.style.color = type === 'error' ? '#ff8e8e' : '#fff'; // Softer red for error
    toastElement.innerText = message;
    
    // Trigger Reflow to ensure the transition plays if it was just created or hidden
    void toastElement.offsetWidth; 

    toastElement.style.opacity = '1';

    toastTimeout = setTimeout(() => {
      if (toastElement) {
        toastElement.style.opacity = '0';
      }
    }, TOAST_DURATION_MS);
  };

  // --- Core Logic ---

  const getCurrentQuery = () => {
    const searchInput = document.querySelector('#tags') ||
        document.querySelector('input[name="tags"]');

    if (searchInput && searchInput.value.trim() !== '') {
      return searchInput.value.trim();
    }

    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('q') || urlParams.get('tags') || '';
  };

  const fetchRandomId = async (tags) => {
    if (isFetching) return null;
    isFetching = true;

    try {
      const orderRegex = /order:[^\s]+/;
      let apiQuery = tags;

      if (orderRegex.test(apiQuery)) {
        apiQuery = apiQuery.replace(orderRegex, 'order:random');
      } else {
        apiQuery += ' order:random';
      }

      const apiUrl = `/posts.json?tags=${encodeURIComponent(apiQuery)}&limit=1&only=id`;
      const response = await fetch(apiUrl);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      return (data && data.length > 0) ? data[0].id : null;

    } catch (error) {
      console.warn('NextRandomPost: Fetch failed', error);
      return null;
    } finally {
      isFetching = false;
    }
  };

  const performPrefetch = async () => {
    const currentTags = getCurrentQuery();
    const id = await fetchRandomId(currentTags);
    if (id) {
      cachedNextId = id;
      cachedQuerySource = currentTags;
    }
  };

  const navigateToPost = (postId, activeTags) => {
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('tags')) {
      urlParams.set('tags', activeTags);
    } else {
      urlParams.set('q', activeTags);
    }
    window.location.href = `/posts/${postId}?${urlParams.toString()}`;
  };

  const executeNavigation = async () => {
    if (isNavigating) return;
    isNavigating = true;

    const currentTags = getCurrentQuery();

    // Strategy 1: Cache Hit
    if (cachedNextId && currentTags === cachedQuerySource) {
      navigateToPost(cachedNextId, currentTags);
      return;
    }

    // Strategy 2: Cache Miss
    showToast('Query changed. Searching...', 'info');
    const freshId = await fetchRandomId(currentTags);

    if (freshId) {
      navigateToPost(freshId, currentTags);
    } else {
      showToast('No random post found.', 'error');
      isNavigating = false;
    }
  };

  // --- Init ---

  const init = () => {
    performPrefetch();

    const optionsList = document.querySelector('#post-options > ul');
    if (optionsList) {
      const listItem = document.createElement('li');
      const link = document.createElement('a');

      link.href = '#';
      link.innerText = 'Next random post';
      link.style.cursor = 'pointer';
      link.title = 'Shortcut: Alt + Shift + →';

      link.addEventListener('click', (event) => {
        event.preventDefault();
        executeNavigation();
      });

      listItem.appendChild(link);
      optionsList.appendChild(listItem);
    }

    document.addEventListener('keydown', (event) => {
      const target = event.target;
      const isInput = ['INPUT', 'TEXTAREA'].includes(target.tagName) ||
          target.isContentEditable;

      if (isInput) return;

      if (event.altKey && event.shiftKey && event.key === 'ArrowRight') {
        event.preventDefault();
        executeNavigation();
      }
    });
  };

  init();
})();
