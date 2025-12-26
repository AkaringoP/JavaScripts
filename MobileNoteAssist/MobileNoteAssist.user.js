// ==UserScript==
// @name         Danbooru Mobile Note Assist
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  Assist creating notes on mobile with accurate scaling and touch-friendly controls. Includes draggable button.
// @author       AkaringoP
// @match        *://danbooru.donmai.us/posts/*
// @icon         https://danbooru.donmai.us/favicon.ico
// @updateURL    https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/MobileNoteAssist/MobileNoteAssist.user.js
// @downloadURL  https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/MobileNoteAssist/MobileNoteAssist.user.js
// @grant        none
// ==/UserScript==

(function() {
  'use strict';

  /**
   * Configuration constants.
   */
  const STATE_KEY = 'dmna_enabled';
  const POS_KEY = 'dmna_btn_margin_y';
  const INITIAL_SIZE_RATIO = 0.10; // 10% of the image's smaller dimension
  const MIN_BOX_SIZE = 15;
  const MIN_INITIAL_SIZE = 30;
  const MAX_INITIAL_SIZE = 150;
  const LONG_PRESS_DURATION = 1500; // 1.5 Seconds

  // UI Positioning Constants
  const BTN_SIZE = 40;
  const BTN_MARGIN_X = 20;
  const DEFAULT_BTN_MARGIN_Y = 80;
  const TOAST_MARGIN_BOTTOM = 20;

  /**
   * Global state variables.
   */
  let isEnabled = localStorage.getItem(STATE_KEY) === 'true';
  let userBtnMarginY = parseInt(localStorage.getItem(POS_KEY), 10) || DEFAULT_BTN_MARGIN_Y;

  // Interaction state variables
  let isDraggingBtn = false;
  let isPressing = false;
  let longPressTimer = null;
  let dragStartY = 0;
  let dragStartMarginY = 0;

  // DOM Elements
  let boxElement = null;
  let handleNW = null;
  let handleSE = null;
  let handleSW = null;
  let handleNE = null;
  let popoverElement = null;
  let toastElement = null;
  let toastTimer = null;
  let viewportRaf = null;

  /**
   * CSS styles for the UI components.
   */
  const STYLES = `
    /* 1. Note Box Container */
    #dmna-box {
      position: absolute;
      width: 50px;
      height: 50px;
      border: 1.4px solid #0073ff;
      background-color: rgba(0, 115, 255, 0.15);
      z-index: 9990;
      touch-action: none;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
      display: none;
      box-sizing: border-box;
    }

    /* 2. Resize Handles */
    #dmna-resize-se {
      position: absolute; width: 0; height: 0; right: 0; bottom: 0;
      border-bottom: 7px solid #0073ff;
      border-left: 7px solid transparent;
      cursor: nwse-resize; z-index: 9991;
      filter: drop-shadow(-1px -1px 0 rgba(255, 255, 255, 0.5));
    }
    #dmna-resize-se::after {
      content: ''; position: absolute;
      right: -40px; bottom: -40px; width: 70px; height: 70px;
    }

    #dmna-resize-nw {
      position: absolute; width: 0; height: 0; left: 0; top: 0;
      cursor: nwse-resize; z-index: 9991;
    }
    #dmna-resize-nw::after {
      content: ''; position: absolute;
      left: -40px; top: -40px; width: 70px; height: 70px;
    }

    /* 3. Drag Handles */
    #dmna-drag-sw {
      position: absolute; width: 0; height: 0; left: 0; bottom: 0;
      cursor: move; z-index: 9991;
    }
    #dmna-drag-sw::after {
      content: ''; position: absolute;
      left: -40px; bottom: -40px; width: 70px; height: 70px;
    }

    #dmna-drag-ne {
      position: absolute; width: 0; height: 0; right: 0; top: 0;
      cursor: move; z-index: 9991;
    }
    #dmna-drag-ne::after {
      content: ''; position: absolute;
      right: -40px; top: -40px; width: 70px; height: 70px;
    }

    /* 4. Popover */
    #dmna-popover {
      position: absolute; z-index: 9992; display: flex; gap: 15px;
      background: white; padding: 10px 16px; border-radius: 14px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      display: none; border: 1px solid #ddd;
      --arrow-offset: 0px;
    }
    #dmna-popover::after {
      content: ""; position: absolute; top: -10px;
      left: calc(50% + var(--arrow-offset)); margin-left: -10px;
      border-width: 0 10px 10px 10px; border-style: solid;
      border-color: transparent transparent white transparent;
    }
    #dmna-popover::before {
      content: ""; position: absolute; top: -11px;
      left: calc(50% + var(--arrow-offset)); margin-left: -10px;
      border-width: 0 10px 10px 10px; border-style: solid;
      border-color: transparent transparent #ddd transparent;
    }

    .dmna-btn {
      width: 42px; height: 42px; border-radius: 50%; border: none;
      font-size: 20px; display: flex; align-items: center; justify-content: center;
      cursor: pointer; transition: transform 0.1s;
    }
    .dmna-btn:active { transform: scale(0.9); }
    #dmna-ok { background: #e8f5e9; color: #2e7d32; }
    #dmna-no { background: #ffebee; color: #c62828; }

    /* 5. Floating Toggle Button */
    #dmna-float-btn {
      position: absolute;
      left: 0; top: 0;
      width: 40px; height: 40px; border-radius: 50%;
      background: rgba(0, 0, 0, 0.6); color: white; font-size: 21px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      display: flex; align-items: center; justify-content: center;
      z-index: 11000; cursor: pointer; backdrop-filter: blur(2px);
      user-select: none;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      transform-origin: 0 0;
      will-change: transform, background, box-shadow;
      transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
      /* Important: Disable default touch actions to prevent native scrolling/menu */
      touch-action: none;
    }
    #dmna-float-btn.active {
      background: #0073ff;
      border-color: white;
      box-shadow: 0 0 15px #0073ff;
    }
    #dmna-float-btn.dragging {
      background: #ff9800 !important;
      border-color: #ffe0b2 !important;
      box-shadow: 0 0 15px #ff9800 !important;
      transform: scale(1.2);
    }

    /* 6. Toast Message */
    #dmna-toast {
      visibility: hidden; min-width: 160px;
      background-color: rgba(30, 30, 30, 0.95); color: #fff;
      text-align: center; border-radius: 50px; padding: 12px 24px;
      position: absolute;
      left: 0; top: 0; z-index: 11000;
      font-size: 14px; opacity: 0;
      transition: opacity 0.4s ease-in-out;
      pointer-events: none;
      transform-origin: 0 0;
      will-change: transform, opacity;
    }
    #dmna-toast.show { visibility: visible; opacity: 1; }

    /* 7. Sidebar Link Styling */
    #dmna-sidebar-link {
      color: #7b8c9d !important;
      transition: all 0.3s ease;
      text-decoration: none;
    }
    #dmna-sidebar-link.active {
      color: #0073ff !important;
      font-weight: bold;
      text-shadow: 0 0 8px rgba(0, 115, 255, 0.6);
    }

    body.dmna-active #image { cursor: crosshair !important; }
  `;

  // Inject Styles
  if (typeof GM_addStyle !== 'undefined') {
    GM_addStyle(STYLES);
  } else {
    const style = document.createElement('style');
    style.innerHTML = STYLES;
    document.head.appendChild(style);
  }

  function showToast(msg) {
    if (!toastElement) {
      toastElement = document.createElement('div');
      toastElement.id = 'dmna-toast';
      document.body.appendChild(toastElement);
    }
    updateVisualViewportPositions();
    toastElement.textContent = msg;
    void toastElement.offsetWidth;
    toastElement.className = 'show';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastElement.className = '';
    }, 2500);
  }

  function updateVisualViewportPositions() {
    const btn = document.getElementById('dmna-float-btn');
    const toast = document.getElementById('dmna-toast');

    if (!window.visualViewport) {
      const scrollX = window.pageXOffset;
      const scrollY = window.pageYOffset;
      if (btn) {
        btn.style.transform = `translate(${scrollX + window.innerWidth - BTN_MARGIN_X - BTN_SIZE}px, ${scrollY + window.innerHeight - userBtnMarginY - BTN_SIZE}px)`;
      }
      if (toast) {
        toast.style.transform = `translate(${scrollX + window.innerWidth / 2}px, ${scrollY + window.innerHeight - TOAST_MARGIN_BOTTOM}px) translate(-50%, 0)`;
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

    if (toast && toast.classList.contains('show')) {
      const tx = vvPageLeft + (vv.width / 2);
      const ty = vvPageTop + vv.height - (TOAST_MARGIN_BOTTOM * invScale);
      toast.style.transform = `translate(${tx}px, ${ty}px) scale(${invScale}) translate(-50%, -100%)`;
    }
  }

  function init() {
    createUI();
    updateStateUI();
    updateVisualViewportPositions();

    if (window.visualViewport) {
      const handleUpdate = () => {
        if (!viewportRaf) {
          viewportRaf = requestAnimationFrame(() => {
            updateVisualViewportPositions();
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

    const img = document.querySelector('#image');
    if (img) {
      img.addEventListener('click', onImageClick);
    }
  }

  function createUI() {
    if (document.getElementById('dmna-box')) return;

    const floatBtn = document.createElement('div');
    floatBtn.id = 'dmna-float-btn';
    floatBtn.innerHTML = '📝';

    // Button interactions are now fully handled in setupButtonInteractions
    // No separate onclick handler
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
    boxElement.appendChild(handleSE);

    handleNW = document.createElement('div');
    handleNW.id = 'dmna-resize-nw';
    boxElement.appendChild(handleNW);

    handleSW = document.createElement('div');
    handleSW.id = 'dmna-drag-sw';
    boxElement.appendChild(handleSW);

    handleNE = document.createElement('div');
    handleNE.id = 'dmna-drag-ne';
    boxElement.appendChild(handleNE);

    document.body.appendChild(boxElement);

    popoverElement = document.createElement('div');
    popoverElement.id = 'dmna-popover';
    popoverElement.innerHTML = `
      <button id="dmna-ok" class="dmna-btn">✔</button>
      <button id="dmna-no" class="dmna-btn">✖</button>
    `;
    document.body.appendChild(popoverElement);

    setupDragAndResize();
    document.getElementById('dmna-ok').addEventListener('click', submitNote);
    document.getElementById('dmna-no').addEventListener('click', () => {
      hideBox();
      showToast('Cancelled');
    });
  }

  /**
   * Sets up touch interactions (Tap vs Long Press Drag) for the floating button.
   * Uses manual event handling to override default browser behavior.
   * @param {HTMLElement} btn
   */
  function setupButtonInteractions(btn) {
    btn.addEventListener('touchstart', (e) => {
      // Prevent browser default (context menu, selection, magnifying glass)
      // This is crucial for the timer to work while holding still
      e.preventDefault();

      isDraggingBtn = false;
      isPressing = true;
      dragStartY = e.touches[0].clientY;
      dragStartMarginY = userBtnMarginY;

      // Start Long Press Timer
      longPressTimer = setTimeout(() => {
        if (isPressing) {
          isDraggingBtn = true;
          btn.classList.add('dragging');
          if (navigator.vibrate) navigator.vibrate(50);
          showToast('↕️ Reposition Mode');
        }
      }, LONG_PRESS_DURATION);
    }, { passive: false });

    btn.addEventListener('touchmove', (e) => {
      // Always prevent scroll when touching the button
      e.preventDefault();
      e.stopPropagation();

      const currentY = e.touches[0].clientY;

      // If we are already in drag mode, update position
      if (isDraggingBtn) {
        const dy = currentY - dragStartY;
        let newMargin = dragStartMarginY - dy;
        const screenH = window.innerHeight;
        newMargin = Math.max(20, Math.min(screenH - 100, newMargin));
        userBtnMarginY = newMargin;
        updateVisualViewportPositions();
        return;
      }

      // If not in drag mode yet, check if user moved too much (cancel long press)
      if (Math.abs(currentY - dragStartY) > 10) {
        clearTimeout(longPressTimer);
        isPressing = false;
      }
    }, { passive: false });

    btn.addEventListener('touchend', (e) => {
      e.preventDefault(); // Prevent default click generation
      clearTimeout(longPressTimer);
      isPressing = false;

      if (isDraggingBtn) {
        // End of drag
        isDraggingBtn = false;
        btn.classList.remove('dragging');
        localStorage.setItem(POS_KEY, userBtnMarginY);
        // Silently saved
      } else {
        // If it wasn't a drag/long-press, treat it as a Click/Toggle
        toggleState();
      }
    });
  }

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

  function onImageClick(e) {
    if (!isEnabled) return;
    if (e.target.closest('#dmna-box') ||
        e.target.closest('#dmna-popover') ||
        e.target.closest('#dmna-float-btn')) {
      return;
    }

    e.preventDefault();
    e.stopPropagation();

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

    let startX = e.pageX - (size / 2);
    let startY = e.pageY - (size / 2);

    if (startX < absLeft) startX = absLeft;
    if (startY < absTop) startY = absTop;
    if (startX + size > absRight) startX = absRight - size;
    if (startY + size > absBottom) startY = absBottom - size;

    showBox(startX, startY, size, size);
  }

  function showBox(x, y, w, h) {
    boxElement.style.left = `${x}px`;
    boxElement.style.top = `${y}px`;
    boxElement.style.width = `${w}px`;
    boxElement.style.height = `${h}px`;
    boxElement.style.display = 'block';
    updatePopoverPosition();
  }

  function hideBox() {
    boxElement.style.display = 'none';
    popoverElement.style.display = 'none';
  }

  function updatePopoverPosition() {
    const rect = boxElement.getBoundingClientRect();
    const boxCenterX = rect.left + window.scrollX + (rect.width / 2);
    const boxBottomY = rect.top + window.scrollY + rect.height;

    const popoverWidth = 140;
    const screenW = window.innerWidth;
    const minX = (popoverWidth / 2) + 10;
    const maxX = screenW - (popoverWidth / 2) - 10;
    const clampedX = Math.max(minX, Math.min(boxCenterX, maxX));
    const arrowOffset = boxCenterX - clampedX;

    popoverElement.style.left = `${clampedX}px`;
    popoverElement.style.top = `${boxBottomY}px`;
    popoverElement.style.transform = `translateX(-50%) translateY(15px)`;
    popoverElement.style.setProperty('--arrow-offset', `${arrowOffset}px`);
    popoverElement.style.display = 'flex';
  }

  function setupDragAndResize() {
    let mode = null;
    let startX, startY, startLeft, startTop, startW, startH;

    const onStart = (e) => {
      if (!isEnabled) return;
      const target = e.target;

      if (target === handleSE) mode = 'se';
      else if (target === handleNW) mode = 'nw';
      else if (target === handleSW || target === handleNE || target === boxElement) mode = 'drag';
      else return;

      e.preventDefault();
      const pt = e.touches ? e.touches[0] : e;
      startX = pt.clientX;
      startY = pt.clientY;

      const rect = boxElement.getBoundingClientRect();
      startLeft = rect.left + window.scrollX;
      startTop = rect.top + window.scrollY;
      startW = rect.width;
      startH = rect.height;

      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchmove', onMove, { passive: false });
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
        let attemptW = startW + deltaW;
        let attemptH = startH + deltaH;

        if (attemptW < MIN_BOX_SIZE) {
          deltaW = MIN_BOX_SIZE - startW;
        }
        if (attemptH < MIN_BOX_SIZE) {
          deltaH = MIN_BOX_SIZE - startH;
        }

        let newLeft = startLeft - deltaW;
        let newTop = startTop - deltaH;
        let newW = startW + deltaW;
        let newH = startH + deltaH;

        if (newLeft < boundLeft) {
          const overflowX = boundLeft - newLeft;
          newLeft = boundLeft;
          newW -= overflowX;
        }
        if (newTop < boundTop) {
          const overflowY = boundTop - newTop;
          newTop = boundTop;
          newH -= overflowY;
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
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('mouseup', onEnd);
      document.removeEventListener('touchend', onEnd);
    };

    boxElement.addEventListener('mousedown', onStart);
    boxElement.addEventListener('touchstart', onStart, { passive: false });
  }

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

    let originalWidth = img.naturalWidth;
    let originalHeight = img.naturalHeight;

    try {
      const infoRes = await fetch(`/posts/${postId}.json`);
      if (infoRes.ok) {
        const data = await infoRes.json();
        originalWidth = data.image_width;
        originalHeight = data.image_height;
      }
    } catch (e) {
      if (document.body.dataset.postWidth) {
        originalWidth = parseInt(document.body.dataset.postWidth, 10);
        originalHeight = parseInt(document.body.dataset.postHeight, 10);
      }
    }

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
      showToast('⚠️ Out of image bounds.');
      btn.innerHTML = originHtml;
      return;
    }

    const formData = new FormData();
    formData.append('authenticity_token', csrfToken);
    formData.append('note[post_id]', postId);
    formData.append('note[x]', finalX);
    formData.append('note[y]', finalY);
    formData.append('note[width]', finalW);
    formData.append('note[height]', finalH);
    formData.append('note[body]', "<i>It's needs to be edited.</i>");

    try {
      const res = await fetch('/notes', {
        method: 'POST',
        headers: { 'X-CSRF-Token': csrfToken },
        body: formData,
      });

      if (res.ok) {
        showToast('✅ Note created! Reloading...');
        setTimeout(() => location.reload(), 800);
      } else {
        throw new Error('Server Error');
      }
    } catch (err) {
      showToast('Error: ' + err.message);
      btn.innerHTML = originHtml;
    }
  }

  // Run initialization
  init();
  setTimeout(init, 1000);
})();
