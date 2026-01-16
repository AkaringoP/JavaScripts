// ==UserScript==
// @name         Danbooru Mobile Note Assist
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  Danbooru mobile note tool.
// @author       AkaringoP
// @match        *://danbooru.donmai.us/posts/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  // --------------------------------------------------------------------------
  // Constants & Configuration
  // --------------------------------------------------------------------------

  /** @const {string} Key for local storage state. */
  const STATE_KEY = 'dmna_enabled';

  /** @const {string} Key for local storage button position. */
  const POS_KEY = 'dmna_btn_margin_y';

  /** @const {number} Ratio of the note box relative to the image size (0.1 = 10%). */
  const INITIAL_SIZE_RATIO = 0.10;

  /** @const {number} Minimum size of the note box in pixels. */
  const MIN_BOX_SIZE = 15;

  /** @const {number} Minimum initial size of the note box in pixels. */
  const MIN_INITIAL_SIZE = 30;

  /** @const {number} Maximum initial size of the note box in pixels. */
  const MAX_INITIAL_SIZE = 150;

  /** @const {number} Duration in ms to trigger long-press actions. */
  const LONG_PRESS_DURATION = 1500;

  /** @const {number} Floating button size in pixels. */
  const BTN_SIZE = 40;

  /** @const {number} Horizontal margin for the floating button. */
  const BTN_MARGIN_X = 20;

  /** @const {number} Default vertical margin for the floating button. */
  const DEFAULT_BTN_MARGIN_Y = 80;

  /** @const {number} Bottom margin for the toast message. */
  const TOAST_MARGIN_BOTTOM = 20;

  /**
   * Mapping of UI IDs to Danbooru tag strings.
   * @const {Object<string, string>}
   */
  const TAG_MAP = {
    translated: 'translated',
    request: 'translation_request',
    check: 'check_translation',
    partial: 'partially_translated',
  };

  // --------------------------------------------------------------------------
  // State Variables
  // --------------------------------------------------------------------------

  let isEnabled = localStorage.getItem(STATE_KEY) === 'true';
  let userBtnMarginY = parseInt(localStorage.getItem(POS_KEY), 10) ||
      DEFAULT_BTN_MARGIN_Y;

  // Interaction State
  let isDraggingBtn = false;
  let isPressing = false;
  let longPressTimer = null;
  let dragStartY = 0;
  let dragStartMarginY = 0;

  // Box Creation State (for PC Drag)
  let isCreatingBox = false;
  let createStartX = 0;
  let createStartY = 0;
  let createWasVisible = false;

  // DOM Elements
  let boxElement = null;
  let handleNW = null;
  let handleSE = null;
  let handleSW = null;
  let handleNE = null;
  let popoverElement = null;
  let inputElement = null;
  let toastElement = null;

  // Timers & RAF
  let toastTimer = null;
  let viewportRaf = null;
  let debugFadeTimer = null;

  // Data
  let allPostTags = new Set();
  let postOriginalWidth = 0;
  let postOriginalHeight = 0;
  let initialToggleState = {};

  // --------------------------------------------------------------------------
  // Styles
  // --------------------------------------------------------------------------

  const STYLES = `
    :root {
      --touch-inner: 25%;
      --touch-outer: 30px; 
    }

    .dmna-hidden { display: none !important; }

    #dmna-box {
      position: absolute; width: 50px; height: 50px;
      border: 1.2px solid #0073ff; background-color: rgba(0, 115, 255, 0.15);
      z-index: 9990; touch-action: none;
      box-sizing: border-box;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
      display: none;
    }

    /* Visual Triangle (Max 6px) */
    #dmna-box::before {
      content: ''; position: absolute;
      right: 0; bottom: 0;
      width: 30%; height: 30%;
      max-width: 6px; max-height: 6px;
      aspect-ratio: 1 / 1;
      background: linear-gradient(to top left, #0073ff 50%, transparent 50%);
      z-index: 9991; pointer-events: none;
      transition: opacity 0.2s;
    }
    #dmna-box.interacting::before { opacity: 0; }

    /* Debug Visualization */
    .dmna-handle::after {
      content: attr(data-icon);
      position: absolute;
      width: calc(var(--touch-inner) + var(--touch-outer));
      height: calc(var(--touch-inner) + var(--touch-outer));
      display: flex; align-items: center; justify-content: center;
      font-size: 16px; font-weight: bold;
      z-index: 9995;
      background-color: transparent;
      border: 1px solid transparent;
      color: transparent;
      text-shadow: none;
      transition: background-color 0.3s ease, border-color 0.3s ease, color 0.3s ease;
    }

    #dmna-box.show-debug .dmna-handle::after {
      background-color: rgba(255, 0, 0, 0.2);
      border-color: rgba(255, 255, 255, 0.3);
      color: #e0e0e0;
      text-shadow: 0 0 2px rgba(0,0,0,0.3);
    }

    #dmna-box.interacting .dmna-handle::after {
      background-color: transparent !important;
      border-color: transparent !important;
      color: transparent !important;
      text-shadow: none !important;
    }

    /* Handle Positions */
    #dmna-resize-se { position: absolute; right: 0; bottom: 0; width: 0; height: 0; cursor: nwse-resize; }
    #dmna-resize-se::after { right: calc(var(--touch-outer) * -1); bottom: calc((var(--touch-outer) * -1) + 15px); }

    #dmna-resize-nw { position: absolute; left: 0; top: 0; width: 0; height: 0; cursor: nwse-resize; }
    #dmna-resize-nw::after { left: calc(var(--touch-outer) * -1); top: calc(var(--touch-outer) * -1); }

    #dmna-drag-sw { position: absolute; left: 0; bottom: 0; width: 0; height: 0; cursor: move; }
    #dmna-drag-sw::after { left: calc(var(--touch-outer) * -1); bottom: calc((var(--touch-outer) * -1) + 15px); }

    #dmna-drag-ne { position: absolute; right: 0; top: 0; width: 0; height: 0; cursor: move; }
    #dmna-drag-ne::after { right: calc(var(--touch-outer) * -1); top: calc(var(--touch-outer) * -1); }

    /* Popover UI */
    #dmna-popover {
      position: absolute; z-index: 9992;
      display: none; flex-direction: column; gap: 10px;
      background: #1f232b; padding: 14px; border-radius: 14px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      border: 1px solid #3e4451; width: 230px;
      --arrow-offset: 0px; color: #fff;
      transition: opacity 0.2s ease; opacity: 1;
      transform-origin: top center;
      box-sizing: border-box;
    }
    #dmna-popover.interacting { opacity: 0.2; }

    #dmna-popover::after {
      content: ""; position: absolute; top: -10px;
      left: calc(50% + var(--arrow-offset)); margin-left: -10px;
      border-width: 0 10px 10px 10px; border-style: solid;
      border-color: transparent transparent #1f232b transparent;
    }

    .dmna-input-row { display: flex; gap: 8px; align-items: center; width: 100%; }

    #dmna-input {
      flex: 1; min-width: 0; height: 36px;
      background: #2c323d; border: 1px solid #3e4451; color: white;
      border-radius: 6px; padding: 6px; font-size: 14px; resize: none;
      box-sizing: border-box; font-family: sans-serif;
    }
    #dmna-input:focus { outline: 2px solid #0073ff; border-color: transparent; }

    #dmna-eye-btn {
      flex: 0 0 36px; width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      background: #2c323d; border: 1px solid #3e4451; border-radius: 6px;
      font-size: 18px; cursor: pointer; user-select: none;
      transition: background 0.2s; box-sizing: border-box;
    }
    #dmna-eye-btn:active { background: #3e4451; }

    #dmna-tags { display: flex; flex-direction: column; gap: 8px; margin: 4px 0; }
    .dmna-toggle-row { display: flex; justify-content: space-between; align-items: center; }
    .dmna-toggle-label { font-size: 13px; font-weight: 500; color: #ced4da; }

    .dmna-switch { position: relative; display: inline-block; width: 36px; height: 20px; }
    .dmna-switch input { opacity: 0; width: 0; height: 0; }
    .dmna-slider { position: absolute; cursor: pointer; top: 0; left: 0; right: 0; bottom: 0; background-color: #555; transition: .3s; border-radius: 20px; }
    .dmna-slider:before { position: absolute; content: ""; height: 16px; width: 16px; left: 2px; bottom: 2px; background-color: white; transition: .3s; border-radius: 50%; }
    input:checked + .dmna-slider { background-color: #0073ff; }
    input:checked + .dmna-slider:before { transform: translateX(16px); }

    .dmna-btn-group { display: flex; gap: 10px; justify-content: space-around; width: 100%; margin-top: 4px; }
    .dmna-btn {
      width: 100%; height: 36px; border-radius: 8px; border: none;
      font-size: 18px; display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: transform 0.1s;
    }
    .dmna-btn:active { transform: scale(0.95); }
    #dmna-ok { background: #e8f5e9; color: #2e7d32; }
    #dmna-no { background: #ffebee; color: #c62828; }

    #dmna-float-btn {
      position: absolute; left: 0; top: 0;
      width: 40px; height: 40px; border-radius: 50%;
      background: rgba(0, 0, 0, 0.6); color: white; font-size: 21px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      display: flex; align-items: center; justify-content: center;
      z-index: 11000; cursor: pointer; backdrop-filter: blur(2px);
      user-select: none; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      transform-origin: 0 0; will-change: transform; touch-action: none;
      transition: opacity 0.2s, visibility 0.2s;
    }
    #dmna-float-btn.active { background: #0073ff; border-color: white; box-shadow: 0 0 15px #0073ff; }
    #dmna-float-btn.dragging { background: #ff9800 !important; border-color: #ffe0b2 !important; transform: scale(1.2); }

    #dmna-toast {
      visibility: hidden; min-width: 160px;
      background-color: rgba(30, 30, 30, 0.95); color: #fff;
      text-align: center; border-radius: 50px; padding: 12px 24px;
      position: absolute; left: 0; top: 0; z-index: 11000;
      font-size: 14px; opacity: 0;
      transition: opacity 0.4s ease-in-out, visibility 0.4s ease-in-out;
      pointer-events: none; transform-origin: 0 0;
      will-change: transform, opacity;
    }
    #dmna-toast.show { visibility: visible; opacity: 1; }
    #dmna-sidebar-link { color: #7b8c9d !important; text-decoration: none; }
    #dmna-sidebar-link.active { color: #0073ff !important; font-weight: bold; text-shadow: 0 0 8px rgba(0, 115, 255, 0.6); }
    body.dmna-active #image { cursor: crosshair !important; }
  `;

  if (typeof GM_addStyle !== 'undefined') {
    GM_addStyle(STYLES);
  } else {
    const style = document.createElement('style');
    style.innerHTML = STYLES;
    document.head.appendChild(style);
  }

  // --------------------------------------------------------------------------
  // Core Functions
  // --------------------------------------------------------------------------

  /**
   * Displays a toast message to the user.
   * @param {string} msg The message text to display.
   */
  function showToast(msg) {
    if (!toastElement) {
      toastElement = document.createElement('div');
      toastElement.id = 'dmna-toast';
      document.body.appendChild(toastElement);
    }
    updateVisualViewportPositions();
    toastElement.textContent = msg;
    void toastElement.offsetWidth; // Trigger reflow
    toastElement.className = 'show';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastElement.className = '';
    }, 2500);
  }

  /**
   * Updates positions of fixed elements (float button, toast) based on the visual viewport.
   * This is necessary to handle mobile keyboard layout changes and pinch-zooming correctly.
   */
  function updateVisualViewportPositions() {
    const btn = document.getElementById('dmna-float-btn');
    const toast = document.getElementById('dmna-toast');

    if (!window.visualViewport) {
      const scrollX = window.pageXOffset;
      const scrollY = window.pageYOffset;
      if (btn) {
        btn.style.transform = `translate(
          ${scrollX + window.innerWidth - BTN_MARGIN_X - BTN_SIZE}px,
          ${scrollY + window.innerHeight - userBtnMarginY - BTN_SIZE}px)`;
      }
      if (toast) {
        toast.style.transform = `translate(
          ${scrollX + window.innerWidth / 2}px,
          ${scrollY + window.innerHeight - TOAST_MARGIN_BOTTOM}px) translate(-50%, 0)`;
      }
      return;
    }

    const vv = window.visualViewport;
    const invScale = 1 / vv.scale;
    const vvPageLeft = vv.pageLeft;
    const vvPageTop = vv.pageTop;

    if (btn) {
      const btnScale = isEnabled ? invScale * 1.1 : invScale;
      const bx = vvPageLeft + vv.width - ((BTN_MARGIN_X + BTN_SIZE) * invScale);
      const by = vvPageTop + vv.height - ((userBtnMarginY + BTN_SIZE) * invScale);
      btn.style.transform = `translate(${bx}px, ${by}px) scale(${btnScale})`;
    }
    if (toast) {
      const tx = vvPageLeft + (vv.width / 2);
      const ty = vvPageTop + vv.height - (TOAST_MARGIN_BOTTOM * invScale);
      toast.style.transform =
          `translate(${tx}px, ${ty}px) scale(${invScale}) translate(-50%, -100%)`;
    }
  }

  /**
   * Initializes the script, binding global events and creating UI.
   */
  function init() {
    loadTagsFromDOM();
    fetchPostData(true);

    createUI();
    updateStateUI();
    updateVisualViewportPositions();

    if (window.visualViewport) {
      const handleUpdate = () => {
        if (!viewportRaf) {
          viewportRaf = requestAnimationFrame(() => {
            updateVisualViewportPositions();
            // Also update popover if it's visible to handle zoom changes
            if (boxElement && boxElement.style.display === 'block') {
              updatePopoverPosition();
            }
            viewportRaf = null;
          });
        }
      };
      window.visualViewport.addEventListener('resize', handleUpdate);
      window.visualViewport.addEventListener('scroll', handleUpdate);
      window.addEventListener('scroll', handleUpdate);
    }

    const sidebarLink = document.getElementById('dmna-sidebar-link');
    if (sidebarLink) {
      sidebarLink.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleState();
      };
    }

    // Bind creation interactions (Click/Drag)
    const img = document.querySelector('#image');
    if (img) setupCreationInteraction(img);
  }

  /**
   * Attempts to load existing post tags from the DOM as a fallback.
   */
  function loadTagsFromDOM() {
    let tagString = document.body.dataset.postTags ||
        document.body.dataset.tags || '';
    if (!tagString) {
      const postDiv = document.querySelector('#image-container');
      if (postDiv && postDiv.dataset.tags) tagString = postDiv.dataset.tags;
    }
    allPostTags = new Set(tagString.split(' ').filter((t) => t.trim() !== ''));

    if (document.body.dataset.postWidth) {
      postOriginalWidth = parseInt(document.body.dataset.postWidth, 10);
      postOriginalHeight = parseInt(document.body.dataset.postHeight, 10);
    }
  }

  /**
   * Fetches fresh post data (tags and dimensions) from the Danbooru API.
   * @param {boolean} shouldUpdateUI If true, refreshes the toggle UI after fetching.
   * @return {Promise<Set<string>|null>} The set of current tags, or null on failure.
   */
  async function fetchPostData(shouldUpdateUI = false) {
    const postIdMatch = location.pathname.match(/\/posts\/(\d+)/);
    const postId = postIdMatch ? postIdMatch[1] : document.body.dataset.postId;
    if (!postId) return null;

    try {
      const res = await fetch(
          `/posts/${postId}.json?only=tag_string,image_width,image_height`);
      if (res.ok) {
        const data = await res.json();
        if (data.image_width) postOriginalWidth = data.image_width;
        if (data.image_height) postOriginalHeight = data.image_height;

        if (data && typeof data.tag_string === 'string') {
          const freshSet = new Set(
              data.tag_string.split(' ').filter((t) => t.trim() !== ''));
          allPostTags = freshSet;
          if (shouldUpdateUI && boxElement &&
              boxElement.style.display === 'block') {
            updateToggleStates();
          }
          return freshSet;
        }
      }
    } catch (e) {
      console.error('Failed to fetch post data', e);
    }
    return null;
  }

  /**
   * Generates the HTML for a toggle switch row.
   * @param {string} id The identifier for the tag map.
   * @param {string} label The display label.
   * @return {string} HTML string.
   */
  function createToggleRow(id, label) {
    return `
      <div class="dmna-toggle-row">
        <span class="dmna-toggle-label">${label}</span>
        <label class="dmna-switch">
          <input type="checkbox" id="dmna-tag-${id}">
          <span class="dmna-slider"></span>
        </label>
      </div>
    `;
  }

  /**
   * Updates the checked state of the toggle switches based on `allPostTags`.
   */
  function updateToggleStates() {
    const setCheck = (id, tag) => {
      const el = document.getElementById(`dmna-tag-${id}`);
      if (el) el.checked = allPostTags.has(tag);
    };
    setCheck('translated', TAG_MAP.translated);
    setCheck('request', TAG_MAP.request);
    setCheck('check', TAG_MAP.check);
    setCheck('partial', TAG_MAP.partial);
  }

  /**
   * Captures the initial state of the toggle switches when the popover is opened.
   * Used to determine if any tag changes need to be submitted.
   */
  function captureInitialToggleState() {
    initialToggleState = {
      translated: document.getElementById('dmna-tag-translated')?.checked,
      request: document.getElementById('dmna-tag-request')?.checked,
      check: document.getElementById('dmna-tag-check')?.checked,
      partial: document.getElementById('dmna-tag-partial')?.checked,
    };
  }

  /**
   * Checks if the current toggle state differs from the initial state.
   * @return {boolean} True if changes are detected.
   */
  function hasTagChanges() {
    const current = {
      translated: document.getElementById('dmna-tag-translated')?.checked,
      request: document.getElementById('dmna-tag-request')?.checked,
      check: document.getElementById('dmna-tag-check')?.checked,
      partial: document.getElementById('dmna-tag-partial')?.checked,
    };
    return (
      current.translated !== initialToggleState.translated ||
      current.request !== initialToggleState.request ||
      current.check !== initialToggleState.check ||
      current.partial !== initialToggleState.partial
    );
  }

  /**
   * Configures the mutual exclusion logic between 'Translated' and request tags.
   */
  function setupTagLogic() {
    const tTranslated = document.getElementById('dmna-tag-translated');
    const tRequest = document.getElementById('dmna-tag-request');
    const tCheck = document.getElementById('dmna-tag-check');
    const tPartial = document.getElementById('dmna-tag-partial');

    // 1. Translated ON -> Others OFF
    if (tTranslated) {
      tTranslated.addEventListener('change', () => {
        if (tTranslated.checked) {
          if (tRequest) tRequest.checked = false;
          if (tCheck) tCheck.checked = false;
          if (tPartial) tPartial.checked = false;
        }
      });
    }

    // 2. Others ON -> Translated OFF
    const others = [tRequest, tCheck, tPartial];
    others.forEach((el) => {
      if (el) {
        el.addEventListener('change', () => {
          if (el.checked) {
            if (tTranslated) tTranslated.checked = false;
          }
        });
      }
    });
  }

  /**
   * Shows the visual debug zones (touch handles) for a limited time.
   * @param {number} [duration=0] Duration in ms to show the zones. 0 keeps them shown.
   */
  function showDebugZones(duration = 0) {
    if (!boxElement) return;
    boxElement.classList.add('show-debug');
    if (debugFadeTimer) clearTimeout(debugFadeTimer);

    if (duration > 0) {
      debugFadeTimer = setTimeout(() => {
        boxElement.classList.remove('show-debug');
      }, duration);
    }
  }

  /**
   * Hides the visual debug zones.
   */
  function hideDebugZones() {
    if (!boxElement) return;
    if (debugFadeTimer) clearTimeout(debugFadeTimer);
    boxElement.classList.remove('show-debug');
  }

  /**
   * Creates all UI elements (Floating Button, Box, Popover).
   */
  function createUI() {
    if (document.getElementById('dmna-box')) return;

    const floatBtn = document.createElement('div');
    floatBtn.id = 'dmna-float-btn';
    floatBtn.innerHTML = '📝';
    setupButtonInteractions(floatBtn);
    document.body.appendChild(floatBtn);

    const optionsList = document.querySelector('#post-options > ul');
    if (optionsList) {
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.id = 'dmna-sidebar-link';
      a.href = '#';
      a.textContent = 'Note Assist: OFF';
      li.appendChild(a);
      optionsList.appendChild(li);
    }

    boxElement = document.createElement('div');
    boxElement.id = 'dmna-box';

    handleSE = document.createElement('div');
    handleSE.id = 'dmna-resize-se';
    handleSE.className = 'dmna-handle';
    handleSE.setAttribute('data-icon', '↘');
    boxElement.appendChild(handleSE);

    handleNW = document.createElement('div');
    handleNW.id = 'dmna-resize-nw';
    handleNW.className = 'dmna-handle';
    handleNW.setAttribute('data-icon', '↖');
    boxElement.appendChild(handleNW);

    handleSW = document.createElement('div');
    handleSW.id = 'dmna-drag-sw';
    handleSW.className = 'dmna-handle';
    handleSW.setAttribute('data-icon', '✥');
    boxElement.appendChild(handleSW);

    handleNE = document.createElement('div');
    handleNE.id = 'dmna-drag-ne';
    handleNE.className = 'dmna-handle';
    handleNE.setAttribute('data-icon', '✥');
    boxElement.appendChild(handleNE);

    document.body.appendChild(boxElement);

    popoverElement = document.createElement('div');
    popoverElement.id = 'dmna-popover';

    popoverElement.innerHTML = `
      <div class="dmna-input-row">
        <textarea id="dmna-input" placeholder="Enter note..." rows="1"></textarea>
        <div id="dmna-eye-btn">👁️</div>
      </div>
      
      <div id="dmna-tags">
        ${createToggleRow('translated', 'Translated')}
        ${createToggleRow('request', 'Translation request')}
        ${createToggleRow('check', 'Check translation')}
        ${createToggleRow('partial', 'Partially translated')}
      </div>

      <div class="dmna-btn-group">
        <button id="dmna-ok" class="dmna-btn">✔</button>
        <button id="dmna-no" class="dmna-btn">✖</button>
      </div>
    `;
    document.body.appendChild(popoverElement);

    inputElement = document.getElementById('dmna-input');

    // Auto-hide floating button when typing
    if (inputElement) {
      const floatBtn = document.getElementById('dmna-float-btn');
      
      // Use capture to detect focus/blur on ANY input element in the document
      document.addEventListener('focus', (e) => {
        const target = e.target;
        const isTextInput = target.tagName === 'TEXTAREA' ||
            (target.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'image', 'file', 'range', 'color'].includes(target.type));
        
        if (isTextInput && floatBtn) {
          floatBtn.classList.add('dmna-hidden');
        }
      }, true);

      document.addEventListener('blur', (e) => {
        if (floatBtn) {
          setTimeout(() => {
            // Check if focus moved to another text input
            const active = document.activeElement;
            const isTextInput = active && (active.tagName === 'TEXTAREA' ||
                (active.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'image', 'file', 'range', 'color'].includes(active.type)));
            
            if (!isTextInput) {
              floatBtn.classList.remove('dmna-hidden');
            }
          }, 100);
        }
      }, true);
    }

    const eyeBtn = document.getElementById('dmna-eye-btn');
    if (eyeBtn) {
      const startShow = (e) => { e.preventDefault(); showDebugZones(); };
      const stopShow = (e) => { e.preventDefault(); hideDebugZones(); };

      eyeBtn.addEventListener('touchstart', startShow);
      eyeBtn.addEventListener('touchend', stopShow);
      eyeBtn.addEventListener('mousedown', startShow);
      eyeBtn.addEventListener('mouseup', stopShow);
      eyeBtn.addEventListener('mouseleave', stopShow);
    }

    updateToggleStates();
    setupTagLogic();

    setupDragAndResize();
    document.getElementById('dmna-ok').addEventListener('click', submitNote);
    document.getElementById('dmna-no').addEventListener('click', () => {
      hideBox();
      showToast('Cancelled');
    });
  }

  /**
   * Configures interaction for the floating button (Move & Toggle).
   * Supports both Touch and Mouse events.
   * @param {HTMLElement} btn The floating button element.
   */
  function setupButtonInteractions(btn) {
    const handleStart = (e) => {
      if (e.type === 'touchstart') e.preventDefault();
      isDraggingBtn = false;
      isPressing = true;
      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
      dragStartY = clientY;
      dragStartMarginY = userBtnMarginY;

      longPressTimer = setTimeout(() => {
        if (isPressing) {
          isDraggingBtn = true;
          btn.classList.add('dragging');
          if (navigator.vibrate) navigator.vibrate(50);
          showToast('↕️ Reposition Mode');
        }
      }, LONG_PRESS_DURATION);
    };

    const handleMove = (e) => {
      if (e.type === 'touchmove') {
        e.preventDefault();
        e.stopPropagation();
      }
      if (!isPressing) return;

      const clientY = e.type.startsWith('touch') ? e.touches[0].clientY : e.clientY;
      if (isDraggingBtn) {
        const dy = clientY - dragStartY;
        let newMargin = dragStartMarginY - dy;
        const screenH = window.innerHeight;
        newMargin = Math.max(20, Math.min(screenH - 100, newMargin));
        userBtnMarginY = newMargin;
        updateVisualViewportPositions();
        return;
      }
      if (Math.abs(clientY - dragStartY) > 10) {
        clearTimeout(longPressTimer);
        isPressing = false;
      }
    };

    const handleEnd = (e) => {
      if (e.type === 'touchend') e.preventDefault();
      clearTimeout(longPressTimer);
      isPressing = false;
      if (isDraggingBtn) {
        isDraggingBtn = false;
        btn.classList.remove('dragging');
        localStorage.setItem(POS_KEY, userBtnMarginY);
      } else {
        if (Math.abs((e.type.startsWith('touch') ? e.changedTouches[0].clientY : e.clientY) - dragStartY) < 10) {
          toggleState();
        }
      }
    };

    btn.addEventListener('touchstart', handleStart, {passive: false});
    btn.addEventListener('touchmove', handleMove, {passive: false});
    btn.addEventListener('touchend', handleEnd);
    btn.addEventListener('mousedown', handleStart);
    document.addEventListener('mousemove', (e) => { if (isPressing) handleMove(e); });
    btn.addEventListener('mouseup', handleEnd);
  }

  /**
   * Toggles the script on/off.
   */
  function toggleState() {
    isEnabled = !isEnabled;
    localStorage.setItem(STATE_KEY, isEnabled);
    updateStateUI();
    updateVisualViewportPositions();
    if (isEnabled) {
      showToast('✨ Note Assist ON');
    } else {
      hideBox();
      showToast('Note Assist OFF');
    }
  }

  /**
   * Updates visual state of the floating button and sidebar link.
   */
  function updateStateUI() {
    const floatBtn = document.getElementById('dmna-float-btn');
    const sidebarLink = document.getElementById('dmna-sidebar-link');
    if (isEnabled) {
      floatBtn.classList.add('active');
      document.body.classList.add('dmna-active');
      if (sidebarLink) {
        sidebarLink.classList.add('active');
        sidebarLink.textContent = 'Note Assist: ON';
      }
    } else {
      floatBtn.classList.remove('active');
      document.body.classList.remove('dmna-active');
      if (sidebarLink) {
        sidebarLink.classList.remove('active');
        sidebarLink.textContent = 'Note Assist: OFF';
      }
    }
  }

  /**
   * Sets up box creation logic on the image.
   * Handles "Click to Toggle" and "Drag to Create".
   * @param {HTMLElement} img The target image element.
   */
  function setupCreationInteraction(img) {
    // 1. PC Drag-to-Create
    img.addEventListener('mousedown', (e) => {
      if (!isEnabled || e.button !== 0) return;
      if (e.target.closest('#dmna-box') || e.target.closest('#dmna-popover')) return;
      if (e.type.startsWith('touch')) return;

      e.preventDefault();
      isCreatingBox = true;
      createStartX = e.pageX;
      createStartY = e.pageY;

      // Save state before drag starts to handle click-toggle correctly
      createWasVisible = (boxElement.style.display === 'block');

      document.addEventListener('mousemove', onCreateMove);
      document.addEventListener('mouseup', onCreateEnd);
    });

    // 2. Click (Touch & Mouse Click fallthrough)
    img.addEventListener('click', (e) => {
      if (!isEnabled) return;
      if (e.target.closest('#dmna-box') || e.target.closest('#dmna-popover') || e.target.closest('#dmna-float-btn')) return;
      if (isCreatingBox) return; // Prevent double trigger

      e.preventDefault(); e.stopPropagation();

      // Toggle Logic
      if (boxElement.style.display === 'block') {
        hideBox();
        showToast('Cancelled');
      } else {
        spawnDefaultBox(e.pageX, e.pageY);
      }
    });
  }

  /**
   * Handles mouse movement during box creation drag.
   * @param {MouseEvent} e
   */
  function onCreateMove(e) {
    if (!isCreatingBox) return;
    e.preventDefault();

    const currentX = e.pageX;
    const currentY = e.pageY;

    // Drag threshold to prevent accidental drags
    const dist = Math.hypot(currentX - createStartX, currentY - createStartY);

    if (dist > 5) {
      // If we just started dragging, ensure UI is reset
      if (boxElement.style.display === 'none' || createWasVisible) {
        boxElement.style.display = 'block';
        if (popoverElement) popoverElement.style.display = 'none'; // Hide popover during drag
      }

      const width = Math.abs(currentX - createStartX);
      const height = Math.abs(currentY - createStartY);
      const left = Math.min(currentX, createStartX);
      const top = Math.min(currentY, createStartY);

      boxElement.style.left = `${left}px`;
      boxElement.style.top = `${top}px`;
      boxElement.style.width = `${width}px`;
      boxElement.style.height = `${height}px`;
    }
  }

  /**
   * Handles the end of a creation drag operation.
   * @param {MouseEvent} e
   */
  function onCreateEnd(e) {
    if (!isCreatingBox) return;
    isCreatingBox = false;
    document.removeEventListener('mousemove', onCreateMove);
    document.removeEventListener('mouseup', onCreateEnd);

    const dist = Math.hypot(e.pageX - createStartX, e.pageY - createStartY);

    if (dist > 5) {
      // Valid drag: Show full UI
      if (inputElement) inputElement.value = '';
      updateToggleStates();
      captureInitialToggleState();
      updatePopoverPosition();
      showDebugZones(1500);
    } else {
      // Just a click (handled here for PC consistency)
      if (createWasVisible) {
        hideBox();
        showToast('Cancelled');
      } else {
        spawnDefaultBox(e.pageX, e.pageY);
      }
    }
  }

  /**
   * Spawns a default-sized box centered at the given coordinates.
   * @param {number} pageX
   * @param {number} pageY
   */
  function spawnDefaultBox(pageX, pageY) {
    const img = document.querySelector('#image');
    const imgRect = img.getBoundingClientRect();
    const absLeft = imgRect.left + window.scrollX;
    const absTop = imgRect.top + window.scrollY;
    const absRight = absLeft + imgRect.width;
    const absBottom = absTop + imgRect.height;

    const minDimension = Math.min(imgRect.width, imgRect.height);
    let calculatedSize = minDimension * INITIAL_SIZE_RATIO;
    calculatedSize = Math.max(MIN_INITIAL_SIZE, Math.min(calculatedSize, MAX_INITIAL_SIZE));
    const size = Math.round(calculatedSize);

    let startX = pageX - (size / 2);
    let startY = pageY - (size / 2);

    if (startX < absLeft) startX = absLeft;
    if (startY < absTop) startY = absTop;
    if (startX + size > absRight) startX = absRight - size;
    if (startY + size > absBottom) startY = absBottom - size;

    showBox(startX, startY, size, size);
  }

  /**
   * Shows the note box at specific coordinates.
   * @param {number} x
   * @param {number} y
   * @param {number} w
   * @param {number} h
   */
  function showBox(x, y, w, h) {
    boxElement.style.left = `${x}px`;
    boxElement.style.top = `${y}px`;
    boxElement.style.width = `${w}px`;
    boxElement.style.height = `${h}px`;
    boxElement.style.display = 'block';

    if (inputElement) inputElement.value = '';

    showDebugZones(1500);

    updateToggleStates();
    captureInitialToggleState();
    updatePopoverPosition();
  }

  /**
   * Hides the note box and popover.
   */
  function hideBox() {
    boxElement.style.display = 'none';
    popoverElement.style.display = 'none';
  }

  /**
   * Updates the popover position to stay anchored to the box.
   * Handles zoom scaling via inverse transform.
   */
  function updatePopoverPosition() {
    const rect = boxElement.getBoundingClientRect();
    const boxCenterX = rect.left + window.scrollX + (rect.width / 2);
    const boxBottomY = rect.top + window.scrollY + rect.height;

    const popoverWidth = 230;

    const screenW = window.innerWidth;
    const minX = (popoverWidth / 2) + 10;
    const maxX = screenW - (popoverWidth / 2) - 10;
    const clampedX = Math.max(minX, Math.min(boxCenterX, maxX));
    const arrowOffset = boxCenterX - clampedX;

    const vvScale = window.visualViewport ? window.visualViewport.scale : 1;
    const invScale = 1 / vvScale;

    popoverElement.style.left = `${clampedX}px`;
    popoverElement.style.top = `${boxBottomY}px`;
    
    // Position 10px below, apply inverse scale
    popoverElement.style.transform = `translateX(-50%) translateY(10px) scale(${invScale})`;
    
    // Anchor transform origin to the arrow tip
    popoverElement.style.transformOrigin = `calc(50% + ${arrowOffset}px) -10px`;
    
    popoverElement.style.setProperty('--arrow-offset', `${arrowOffset}px`);
    popoverElement.style.display = 'flex';
  }

  /**
   * Sets up drag and resize interaction handlers for the note box.
   * Supports both Touch and Mouse events.
   */
  function setupDragAndResize() {
    let mode = null;
    let startX;
    let startY;
    let startLeft;
    let startTop;
    let startW;
    let startH;

    const onStart = (e) => {
      if (!isEnabled) return;
      const target = e.target;
      if (target === handleSE) mode = 'se';
      else if (target === handleNW) mode = 'nw';
      else if (target === handleSW || target === handleNE ||
               target === boxElement) {
        mode = 'drag';
      } else return;

      e.preventDefault();
      boxElement.classList.add('interacting');
      popoverElement.classList.add('interacting');

      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX;
      startY = pt.clientY;
      const rect = boxElement.getBoundingClientRect();
      startLeft = rect.left + window.scrollX;
      startTop = rect.top + window.scrollY;
      startW = rect.width;
      startH = rect.height;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchmove', onMove, {passive: false});
      document.addEventListener('mouseup', onEnd);
      document.addEventListener('touchend', onEnd);
    };

    const onMove = (e) => {
      if (!mode) return;
      e.preventDefault();
      const img = document.querySelector('#image');
      const imgRect = img.getBoundingClientRect();
      const boundLeft = imgRect.left + window.scrollX;
      const boundTop = imgRect.top + window.scrollY;
      const boundRight = boundLeft + imgRect.width;
      const boundBottom = boundTop + imgRect.height;

      const pt = e.touches ? e.touches[0] : e;
      const dx = pt.clientX - startX;
      const dy = pt.clientY - startY;

      if (mode === 'se') {
        let newW = Math.max(MIN_BOX_SIZE, startW + dx);
        let newH = Math.max(MIN_BOX_SIZE, startH + dy);
        if (startLeft + newW > boundRight) newW = boundRight - startLeft;
        if (startTop + newH > boundBottom) newH = boundBottom - startTop;
        boxElement.style.width = `${newW}px`;
        boxElement.style.height = `${newH}px`;
      } else if (mode === 'nw') {
        let deltaW = -dx;
        let deltaH = -dy;
        const attemptW = startW + deltaW;
        const attemptH = startH + deltaH;
        if (attemptW < MIN_BOX_SIZE) deltaW = MIN_BOX_SIZE - startW;
        if (attemptH < MIN_BOX_SIZE) deltaH = MIN_BOX_SIZE - startH;
        let newLeft = startLeft - deltaW;
        let newTop = startTop - deltaH;
        let newW = startW + deltaW;
        let newH = startH + deltaH;
        if (newLeft < boundLeft) {
          newLeft = boundLeft;
          newW -= (boundLeft - (startLeft - deltaW));
        }
        if (newTop < boundTop) {
          newTop = boundTop;
          newH -= (boundTop - (startTop - deltaH));
        }
        boxElement.style.left = `${newLeft}px`;
        boxElement.style.top = `${newTop}px`;
        boxElement.style.width = `${newW}px`;
        boxElement.style.height = `${newH}px`;
      } else if (mode === 'drag') {
        let newX = startLeft + dx;
        let newY = startTop + dy;
        const maxLeft = boundRight - startW;
        const maxTop = boundBottom - startH;
        newX = Math.max(boundLeft, Math.min(newX, maxLeft));
        newY = Math.max(boundTop, Math.min(newY, maxTop));
        boxElement.style.left = `${newX}px`;
        boxElement.style.top = `${newY}px`;
      }
      updatePopoverPosition();
    };

    const onEnd = () => {
      mode = null;
      boxElement.classList.remove('interacting');
      popoverElement.classList.remove('interacting');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchend', onEnd);
    };

    boxElement.addEventListener('mousedown', onStart);
    boxElement.addEventListener('touchstart', onStart, {passive: false});
  }

  /**
   * Submits the created note to the Danbooru API and updates tags if changed.
   */
  async function submitNote() {
    const img = document.querySelector('#image');
    if (!img) return;

    const boxRect = boxElement.getBoundingClientRect();
    const btn = document.getElementById('dmna-ok');
    const originHtml = btn.innerHTML;
    btn.innerHTML = '⏳';

    const postIdMatch = location.pathname.match(/\/posts\/(\d+)/);
    const postId = postIdMatch ? postIdMatch[1] : document.body.dataset.postId;
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

    // Fetch dimensions if not available
    if (!postOriginalWidth || !postOriginalHeight) {
      await fetchPostData(false);
    }

    const originalWidth = postOriginalWidth || img.naturalWidth;
    const originalHeight = postOriginalHeight || img.naturalHeight;

    const imgRect = img.getBoundingClientRect();
    const scaleX = originalWidth / imgRect.width;
    const scaleY = originalHeight / imgRect.height;
    const relX = boxRect.left - imgRect.left;
    const relY = boxRect.top - imgRect.top;
    const finalX = Math.round(relX * scaleX);
    const finalY = Math.round(relY * scaleY);
    const finalW = Math.round(boxRect.width * scaleX);
    const finalH = Math.round(boxRect.height * scaleY);

    if (finalX < 0 || finalY < 0) {
      showToast('⚠️ Out of bounds');
      btn.innerHTML = originHtml;
      return;
    }

    let noteBody = inputElement.value.trim();
    if (!noteBody) noteBody = 'Translation requested';

    const noteFormData = new FormData();
    noteFormData.append('authenticity_token', csrfToken);
    noteFormData.append('note[post_id]', postId);
    noteFormData.append('note[x]', finalX);
    noteFormData.append('note[y]', finalY);
    noteFormData.append('note[width]', finalW);
    noteFormData.append('note[height]', finalH);
    noteFormData.append('note[body]', noteBody);

    const getChecked = (id) =>
        document.getElementById(`dmna-tag-${id}`)?.checked;

    try {
      const promises = [];
      promises.push(fetch('/notes', {
        method: 'POST',
        headers: {'X-CSRF-Token': csrfToken},
        body: noteFormData,
      }));

      // Safe Sync logic for tags
      if (hasTagChanges()) {
        const latestTagSet = await fetchPostData(false);
        if (latestTagSet) {
          const processTag = (id, tagName) => {
            if (getChecked(id)) latestTagSet.add(tagName);
            else latestTagSet.delete(tagName);
          };
          processTag('translated', TAG_MAP.translated);
          processTag('request', TAG_MAP.request);
          processTag('check', TAG_MAP.check);
          processTag('partial', TAG_MAP.partial);

          const newTagString = Array.from(latestTagSet).join(' ');

          const tagFormData = new FormData();
          tagFormData.append('authenticity_token', csrfToken);
          tagFormData.append('post[tag_string]', newTagString);

          promises.push(fetch(`/posts/${postId}.json`, {
            method: 'PUT',
            headers: {'X-CSRF-Token': csrfToken},
            body: tagFormData,
          }));
        }
      } else {
        console.log('No tag changes detected. Skipping tag update.');
      }

      const results = await Promise.all(promises);
      const allOk = results.every((r) => r.ok);

      if (allOk) {
        if (getChecked('translated')) {
          localStorage.setItem(STATE_KEY, 'false');
        }
        showToast('✅ Saved! Reloading...');
        setTimeout(() => location.reload(), 800);
      } else {
        throw new Error('Server returned error');
      }
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.innerHTML = originHtml;
    }
  }

  init();
  setTimeout(init, 1000);
})();

