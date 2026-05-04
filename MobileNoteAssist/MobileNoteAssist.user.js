// ==UserScript==
// @name         Danbooru Mobile Note Assist
// @namespace    http://tampermonkey.net/
// @version      2.6
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

  /** @const {string} Key for local storage button vertical position. */
  const POS_KEY = 'dmna_btn_margin_y';

  /** @const {string} Key for local storage button horizontal position. */
  const POS_X_KEY = 'dmna_btn_margin_x';

  /** @const {string} Legacy v2.x localStorage key, removed once on upgrade. */
  const LEGACY_STATE_KEY = 'dmna_enabled';

  /** @const {number} Duration in ms to trigger long-press actions. */
  const LONG_PRESS_DURATION = 1500;

  /** @const {number} Max gap between two taps to be treated as a double-tap. */
  const DOUBLE_TAP_THRESHOLD_MS = 300;

  /** @const {number} Floating button size in pixels. */
  const BTN_SIZE = 40;

  /** @const {number} Default horizontal margin (from right edge) for the floating button. */
  const DEFAULT_BTN_MARGIN_X = 20;

  /** @const {number} Default vertical margin (from bottom edge) for the floating button. */
  const DEFAULT_BTN_MARGIN_Y = 80;

  /** @const {number} Bottom margin for the toast message. */
  const TOAST_MARGIN_BOTTOM = 20;

  /** @const {number} Default new-box size as a fraction of the shorter
   *  rendered image dimension. v2.6 carry-over. */
  const INITIAL_SIZE_RATIO = 0.1;

  /** @const {number} Lower clamp for the default new-box display size (px). */
  const MIN_INITIAL_SIZE = 30;

  /** @const {number} Upper clamp for the default new-box display size (px). */
  const MAX_INITIAL_SIZE = 150;

  /** @const {number} Minimum hypot distance (px) between mousedown and
   *  mouseup on the image to count as a "drag-to-create" rather than a
   *  click. Phase 3 Wave 3 (drag/resize) wires PC-only drag-to-create. */
  const DRAG_THRESHOLD_PX = 5;

  /** @const {number} Absolute minimum box width/height in original-image
   *  pixels. The display-space floor (`MIN_BOX_SIZE_DISPLAY`) is the
   *  binding constraint at most zoom levels; this is just a safety
   *  net so we never store an effectively-zero rect. */
  const MIN_BOX_SIZE_IMG = 8;

  /** @const {number} Minimum box width/height in display pixels.
   *  Originally 48 for "all four 32px touch zones non-overlapping," but
   *  with the corner zones now positioned mostly outside the box (NW/NE
   *  fully outside, SE/SW shifted up half) the in-box overlap concern
   *  is gone, so this is now driven purely by "how small a box is still
   *  usable." 40 keeps the body large enough to grab without crowding
   *  the SE corner triangle affordance. */
  const MIN_BOX_SIZE_DISPLAY = 40;

  /** @const {number} Popover CSS width in display pixels (counter-scaled
   *  by visualViewport so the visual width stays constant under pinch). */
  const POPOVER_WIDTH = 260;

  /** @const {number} Vertical gap (display px) between the active box's
   *  bottom edge and the popover's top edge. */
  const POPOVER_OFFSET = 12;

  /** @const {number} Min visual padding from the viewport edge when the
   *  popover would otherwise clip. */
  const POPOVER_VIEWPORT_PADDING = 10;

  /** @const {number} Half-width (px) of the popover's pointer arrow.
   *  Used to clamp the arrow's horizontal slide so it never overhangs
   *  the popover's rounded corners. */
  const POPOVER_ARROW_HALF = 8;

  // --------------------------------------------------------------------------
  // Type Definitions (JSDoc)
  // --------------------------------------------------------------------------

  /**
   * @typedef {Object} NoteState
   * @property {number} x  Original-image x-coord of the box top-left.
   * @property {number} y  Original-image y-coord of the box top-left.
   * @property {number} w  Original-image width.
   * @property {number} h  Original-image height.
   * @property {string} text  Note body.
   *
   * All four geometry fields live in original-image pixel space (the same
   * space Danbooru's `/notes` API uses). The renderer projects them to the
   * current rendered display rect via `imageToScreenRect()`; tap handlers
   * project the other way via `screenToImageState()`. Display-space numbers
   * never enter a Note.
   */

  /**
   * @typedef {Object} Note
   * @property {NoteState} current  Live working state, mutated by edits.
   * @property {NoteState} initialState  Immutable snapshot at create/load
   *     time — the dirty (green) classification compares against this.
   * @property {NoteState} confirmedState  Latest popover-✔ checkpoint; the
   *     ✖ button reverts `current` here, and per-note Undo restores from
   *     here (with `actionLog` providing the multi-step history).
   * @property {boolean} isDeleted  Soft-delete flag; the box is still kept
   *     in the collection (so undo can restore it) and shown with red
   *     dashed styling until Confirm runs.
   * @property {boolean} isServerNote  True for notes loaded from the server
   *     when active mode is entered — drives the Confirm phase routing
   *     (POST for new temps, PUT for edited server notes, DELETE for
   *     soft-deleted server notes).
   * @property {boolean} everConfirmed  True after the first popoverConfirm
   *     for this note. Distinguishes "fresh new" notes (popover-dismiss
   *     hard-deletes them — cancel creation) from already-committed
   *     notes (popover-dismiss reverts to confirmedState — cancel
   *     edits). Without this flag we'd be guessing from
   *     `confirmedState === initialState`, which falsely classifies
   *     "user ✔'d an empty box without editing" as fresh-new.
   * @property {?HTMLElement} domElement  The `.dmna-note-box` div, or null
   *     until first render.
   */

  /**
   * @typedef {Object} ActionLogEntry
   * @property {string} noteId
   * @property {'create' | 'edit' | 'delete'} type
   * @property {?NoteState} prevState  State immediately before the action.
   *     Null for 'create' (the note didn't exist yet). Per-note Undo finds
   *     the latest entry matching `noteId` and reverses it; global Undo
   *     pops the tail regardless of which note it touched.
   */

  /**
   * @typedef {'idle' | 'active'} Mode  The high-level interaction mode.
   *     - `'idle'`: script off — boxes hidden, image is plain, floating
   *       button shows the default 📝 icon.
   *     - `'active'`: editing enabled — server notes (if any) are loaded
   *       as boxes, taps on the image create new ones, taps on existing
   *       boxes activate them, and the popover offers ✔ / ✖ / 🗑.
   *     Toggled by the arc menu's Edit item; turned off via three paths
   *     (PLAN.md Z11): floating-button double-tap, menu re-tap of Edit,
   *     or post-Confirm reload (Phase 4).
   */

  // --------------------------------------------------------------------------
  // State Variables
  // --------------------------------------------------------------------------

  const savedMarginX = parseInt(localStorage.getItem(POS_X_KEY), 10);
  let userBtnMarginX = Number.isFinite(savedMarginX) ?
      savedMarginX : DEFAULT_BTN_MARGIN_X;
  const savedMarginY = parseInt(localStorage.getItem(POS_KEY), 10);
  let userBtnMarginY = Number.isFinite(savedMarginY) ?
      savedMarginY : DEFAULT_BTN_MARGIN_Y;

  // One-shot cleanup of the v2.x ON/OFF flag — v3.0 has no global enabled
  // state; mode is per-session and lives only in the menu state machine.
  localStorage.removeItem(LEGACY_STATE_KEY);

  // Floating-button interaction state
  let isDraggingBtn = false;
  let isPressing = false;
  let longPressTimer = null;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragStartMarginX = 0;
  let dragStartMarginY = 0;
  let lastBtnTapTime = 0;

  // DOM elements (created lazily in createUI)
  let toastElement = null;

  // Timers & RAF
  let toastTimer = null;
  let viewportRaf = null;

  // Initialization
  let initialized = false;
  let viewportListenersBound = false;

  // Arc Menu (v3.0)
  let menuElement = null;
  let isMenuOpen = false;
  let outsideClickListenerBound = false;

  // Multi-note state machine (v3.0 Phase 2)

  /** @type {Mode} */
  let mode = 'idle';

  /** @type {Map<string, Note>} */
  const notes = new Map();

  /** @type {ActionLogEntry[]} */
  const actionLog = [];

  /** @type {?string} */
  let activeNoteId = null;

  // Image / post metadata (v3.0 Phase 3 Wave 2). Loaded once per session
  // on first active-mode entry and cached for the page lifetime.

  /** @type {number}  Original-image width (px). 0 = not yet fetched. */
  let postOriginalWidth = 0;

  /** @type {number}  Original-image height (px). 0 = not yet fetched. */
  let postOriginalHeight = 0;

  /** @type {?Promise<{width: number, height: number}>}
   *  In-flight metadata fetch (deduplicates concurrent requests). Cleared
   *  on failure so the next active-entry can retry. */
  let postMetaPromise = null;

  /** @type {number}  Generation counter incremented on every active-mode
   *  entry. Async fetches capture the value at start and bail out on
   *  return if it no longer matches — prevents stale server notes from
   *  being injected after the user has already toggled off. */
  let activeModeGen = 0;

  /** @type {boolean}  True after the image's click handler has been
   *  attached. Set by `bindImageHandlers()`. */
  let imageHandlersBound = false;

  // Popover (v3.0 Phase 3 Wave 3). Created lazily on first activation.

  /** @type {?HTMLElement} */
  let popoverElement = null;

  /** @type {?HTMLInputElement} */
  let popoverInputElement = null;

  /** @type {?HTMLElement} */
  let popoverArrowElement = null;

  // Box drag/resize state (v3.0 Phase 3 Wave 3). One interaction at a
  // time — pointer events with setPointerCapture serialize the gesture.

  /**
   * @typedef {Object} DragState
   * @property {'drag' | 'resize-nw' | 'resize-se'} kind
   * @property {string} noteId
   * @property {number} pointerId
   * @property {number} startScreenX  In document/page CSS pixels.
   * @property {number} startScreenY
   * @property {NoteState} startState  Snapshot of `note.current` at
   *     pointerdown — every move computes the next state from this
   *     baseline (not from the previous frame), so the drag is
   *     stateless across frames and immune to subpixel drift.
   * @property {HTMLElement} captureTarget  Element with active pointer
   *     capture; the move/up listeners are attached here too.
   * @property {boolean} moved  Set true once the pointer has traveled
   *     more than DRAG_THRESHOLD_PX from the start. Drives the
   *     `suppressNextClick` flag so a tap-and-hold without movement
   *     still counts as a click.
   */

  /** @type {?DragState} */
  let dragState = null;

  /** @type {boolean}  Set on a drag-with-movement's pointerup; consumed
   *  (and reset) by the trailing click handler so a finished drag
   *  doesn't also re-activate the box via click. */
  let suppressNextBoxClick = false;

  // --------------------------------------------------------------------------
  // Styles
  // --------------------------------------------------------------------------

  const STYLES = `
    .dmna-hidden { display: none !important; }

    #dmna-float-btn {
      position: absolute; left: 0; top: 0;
      width: 40px; height: 40px; border-radius: 50%;
      background: rgba(0, 0, 0, 0.6); color: white; font-size: 21px;
      border: 2px solid rgba(255, 255, 255, 0.3);
      display: flex; align-items: center; justify-content: center;
      z-index: 11000; cursor: pointer; backdrop-filter: blur(2px);
      user-select: none; box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      transform-origin: 0 0; will-change: transform; touch-action: none;
      transition: opacity 0.2s, visibility 0.2s,
          background 0.15s, border-color 0.15s;
    }
    #dmna-float-btn.expanded {
      background: rgba(0, 115, 255, 0.85);
      border-color: white;
      box-shadow: 0 0 12px rgba(0, 115, 255, 0.6);
    }
    #dmna-float-btn.dragging { background: #ff9800 !important; border-color: #ffe0b2 !important; transform: scale(1.2); }

    /* Arc Menu */
    #dmna-menu {
      position: absolute; left: 0; top: 0;
      width: 40px; height: 40px;
      z-index: 10999;
      transform-origin: 0 0; will-change: transform;
      pointer-events: none;
    }
    .dmna-menu-item {
      --tx: 0px;
      --ty: 0px;
      position: absolute;
      left: 0; top: 0;
      width: 40px; height: 40px;
      border-radius: 50%;
      background: rgba(31, 35, 43, 0.92);
      border: 1.5px solid rgba(255, 255, 255, 0.25);
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; color: white;
      cursor: pointer; user-select: none;
      box-shadow: 0 4px 8px rgba(0, 0, 0, 0.3);
      pointer-events: none;
      opacity: 0;
      /* Closed state: stacked on the floating button at small scale. */
      transform: translate(0, 0) scale(0.4);
      transition: transform 0.2s ease-out, opacity 0.18s ease-out,
          background 0.15s;
      touch-action: manipulation;
    }
    #dmna-menu.open .dmna-menu-item {
      opacity: 1;
      /* Open state: slide out to per-item arc position (--tx, --ty). */
      transform: translate(var(--tx), var(--ty)) scale(1);
      pointer-events: auto;
    }
    #dmna-menu.open .dmna-menu-item:active {
      transform: translate(var(--tx), var(--ty)) scale(0.88);
      background: rgba(0, 115, 255, 0.85);
    }

    /* Note Boxes (v3.0 Phase 2) — color priority is encoded by source order:
       active (orange) > deleted (red dashed) > dirty (green) > default (blue).
       Multiple state classes can coexist on a box; later rules override
       earlier ones. */
    .dmna-note-box {
      position: absolute;
      border: 1.2px solid #0073ff;
      background-color: rgba(0, 115, 255, 0.15);
      z-index: 9990;
      box-sizing: border-box;
      box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.4);
      pointer-events: none;
      transition: border-color 0.15s, background-color 0.15s,
          border-style 0s;
    }
    .dmna-note-box.is-dirty {
      border-color: #43a047;
      background-color: rgba(67, 160, 71, 0.15);
    }
    .dmna-note-box.is-deleted {
      border-style: dashed;
      border-color: #e53935;
      background-color: rgba(229, 57, 53, 0.10);
    }
    .dmna-note-box.is-active {
      border-style: solid;
      border-color: #ff9800;
      background-color: rgba(255, 152, 0, 0.15);
    }

    /* Active-mode cursor cue: tapping the image creates a new note. */
    body.dmna-mode-active #image { cursor: crosshair; }

    /* In active mode boxes accept their own click (to swap active selection)
       and stop propagation, so the underlying image handler doesn't also
       fire and spawn a duplicate note over the existing box. The
       touch-action: none is necessary for the body's pointerdown drag —
       without it the browser hijacks short drags as pan/scroll on mobile
       and our pointermove never fires. */
    body.dmna-mode-active .dmna-note-box {
      pointer-events: auto;
      cursor: pointer;
      touch-action: none;
    }

    /* Hide Danbooru's native note overlay while our active mode is on.
       The script renders its own boxes on top of the same notes (loaded
       via fetchServerNotes) and clicking through to native popups would
       just be visual noise. The native UI returns when the user toggles
       back to idle (the body class drops).

       NB: do NOT hide .note-container — it is the wrapper that also
       contains the post image element itself, so hiding it nukes the
       image. Only the per-note overlays should disappear. */
    body.dmna-mode-active .note-box,
    body.dmna-mode-active .note-body { display: none !important; }

    /* Resize/Move handles (v3.0 Phase 3 Wave 3) — only shown on the
       active box. NW/SE are resize handles, NE/SW are move-only handles.
       Each handle is a 32×32 invisible touch zone.

       NW/NE (top): fully outside the box (bottom edge at box top, top
       edge 32px above). They sit above the box, never collide with the
       popover (which is below).

       SE/SW (bottom): shifted UP by half — bottom: -16 instead of -32.
       Matches v2.6's pattern (a 15px shift on a 30px touch-outer): with
       POPOVER_OFFSET=12, the bottom 16px outside still has 12px visible
       above the popover top (4px hidden behind the popover, accepted).
       The other 16px sits INSIDE the box; this is the unavoidable
       trade-off — handles can't be both "fully outside" AND "not
       covered by popover" when the popover sits directly below. */
    .dmna-handle {
      display: none;
      position: absolute;
      width: 32px; height: 32px;
      box-sizing: border-box;
      background: transparent;
      pointer-events: auto;
      z-index: 1;
      touch-action: none;
    }
    .dmna-note-box.is-active .dmna-handle { display: block; }
    .dmna-handle-nw { top: -32px; left: -32px; cursor: nwse-resize; }
    .dmna-handle-ne { top: -32px; right: -32px; cursor: move; }
    .dmna-handle-se { bottom: -16px; right: -32px; cursor: nwse-resize; }
    .dmna-handle-sw { bottom: -16px; left: -32px; cursor: move; }

    /* SE corner triangle: visual resize affordance on active box. Color
       tracks the active border (orange). */
    .dmna-note-box.is-active::after {
      content: '';
      position: absolute;
      bottom: 0; right: 0;
      width: 0; height: 0;
      border-style: solid;
      border-width: 0 0 8px 8px;
      border-color: transparent transparent #ff9800 transparent;
      pointer-events: none;
    }

    /* Touch-zone debug overlay: while the user holds the popover's 👁
       button, paint each (otherwise invisible) corner handle in red so
       they can see exactly where the touch zones extend past the visible
       border. Only renders for the active box's handles since those are
       the only ones that actually receive input. */
    body.dmna-show-debug-zones .dmna-note-box.is-active .dmna-handle {
      background: rgba(229, 57, 53, 0.30);
      border: 1px dashed rgba(255, 120, 120, 0.95);
    }
    body.dmna-show-debug-zones .dmna-note-box.is-active .dmna-handle::before {
      content: attr(data-icon);
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: white;
      text-shadow: 0 0 3px black;
    }

    /* Popover (v3.0 Phase 3 Wave 3) — anchored under the active box,
       pinch-counter-scaled for mobile readability. */
    #dmna-popover {
      position: absolute;
      left: 0; top: 0;
      width: ${POPOVER_WIDTH}px;
      background: rgba(30, 30, 30, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      padding: 10px;
      z-index: 10995;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
      display: none;
      transform-origin: 0 0;
      will-change: transform, opacity;
      box-sizing: border-box;
      transition: opacity 0.15s;
    }
    #dmna-popover.show { display: block; }
    #dmna-popover-arrow {
      position: absolute;
      top: -8px;
      left: ${(POPOVER_WIDTH / 2) - POPOVER_ARROW_HALF}px;
      width: 0; height: 0;
      border-style: solid;
      border-width: 0 8px 8px 8px;
      border-color: transparent transparent rgba(30, 30, 30, 0.96) transparent;
      pointer-events: none;
    }
    #dmna-popover-input-row {
      display: flex;
      gap: 8px;
      align-items: stretch;
    }
    #dmna-popover-input {
      flex: 1;
      padding: 8px 10px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(0, 0, 0, 0.4);
      color: white;
      font-size: 14px;
      font-family: inherit;
      line-height: 1.4;
      box-sizing: border-box;
      outline: none;
      resize: none;
    }
    #dmna-popover-input:focus { border-color: #0073ff; }
    #dmna-popover-eye {
      flex-shrink: 0;
      width: 44px;
      align-self: stretch;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.06);
      color: white;
      font-size: 18px;
      cursor: pointer;
      user-select: none;
      touch-action: none;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    #dmna-popover-eye:active,
    #dmna-popover-eye.is-pressed {
      background: rgba(255, 255, 255, 0.22);
    }
    #dmna-popover-buttons {
      display: flex;
      gap: 8px;
      margin-top: 10px;
    }
    .dmna-popover-btn {
      flex: 1;
      padding: 10px 0;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: white;
      font-size: 20px;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
    }
    .dmna-popover-btn:active {
      background: rgba(255, 255, 255, 0.28);
    }
    /* Light/white character color for ✔ / ✖ (text-glyph presentation
       forced via VS-15 in createPopover). 🗑 ignores this — it renders
       as a system emoji with its own colors. */
    .dmna-popover-btn[data-action="confirm"],
    .dmna-popover-btn[data-action="cancel"] { color: #f0f0f0; }
    .dmna-popover-btn[data-action="delete"] { color: #ff8b8b; }

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
  `;

  const styleElement = document.createElement('style');
  styleElement.textContent = STYLES;
  document.head.appendChild(styleElement);

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
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
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
    const menu = document.getElementById('dmna-menu');
    const toast = document.getElementById('dmna-toast');

    if (!window.visualViewport) {
      const scrollX = window.pageXOffset;
      const scrollY = window.pageYOffset;
      const bx = scrollX + window.innerWidth - userBtnMarginX - BTN_SIZE;
      const by = scrollY + window.innerHeight - userBtnMarginY - BTN_SIZE;
      if (btn) {
        btn.style.transform = `translate(${bx}px, ${by}px)`;
      }
      if (menu) {
        menu.style.transform = `translate(${bx}px, ${by}px)`;
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
    const bx = vvPageLeft + vv.width - ((userBtnMarginX + BTN_SIZE) * invScale);
    const by = vvPageTop + vv.height - ((userBtnMarginY + BTN_SIZE) * invScale);

    if (btn) {
      btn.style.transform = `translate(${bx}px, ${by}px) scale(${invScale})`;
    }
    if (menu) {
      menu.style.transform = `translate(${bx}px, ${by}px) scale(${invScale})`;
    }
    if (toast) {
      const tx = vvPageLeft + (vv.width / 2);
      const ty = vvPageTop + vv.height - (TOAST_MARGIN_BOTTOM * invScale);
      toast.style.transform =
          `translate(${tx}px, ${ty}px) scale(${invScale}) translate(-50%, -100%)`;
    }

    // Popover (Wave 3) is anchored to the active box, so its transform
    // depends on both the visual viewport and the box's image-space
    // rect. Skip when no box is active (popover is hidden anyway).
    if (activeNoteId !== null) {
      updatePopoverPosition();
    }
  }

  /**
   * Initializes the script, binding global events and creating UI.
   */
  function init() {
    if (initialized) {
      return;
    }

    createUI();
    updateVisualViewportPositions();
    bindImageHandlers();

    // Re-project all note boxes whenever the rendered image rect could
    // have changed. visualViewport pinch-zoom does NOT change document
    // layout (note boxes are in page coords, anchored to the image's
    // page-coord rect, which only moves under window resize / orientation
    // change), so it's intentionally absent here.
    window.addEventListener('resize', updateAllNoteBoxPositions);
    window.addEventListener('orientationchange', updateAllNoteBoxPositions);

    // Reload / navigate-away guard: if the user is mid-active-mode with
    // dirty notes, surface the browser's standard "Leave site?" prompt.
    // Browsers ignore custom messages here for security, so this is a
    // generic confirm — that's still an upgrade over silent loss.
    // tryDeactivate's `window.confirm` covers the in-script off paths
    // (Z11); this handler covers the out-of-band ones (refresh button,
    // closing the tab, Cmd+R, etc).
    window.addEventListener('beforeunload', (e) => {
      if (mode === 'active' && hasDirtyNotes()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    if (window.visualViewport && !viewportListenersBound) {
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
      viewportListenersBound = true;
    }

    initialized = true;
  }

  /**
   * Checks whether the given element is a text-input element.
   * @param {?Element} el The element to check.
   * @return {boolean} True if the element is a text input or textarea.
   */
  function isTextInputElement(el) {
    if (!el) {
      return false;
    }
    if (el.isContentEditable === true) {
      return true;
    }
    return el.tagName === 'TEXTAREA' ||
        (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button',
          'submit', 'image', 'file', 'range', 'color'].includes(el.type));
  }

  /**
   * Creates all UI elements (floating button + arc menu).
   */
  function createUI() {
    if (document.getElementById('dmna-float-btn')) {
      return;
    }

    const floatBtn = document.createElement('div');
    floatBtn.id = 'dmna-float-btn';
    floatBtn.innerHTML = '📝';
    setupButtonInteractions(floatBtn);
    document.body.appendChild(floatBtn);

    createArcMenu();

    // Auto-hide the floating button when focus enters a text-input element
    // anywhere in the document, so it doesn't cover the on-screen keyboard.
    document.addEventListener('focus', (e) => {
      if (isTextInputElement(e.target)) {
        floatBtn.classList.add('dmna-hidden');
      }
    }, true);

    document.addEventListener('blur', () => {
      setTimeout(() => {
        if (!isTextInputElement(document.activeElement)) {
          floatBtn.classList.remove('dmna-hidden');
        }
      }, 100);
    }, true);
  }

  /**
   * Configures interaction for the floating button (Move & Toggle).
   * Supports both Touch and Mouse events.
   * @param {HTMLElement} btn The floating button element.
   */
  function setupButtonInteractions(btn) {
    const handleStart = (e) => {
      if (e.type === 'touchstart') {
        e.preventDefault();
      }
      isDraggingBtn = false;
      isPressing = true;
      const isTouch = e.type.startsWith('touch');
      const clientX = isTouch ? e.touches[0].clientX : e.clientX;
      const clientY = isTouch ? e.touches[0].clientY : e.clientY;
      dragStartX = clientX;
      dragStartY = clientY;
      dragStartMarginX = userBtnMarginX;
      dragStartMarginY = userBtnMarginY;

      longPressTimer = setTimeout(() => {
        if (isPressing) {
          isDraggingBtn = true;
          // Close menu before entering reposition mode to avoid visual
          // conflict between `.expanded` and `.dragging` button states.
          if (isMenuOpen) {
            closeMenu();
          }
          btn.classList.add('dragging');
          if (navigator.vibrate) {
            navigator.vibrate(50);
          }
          showToast('✥ Reposition Mode');
        }
      }, LONG_PRESS_DURATION);
    };

    const handleMove = (e) => {
      if (e.type === 'touchmove') {
        e.preventDefault();
        e.stopPropagation();
      }
      if (!isPressing) {
        return;
      }

      const isTouch = e.type.startsWith('touch');
      const clientX = isTouch ? e.touches[0].clientX : e.clientX;
      const clientY = isTouch ? e.touches[0].clientY : e.clientY;
      if (isDraggingBtn) {
        const dx = clientX - dragStartX;
        const dy = clientY - dragStartY;
        const screenW = window.innerWidth;
        const screenH = window.innerHeight;
        let newMarginX = dragStartMarginX - dx;
        let newMarginY = dragStartMarginY - dy;
        // Clamps derived from arc menu geometry (r=70, 3 items at -70°,
        // -115°, -160°) so the entire menu stays on-screen at any button
        // position:
        //   • Right limit (min X): ⌈r·cos(-70°)⌉ = ⌈24⌉ = 25.
        //     Prevents item 0 (Confirm, -70°) from clipping the right edge.
        //   • Left limit (max X = screenW − 110): r·|cos(-160°)| + item_half
        //     + btn_half ≈ 66 + 20 + 20 = 106 → 110 (round). Item 2 (Edit,
        //     -160°) is the leftmost.
        //   • Top limit (max Y = screenH − 105): r·|sin(-115°)| + item_half
        //     + btn_half ≈ 64 + 20 + 20 = 104 → 105 (round). Item 1 (Undo,
        //     -115°) is the highest.
        //   • Bottom limit (min Y = 20): only the button itself extends
        //     below button-center; all items sit at or above it.
        newMarginX = Math.max(25, Math.min(screenW - 110, newMarginX));
        newMarginY = Math.max(20, Math.min(screenH - 105, newMarginY));
        userBtnMarginX = newMarginX;
        userBtnMarginY = newMarginY;
        updateVisualViewportPositions();
        return;
      }
      const dx = clientX - dragStartX;
      const dy = clientY - dragStartY;
      if (Math.hypot(dx, dy) > 10) {
        clearTimeout(longPressTimer);
        isPressing = false;
      }
    };

    const handleEnd = (e) => {
      if (e.type === 'touchend') {
        e.preventDefault();
      }
      clearTimeout(longPressTimer);
      isPressing = false;
      if (isDraggingBtn) {
        isDraggingBtn = false;
        btn.classList.remove('dragging');
        localStorage.setItem(POS_X_KEY, userBtnMarginX);
        localStorage.setItem(POS_KEY, userBtnMarginY);
      } else {
        const isTouch = e.type.startsWith('touch');
        const endX = isTouch ? e.changedTouches[0].clientX : e.clientX;
        const endY = isTouch ? e.changedTouches[0].clientY : e.clientY;
        const dx = endX - dragStartX;
        const dy = endY - dragStartY;
        if (Math.hypot(dx, dy) < 10) {
          // Z11 path #1 (bidirectional): a fast second tap toggles the
          // active mode. From idle it turns the script on; from active
          // it routes to tryDeactivate (with a dirty confirm if needed).
          // Option A (immediate-and-cancel): the first tap already ran
          // toggleMenu, so the menu may be visibly opening; we close it
          // here and dispatch the mode change. The brief flicker is
          // accepted in exchange for zero latency on single-tap.
          const now = Date.now();
          const elapsed = now - lastBtnTapTime;
          if (elapsed < DOUBLE_TAP_THRESHOLD_MS) {
            if (isMenuOpen) {
              closeMenu();
            }
            lastBtnTapTime = 0;
            if (mode === 'active') {
              tryDeactivate();
            } else {
              setMode('active');
            }
          } else {
            lastBtnTapTime = now;
            toggleMenu();
          }
        }
      }
    };

    btn.addEventListener('touchstart', handleStart, {passive: false});
    btn.addEventListener('touchmove', handleMove, {passive: false});
    btn.addEventListener('touchend', handleEnd);
    btn.addEventListener('mousedown', handleStart);
    document.addEventListener('mousemove', (e) => {
      if (isPressing) {
        handleMove(e);
      }
    });
    btn.addEventListener('mouseup', handleEnd);
  }

  /**
   * Creates the arc menu DOM (4 items at -90°, -120°, -150°, -180° from
   * the floating button center, radius 85px).
   */
  function createArcMenu() {
    if (document.getElementById('dmna-menu')) {
      return;
    }

    menuElement = document.createElement('div');
    menuElement.id = 'dmna-menu';

    /**
     * @type {Array<{action: 'edit' | 'undo' | 'confirm', icon: string,
     *     label: string}>}
     *
     * Order matches arc traversal from arc-start (closest to top) down
     * to arc-end (closest to floating button). Read "from button outward
     * / bottom-up": Edit -> Undo -> Confirm.
     *
     * Phase 3 (Z10): create + edit modes were merged into a single
     * `active` mode driven by the Edit item, and the explicit Discard-all
     * item was removed (its role is absorbed by the Z11 off-flow's dirty
     * confirm dialog). Down from 5 items to 3.
     */
    const items = [
      {action: 'confirm', icon: '✅', label: 'Confirm'},
      {action: 'undo', icon: '↶', label: 'Undo'},
      {action: 'edit', icon: '✏️', label: 'Edit'},
    ];

    // Arc geometry: 3 items distributed across a 90° span starting at
    // -90° + 20° (clockwise tilt) so the topmost item (Confirm) sits at
    // -70° and the bottom-most item (Edit) sits at -160°. Step = 45°,
    // radius 70 → button-edge to item-edge gap ≈ 30px (was 60px at r=100).
    // Adjacent item centers ≈ 54px apart (~14px visible gap) — still
    // comfortable for mobile touch.
    // Closed state is translate(0, 0) so items animate out from the
    // button on open.
    const r = 70;
    const itemSize = BTN_SIZE;
    const half = itemSize / 2;
    const center = BTN_SIZE / 2;
    const angleOffset = Math.PI / 9; // +20° clockwise tilt
    const angleSpan = (Math.PI * 90) / 180; // 90° span (was 110° at 5 items)
    const angleStart = -Math.PI / 2 + angleOffset; // -70°
    const angleEnd = angleStart - angleSpan; // -160°
    const step = (angleEnd - angleStart) / (items.length - 1);

    items.forEach((item, i) => {
      const theta = angleStart + (step * i);
      const cx = center + (r * Math.cos(theta));
      const cy = center + (r * Math.sin(theta));
      const tx = cx - half;
      const ty = cy - half;

      const el = document.createElement('div');
      el.className = 'dmna-menu-item';
      el.dataset.action = item.action;
      el.setAttribute('aria-label', item.label);
      el.textContent = item.icon;
      el.style.setProperty('--tx', `${tx}px`);
      el.style.setProperty('--ty', `${ty}px`);
      el.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
        handleMenuAction(item.action);
      });
      menuElement.appendChild(el);
    });

    document.body.appendChild(menuElement);
  }

  /**
   * Toggles the arc menu open/closed.
   */
  function toggleMenu() {
    if (isMenuOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  }

  /**
   * Opens the arc menu and binds dismiss listeners (outside-click, Esc).
   */
  function openMenu() {
    if (isMenuOpen || !menuElement) {
      return;
    }
    isMenuOpen = true;
    menuElement.classList.add('open');
    const btn = document.getElementById('dmna-float-btn');
    if (btn) {
      btn.classList.add('expanded');
    }
    if (!outsideClickListenerBound) {
      document.addEventListener('click', outsideClickHandler, true);
      document.addEventListener('keydown', escHandler);
      outsideClickListenerBound = true;
    }
  }

  /**
   * Closes the arc menu and unbinds dismiss listeners.
   */
  function closeMenu() {
    if (!isMenuOpen) {
      return;
    }
    isMenuOpen = false;
    if (menuElement) {
      menuElement.classList.remove('open');
    }
    const btn = document.getElementById('dmna-float-btn');
    if (btn) {
      btn.classList.remove('expanded');
    }
    if (outsideClickListenerBound) {
      document.removeEventListener('click', outsideClickHandler, true);
      document.removeEventListener('keydown', escHandler);
      outsideClickListenerBound = false;
    }
  }

  /**
   * Capture-phase click handler: closes menu on taps outside the menu
   * and the floating button. Stops the click so the outside element
   * doesn't also receive it.
   * @param {MouseEvent} e
   */
  function outsideClickHandler(e) {
    const target = e.target;
    if (target instanceof Element &&
        (target.closest('#dmna-menu') ||
         target.closest('#dmna-float-btn'))) {
      return;
    }
    e.stopPropagation();
    closeMenu();
  }

  /**
   * Esc key handler: closes the menu (PC convenience).
   * @param {KeyboardEvent} e
   */
  function escHandler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeMenu();
    }
  }

  // --------------------------------------------------------------------------
  // Multi-note State Machine (v3.0 Phase 2)
  // --------------------------------------------------------------------------

  /**
   * Generates a unique note id for a new (temp) note. Server-loaded notes
   * reuse their numeric server id directly, so the `temp-` prefix is the
   * tell that distinguishes the two at Confirm time.
   * @return {string}
   */
  function genNoteId() {
    if (typeof crypto !== 'undefined' &&
        typeof crypto.randomUUID === 'function') {
      return 'temp-' + crypto.randomUUID();
    }
    return 'temp-' + Math.random().toString(36).slice(2) +
        Date.now().toString(36);
  }

  /**
   * Whether the note's current state diverges from its initial snapshot.
   * Drives the green ('is-dirty') visual.
   *
   * Split rule (per user feedback):
   *   - New (temp) notes are ALWAYS dirty — green is the "this isn't on
   *     the server yet" distinguisher, regardless of whether `current`
   *     happens to match `initialState`. The earlier scenario "edit,
   *     ✔, revert → blue" applies only to server notes (where the
   *     server's saved state is the natural clean baseline).
   *   - Server notes follow the universal `current ≠ initialState`
   *     rule, so an edit that's been reverted shows as clean blue.
   *
   * (Phase 4 Confirm POSTs every `!isServerNote` note regardless of
   * dirty status, so this is purely a display affordance.)
   *
   * @param {Note} note
   * @return {boolean}
   */
  function isDirty(note) {
    if (!note.isServerNote) {
      return true;
    }
    const a = note.current;
    const b = note.initialState;
    return a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h ||
        a.text !== b.text;
  }

  /**
   * Appends an action to the chronological log. Both global Undo (pops
   * the tail) and per-note Undo (finds the latest entry by noteId) read
   * from this single source.
   * @param {string} noteId
   * @param {'create' | 'edit' | 'delete'} type
   * @param {?NoteState} prevState
   */
  function pushAction(noteId, type, prevState) {
    actionLog.push({noteId, type, prevState});
  }

  /**
   * Recomputes and applies the visual state classes for a single note.
   * Call after any state change (active swap, dirty toggle, soft-delete).
   * @param {string} noteId
   */
  function updateNoteVisuals(noteId) {
    const note = notes.get(noteId);
    if (!note || !note.domElement) {
      return;
    }
    const el = note.domElement;
    el.classList.toggle('is-active', activeNoteId === noteId);
    el.classList.toggle('is-deleted', note.isDeleted);
    el.classList.toggle('is-dirty', isDirty(note));
  }

  /**
   * Recomputes visuals for every note in the collection. Useful after
   * batch state changes (e.g., session reset).
   */
  function updateAllNoteVisuals() {
    for (const id of notes.keys()) {
      updateNoteVisuals(id);
    }
  }

  /**
   * Creates the DOM box for a note if missing, then projects its
   * image-space `current` rect to display space and writes the box's
   * left/top/width/height. If the image isn't laid out yet (rect 0×0),
   * the box is hidden until a later re-render — this happens on first
   * server-note load before `<img>` finishes loading.
   * @param {string} noteId
   */
  function renderNoteBox(noteId) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    if (!note.domElement) {
      const el = document.createElement('div');
      el.className = 'dmna-note-box';
      el.dataset.noteId = noteId;
      el.addEventListener('click', (e) => {
        // In active mode the box owns its own click (selection swap) and
        // must consume it so the underlying image's create-handler doesn't
        // also fire. Outside active mode boxes shouldn't even exist
        // (`discardAll` runs on the idle transition), but the guard is
        // cheap and protects the debug surface.
        if (mode !== 'active') {
          return;
        }
        e.stopPropagation();
        // The trailing click after a drag-with-movement would re-trigger
        // setActiveNote(idempotent) and isn't itself harmful, but we
        // also want to make sure the click can't reach any other handler
        // (defensive; no real damage today, but ahead of Wave 4 off-paths
        // we want the boundary clean).
        if (suppressNextBoxClick) {
          suppressNextBoxClick = false;
          return;
        }
        setActiveNote(noteId);
      });

      // Body-drag listener on the box itself (handles stop propagation
      // before reaching here for resize/move-only corners).
      attachBodyDragListener(el, noteId);

      // Add 4 corner handles. NW/SE = resize, NE/SW = move-only.
      // The `data-icon` attribute is consumed by the debug-zone overlay
      // (`body.dmna-show-debug-zones .dmna-handle::before`) — invisible
      // unless the popover's 👁 button is held.
      const handleIcons = {nw: '↖', ne: '✥', sw: '✥', se: '↘'};
      ['nw', 'ne', 'sw', 'se'].forEach((corner) => {
        const h = document.createElement('div');
        h.className = `dmna-handle dmna-handle-${corner}`;
        h.dataset.corner = corner;
        h.dataset.icon = handleIcons[corner];
        attachHandleListeners(
            h, /** @type {any} */ (corner), noteId);
        el.appendChild(h);
      });

      document.body.appendChild(el);
      note.domElement = el;
    }
    const screen = imageToScreenRect(note.current);
    if (screen) {
      note.domElement.style.display = '';
      note.domElement.style.left = `${screen.left}px`;
      note.domElement.style.top = `${screen.top}px`;
      note.domElement.style.width = `${screen.width}px`;
      note.domElement.style.height = `${screen.height}px`;
    } else {
      // Image rect not yet known — hide until the next re-render
      // (window resize, image load, or explicit updateAllNoteBoxPositions).
      note.domElement.style.display = 'none';
    }
    updateNoteVisuals(noteId);
  }

  /**
   * Re-projects every box's image-space rect to display space. Call after
   * anything that could change the rendered image rect: window resize,
   * image load, orientation change.
   */
  function updateAllNoteBoxPositions() {
    for (const id of notes.keys()) {
      renderNoteBox(id);
    }
  }

  /**
   * Removes the DOM box for a note (does NOT touch the `notes` Map — that
   * is the caller's responsibility for a hard-delete vs. soft-delete
   * distinction).
   * @param {string} noteId
   */
  function removeNoteBoxDOM(noteId) {
    const note = notes.get(noteId);
    if (note && note.domElement) {
      note.domElement.remove();
      note.domElement = null;
    }
  }

  /**
   * Whether any note in the collection is currently dirty. Used by the
   * Z11 off-flow to decide whether to show the discard confirm dialog.
   * @return {boolean}
   */
  function hasDirtyNotes() {
    for (const note of notes.values()) {
      if (isDirty(note)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Wipes all notes from the session: removes their DOM, clears the
   * `notes` Map and `actionLog`, and unsets the active selection.
   * Used by the Z11 off-flow when the user accepts the discard prompt
   * (or implicitly when there's nothing dirty to lose).
   */
  function discardAll() {
    for (const id of [...notes.keys()]) {
      removeNoteBoxDOM(id);
    }
    notes.clear();
    actionLog.length = 0;
    setActiveNote(null);
  }

  /**
   * Switches the high-level mode. Idempotent on same-mode input.
   * Side effects:
   *   - 'active': swaps the floating-button icon to ✏️, toggles the
   *     `dmna-mode-active` body class (which surfaces e.g. crosshair
   *     cursor on the image), bumps `activeModeGen`, and fires the async
   *     server-note fetch (`enterActiveMode`).
   *   - 'idle': calls discardAll, restores the 📝 icon, and removes the
   *     body class. Bumping the gen counter implicitly cancels any
   *     in-flight enterActiveMode.
   * @param {Mode} newMode
   */
  function setMode(newMode) {
    if (mode === newMode) {
      return;
    }
    mode = newMode;
    const btn = document.getElementById('dmna-float-btn');
    if (newMode === 'active') {
      if (btn) {
        btn.textContent = '✏️';
      }
      document.body.classList.add('dmna-mode-active');
      activeModeGen++;
      enterActiveMode(activeModeGen);
    } else {
      // 'idle' — script off
      activeModeGen++; // invalidate any in-flight fetch
      discardAll();
      if (btn) {
        btn.textContent = '📝';
      }
      document.body.classList.remove('dmna-mode-active');
      // Defensive: Danbooru's notes.js binds a mousedown on
      // `#image-container` that, on a short tap, toggles `.hide-notes`
      // on `.note-container` (its own native show/hide flag). Even with
      // our capture-phase blocker, a stray prior interaction can have
      // left that class on. Without this reset, native notes stay
      // hidden after we go idle and the user has to refresh.
      const noteContainer = document.querySelector('.note-container');
      if (noteContainer) {
        noteContainer.classList.remove('hide-notes');
      }
    }
  }

  /**
   * Async tail of the active-mode transition: fetches post metadata (for
   * the image-space ↔ display-space scale) and then the existing notes,
   * populating the collection. Both steps gate on `gen === activeModeGen`
   * so a fast off-toggle (or another active entry) cleanly cancels
   * whatever's still in flight without leaving stale boxes around.
   * @param {number} gen
   */
  async function enterActiveMode(gen) {
    try {
      await fetchPostMeta();
    } catch (err) {
      if (gen !== activeModeGen) {
        return;
      }
      showToast('⚠️ Failed to load image dimensions');
      return;
    }
    if (gen !== activeModeGen || mode !== 'active') {
      return;
    }

    let serverNotes;
    try {
      serverNotes = await fetchServerNotes();
    } catch (err) {
      if (gen !== activeModeGen) {
        return;
      }
      showToast('⚠️ Failed to load existing notes');
      return;
    }
    if (gen !== activeModeGen || mode !== 'active') {
      return;
    }

    for (const sn of serverNotes) {
      addServerNote(sn);
    }
  }

  /**
   * The Z11 off-attempt: if any note is dirty, prompts the user with
   * `window.confirm('Discard all changes and turn off?')`. Acceptance
   * runs `setMode('idle')`; cancellation re-opens the arc menu so the
   * user can pick Confirm or Undo instead. With no dirty notes, off
   * happens immediately.
   *
   * Called from two paths (PLAN.md Z11):
   *   1. Floating-button double-tap.
   *   2. Re-tap of the Edit menu item while already in active mode.
   * The third path (post-Confirm reload) is Phase 4.
   */
  function tryDeactivate() {
    if (hasDirtyNotes()) {
      // window.confirm is a deliberately simple Phase 3 choice (the v3.1
      // backlog has a custom-modal upgrade). It blocks the page until
      // dismissed, which is fine for a destructive action.
      // eslint-disable-next-line no-alert
      const ok = window.confirm('Discard all changes and turn off?');
      if (ok) {
        setMode('idle');
      } else {
        openMenu();
      }
    } else {
      setMode('idle');
    }
  }

  /**
   * Dispatch for arc menu item clicks. Wired via the click handler on
   * each `.dmna-menu-item` (which calls closeMenu first).
   * @param {'edit' | 'undo' | 'confirm'} action
   */
  function handleMenuAction(action) {
    switch (action) {
      case 'edit':
        if (mode === 'active') {
          // Re-tap while active — Z11 path #2 off-attempt.
          tryDeactivate();
        } else {
          setMode('active');
        }
        break;
      case 'undo':
        showToast('Undo: Phase 5 (TBD)');
        break;
      case 'confirm':
        showToast('Confirm: Phase 4 (TBD)');
        break;
    }
  }

  /**
   * Sets the active note (the one currently being worked on, drawn in
   * orange). Pass null to clear. Updates visuals on both the previous
   * and the new active so their classes reflect the change.
   * @param {?string} noteId
   */
  function setActiveNote(noteId) {
    if (activeNoteId === noteId) {
      return;
    }
    const prev = activeNoteId;
    activeNoteId = noteId;
    if (prev !== null) {
      updateNoteVisuals(prev);
    }
    if (noteId !== null) {
      updateNoteVisuals(noteId);
      showPopover(noteId);
    } else {
      hidePopover();
    }
  }

  // --------------------------------------------------------------------------
  // Popover (v3.0 Phase 3 Wave 3)
  //
  // The popover is a single shared element (created lazily on first
  // activation) that re-binds to whichever note is currently active.
  // Position is recomputed on:
  //   1. setActiveNote → showPopover()
  //   2. drag/resize move → updatePopoverPosition()
  //   3. updateVisualViewportPositions (pinch zoom / scroll / resize)
  // --------------------------------------------------------------------------

  /**
   * Builds the popover DOM and wires its input + button events.
   * Idempotent.
   */
  function createPopover() {
    if (popoverElement) {
      return;
    }
    popoverElement = document.createElement('div');
    popoverElement.id = 'dmna-popover';

    popoverArrowElement = document.createElement('div');
    popoverArrowElement.id = 'dmna-popover-arrow';
    popoverElement.appendChild(popoverArrowElement);

    const inputRow = document.createElement('div');
    inputRow.id = 'dmna-popover-input-row';

    popoverInputElement = /** @type {HTMLInputElement} */ (
      document.createElement('textarea'));
    popoverInputElement.id = 'dmna-popover-input';
    popoverInputElement.rows = 3;
    popoverInputElement.placeholder = 'Note...';
    popoverInputElement.autocomplete = 'off';
    popoverInputElement.spellcheck = false;
    popoverInputElement.addEventListener('input', () => {
      if (!activeNoteId) {
        return;
      }
      const note = notes.get(activeNoteId);
      if (note) {
        note.current.text = popoverInputElement.value;
        updateNoteVisuals(activeNoteId);
      }
    });
    inputRow.appendChild(popoverInputElement);

    // 👁 hold-to-show touch-zone debug button. Press-and-hold mirrors
    // the v2.6 affordance (matches user muscle memory for "where do
    // those invisible corner zones really extend?"). Pointer-capture
    // ensures the up event lands on the button even if the user drags
    // off it during the hold.
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.id = 'dmna-popover-eye';
    eyeBtn.textContent = '👁';
    eyeBtn.setAttribute('aria-label', 'Show touch zones (press and hold)');
    eyeBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        eyeBtn.setPointerCapture(e.pointerId);
      } catch (_err) {
        // Non-capturing fallback — debug zones still toggle correctly
        // via the document-level pointerup below.
      }
      document.body.classList.add('dmna-show-debug-zones');
      eyeBtn.classList.add('is-pressed');
    });
    const releaseEye = (e) => {
      document.body.classList.remove('dmna-show-debug-zones');
      eyeBtn.classList.remove('is-pressed');
      try {
        eyeBtn.releasePointerCapture(e.pointerId);
      } catch (_err) {
        // Already released.
      }
    };
    eyeBtn.addEventListener('pointerup', releaseEye);
    eyeBtn.addEventListener('pointercancel', releaseEye);
    inputRow.appendChild(eyeBtn);

    popoverElement.appendChild(inputRow);

    const buttons = document.createElement('div');
    buttons.id = 'dmna-popover-buttons';
    // ✔ / ✖ have dual presentation: text glyph (CSS color applies) or
    // emoji (system color, CSS ignored). On Safari/iOS the default falls
    // back to emoji, which made the buttons look uniformly dark in the
    // user's screenshot. Appending ︎ (Variation Selector-15) forces
    // the text presentation. 🗑 has no text variant so it stays as a
    // system emoji — its CSS color is a visual hint that may be ignored.
    [
      {action: 'confirm', icon: '✔︎', label: 'Confirm'},
      {action: 'cancel', icon: '✖︎', label: 'Cancel'},
      {action: 'delete', icon: '🗑', label: 'Delete'},
    ].forEach(({action, icon, label}) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'dmna-popover-btn';
      b.dataset.action = action;
      b.setAttribute('aria-label', label);
      b.textContent = icon;
      b.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handlePopoverAction(action);
      });
      buttons.appendChild(b);
    });
    popoverElement.appendChild(buttons);

    document.body.appendChild(popoverElement);
  }

  /**
   * Shows the popover bound to the given note. Replaces the input
   * value with the note's current text. Idempotent — calling it on
   * the same note re-positions but won't blow away unsaved typing
   * (the input is only overwritten on note swap).
   * @param {string} noteId
   */
  function showPopover(noteId) {
    createPopover();
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    if (popoverInputElement.dataset.boundNoteId !== noteId) {
      popoverInputElement.value = note.current.text || '';
      popoverInputElement.dataset.boundNoteId = noteId;
    }
    // Pre-position BEFORE reveal. If we add `.show` first the popover
    // renders at its previous transform (or at (0, 0) on first show)
    // for one frame before updatePopoverPosition runs, producing a
    // visible flicker / jump to the box anchor. Setting transform
    // while still display:none means the inline style is in place by
    // the time the show class flips display to block.
    updatePopoverPosition();
    popoverElement.classList.add('show');
  }

  /** Hides the popover without destroying it. */
  function hidePopover() {
    if (popoverElement) {
      popoverElement.classList.remove('show');
      delete popoverInputElement.dataset.boundNoteId;
    }
  }

  /**
   * Re-projects the active box's image-space rect to display space and
   * pins the popover under it. Counter-scales the popover so its visual
   * size stays constant under pinch zoom — the same trick the floating
   * button uses, but with anchoring math. The arrow slides horizontally
   * inside the popover so it always points at the box's center even
   * when the popover gets clamped to a viewport edge.
   */
  function updatePopoverPosition() {
    if (!popoverElement) {
      return;
    }
    // No `.show` check: showPopover deliberately calls this BEFORE
    // adding the show class so the transform is in place when the
    // popover first becomes visible (avoiding a flicker from the
    // previous-or-default position). The activeNoteId guard below is
    // the real "should we be running this" check — activeNoteId and
    // popover-shown are kept in sync by setActiveNote.
    if (!activeNoteId) {
      return;
    }
    const note = notes.get(activeNoteId);
    if (!note) {
      return;
    }
    const boxRectPage = imageToScreenRect(note.current);
    if (!boxRectPage) {
      return;
    }

    const vv = window.visualViewport;
    const scale = vv ? vv.scale : 1;
    const invScale = 1 / scale;
    const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
    const vvPageTop = vv ? vv.pageTop : window.pageYOffset;

    // Box's visual rect in viewport-CSS-pixels.
    const boxVisualLeft = (boxRectPage.left - vvPageLeft) * scale;
    const boxVisualTop = (boxRectPage.top - vvPageTop) * scale;
    const boxVisualWidth = boxRectPage.width * scale;
    const boxVisualHeight = boxRectPage.height * scale;
    const boxCenterVisualX = boxVisualLeft + (boxVisualWidth / 2);
    const boxBottomVisualY = boxVisualTop + boxVisualHeight;

    // Popover visual position: centered on the box. NO horizontal
    // clamp — earlier versions clamped the popover to stay within the
    // visual viewport, but at high pinch-zoom the available range
    // collapses (e.g., vvWidth=300, popover=260 → only 30px of horizontal
    // slack), which pinned the popover to the viewport's left edge and
    // broke the "anchored to box" illusion entirely. We now accept that
    // the popover may overflow at extreme zoom; the user can pinch out
    // or pan to see the rest. Box-anchoring is the higher-priority
    // affordance. The arrow stays at the popover's CSS-center (set
    // statically in createPopover); no per-call slide needed.
    const popVisualLeft = boxCenterVisualX - (POPOVER_WIDTH / 2);
    const popVisualTop = boxBottomVisualY + POPOVER_OFFSET;

    // Convert visual coords back to document coords for the transform.
    const tx = vvPageLeft + (popVisualLeft / scale);
    const ty = vvPageTop + (popVisualTop / scale);
    popoverElement.style.transform =
        `translate(${tx}px, ${ty}px) scale(${invScale})`;
  }

  /**
   * Dispatch for the popover's three action buttons.
   * @param {'confirm' | 'cancel' | 'delete'} action
   */
  function handlePopoverAction(action) {
    if (!activeNoteId) {
      return;
    }
    const id = activeNoteId;
    if (action === 'confirm') {
      popoverConfirm(id);
    } else if (action === 'cancel') {
      popoverCancel(id);
    } else if (action === 'delete') {
      popoverDelete(id);
    }
  }

  /**
   * ✔ — Commit the current geometry and text as the new checkpoint
   * (`confirmedState`). Push an 'edit' action to the log so global
   * Undo can roll back to the previous checkpoint.
   * @param {string} noteId
   */
  function popoverConfirm(noteId) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    pushAction(noteId, 'edit', {...note.confirmedState});
    note.confirmedState = {...note.current};
    note.everConfirmed = true;
    setActiveNote(null);
    updateNoteVisuals(noteId);
  }

  /**
   * ✖ — Discard uncommitted changes by reverting `current` to
   * `confirmedState`. The note stays in the collection. For a
   * never-confirmed brand-new note this reverts to its spawn state
   * (the user can then 🗑 to actually remove it).
   * @param {string} noteId
   */
  function popoverCancel(noteId) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    note.current = {...note.confirmedState};
    renderNoteBox(noteId);
    setActiveNote(null);
  }

  /**
   * 🗑 — Delete the note. New (temp) notes hard-delete (DOM + Map
   * removed; no actionLog entry, since they were never persisted
   * anywhere). Server notes soft-delete (`isDeleted: true`, kept in
   * the collection so Undo can restore them) and push a 'delete'
   * action with the prior `current` for revert.
   * @param {string} noteId
   */
  function popoverDelete(noteId) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    if (!note.isServerNote) {
      hardDeleteNote(noteId);
    } else {
      pushAction(noteId, 'delete', {...note.current});
      note.isDeleted = true;
      setActiveNote(null);
      updateNoteVisuals(noteId);
    }
  }

  /**
   * Removes a note from existence: clears active selection (if it was
   * the active one), drops the DOM, deletes the Map entry, and strips
   * any actionLog entries that reference this id. Used by both
   * popoverDelete (for new temp notes) and dismissActivePopover
   * (cancel-creation path for fresh-new notes).
   *
   * The actionLog cleanup is best-effort: for fresh-new notes there's
   * only ever a single 'create' tail entry, so this just trims it. For
   * temp notes that were ✔'d before being 🗑'd, both 'create' and any
   * 'edit' entries are dropped — Wave 5 (undo) will revisit whether
   * that's the right call.
   * @param {string} id
   */
  function hardDeleteNote(id) {
    if (activeNoteId === id) {
      setActiveNote(null);
    }
    removeNoteBoxDOM(id);
    notes.delete(id);
    for (let i = actionLog.length - 1; i >= 0; i--) {
      if (actionLog[i].noteId === id) {
        actionLog.splice(i, 1);
      }
    }
  }

  /**
   * "Tap outside the popover" dismiss path. Routes to either a hard
   * delete (fresh-new note: cancel creation) or a state revert
   * (✔'d / server note: cancel uncommitted edits, like the ✖ button).
   *
   * "Fresh new" = `!isServerNote && !everConfirmed`. The earlier version
   * inferred this from `confirmedState === initialState`, but that
   * mis-classified the case "user ✔'d an empty box without changes" as
   * fresh-new (since the two states were still equal post-confirm) and
   * hard-deleted the box on the next outside-tap. The explicit
   * `everConfirmed` flag is the source of truth — set by popoverConfirm
   * and untouched elsewhere.
   *
   * Used by `handleImageClick` when an image click lands while a
   * popover is open: instead of spawning a second box, the click
   * dismisses the active popover. The user has to dismiss first, then
   * tap again to create another note — matching v2.6's "tap empty
   * image cancels" UX.
   */
  function dismissActivePopover() {
    if (activeNoteId === null) {
      return;
    }
    const id = activeNoteId;
    const note = notes.get(id);
    if (!note) {
      setActiveNote(null);
      return;
    }
    const isFreshNew = !note.isServerNote && !note.everConfirmed;
    if (isFreshNew) {
      hardDeleteNote(id);
    } else {
      note.current = {...note.confirmedState};
      renderNoteBox(id);
      setActiveNote(null);
    }
  }

  // --------------------------------------------------------------------------
  // Box Drag/Resize (v3.0 Phase 3 Wave 3)
  //
  // One pointer interaction at a time, serialized via setPointerCapture.
  // Move math is "from start" (each frame computes next state from
  // `dragState.startState` + cumulative delta) rather than "from prev",
  // so the gesture is stateless across frames and immune to subpixel
  // drift. NW resize keeps the SE corner pinned (and vice versa) by
  // adjusting both the position and size of the box together.
  // --------------------------------------------------------------------------

  /**
   * Wires a corner handle's pointerdown. Idempotent caller pattern —
   * the handle DOM is created once and this is called once per handle.
   * @param {HTMLElement} handle
   * @param {'nw' | 'ne' | 'sw' | 'se'} corner
   * @param {string} noteId
   */
  function attachHandleListeners(handle, corner, noteId) {
    handle.addEventListener('pointerdown', (e) => {
      if (mode !== 'active') {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      // Activate this note if it isn't already, so the handle is even
      // visible (CSS only shows handles on `.is-active`). Also any
      // popover swap happens before the gesture begins.
      if (activeNoteId !== noteId) {
        setActiveNote(noteId);
      }
      const isResize = (corner === 'nw' || corner === 'se');
      const kind = isResize ? `resize-${corner}` : 'drag';
      startInteraction(noteId, /** @type {any} */ (kind), e, handle);
    });
  }

  /**
   * Wires the box body's pointerdown for body-drag (move). Stops at
   * the body — handles have their own pointerdown that stopPropagation
   * before reaching here.
   * @param {HTMLElement} bodyEl
   * @param {string} noteId
   */
  function attachBodyDragListener(bodyEl, noteId) {
    bodyEl.addEventListener('pointerdown', (e) => {
      if (mode !== 'active') {
        return;
      }
      // Activate-on-touch so a single tap-and-drag works on inactive
      // boxes without requiring two gestures.
      if (activeNoteId !== noteId) {
        setActiveNote(noteId);
      }
      e.preventDefault();
      startInteraction(noteId, 'drag', e, bodyEl);
    });
  }

  /**
   * Common entrypoint for both handle and body interactions. Captures
   * the pointer to the target so subsequent move/up events go there
   * regardless of where the pointer travels.
   * @param {string} noteId
   * @param {'drag' | 'resize-nw' | 'resize-se'} kind
   * @param {PointerEvent} e
   * @param {HTMLElement} captureTarget
   */
  function startInteraction(noteId, kind, e, captureTarget) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }

    dragState = {
      kind,
      noteId,
      pointerId: e.pointerId,
      startScreenX: e.clientX,
      startScreenY: e.clientY,
      startState: {...note.current},
      captureTarget,
      moved: false,
    };

    try {
      captureTarget.setPointerCapture(e.pointerId);
    } catch (_err) {
      // Some browsers throw if the pointer is no longer active; fall
      // back to plain doc-level listeners. Rare in practice.
    }
    captureTarget.addEventListener('pointermove', onInteractionMove);
    captureTarget.addEventListener('pointerup', onInteractionEnd);
    captureTarget.addEventListener('pointercancel', onInteractionEnd);

    // NB: popover opacity is NOT dimmed here. Dimming is deferred to
    // onInteractionMove (first frame past DRAG_THRESHOLD_PX) so a
    // no-movement tap doesn't trigger a 100→25→100% flash that the
    // user perceives as the popover "appearing twice."
  }

  /**
   * Pointermove handler: recomputes the note's current geometry from
   * the start state + cumulative pointer delta. Clamps to image bounds
   * and respects MIN_BOX_SIZE_IMG.
   * @param {PointerEvent} e
   */
  function onInteractionMove(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) {
      return;
    }
    const note = notes.get(dragState.noteId);
    if (!note) {
      return;
    }

    const dx = e.clientX - dragState.startScreenX;
    const dy = e.clientY - dragState.startScreenY;
    if (!dragState.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      dragState.moved = true;
      // First frame of actual movement — dim the popover so the user
      // can see the box clearly while dragging. (No-movement taps
      // don't reach this branch, so the popover stays at 100% and the
      // box-select tap doesn't visually flicker.)
      if (popoverElement) {
        popoverElement.style.opacity = '0.25';
      }
    }

    // Convert display-space delta to image-space.
    const rect = getImageDisplayRect();
    if (!rect || !postOriginalWidth) {
      return;
    }
    const scale = rect.width / postOriginalWidth;
    const dxImg = dx / scale;
    const dyImg = dy / scale;
    // Resize floor: max of the absolute image-space minimum and the
    // display-space minimum projected to image space. The display
    // floor wins at most zoom levels — a small image rendered larger
    // than its original would still need the box big enough for the
    // 32px touch zones to not collide, which is a display-space
    // constraint.
    const minImg = Math.max(
        MIN_BOX_SIZE_IMG, MIN_BOX_SIZE_DISPLAY / scale);

    const start = dragState.startState;
    let nx = start.x;
    let ny = start.y;
    let nw = start.w;
    let nh = start.h;

    if (dragState.kind === 'drag') {
      nx = start.x + dxImg;
      ny = start.y + dyImg;
    } else if (dragState.kind === 'resize-se') {
      nw = Math.max(minImg, start.w + dxImg);
      nh = Math.max(minImg, start.h + dyImg);
    } else if (dragState.kind === 'resize-nw') {
      // NW pivots around the SE corner: the SE-corner image-coord
      // (start.x + start.w, start.y + start.h) stays fixed.
      const seX = start.x + start.w;
      const seY = start.y + start.h;
      let candX = start.x + dxImg;
      let candY = start.y + dyImg;
      if (seX - candX < minImg) {
        candX = seX - minImg;
      }
      if (seY - candY < minImg) {
        candY = seY - minImg;
      }
      nx = candX;
      ny = candY;
      nw = seX - candX;
      nh = seY - candY;
    }

    // Clamp position so the box stays inside the original image.
    nx = Math.max(0, Math.min(postOriginalWidth - nw, nx));
    ny = Math.max(0, Math.min(postOriginalHeight - nh, ny));

    note.current = {x: nx, y: ny, w: nw, h: nh, text: note.current.text};
    renderNoteBox(dragState.noteId);
    updatePopoverPosition();
  }

  /**
   * Pointerup/cancel handler: releases the pointer capture, restores
   * popover opacity, and sets `suppressNextBoxClick` if the gesture
   * actually moved (so the trailing emulated click on the box doesn't
   * re-run any selection logic on top of the just-completed drag).
   * @param {PointerEvent} e
   */
  function onInteractionEnd(e) {
    if (!dragState || e.pointerId !== dragState.pointerId) {
      return;
    }
    const target = dragState.captureTarget;
    try {
      target.releasePointerCapture(e.pointerId);
    } catch (_err) {
      // Already released or never captured — non-fatal.
    }
    target.removeEventListener('pointermove', onInteractionMove);
    target.removeEventListener('pointerup', onInteractionEnd);
    target.removeEventListener('pointercancel', onInteractionEnd);

    if (dragState.moved) {
      // Only reset opacity if we actually dimmed (matches the
      // movement-gated dim in onInteractionMove). Pure-tap gestures
      // never touch popover opacity.
      if (popoverElement) {
        popoverElement.style.opacity = '';
      }
      suppressNextBoxClick = true;
      // Auto-release after the click event window so a swallowed click
      // can't permanently sink the next legitimate tap (matches the
      // v2.6 suppressNextClick TTL pattern).
      setTimeout(() => {
        suppressNextBoxClick = false;
      }, 500);
    }

    dragState = null;
  }

  // --------------------------------------------------------------------------
  // Image Coordinate System (v3.0 Phase 3 Wave 2)
  //
  // Notes are stored in original-image pixel space (matching Danbooru's
  // /notes API) and rendered in display space (raw page pixels). Converting
  // between the two requires:
  //   1. The original-image dimensions  (`postOriginalWidth/Height`,
  //      fetched once via `fetchPostMeta()`).
  //   2. The current rendered image rect (`getImageDisplayRect()`,
  //      observed via `<img>.getBoundingClientRect()` + scroll offsets).
  //
  // Aspect ratio is assumed uniform — Danbooru never letterboxes posts —
  // so a single scalar (`rect.width / postOriginalWidth`) drives both axes.
  // --------------------------------------------------------------------------

  /**
   * Pulls the post id from the URL. v3.0 only runs on `/posts/{id}` per
   * the @match pattern, so this should always return a string in
   * practice; null branches exist for defensiveness against odd URL
   * shapes (e.g., trailing slashes, query strings — both still match).
   * @return {?string}
   */
  function getPostId() {
    const m = window.location.pathname.match(/^\/posts\/(\d+)/);
    return m ? m[1] : null;
  }

  /**
   * @return {?HTMLImageElement} The post's main `<img>`, or null if not
   *     yet in the DOM (Danbooru renders it inside `#image-container` on
   *     post pages — `id="image"` is a stable hook).
   */
  function getImageElement() {
    return /** @type {?HTMLImageElement} */ (
      document.getElementById('image'));
  }

  /**
   * Reads the post image's bounding rect and translates it from viewport
   * space to document/page space (the same coordinate system note boxes
   * are positioned in, since they're `position: absolute` children of
   * `<body>`).
   * @return {?{left: number, top: number, width: number, height: number}}
   *     Null if the image is missing or has zero size (e.g., not loaded
   *     or hidden by display:none).
   */
  function getImageDisplayRect() {
    const img = getImageElement();
    if (!img) {
      return null;
    }
    const r = img.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) {
      return null;
    }
    return {
      left: r.left + window.pageXOffset,
      top: r.top + window.pageYOffset,
      width: r.width,
      height: r.height,
    };
  }

  /**
   * Projects an image-space note state to a display-space rect. Returns
   * null if the rendered image rect is unavailable (caller should hide
   * the box and try again later — see `renderNoteBox`).
   *
   * If `postOriginalWidth` is 0 (metadata not yet fetched) the projection
   * falls back to scale 1, which is wrong for real notes but keeps the
   * debug surface usable when poking values via `__dmna3.addNote` before
   * any active-mode entry.
   *
   * @param {NoteState} state
   * @return {?{left: number, top: number, width: number, height: number}}
   */
  function imageToScreenRect(state) {
    const rect = getImageDisplayRect();
    if (!rect) {
      return null;
    }
    const scale = postOriginalWidth ? rect.width / postOriginalWidth : 1;
    return {
      left: rect.left + (state.x * scale),
      top: rect.top + (state.y * scale),
      width: state.w * scale,
      height: state.h * scale,
    };
  }

  /**
   * Reverse projection: given a display-space rect (in page coords),
   * produce the corresponding image-space NoteState (without `text`).
   * Returns null when the rendered image rect is missing or post
   * dimensions aren't known yet — both indicate "we shouldn't be
   * creating a note right now," not "default to identity."
   * @param {{left: number, top: number, width: number, height: number}} r
   * @return {?{x: number, y: number, w: number, h: number}}
   */
  function screenToImageRect(r) {
    const rect = getImageDisplayRect();
    if (!rect || !postOriginalWidth) {
      return null;
    }
    const scale = rect.width / postOriginalWidth;
    return {
      x: (r.left - rect.left) / scale,
      y: (r.top - rect.top) / scale,
      w: r.width / scale,
      h: r.height / scale,
    };
  }

  // --------------------------------------------------------------------------
  // Server Fetch (v3.0 Phase 3 Wave 2)
  // --------------------------------------------------------------------------

  /**
   * Fetches and caches the post's original image dimensions. The result
   * lands in module-scoped `postOriginalWidth/Height`; callers can either
   * await the returned promise or read those values directly afterwards.
   *
   * Concurrent calls dedupe via `postMetaPromise`. On failure the cache
   * is cleared so the next active-mode entry can retry.
   *
   * @return {Promise<{width: number, height: number}>}
   */
  function fetchPostMeta() {
    if (postOriginalWidth && postOriginalHeight) {
      return Promise.resolve({
        width: postOriginalWidth,
        height: postOriginalHeight,
      });
    }
    if (postMetaPromise) {
      return postMetaPromise;
    }
    const id = getPostId();
    if (!id) {
      return Promise.reject(new Error('No post id in URL'));
    }
    postMetaPromise = fetch(
        `/posts/${id}.json?only=image_width,image_height`,
        {credentials: 'same-origin'})
        .then((r) => {
          if (!r.ok) {
            throw new Error(`HTTP ${r.status}`);
          }
          return r.json();
        })
        .then((data) => {
          postOriginalWidth = Number(data.image_width) || 0;
          postOriginalHeight = Number(data.image_height) || 0;
          if (!postOriginalWidth || !postOriginalHeight) {
            throw new Error('Image dimensions missing in response');
          }
          return {
            width: postOriginalWidth,
            height: postOriginalHeight,
          };
        })
        .catch((err) => {
          postMetaPromise = null;
          throw err;
        });
    return postMetaPromise;
  }

  /**
   * Fetches the active (non-deleted) notes for the current post.
   *
   * Danbooru exposes notes via the global `/notes.json` endpoint with a
   * search filter — there is no `/posts/{id}/notes.json` route (404).
   * `is_active=true` skips server-side soft-deleted notes; `limit=1000`
   * is well above any sane post's note count.
   *
   * @return {Promise<Array<{id: number, x: number, y: number, width: number,
   *     height: number, body: string, is_active: boolean}>>}
   */
  function fetchServerNotes() {
    const id = getPostId();
    if (!id) {
      return Promise.reject(new Error('No post id in URL'));
    }
    const url = `/notes.json?search%5Bpost_id%5D=${id}` +
        `&search%5Bis_active%5D=true&limit=1000`;
    return fetch(url, {credentials: 'same-origin'})
        .then((r) => {
          if (!r.ok) {
            throw new Error(`HTTP ${r.status}`);
          }
          return r.json();
        });
  }

  /**
   * Inserts a server note into the local collection as `isServerNote:true`
   * with the server's numeric id as the noteId (string-cast). Idempotent —
   * if the same id is already in the Map (e.g., from a stale enterActive
   * race), the duplicate is skipped.
   *
   * No `actionLog.push` here: loading server notes is the baseline state,
   * not a user action.
   *
   * @param {{id: number, x: number, y: number, width: number,
   *     height: number, body: string}} sn
   */
  function addServerNote(sn) {
    const id = String(sn.id);
    if (notes.has(id)) {
      return;
    }
    /** @type {NoteState} */
    const state = {
      x: sn.x,
      y: sn.y,
      w: sn.width,
      h: sn.height,
      text: sn.body || '',
    };
    /** @type {Note} */
    const note = {
      current: {...state},
      initialState: {...state},
      confirmedState: {...state},
      isDeleted: false,
      isServerNote: true,
      everConfirmed: false,
      domElement: null,
    };
    notes.set(id, note);
    renderNoteBox(id);
  }

  /**
   * Creates a new temp note with the given image-space state and renders
   * it. Pushes a 'create' entry to actionLog so global Undo can roll it
   * back. Returns the generated noteId.
   * @param {NoteState} state
   * @return {string}
   */
  function createTempNote(state) {
    const id = genNoteId();
    /** @type {Note} */
    const note = {
      current: {...state},
      initialState: {...state},
      confirmedState: {...state},
      isDeleted: false,
      isServerNote: false,
      everConfirmed: false,
      domElement: null,
    };
    notes.set(id, note);
    pushAction(id, 'create', null);
    renderNoteBox(id);
    return id;
  }

  // --------------------------------------------------------------------------
  // Active-mode Image Interaction (v3.0 Phase 3 Wave 2)
  //
  // Wires `<img id="image">` for tap-to-create. Box-tap-to-activate is
  // handled inside renderNoteBox (the box's own click listener stops
  // propagation so the image's listener doesn't also fire).
  // --------------------------------------------------------------------------

  /**
   * Click handler for the post image. In active mode, an empty-area
   * click spawns a default-sized box centered on the click and activates
   * it. Idle-mode clicks are no-ops (the body class also makes this a
   * dead path visually).
   * @param {MouseEvent} e
   */
  function handleImageClick(e) {
    if (mode !== 'active') {
      return;
    }
    // Popover-open guard: a click on the image while a box is active
    // does NOT spawn a second box — it dismisses the active popover
    // (matching v2.6's "tap empty image cancels" UX). See
    // `dismissActivePopover` for the fresh-new vs ✔'d/server routing.
    // The user has to dismiss first, then tap again to create.
    if (activeNoteId !== null) {
      dismissActivePopover();
      return;
    }
    if (!postOriginalWidth || !postOriginalHeight) {
      showToast('⚠️ Image dimensions unknown');
      return;
    }
    const rect = getImageDisplayRect();
    if (!rect) {
      showToast('⚠️ Image not visible');
      return;
    }

    // Default size in display space (matches v2.6 spawnDefaultBox), then
    // converted to image space at storage time.
    const shortSide = Math.min(rect.width, rect.height);
    const sizeDisplay = Math.max(MIN_INITIAL_SIZE,
        Math.min(MAX_INITIAL_SIZE, shortSide * INITIAL_SIZE_RATIO));

    const clickX = e.clientX + window.pageXOffset;
    const clickY = e.clientY + window.pageYOffset;
    let leftDisplay = clickX - (sizeDisplay / 2);
    let topDisplay = clickY - (sizeDisplay / 2);

    // Clamp so the box stays fully inside the image rect.
    const maxLeft = rect.left + rect.width - sizeDisplay;
    const maxTop = rect.top + rect.height - sizeDisplay;
    leftDisplay = Math.max(rect.left, Math.min(maxLeft, leftDisplay));
    topDisplay = Math.max(rect.top, Math.min(maxTop, topDisplay));

    const imgState = screenToImageRect({
      left: leftDisplay,
      top: topDisplay,
      width: sizeDisplay,
      height: sizeDisplay,
    });
    if (!imgState) {
      showToast('⚠️ Image not visible');
      return;
    }
    const id = createTempNote({
      x: imgState.x,
      y: imgState.y,
      w: imgState.w,
      h: imgState.h,
      text: '',
    });
    setActiveNote(id);
    // Phase 3 Wave 3 will open the popover here.
  }

  /**
   * Attaches the image click handler. If `<img id="image">` isn't in the
   * DOM yet (Danbooru lazily inserts it on some flows), retries with a
   * 1s timeout — a v2.6 carry-over pattern. Idempotent.
   *
   * Capture-phase mousedown/touchstart blocker: Danbooru's notes.js binds
   * a bubble-phase mousedown on `#image-container` that handles
   * drag-to-create-note AND toggles `.hide-notes` on `.note-container`
   * for short taps. Both behaviors fight ours — in active mode we own
   * tap-to-create, and the `.hide-notes` toggle persists past our CSS
   * rule, leaving native notes invisible after returning to idle. The
   * capture listener stops propagation before Danbooru sees the event;
   * the dual mousedown+touchstart bind covers both PC and mobile.
   */
  function bindImageHandlers() {
    if (imageHandlersBound) {
      return;
    }
    const img = getImageElement();
    if (!img) {
      setTimeout(bindImageHandlers, 1000);
      return;
    }
    img.addEventListener('click', handleImageClick);
    img.addEventListener('load', updateAllNoteBoxPositions);

    const blockNativeIfActive = (e) => {
      if (mode !== 'active') {
        return;
      }
      e.stopPropagation();
    };
    img.addEventListener('mousedown', blockNativeIfActive, true);
    img.addEventListener('touchstart', blockNativeIfActive, true);

    imageHandlersBound = true;
  }

  // --------------------------------------------------------------------------
  // Debug Surface (Phase 2 verification)
  //
  // Exposed on `window.__dmna3` so the Phase 2 state machine can be exercised
  // from the browser console while the menu items are still stubs. This block
  // is removed (or gated behind a build flag) before the v3.0.0 release.
  // --------------------------------------------------------------------------

  window.__dmna3 = {
    /**
     * Adds a temp note with the given image-space state and renders its
     * box. Note: in Wave 2 onward, the state is image-space pixels, so
     * if `postOriginalWidth` is still 0 (no active-mode entry yet) the
     * scale falls back to 1 — boxes will appear at the image's top-left
     * with their raw values as display pixels.
     * @param {NoteState} state
     * @return {string} the generated note id
     */
    addNote(state) {
      return createTempNote(state);
    },

    /**
     * Hard-removes a note (DOM + collection entry). For soft-delete use
     * `markDeleted` instead.
     * @param {string} noteId
     */
    removeNote(noteId) {
      if (activeNoteId === noteId) {
        setActiveNote(null);
      }
      removeNoteBoxDOM(noteId);
      notes.delete(noteId);
    },

    /**
     * Soft-deletes a note (sets `isDeleted: true`, keeps it in the
     * collection so Undo can restore it). The box switches to the red
     * dashed visual.
     * @param {string} noteId
     */
    markDeleted(noteId) {
      const n = notes.get(noteId);
      if (!n) {
        return;
      }
      pushAction(noteId, 'delete', {...n.current});
      n.isDeleted = true;
      updateNoteVisuals(noteId);
    },

    /**
     * Mutates `current` to simulate a non-text edit (drag/resize) or text
     * change. Triggers a re-render and dirty re-evaluation.
     * @param {string} noteId
     * @param {Partial<NoteState>} changes
     */
    patch(noteId, changes) {
      const n = notes.get(noteId);
      if (!n) {
        return;
      }
      Object.assign(n.current, changes);
      renderNoteBox(noteId);
    },

    /** @param {?string} noteId */
    setActive(noteId) {
      setActiveNote(noteId);
    },

    /** @param {Mode} newMode */
    setMode(newMode) {
      setMode(newMode);
    },

    /** Triggers the Z11 off-flow (with dirty confirm). */
    tryDeactivate() {
      tryDeactivate();
    },

    /** @return {boolean} */
    hasDirty() {
      return hasDirtyNotes();
    },

    /** Clears all notes from the collection (DOM + Map + log). */
    reset() {
      discardAll();
    },

    /** @return {Promise<{width: number, height: number}>} */
    fetchPostMeta() {
      return fetchPostMeta();
    },

    /** Forces a re-projection of every note box. */
    rerender() {
      updateAllNoteBoxPositions();
    },

    notes,
    actionLog,
    get mode() {
      return mode;
    },
    get activeNoteId() {
      return activeNoteId;
    },
    get postOriginalWidth() {
      return postOriginalWidth;
    },
    get postOriginalHeight() {
      return postOriginalHeight;
    },
  };

  init();
})();
