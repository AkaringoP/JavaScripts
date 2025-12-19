// ==UserScript==
// @name         Danbooru Mobile Note Assist
// @namespace    http://tampermonkey.net/
// @version      1.0.0
// @description  Assist creating notes on mobile with accurate scaling and touch-friendly controls.
// @author       AkaringoP 
// @match        *://danbooru.donmai.us/posts/*
// @grant        GM_addStyle
// ==/UserScript==

(function() {
  'use strict';

  /**
   * Configuration and State Variables
   */
  const STATE_KEY = 'dmna_enabled';
  let isEnabled = localStorage.getItem(STATE_KEY) === 'true';

  // UI Elements
  let boxElement = null;
  let handleNW = null;
  let handleSE = null;
  let handleSW = null;
  let handleNE = null;
  let popoverElement = null;
  let toastElement = null;
  let toastTimer = null;

  /**
   * CSS Styles
   * Google Style: Use 2-space indentation within the template literal for readability.
   */
  const STYLES = `
    /* 1. Note Box (The visible container) */
    #dmna-box {
      position: absolute;
      width: 50px;
      height: 50px;
      border: 2px solid #0073ff;
      background-color: rgba(0, 115, 255, 0.15);
      z-index: 9990;
      touch-action: none;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
      display: none;
      box-sizing: border-box;
    }

    /* 2. Resize Handle SE (Bottom-Right) - Visible Triangle */
    #dmna-resize-se {
      position: absolute;
      width: 0;
      height: 0;
      right: 0;
      bottom: 0;
      border-bottom: 7px solid #0073ff;
      border-left: 7px solid transparent;
      cursor: nwse-resize;
      z-index: 9991;
      filter: drop-shadow(-1px -1px 0 rgba(255, 255, 255, 0.5));
    }
    /* Extended Touch Area for SE */
    #dmna-resize-se::after {
      content: '';
      position: absolute;
      right: -40px;
      bottom: -40px;
      width: 70px;
      height: 70px;
    }

    /* 3. Resize Handle NW (Top-Left) - Visible Triangle */
    #dmna-resize-nw {
      position: absolute;
      width: 0;
      height: 0;
      left: 0;
      top: 0;
      border-top: 7px solid #0073ff;
      border-right: 7px solid transparent;
      cursor: nwse-resize;
      z-index: 9991;
      filter: drop-shadow(1px 1px 0 rgba(255, 255, 255, 0.5));
    }
    /* Extended Touch Area for NW */
    #dmna-resize-nw::after {
      content: '';
      position: absolute;
      left: -40px;
      top: -40px;
      width: 70px;
      height: 70px;
    }

    /* 4. Drag Handle SW (Bottom-Left) - Invisible Zone */
    #dmna-drag-sw {
      position: absolute;
      width: 0;
      height: 0;
      left: 0;
      bottom: 0;
      cursor: move;
      z-index: 9991;
    }
    #dmna-drag-sw::after {
      content: '';
      position: absolute;
      left: -40px;
      bottom: -40px;
      width: 70px;
      height: 70px;
    }

    /* 5. Drag Handle NE (Top-Right) - Invisible Zone */
    #dmna-drag-ne {
      position: absolute;
      width: 0;
      height: 0;
      right: 0;
      top: 0;
      cursor: move;
      z-index: 9991;
    }
    #dmna-drag-ne::after {
      content: '';
      position: absolute;
      right: -40px;
      top: -40px;
      width: 70px;
      height: 70px;
    }

    /* 6. Popover (Speech Bubble) */
    #dmna-popover {
      position: absolute;
      z-index: 9992;
      display: flex;
      gap: 15px;
      background: white;
      padding: 10px 16px;
      border-radius: 14px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
      display: none;
      border: 1px solid #ddd;
      --arrow-offset: 0px;
    }
    /* Popover Arrow */
    #dmna-popover::after {
      content: "";
      position: absolute;
      top: -10px;
      left: calc(50% + var(--arrow-offset));
      margin-left: -10px;
      border-width: 0 10px 10px 10px;
      border-style: solid;
      border-color: transparent transparent white transparent;
    }
    #dmna-popover::before {
      content: "";
      position: absolute;
      top: -11px;
      left: calc(50% + var(--arrow-offset));
      margin-left: -10px;
      border-width: 0 10px 10px 10px;
      border-style: solid;
      border-color: transparent transparent #ddd transparent;
    }

    /* Popover Buttons */
    .dmna-btn {
      width: 42px;
      height: 42px;
      border-radius: 50%;
      border: none;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: transform 0.1s;
    }
    .dmna-btn:active {
      transform: scale(0.9);
    }
    #dmna-ok {
      background: #e8f5e9;
      color: #2e7d32;
    }
    #dmna-no {
      background: #ffebee;
      color: #c62828;
    }

    /* 7. Floating Toggle Button */
    #dmna-float-btn {
      position: fixed;
      bottom: 80px;
      right: 20px;
      width: 35px;
      height: 35px;
      border-radius: 50%;
      background: rgba(0, 0, 0, 0.6);
      color: white;
      font-size: 18px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      cursor: pointer;
      backdrop-filter: blur(2px);
      user-select: none;
      transition: all 0.2s;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
    }
    #dmna-float-btn.active {
      background: #0073ff;
      border-color: white;
      box-shadow: 0 0 15px #0073ff;
      transform: scale(1.1);
    }

    /* 8. Toast Message */
    #dmna-toast {
      visibility: hidden;
      min-width: 160px;
      background-color: rgba(30, 30, 30, 0.95);
      color: #fff;
      text-align: center;
      border-radius: 50px;
      padding: 12px 24px;
      position: fixed;
      z-index: 11000;
      left: 50%;
      bottom: 30px;
      transform: translateX(-50%);
      font-size: 14px;
      opacity: 0;
      transition: opacity 0.5s ease-in-out, bottom 0.5s ease-in-out;
      pointer-events: none;
    }
    #dmna-toast.show {
      visibility: visible;
      opacity: 1;
      bottom: 50px;
    }

    /* Utility */
    body.dmna-active #image {
      cursor: crosshair !important;
    }
  `;

  // Apply Styles
  if (typeof GM_addStyle !== 'undefined') {
    GM_addStyle(STYLES);
  } else {
    const style = document.createElement('style');
    style.innerHTML = STYLES;
    document.head.appendChild(style);
  }

  /**
   * Displays a toast message at the bottom of the screen.
   * @param {string} msg - The message to display.
   */
  function showToast(msg) {
    if (!toastElement) {
      toastElement = document.createElement('div');
      toastElement.id = 'dmna-toast';
      document.body.appendChild(toastElement);
    }

    toastElement.textContent = msg;
    // Trigger reflow to ensure CSS transition works for repeated calls
    void toastElement.offsetWidth;

    toastElement.className = 'show';

    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toastElement.className = '';
    }, 2500);
  }

  /**
   * Initializes the script.
   */
  function init() {
    createUI();
    updateStateUI();

    const floatBtn = document.getElementById('dmna-float-btn');
    if (floatBtn) {
      floatBtn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleState();
      };
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

  /**
   * Creates the necessary DOM elements for the UI.
   */
  function createUI() {
    if (document.getElementById('dmna-box')) return;

    // 1. Floating Toggle Button
    const floatBtn = document.createElement('div');
    floatBtn.id = 'dmna-float-btn';
    floatBtn.innerHTML = '📝';
    document.body.appendChild(floatBtn);

    // 2. Sidebar Option
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

    // 3. Note Box Container
    boxElement = document.createElement('div');
    boxElement.id = 'dmna-box';

    // 4. Handles
    // Resize Handles (Visible)
    handleSE = document.createElement('div');
    handleSE.id = 'dmna-resize-se';
    boxElement.appendChild(handleSE);

    handleNW = document.createElement('div');
    handleNW.id = 'dmna-resize-nw';
    boxElement.appendChild(handleNW);

    // Drag Handles (Invisible)
    handleSW = document.createElement('div');
    handleSW.id = 'dmna-drag-sw';
    boxElement.appendChild(handleSW);

    handleNE = document.createElement('div');
    handleNE.id = 'dmna-drag-ne';
    boxElement.appendChild(handleNE);

    document.body.appendChild(boxElement);

    // 5. Popover
    popoverElement = document.createElement('div');
    popoverElement.id = 'dmna-popover';
    popoverElement.innerHTML = `
      <button id="dmna-ok" class="dmna-btn">✔</button>
      <button id="dmna-no" class="dmna-btn">✖</button>
    `;
    document.body.appendChild(popoverElement);

    // Event Listeners
    setupDragAndResize();
    document.getElementById('dmna-ok').addEventListener('click', submitNote);
    document.getElementById('dmna-no').addEventListener('click', () => {
      hideBox();
      showToast('Cancelled');
    });
  }

  /**
   * Toggles the enabled state of the script.
   */
  function toggleState() {
    isEnabled = !isEnabled;
    localStorage.setItem(STATE_KEY, isEnabled);
    updateStateUI();

    if (isEnabled) {
      showToast('✨ Note Assist ON');
    } else {
      hideBox();
      showToast('Note Assist OFF');
    }
  }

  /**
   * Updates the UI (button styles) based on the enabled state.
   */
  function updateStateUI() {
    const floatBtn = document.getElementById('dmna-float-btn');
    const sidebarLink = document.getElementById('dmna-sidebar-link');

    if (isEnabled) {
      floatBtn.classList.add('active');
      document.body.classList.add('dmna-active');
      if (sidebarLink) {
        sidebarLink.textContent = 'Note Assist: ON';
        sidebarLink.style.fontWeight = 'bold';
        sidebarLink.style.color = '#0073ff';
      }
    } else {
      floatBtn.classList.remove('active');
      document.body.classList.remove('dmna-active');
      if (sidebarLink) {
        sidebarLink.textContent = 'Note Assist: OFF';
        sidebarLink.style.fontWeight = 'normal';
        sidebarLink.style.color = '';
      }
    }
  }

  /**
   * Handles click events on the main image to create the note box.
   * @param {Event} e - The click event.
   */
  function onImageClick(e) {
    if (!isEnabled) return;

    // Ignore clicks on UI elements
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

    const size = 50;
    let startX = e.pageX - (size / 2);
    let startY = e.pageY - (size / 2);

    // Clamp initial box position within image boundaries
    if (startX < absLeft) startX = absLeft;
    if (startY < absTop) startY = absTop;
    if (startX + size > absRight) startX = absRight - size;
    if (startY + size > absBottom) startY = absBottom - size;

    showBox(startX, startY, size, size);
  }

  /**
   * Displays the note box at the specified coordinates.
   */
  function showBox(x, y, w, h) {
    boxElement.style.left = `${x}px`;
    boxElement.style.top = `${y}px`;
    boxElement.style.width = `${w}px`;
    boxElement.style.height = `${h}px`;
    boxElement.style.display = 'block';
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
   * Updates the popover position, ensuring it stays within the screen.
   */
  function updatePopoverPosition() {
    const rect = boxElement.getBoundingClientRect();
    const boxCenterX = rect.left + window.scrollX + (rect.width / 2);
    const boxBottomY = rect.top + window.scrollY + rect.height;

    const popoverWidth = 140; // Approximate width
    const screenW = window.innerWidth;
    const minX = (popoverWidth / 2) + 10;
    const maxX = screenW - (popoverWidth / 2) - 10;

    // Clamp X position to keep popover on screen
    const clampedX = Math.max(minX, Math.min(boxCenterX, maxX));
    const arrowOffset = boxCenterX - clampedX;

    popoverElement.style.left = `${clampedX}px`;
    popoverElement.style.top = `${boxBottomY}px`;
    popoverElement.style.transform = `translateX(-50%) translateY(15px)`;
    popoverElement.style.setProperty('--arrow-offset', `${arrowOffset}px`);
    popoverElement.style.display = 'flex';
  }

  /**
   * Sets up drag and resize interactions for the note box.
   */
  function setupDragAndResize() {
    let mode = null; // 'drag', 'se', 'nw'
    let startX, startY, startLeft, startTop, startW, startH;

    const onStart = (e) => {
      if (!isEnabled) return;
      const target = e.target;

      // Determine interaction mode based on the target
      if (target === handleSE) {
        mode = 'se'; // Resize Bottom-Right
      } else if (target === handleNW) {
        mode = 'nw'; // Resize Top-Left
      } else if (target === handleSW || target === handleNE || target === boxElement) {
        mode = 'drag'; // Move (Bottom-Left, Top-Right, or Body)
      } else {
        return;
      }

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

      // 1. Resize Mode: Bottom-Right (SE)
      if (mode === 'se') {
        let newW = Math.max(30, startW + dx);
        let newH = Math.max(30, startH + dy);

        // Clamp to boundaries
        if (startLeft + newW > boundRight) newW = boundRight - startLeft;
        if (startTop + newH > boundBottom) newH = boundBottom - startTop;

        boxElement.style.width = `${newW}px`;
        boxElement.style.height = `${newH}px`;
      }
      // 2. Resize Mode: Top-Left (NW)
      else if (mode === 'nw') {
        let deltaW = -dx;
        let deltaH = -dy;
        let attemptW = startW + deltaW;
        let attemptH = startH + deltaH;

        // Enforce minimum size
        if (attemptW < 30) {
          deltaW = 30 - startW;
        }
        if (attemptH < 30) {
          deltaH = 30 - startH;
        }

        let newLeft = startLeft - deltaW;
        let newTop = startTop - deltaH;
        let newW = startW + deltaW;
        let newH = startH + deltaH;

        // Clamp Left/Top boundaries
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
      }
      // 3. Drag Mode
      else if (mode === 'drag') {
        let newX = startLeft + dx;
        let newY = startTop + dy;

        const maxLeft = boundRight - startW;
        const maxTop = boundBottom - startH;

        // Clamp to all boundaries
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

  /**
   * Submits the note data to the Danbooru API.
   * Handles scale correction for sample images.
   */
  async function submitNote() {
    const img = document.querySelector('#image');
    if (!img) return;

    // Use only the box dimensions for calculation
    const boxRect = boxElement.getBoundingClientRect();

    const btn = document.getElementById('dmna-ok');
    const originHtml = btn.innerHTML;
    btn.innerHTML = '⏳';

    const postIdMatch = location.pathname.match(/\/posts\/(\d+)/);
    const postId = postIdMatch ? postIdMatch[1] : document.body.dataset.postId;
    const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content;

    let originalWidth = img.naturalWidth;
    let originalHeight = img.naturalHeight;

    // Fetch actual original dimensions via API to handle sample images correctly
    try {
      const infoRes = await fetch(`/posts/${postId}.json`);
      if (infoRes.ok) {
        const data = await infoRes.json();
        originalWidth = data.image_width;
        originalHeight = data.image_height;
      }
    } catch (e) {
      console.error('API Fetch Error, falling back to dataset', e);
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
        body: formData
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

  // Run Initialization
  init();
  // Fallback initialization for delayed loading
  setTimeout(init, 1000);

})();

