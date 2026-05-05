// ==UserScript==
// @name         Danbooru Mobile Note Assist
// @namespace    http://tampermonkey.net/
// @version      3.0.0
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

  /** @const {string} Display name shown in the popover footer credit line. */
  const SCRIPT_NAME = 'MobileNoteAssist';

  /**
   * @const {string} Version string shown in the popover footer. **Must mirror
   * the @version line in the UserScript header above** — Tampermonkey reads
   * @version for auto-update detection, while this constant is only for the
   * footer credit. Bump both together on any release.
   */
  const SCRIPT_VERSION = '3.0.0';

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
   *  Originally 48 (then 40) for usability of the in-box body drag
   *  target. Tightened to 24 per user request — small features (an
   *  eye, a punctuation glyph) need to be markable. The 32px corner
   *  touch zones extend outside the box (NW/NE fully outside, SE/SW
   *  shifted up half) so they remain individually grabbable even when
   *  the box is smaller than a single touch zone. */
  const MIN_BOX_SIZE_DISPLAY = 24;

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

  /** @const {number} Arc menu radius (px). Shared by createArcMenu and
   *  the tag popover positioning so the popover anchors correctly to
   *  whatever spot the Confirm item occupies. */
  const ARC_RADIUS = 70;

  /** @const {number} Confirm item arc angle (radians, math convention).
   *  Used for both menu rendering and tag-popover anchoring. */
  const ARC_CONFIRM_THETA = (-100 * Math.PI) / 180;

  /** @const {number} CSS-px width of the tag popover. */
  const TAG_POPOVER_WIDTH = 240;

  /** @const {number} Visual gap (CSS px) between the tag popover's
   *  arrow tip and the top edge of the Confirm button. */
  const TAG_POPOVER_GAP = 6;

  /** @const {string[]} The four translation-status tags v3.0 surfaces
   *  in the Confirm-time tag popover (Phase 4 D9). Order = display order. */
  const TAG_OPTIONS = [
    'translated',
    'translation_request',
    'check_translation',
    'partially_translated',
  ];

  /** @const {Object<string, string>} Display labels for TAG_OPTIONS.
   *  Capitalized + spaced for readability; the raw tag (the key) is
   *  what gets sent to the server. */
  const TAG_LABELS = {
    translated: 'Translated',
    translation_request: 'Translation request',
    check_translation: 'Check translation',
    partially_translated: 'Partially translated',
  };

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
   * @property {'create' | 'edit' | 'delete' | 'transform'} type
   *     - 'create'    — new temp note spawned. prevState is null.
   *     - 'edit'      — ✔ checkpoint. prevState is the prior
   *                     `confirmedState`; undo restores both
   *                     `current` and `confirmedState` (✔ commits
   *                     both, so undo reverts both).
   *     - 'delete'    — 🗑 soft-delete. prevState is `current` at
   *                     delete time; undo flips `isDeleted=false`
   *                     and restores `current`.
   *     - 'transform' — drag/resize gesture finished with movement.
   *                     prevState is `current` at gesture start;
   *                     undo restores only the geometry fields
   *                     (x/y/w/h), leaving text and confirmedState
   *                     alone. Two reasons for the split: (a) drag
   *                     doesn't change confirmedState, so resetting
   *                     it would clobber a prior ✔; (b) typing
   *                     after a drag shouldn't be undone by a ↶
   *                     aimed at the drag.
   * @property {?NoteState} prevState  State immediately before the action.
   *     Null for 'create' (the note didn't exist yet). Per-note Undo
   *     (popover ↶) finds the latest entry matching `noteId` and
   *     reverses it. Wave 3.5 simplified v3.0 scope to per-note only —
   *     there is no longer a global Undo arc-menu item.
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

  /**
   * Per-note action history. Each entry array is a stack: latest action
   * is at the end, `pop()` is the undo target. Wave 3.5 dropped global
   * Undo so all reads are per-note now — Map<noteId, stack[]> makes
   * popoverUndo / hardDeleteNote O(1) instead of an array reverse-scan
   * that grew with total session activity (Phase 6 audit).
   * @type {Map<string, ActionLogEntry[]>}
   */
  const actionLog = new Map();

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

  // PC keyboard shortcuts (Shift+N global toggle). One-time document-level
  // bind, gated by activeNoteId / focus checks at fire time.
  let hotkeysBound = false;

  // Phase 4 D11: in-flight Confirm send. Locks all interactive paths
  // (keyboard shortcuts, box clicks, menu) so the user can't mutate
  // state while requests are in flight.
  let isSending = false;

  // Popover (v3.0 Phase 3 Wave 3). Created lazily on first activation.

  /** @type {?HTMLElement} */
  let popoverElement = null;

  /** @type {?HTMLInputElement} */
  let popoverInputElement = null;

  /** @type {?HTMLElement} */
  let popoverArrowElement = null;

  // Tag popover (v3.0 Phase 4 D9). Created lazily on first Confirm
  // that needs it.

  /** @type {?HTMLElement} */
  let tagPopoverElement = null;

  /** @type {?Set<string>}  Snapshot of which TAG_OPTIONS the post
   *  already had at popover-open time. Used to compute add/remove
   *  deltas at submit. */
  let tagPopoverInitialTags = null;

  /** @type {?Object<string, boolean>}  Live working state of the four
   *  toggles. Mutated through `applyTagConstraints` so the four rules
   *  (translated XOR rest, c_t/p_t implies t_r, etc.) stay invariant
   *  across every click. */
  let tagPopoverState = null;

  /** @type {?(result: ?{tagsToAdd: string[], tagsToRemove: string[]}) => void}
   *  Active resolver for the in-flight `showTagPopover()` promise.
   *  Null when no popover is open. */
  let pendingTagPopoverResolver = null;

  // Error modal (v3.0 Phase 4 D12). Shown after sendBatch when any
  // call failed. User picks Retry or Cancel.

  /** @type {?HTMLElement} */
  let errorModalElement = null;

  /** @type {?HTMLElement} */
  let errorModalBackdropElement = null;

  /** @type {?(choice: 'retry' | 'cancel') => void} */
  let pendingErrorModalResolver = null;

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

  /**
   * Active drag-to-create state on the image (PC mouse only). Set on
   * `pointerdown`, cleared on `pointerup` / `pointercancel`. The `moved`
   * flag flips once the pointer travels DRAG_THRESHOLD_PX, gating the
   * ghost-rect render and the "create with drag rect vs. default-size
   * click" branch in pointerup.
   * @typedef {{
   *   startX: number,
   *   startY: number,
   *   imageRect: {left: number, top: number, width: number, height: number},
   *   ghostEl: ?HTMLDivElement,
   *   moved: boolean,
   * }} DragCreateState
   */

  /** @type {?DragCreateState} */
  let dragCreate = null;

  /** @type {boolean}  Set when drag-to-create resolves with movement;
   *  consumed (and reset) by `handleImageClick` so the trailing click
   *  doesn't also spawn a default-sized box on top of the dragged one. */
  let suppressNextImageClick = false;

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
    /* When a deleted box is also active (re-tapped to reveal the undo
       affordance), keep the red-dashed visual — masking it as orange
       would hide the very state the popover is asking the user to act on. */
    .dmna-note-box.is-deleted.is-active {
      border-style: dashed;
      border-color: #e53935;
      background-color: rgba(229, 57, 53, 0.18);
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

    /* Drag-to-create ghost rect (PC mouse only). Shown while the user
       is dragging on the image; converted to a real note on pointerup.
       Dashed accent border + faint fill to read as "in progress". */
    #dmna-drag-ghost {
      position: absolute;
      border: 2px dashed rgba(255, 200, 0, 0.85);
      background: rgba(255, 200, 0, 0.12);
      pointer-events: none;
      z-index: 10500;
      box-sizing: border-box;
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
      background-color: transparent;
      border: 1px dashed transparent;
      pointer-events: auto;
      z-index: 1;
      touch-action: none;
      /* Fade-in/out for the debug-zone overlay (v2.6 carry-over pattern).
         Baseline is fully transparent so toggling the debug-zones body
         class only flips colors — transition then animates the swap.
         The 1px dashed border is reserved at baseline (transparent) so
         border-color can transition smoothly; switching border-style
         mid-animation would snap instead of fade. */
      transition: background-color 0.3s ease, border-color 0.3s ease;
    }
    .dmna-note-box.is-active .dmna-handle { display: block; }
    .dmna-handle-nw { top: -32px; left: -32px; cursor: nwse-resize; }
    .dmna-handle-ne { top: -32px; right: -32px; cursor: move; }
    .dmna-handle-se { bottom: -16px; right: -32px; cursor: nwse-resize; }
    .dmna-handle-sw { bottom: -16px; left: -32px; cursor: move; }

    /* SE corner triangle: visual resize affordance on active box. Color
       tracks the active border (orange). Fades out during drag/resize
       (.is-interacting set in onInteractionMove) so the user's view of
       the underlying art isn't obscured by chrome they're not aiming at —
       v2.6 carry-over pattern. */
    .dmna-note-box.is-active::after {
      content: '';
      position: absolute;
      bottom: 0; right: 0;
      width: 0; height: 0;
      border-style: solid;
      border-width: 0 0 8px 8px;
      border-color: transparent transparent #ff9800 transparent;
      pointer-events: none;
      opacity: 1;
      transition: opacity 0.2s ease;
    }
    .dmna-note-box.is-active.is-interacting::after {
      opacity: 0;
    }

    /* Touch-zone debug overlay: while the user holds the popover's 👁
       button, paint each (otherwise invisible) corner handle in red so
       they can see exactly where the touch zones extend past the visible
       border. Only renders for the active box's handles since those are
       the only ones that actually receive input.

       The icon pseudo-element is always present (so its color can fade
       smoothly via transition); it just stays transparent until the
       debug-zones class flips on. The .dmna-handle baseline above
       handles the background/border fade. */
    .dmna-note-box.is-active .dmna-handle::before {
      content: attr(data-icon);
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      color: transparent;
      text-shadow: none;
      pointer-events: none;
      transition: color 0.3s ease, text-shadow 0.3s ease;
    }
    body.dmna-show-debug-zones .dmna-note-box.is-active .dmna-handle {
      background-color: rgba(229, 57, 53, 0.30);
      border-color: rgba(255, 120, 120, 0.95);
    }
    body.dmna-show-debug-zones .dmna-note-box.is-active .dmna-handle::before {
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
    #dmna-popover-side-stack {
      flex-shrink: 0;
      width: 44px;
      display: flex;
      flex-direction: column;
      gap: 6px;
      align-self: stretch;
    }
    .dmna-popover-side-btn {
      flex: 1;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      background: rgba(255, 255, 255, 0.06);
      color: white;
      font-size: 18px;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
      min-height: 0;
    }
    /* Eye uses pointer events for press-and-hold, so it overrides
       touch-action to disable scroll/zoom while held. */
    #dmna-popover-eye { touch-action: none; }
    #dmna-popover-eye:active,
    #dmna-popover-eye.is-pressed {
      background: rgba(255, 255, 255, 0.22);
    }
    #dmna-popover-undo:active {
      background: rgba(255, 255, 255, 0.22);
    }
    /* Disabled state for the popover's interactive controls — used when
       the active note is soft-deleted, leaving only ↶ (highlighted) live. */
    #dmna-popover-input:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .dmna-popover-side-btn:disabled,
    .dmna-popover-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
    .dmna-popover-side-btn:disabled:active,
    .dmna-popover-btn:disabled:active {
      background: rgba(255, 255, 255, 0.06);
    }
    /* Highlighted ↶ on a soft-deleted note — accents the only live
       action so the user knows their next move is "undo to restore." */
    #dmna-popover-undo.is-highlighted {
      border-color: #ff9800;
      background: rgba(255, 152, 0, 0.22);
      color: #ffb74d;
    }
    #dmna-popover-undo.is-highlighted:active {
      background: rgba(255, 152, 0, 0.36);
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

    /* Footer credit line — script identity at popover bottom. 10px is
       intentionally below typical body-text minimums; this is glance-
       only "what is this?" info, not something we expect users to read
       during their typing flow. Right-aligned + muted so it sits out
       of the way of the action buttons just above. */
    .dmna-popover-credit {
      font-size: 10px;
      color: rgba(255, 255, 255, 0.4);
      text-align: right;
      margin-top: 6px;
      line-height: 1;
      user-select: none;
      pointer-events: none;
    }
    .dmna-popover-btn[data-action="delete"] { color: #ff8b8b; }

    /* Phase 4 (D11): Confirm in-flight UI lock. Pointer events off on
       boxes + popover + floating button so any stray tap/drag is a
       no-op while requests are in flight. The ⏳ icon stays visible
       (pointer-events: none doesn't hide). */
    body.dmna-sending .dmna-note-box,
    body.dmna-sending #dmna-popover,
    body.dmna-sending #dmna-float-btn {
      pointer-events: none !important;
    }

    /* Phase 4 (D9): tag popover — anchored to the LEFT of the floating
       button with a rightward-pointing arrow. The earlier "above Confirm"
       anchor overflowed the right edge of the viewport when the floating
       button sat near the screen edge (which it does by default), so the
       anchor was moved to the floating button itself. Counter-scaled by
       visualViewport like the active-note popover so the visual size
       stays constant across pinch zoom. */
    #dmna-tag-popover {
      position: absolute;
      left: 0; top: 0;
      width: ${TAG_POPOVER_WIDTH}px;
      background: rgba(30, 30, 30, 0.96);
      border: 1px solid rgba(255, 255, 255, 0.18);
      border-radius: 10px;
      padding: 12px;
      z-index: 11500;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      color: white;
      display: none;
      box-sizing: border-box;
      font-size: 14px;
      transform-origin: 0 0;
      will-change: transform;
    }
    #dmna-tag-popover.show { display: block; }

    /* Right-pointing arrow at popover bottom-right, aligned with the
       floating button's vertical center. Offset 12px from popover
       bottom = (BTN_SIZE/2) − arrow_half = 20 − 8: when the popover's
       bottom edge sits at the floating button's bottom edge, this puts
       the arrow's vertical midpoint at the button's vertical midpoint. */
    #dmna-tag-popover-arrow {
      position: absolute;
      right: -8px;
      bottom: 12px;
      width: 0; height: 0;
      border-style: solid;
      border-width: 8px 0 8px 8px;
      border-color: transparent transparent transparent rgba(30, 30, 30, 0.96);
      pointer-events: none;
    }

    .dmna-tag-popover-header {
      font-size: 14px;
      font-weight: bold;
      margin-bottom: 10px;
      color: #ffffff;
    }

    #dmna-tag-popover-toggles {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 12px;
    }

    /* Tag toggle row — label on the left, iOS-style pill switch on the
       right. The whole row is a <button>, so clicks anywhere on it flip
       the state. Inner spans use pointer-events: none so the click
       target is always the button itself. */
    .dmna-tag-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      width: 100%;
      padding: 8px 12px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.18);
      background: rgba(255, 255, 255, 0.06);
      color: #ffffff;
      font-size: 13px;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
      transition: background 0.12s, border-color 0.12s;
      box-sizing: border-box;
    }
    .dmna-tag-toggle:hover {
      background: rgba(255, 255, 255, 0.10);
    }
    /* Forced-on state: rule 3 (check_translation or partially_translated
       implies translation_request) locks translation_request ON. Click
       is a no-op; the visual cue is reduced opacity. */
    .dmna-tag-toggle:disabled {
      cursor: not-allowed;
      opacity: 0.7;
    }
    .dmna-tag-label {
      flex: 1;
      text-align: left;
      pointer-events: none;
    }
    /* Pill switch: 36x20 track + 16x16 thumb. ON = green track + thumb
       slides to the right; OFF = neutral track + thumb on the left. */
    .dmna-tag-switch {
      position: relative;
      flex-shrink: 0;
      width: 36px;
      height: 20px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.22);
      transition: background 0.14s;
      pointer-events: none;
    }
    .dmna-tag-toggle.is-on .dmna-tag-switch {
      background: rgba(46, 204, 113, 0.85);
    }
    .dmna-tag-switch-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: #ffffff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
      transition: transform 0.14s;
      pointer-events: none;
    }
    .dmna-tag-toggle.is-on .dmna-tag-switch-thumb {
      transform: translateX(16px);
    }

    #dmna-tag-popover-buttons {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }
    .dmna-tag-popover-btn {
      padding: 6px 14px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: white;
      font-size: 13px;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
    }
    .dmna-tag-popover-btn:active {
      background: rgba(255, 255, 255, 0.28);
    }
    /* Primary action (Submit) — Danbooru convention: primary first. */
    .dmna-tag-popover-btn[data-action="submit"] {
      border-color: rgba(0, 115, 255, 0.6);
      background: rgba(0, 115, 255, 0.45);
    }
    .dmna-tag-popover-btn[data-action="submit"]:active {
      background: rgba(0, 115, 255, 0.65);
    }

    /* Phase 4 (D12): error modal — same backdrop/card pattern as tag
       modal. Shows failure summary + Retry / Cancel. */
    #dmna-error-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.5);
      z-index: 11500;
      display: none;
    }
    #dmna-error-modal-backdrop.show { display: block; }

    #dmna-error-modal {
      position: fixed;
      left: 50%;
      top: 50%;
      transform: translate(-50%, -50%);
      width: 360px;
      max-width: calc(100vw - 32px);
      max-height: calc(100vh - 64px);
      background: rgba(30, 30, 30, 0.96);
      border: 1px solid rgba(229, 57, 53, 0.4);
      border-radius: 10px;
      padding: 16px;
      z-index: 11501;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
      color: white;
      display: none;
      box-sizing: border-box;
      font-size: 13px;
      overflow-y: auto;
    }
    #dmna-error-modal.show { display: block; }

    .dmna-error-modal-header {
      font-size: 15px;
      font-weight: bold;
      color: #ff8b8b;
      margin-bottom: 8px;
    }
    .dmna-error-modal-summary {
      color: #cccccc;
      margin-bottom: 12px;
    }
    .dmna-error-modal-list {
      max-height: 240px;
      overflow-y: auto;
      margin-bottom: 16px;
      padding: 8px;
      background: rgba(0, 0, 0, 0.3);
      border-radius: 6px;
      font-family: ui-monospace, Menlo, Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
    }
    .dmna-error-modal-list-item {
      color: #f0c0c0;
      word-break: break-word;
    }
    .dmna-error-modal-list-item + .dmna-error-modal-list-item {
      margin-top: 4px;
    }
    #dmna-error-modal-buttons {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }
    .dmna-error-modal-btn {
      padding: 8px 18px;
      border-radius: 6px;
      border: 1px solid rgba(255, 255, 255, 0.32);
      background: rgba(255, 255, 255, 0.13);
      color: white;
      font-size: 14px;
      cursor: pointer;
      user-select: none;
      touch-action: manipulation;
    }
    .dmna-error-modal-btn:active {
      background: rgba(255, 255, 255, 0.28);
    }
    .dmna-error-modal-btn[data-action="retry"] {
      border-color: rgba(0, 115, 255, 0.6);
      background: rgba(0, 115, 255, 0.45);
    }
    .dmna-error-modal-btn[data-action="retry"]:active {
      background: rgba(0, 115, 255, 0.65);
    }

    #dmna-toast {
      visibility: hidden; min-width: 160px;
      background-color: rgba(30, 30, 30, 0.95); color: #fff;
      text-align: center; border-radius: 50px; padding: 12px 24px;
      position: absolute; left: 0; top: 0; z-index: 11000;
      font-size: 14px; opacity: 0;
      transition: opacity 0.4s ease-in-out, visibility 0.4s ease-in-out;
      pointer-events: none; transform-origin: 0 0;
      will-change: transform, opacity;
      border-left: 4px solid transparent;
    }
    #dmna-toast.show { visibility: visible; opacity: 1; }
    /* Type accents — color-coded left border so users can scan severity
       even without reading the text. Background tints stay subtle so the
       toast reads as the same UI element across types. */
    #dmna-toast.dmna-toast-success {
      border-left-color: rgba(46, 204, 113, 0.9);
    }
    #dmna-toast.dmna-toast-warning {
      border-left-color: rgba(240, 180, 50, 0.9);
    }
    #dmna-toast.dmna-toast-error {
      border-left-color: rgba(220, 70, 70, 0.95);
      background-color: rgba(60, 28, 28, 0.96);
    }
  `;

  const styleElement = document.createElement('style');
  styleElement.textContent = STYLES;
  document.head.appendChild(styleElement);

  // --------------------------------------------------------------------------
  // Core Functions
  // --------------------------------------------------------------------------

  /**
   * @typedef {'info' | 'success' | 'warning' | 'error'} ToastType
   */

  /** @const {Object<string, {className: string, duration: number}>}
   *  Per-type toast presets. `error` lingers longer so actionable
   *  messages have time to be read; `success` is brief (the user
   *  already knows their action succeeded — the toast just confirms).
   *  `info` stays at the v2.6 baseline for consistency. */
  const TOAST_PRESETS = {
    info: {className: '', duration: 2500},
    success: {className: 'dmna-toast-success', duration: 1800},
    warning: {className: 'dmna-toast-warning', duration: 3000},
    error: {className: 'dmna-toast-error', duration: 4500},
  };

  /**
   * Displays a toast message. Type drives both the accent color
   * (CSS `.dmna-toast-{type}` class) and the auto-dismiss duration.
   * Stacks: a new call cancels the previous timer and replaces the
   * text + class — no queueing.
   *
   * Error/warning toasts also log to the browser console (with the
   * optional `err` object passed to preserve the stack trace) so the
   * user can diagnose issues after the toast auto-dismisses. Info /
   * success toasts don't log — they'd just spam the console with
   * noise the user already saw on screen.
   * @param {string} msg
   * @param {ToastType=} type Defaults to 'info'.
   * @param {*=} err Optional error object/value for console diagnostics.
   *     Only consulted when type is 'error' or 'warning'.
   */
  function showToast(msg, type, err) {
    const preset = TOAST_PRESETS[type || 'info'] || TOAST_PRESETS.info;
    if (!toastElement) {
      toastElement = document.createElement('div');
      toastElement.id = 'dmna-toast';
      document.body.appendChild(toastElement);
    }
    updateVisualViewportPositions();
    toastElement.textContent = msg;
    void toastElement.offsetWidth; // Trigger reflow
    toastElement.className = `show ${preset.className}`.trim();
    if (toastTimer) {
      clearTimeout(toastTimer);
    }
    toastTimer = setTimeout(() => {
      toastElement.className = '';
    }, preset.duration);

    if (type === 'error' || type === 'warning') {
      const logFn = type === 'error' ? console.error : console.warn;
      const tag = `[${SCRIPT_NAME}]`;
      if (err !== undefined) {
        logFn(tag, msg, err);
      } else {
        logFn(tag, msg);
      }
    }
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

    // Tag popover (Phase 4 D9) is anchored to the (would-be) Confirm
    // arc-menu position, so it follows the floating button.
    if (tagPopoverElement &&
        tagPopoverElement.classList.contains('show')) {
      updateTagPopoverPosition();
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
    // pending changes (anything Confirm would actually send), surface
    // the browser's standard "Leave site?" prompt. Browsers ignore
    // custom messages here for security, so this is a generic confirm —
    // still an upgrade over silent loss. tryDeactivate's `window.confirm`
    // covers the in-script off paths (Z11); this handler covers the
    // out-of-band ones (refresh button, closing the tab, Cmd+R, etc).
    window.addEventListener('beforeunload', (e) => {
      if (mode === 'active' && hasPendingChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    });

    if (!hotkeysBound) {
      document.addEventListener('keydown', handleGlobalHotkeys);
      hotkeysBound = true;
    }

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
          showToast('✥ Drag to reposition', 'info');
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
        // Clamps derived from arc menu geometry (r=70, 2 items at -100°,
        // -150°) so the entire menu stays on-screen at any button
        // position. With both items now on the left half (Phase 4 tag
        // popover anchored above Confirm), the leftward overhang grows.
        //   • Right limit (min X = 25): items don't extend right of
        //     button (cos < 0 for both), so the constraint is just
        //     "button visible." Use 25 for a small margin from edge.
        //   • Left limit (max X = screenW − 110): r·|cos(-150°)| +
        //     item_half + btn_half ≈ 61 + 20 + 20 = 101 → 110. Item 1
        //     (Edit, -150°) is the leftmost.
        //   • Top limit (max Y = screenH − 110): r·|sin(-100°)| +
        //     item_half + btn_half ≈ 69 + 20 + 20 = 109 → 110. Item 0
        //     (Confirm, -100°) is the highest.
        //   • Bottom limit (min Y = 20): only the button itself extends
        //     below button-center; all items sit at or above it.
        newMarginX = Math.max(25, Math.min(screenW - 110, newMarginX));
        newMarginY = Math.max(20, Math.min(screenH - 110, newMarginY));
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
            toggleEditMode();
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
     * @type {Array<{action: 'edit' | 'confirm', icon: string,
     *     label: string}>}
     *
     * Order matches arc traversal from arc-start (closest to top) down
     * to arc-end (closest to floating button). Read "from button outward
     * / bottom-up": Edit -> Confirm.
     *
     * Phase 3 (Z10): create + edit modes were merged into a single
     * `active` mode driven by the Edit item, and the explicit Discard-all
     * item was removed (its role is absorbed by the Z11 off-flow's dirty
     * confirm dialog). Down from 5 items to 3.
     *
     * Wave 3.5: global Undo dropped — undo is now per-note via the
     * popover ↶ button. Down to 2 items.
     */
    const items = [
      {action: 'confirm', icon: '✅', label: 'Confirm'},
      {action: 'edit', icon: '✏️', label: 'Edit'},
    ];

    // Arc geometry: both items sit on the LEFT half of the floating
    // button (per user feedback — the right side is the user's thumb's
    // resting area in mobile portrait, and the upper-right is also
    // close to common toolbar overlays). Confirm at -100° ("just before
    // 12"), Edit at -150° ("10 o'clock"). Radius 70 → button-edge to
    // item-edge gap ≈ 30px. Adjacent centers ≈ 60px apart. Closed
    // state is translate(0, 0) so items animate out from the button
    // on open.
    const r = ARC_RADIUS;
    const itemSize = BTN_SIZE;
    const half = itemSize / 2;
    const center = BTN_SIZE / 2;
    const angleStart = ARC_CONFIRM_THETA;       // -100° (just before 12)
    const stepAngle = (-50 * Math.PI) / 180;    // -50° clockwise per step

    items.forEach((item, i) => {
      const theta = angleStart + (stepAngle * i);
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

  /**
   * Document-level keydown for PC shortcuts.
   *
   * Esc — dismiss the active popover (mirrors outside-click:
   * `dismissActivePopover` hard-deletes fresh-new notes, reverts the
   * rest). Fires regardless of whether the textarea has focus, so the
   * user can dismiss after their focus drifted to body/another element
   * via tab/click. Skipped if focus is in some unrelated text input on
   * the page (e.g., Danbooru's tag search) so we don't hijack the
   * native Esc behavior for that input.
   *
   * Shift+N — toggle active/idle (mirrors menu Edit). Disabled while a
   * popover is open or any text input has focus, so it can't fire
   * while the user is typing. `e.code === 'KeyN'` keeps the binding
   * stable across keyboard layouts and Caps Lock; the modifier guard
   * avoids hijacking browser shortcuts (Ctrl/Cmd/Alt + Shift+N).
   *
   * Shift+Enter — fire arc-menu Confirm (`runConfirmFlow`, the batch
   * send) when in active mode. Same gate as Shift+N: no popover, no
   * text-input focus. Critically NOT consumed inside the textarea —
   * Shift+Enter is the standard "insert newline" affordance there
   * (translation lines often span multiple lines), so the input-focus
   * guard preserves it.
   * @param {KeyboardEvent} e
   */
  function handleGlobalHotkeys(e) {
    // Lock keyboard shortcuts while a Confirm batch is in flight (D11).
    if (isSending) {
      return;
    }
    // Tag popover (D9) and error modal (D12) own Esc / Ctrl-Enter
    // while they're open — own handlers fire first, this one stays out.
    if (document.body.classList.contains('dmna-tag-popover-open') ||
        document.body.classList.contains('dmna-error-modal-open')) {
      return;
    }
    if (e.key === 'Escape' && activeNoteId !== null) {
      const ae = document.activeElement;
      if (isTextInputElement(ae) && ae !== popoverInputElement) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      dismissActivePopover();
      return;
    }
    if (
      e.shiftKey && e.code === 'KeyN' &&
      !e.ctrlKey && !e.metaKey && !e.altKey &&
      activeNoteId === null &&
      !isTextInputElement(document.activeElement)
    ) {
      e.preventDefault();
      toggleEditMode();
      return;
    }
    if (
      e.shiftKey && e.key === 'Enter' &&
      !e.ctrlKey && !e.metaKey && !e.altKey &&
      mode === 'active' &&
      activeNoteId === null &&
      !isTextInputElement(document.activeElement)
    ) {
      e.preventDefault();
      runConfirmFlow();
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
   * Pushes an action onto this note's per-note undo stack. Lazily
   * creates the stack on first push.
   * @param {string} noteId
   * @param {'create' | 'edit' | 'delete' | 'transform'} type
   * @param {?NoteState} prevState
   */
  function pushAction(noteId, type, prevState) {
    let stack = actionLog.get(noteId);
    if (!stack) {
      stack = [];
      actionLog.set(noteId, stack);
    }
    stack.push({noteId, type, prevState});
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
  function renderNoteBox(noteId, cachedRect) {
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
    const screen = imageToScreenRect(note.current, cachedRect);
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
   *
   * Reads the image rect once and passes it to each `renderNoteBox` —
   * without this batch path, N notes meant N `getBoundingClientRect()`
   * reads on the image interleaved with N style writes, which forces
   * N forced reflows under orientation change at large note counts
   * (Phase 6 audit P2).
   */
  function updateAllNoteBoxPositions() {
    const rect = getImageDisplayRect();
    for (const id of notes.keys()) {
      renderNoteBox(id, rect);
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
   * Whether the collection has any change that would alter server state
   * if the user pressed Confirm now. Used by the Z11 off-flow (and the
   * beforeunload guard) to decide whether to show the discard prompt.
   *
   * Distinct from `isDirty(note)` which is a *visual* classification
   * ("temp notes are always green"). A soft-deleted ✔'d temp note
   * isDirty=true (still drawn red dashed via CSS) but pending=false
   * (Confirm would silently drop it — Wave 3.5 D8). Same for fresh-new
   * uncommitted temps: visible as green boxes but never POSTed unless
   * ✔'d, so deactivating them is a no-op server-side.
   *
   * Pending = the note maps to a non-empty Phase 4 classifyChanges()
   * bucket (POST / PUT / DELETE), per PLAN.md D8.
   * @return {boolean}
   */
  function hasPendingChanges() {
    for (const note of notes.values()) {
      if (note.isServerNote) {
        // Soft-deleted server note → DELETE.
        if (note.isDeleted) {
          return true;
        }
        // Edited server note → PUT.
        const a = note.current;
        const b = note.initialState;
        if (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h ||
            a.text !== b.text) {
          return true;
        }
      } else {
        // Temp note: only ✔'d AND not soft-deleted notes get POSTed.
        // Fresh-new uncommitted (no ✔) = silent drop. Soft-deleted
        // ✔'d temp = silent drop (never persisted).
        if (note.everConfirmed && !note.isDeleted) {
          return true;
        }
      }
    }
    return false;
  }

  // --------------------------------------------------------------------------
  // Phase 4: Confirm classification (D8 + D9)
  // --------------------------------------------------------------------------

  /**
   * Buckets the current `notes` collection by what API call (if any)
   * Confirm should make for each entry. The result drives both the
   * "anything to do?" check and the eventual `sendBatch()` (Task 4.3).
   *
   * Routing rules (PLAN.md D8):
   *   - !isServerNote && !isDeleted && everConfirmed         → posts
   *   - !isServerNote && !isDeleted && !everConfirmed        → dropped.uncommittedTemps
   *   - !isServerNote && isDeleted                           → dropped.softDeletedTemps
   *   - isServerNote && !isDeleted && current ≠ initialState → puts
   *   - isServerNote && !isDeleted && current === initialState → dropped.unchangedServer
   *   - isServerNote && isDeleted                            → deletes
   *
   * `puts[i].textChanged` flags whether the PUT carries a text edit
   * (vs. geometry-only) — drives the tag popover decision (D9).
   *
   * Server note ids: server-loaded notes use the numeric id directly
   * as their Map key, so `noteId === serverId` for them. The
   * separate field is kept for self-documenting call-sites at
   * `sendBatch` time.
   *
   * @return {{
   *   posts: Array<{noteId: string, state: NoteState}>,
   *   puts: Array<{noteId: string, serverId: string, state: NoteState,
   *                textChanged: boolean}>,
   *   deletes: Array<{noteId: string, serverId: string}>,
   *   dropped: {
   *     uncommittedTemps: string[],
   *     softDeletedTemps: string[],
   *     unchangedServer: string[],
   *   },
   *   hasChanges: boolean
   * }}
   */
  function classifyChanges() {
    const posts = [];
    const puts = [];
    const deletes = [];
    const dropped = {
      uncommittedTemps: [],
      softDeletedTemps: [],
      unchangedServer: [],
    };

    for (const [noteId, note] of notes.entries()) {
      if (note.isServerNote) {
        if (note.isDeleted) {
          deletes.push({noteId, serverId: noteId});
          continue;
        }
        const a = note.current;
        const b = note.initialState;
        const geomChanged = a.x !== b.x || a.y !== b.y ||
            a.w !== b.w || a.h !== b.h;
        const textChanged = a.text !== b.text;
        if (geomChanged || textChanged) {
          puts.push({
            noteId,
            serverId: noteId,
            state: {...a},
            textChanged,
          });
        } else {
          dropped.unchangedServer.push(noteId);
        }
      } else {
        // Temp note
        if (note.isDeleted) {
          dropped.softDeletedTemps.push(noteId);
        } else if (!note.everConfirmed) {
          dropped.uncommittedTemps.push(noteId);
        } else {
          posts.push({noteId, state: {...note.current}});
        }
      }
    }

    const hasChanges =
        posts.length > 0 || puts.length > 0 || deletes.length > 0;

    return {posts, puts, deletes, dropped, hasChanges};
  }

  /**
   * Whether the classified changes require the tag popover (D9):
   * any creation, any deletion, or any text edit. Geometry-only edits
   * proceed straight to send.
   * @param {ReturnType<typeof classifyChanges>} c
   * @return {boolean}
   */
  function needsTagPopover(c) {
    if (c.posts.length > 0) {
      return true;
    }
    if (c.deletes.length > 0) {
      return true;
    }
    return c.puts.some((p) => p.textChanged);
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
    actionLog.clear();
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
      showToast('⚠️ Failed to load image info', 'error', err);
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
      showToast('⚠️ Failed to load existing notes', 'error', err);
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
   * The Z11 off-attempt: if there are any pending changes (notes that
   * Confirm would actually send), prompts the user with
   * `window.confirm('Discard all changes and turn off?')`. Acceptance
   * runs `setMode('idle')`; cancellation re-opens the arc menu so the
   * user can pick Confirm instead (or per-note ↶ from the popover).
   * With no pending changes, off happens immediately. The "pending"
   * check (vs. a naive isDirty count) excludes fresh-new uncommitted
   * temps and soft-deleted ✔'d temps — both are silent-drop at
   * Confirm time, so deactivating in their presence is a server no-op
   * and shouldn't pop a dialog.
   *
   * Called from two paths (PLAN.md Z11):
   *   1. Floating-button double-tap.
   *   2. Re-tap of the Edit menu item while already in active mode.
   * The third path (post-Confirm reload) is Phase 4.
   */
  /**
   * Single entry point for the three Edit-mode toggle paths (arc-menu
   * ✏️, floating-button double-tap, Shift+N hotkey). Decides direction
   * from the current mode, dispatches to `tryDeactivate` / `setMode`,
   * and emits the matching toast — only after `tryDeactivate` actually
   * succeeded (the dirty-confirm prompt can decline and leave us in
   * active mode, in which case no toast).
   */
  function toggleEditMode() {
    if (mode === 'active') {
      tryDeactivate();
      if (mode === 'idle') {
        showToast('Edit mode off', 'info');
      }
    } else {
      setMode('active');
      showToast('Edit mode on', 'info');
    }
  }

  function tryDeactivate() {
    if (hasPendingChanges()) {
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
   * @param {'edit' | 'confirm'} action
   */
  function handleMenuAction(action) {
    switch (action) {
      case 'edit':
        // Z11 path #2: re-tap while active routes through tryDeactivate
        // (dirty-confirm prompt). Common entry-point shared with the
        // double-tap and Shift+N paths.
        toggleEditMode();
        break;
      case 'confirm':
        // Fire-and-forget — runConfirmFlow is async but the menu click
        // handler doesn't need to wait. Re-entrancy guarded inside.
        runConfirmFlow();
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
    // Ctrl/Cmd+Enter inside the textarea = ✔. Bare Enter still inserts
    // a newline. Esc is handled at document level (handleGlobalHotkeys)
    // so it works whether or not the textarea has focus.
    popoverInputElement.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        handlePopoverAction('confirm');
      }
    });
    inputRow.appendChild(popoverInputElement);

    // Right-side button stack: 👁 (top, hold-to-show debug zones) +
    // ↶ (bottom, per-note undo). Two narrow stacked buttons share the
    // same column width as the old single eye button (44px).
    const sideStack = document.createElement('div');
    sideStack.id = 'dmna-popover-side-stack';

    // 👁 hold-to-show touch-zone debug button. Press-and-hold mirrors
    // the v2.6 affordance (matches user muscle memory for "where do
    // those invisible corner zones really extend?"). Pointer-capture
    // ensures the up event lands on the button even if the user drags
    // off it during the hold.
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.id = 'dmna-popover-eye';
    eyeBtn.className = 'dmna-popover-side-btn';
    eyeBtn.textContent = '👁';
    eyeBtn.setAttribute('aria-label', 'Show touch zones (press and hold)');
    eyeBtn.addEventListener('pointerdown', (e) => {
      if (eyeBtn.disabled) {
        return;
      }
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
    sideStack.appendChild(eyeBtn);

    // ↶ per-note undo (Wave 3.5). Pops the most recent actionLog entry
    // for the active note and reverses it.
    const undoBtn = document.createElement('button');
    undoBtn.type = 'button';
    undoBtn.id = 'dmna-popover-undo';
    undoBtn.className = 'dmna-popover-side-btn';
    undoBtn.textContent = '↶';
    undoBtn.setAttribute('aria-label', 'Undo last change to this note');
    undoBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (activeNoteId) {
        popoverUndo(activeNoteId);
      }
    });
    sideStack.appendChild(undoBtn);

    inputRow.appendChild(sideStack);

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

    // Footer credit line — small muted "{NAME} v{VERSION}" at the
    // bottom-right. Out of the typing/action flow but visible enough
    // for "which version is this?" troubleshooting.
    const credit = document.createElement('div');
    credit.className = 'dmna-popover-credit';
    credit.textContent = `${SCRIPT_NAME} v${SCRIPT_VERSION}`;
    popoverElement.appendChild(credit);

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
    updatePopoverForActiveNote();
    // Pre-position BEFORE reveal. If we add `.show` first the popover
    // renders at its previous transform (or at (0, 0) on first show)
    // for one frame before updatePopoverPosition runs, producing a
    // visible flicker / jump to the box anchor. Setting transform
    // while still display:none means the inline style is in place by
    // the time the show class flips display to block.
    updatePopoverPosition();
    popoverElement.classList.add('show');
  }

  /**
   * Reflects the active note's `isDeleted` state onto the popover's
   * controls. When the note is soft-deleted the popover enters a
   * "view + undo only" mode: textarea + ✔ / ✖ / 🗑 / 👁 are all
   * disabled and ↶ is highlighted as the only live action. Re-enabled
   * when popoverUndo restores the note (`isDeleted` flips back to
   * false).
   */
  function updatePopoverForActiveNote() {
    if (!popoverElement || !activeNoteId) {
      return;
    }
    const note = notes.get(activeNoteId);
    if (!note) {
      return;
    }
    const isDeleted = !!note.isDeleted;
    popoverInputElement.disabled = isDeleted;
    popoverElement.querySelectorAll('.dmna-popover-btn').forEach((b) => {
      /** @type {HTMLButtonElement} */ (b).disabled = isDeleted;
    });
    const eyeBtn = popoverElement.querySelector('#dmna-popover-eye');
    if (eyeBtn instanceof HTMLButtonElement) {
      eyeBtn.disabled = isDeleted;
    }
    const undoBtn = popoverElement.querySelector('#dmna-popover-undo');
    if (undoBtn) {
      undoBtn.classList.toggle('is-highlighted', isDeleted);
    }
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
   * ↶ — Per-note undo (Wave 3.5). Pops the most recent actionLog entry
   * for `noteId` and reverses it:
   *   - 'create'    → hardDeleteNote (the note is un-spawned).
   *   - 'edit'      → restore `prevState` to both `current` and
   *                   `confirmedState`. The note stays selected so the
   *                   user can chain ↶ to step further back.
   *   - 'delete'    → un-soft-delete + restore `current` from prevState.
   *   - 'transform' → restore geometry (x/y/w/h) on `current` only;
   *                   text and confirmedState are intentionally left
   *                   alone (see typedef for the rationale).
   * Shows a toast if there's nothing to undo for this note.
   *
   * Replaces the global Undo arc-menu item that was a Phase 5 stub
   * (Wave 3.5 simplified v3.0 scope to per-note only).
   * @param {string} noteId
   */
  function popoverUndo(noteId) {
    const stack = actionLog.get(noteId);
    if (!stack || stack.length === 0) {
      showToast('Nothing to undo for this note', 'info');
      return;
    }
    const entry = stack.pop();
    if (stack.length === 0) {
      actionLog.delete(noteId);
    }
    if (entry.type === 'create') {
      // hardDeleteNote also wipes this note's stack via actionLog.delete,
      // which is a no-op now that the create entry was popped + the empty
      // stack was cleaned above. Either way, idempotent.
      hardDeleteNote(noteId);
      return;
    }
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    if (entry.type === 'edit') {
      note.current = {...entry.prevState};
      note.confirmedState = {...entry.prevState};
      if (popoverInputElement &&
          popoverInputElement.dataset.boundNoteId === noteId) {
        popoverInputElement.value = entry.prevState.text || '';
      }
      renderNoteBox(noteId);
      updateNoteVisuals(noteId);
      updatePopoverPosition();
    } else if (entry.type === 'delete') {
      note.isDeleted = false;
      // Restore current to the state at delete-time. Defensive: with
      // drag/resize disabled on soft-deleted boxes (and the popover's
      // editing controls all disabled), current shouldn't have drifted
      // — but if a future change ever lets it, this keeps undo
      // deterministic.
      note.current = {...entry.prevState};
      if (popoverInputElement &&
          popoverInputElement.dataset.boundNoteId === noteId) {
        popoverInputElement.value = entry.prevState.text || '';
      }
      renderNoteBox(noteId);
      updateNoteVisuals(noteId);
      // The popover may currently be open and bound to this note (the
      // user re-tapped the red-dashed box, then pressed ↶). Flip its
      // disabled/highlighted state back to "live" since the note is
      // no longer deleted.
      updatePopoverForActiveNote();
      updatePopoverPosition();
    } else if (entry.type === 'transform') {
      // Geometry-only revert: restoring text or confirmedState here
      // would also undo unrelated typing / clobber a prior ✔ that
      // happened before the drag.
      note.current.x = entry.prevState.x;
      note.current.y = entry.prevState.y;
      note.current.w = entry.prevState.w;
      note.current.h = entry.prevState.h;
      renderNoteBox(noteId);
      updateNoteVisuals(noteId);
      updatePopoverPosition();
    }
  }

  /**
   * ✔ — Commit the current geometry and text as the new checkpoint
   * (`confirmedState`). Push an 'edit' action to the log so the
   * popover ↶ button can roll back to the previous checkpoint.
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
   * ✖ — Two cases:
   *   1. Fresh-new note (!isServerNote && !everConfirmed): no prior
   *      checkpoint to revert to, so ✖ behaves like 🗑 next to it —
   *      hard-delete (cancel the creation entirely). Mirrors Esc and
   *      outside-tap dismissal.
   *   2. Confirmed temp / server note: revert `current` to the latest
   *      `confirmedState`. The note stays in the collection — ✖ here
   *      is "discard pending edits," not "delete the note." Use 🗑 to
   *      delete (which on a confirmed note soft-deletes for undo).
   * @param {string} noteId
   */
  function popoverCancel(noteId) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    const isFreshNew = !note.isServerNote && !note.everConfirmed;
    if (isFreshNew) {
      hardDeleteNote(noteId);
      return;
    }
    note.current = {...note.confirmedState};
    renderNoteBox(noteId);
    setActiveNote(null);
  }

  /**
   * 🗑 — Routing depends on whether the note has a state worth keeping
   * around for undo:
   *   - Fresh-new (!isServerNote && !everConfirmed): no committed state
   *     exists — hard-delete (DOM + Map gone, actionLog stripped).
   *   - Confirmed temp OR server note: soft-delete (red dashed, kept in
   *     the collection so the popover ↶ can restore it). Pushes a
   *     'delete' action with the prior `current` as the prevState.
   *     Phase 4 Confirm-time will route soft-deleted server notes to
   *     DELETE and silently drop soft-deleted temps (never persisted).
   * @param {string} noteId
   */
  function popoverDelete(noteId) {
    const note = notes.get(noteId);
    if (!note) {
      return;
    }
    const isFreshNew = !note.isServerNote && !note.everConfirmed;
    if (isFreshNew) {
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
    actionLog.delete(id);
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
      // Soft-deleted notes are view-only until the user undoes the
      // delete via the popover ↶. Block drag/resize so the box can't
      // drift while the popover is in undo-only mode.
      const note = notes.get(noteId);
      if (note && note.isDeleted) {
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
      const note = notes.get(noteId);
      // Soft-deleted notes: still selectable (so the user can reach the
      // popover ↶) but not draggable. Activate without starting a drag
      // so a tap on a red-dashed box opens the undo-only popover.
      if (note && note.isDeleted) {
        if (activeNoteId !== noteId) {
          setActiveNote(noteId);
        }
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
      // Hide the SE corner triangle for the same reason — the resize
      // affordance is irrelevant once the gesture is in progress and
      // would otherwise sit on top of the art the user is repositioning
      // the box against.
      if (note.domElement) {
        note.domElement.classList.add('is-interacting');
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
      // Record the gesture as a 'transform' entry so the popover ↶ can
      // roll the box back to its pre-gesture geometry. Captured at
      // gesture end (rather than on the first frame past the threshold)
      // so a single push covers the whole drag — chained ↶ presses then
      // step back through individual gestures, not individual frames.
      pushAction(dragState.noteId, 'transform', {...dragState.startState});

      // Only reset opacity if we actually dimmed (matches the
      // movement-gated dim in onInteractionMove). Pure-tap gestures
      // never touch popover opacity.
      if (popoverElement) {
        popoverElement.style.opacity = '';
      }
      // Restore the SE corner triangle (set in onInteractionMove's
      // first-movement branch).
      const note = notes.get(dragState.noteId);
      if (note && note.domElement) {
        note.domElement.classList.remove('is-interacting');
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
   * Optional `cachedRect` lets the caller pass a pre-computed image
   * display rect (e.g., from a per-frame snapshot in
   * `updateAllNoteBoxPositions`) so a batch render of N notes does
   * one `getBoundingClientRect()` instead of N — avoids layout thrash
   * when style writes interleave with layout reads (Phase 6 audit).
   *
   * @param {NoteState} state
   * @param {{left: number, top: number, width: number, height: number}=} cachedRect
   * @return {?{left: number, top: number, width: number, height: number}}
   */
  function imageToScreenRect(state, cachedRect) {
    const rect = cachedRect || getImageDisplayRect();
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
   * Fetches the post's current `tag_string`. Used by the tag modal
   * (Phase 4 D9) to seed initial toggle state — a TAG_OPTIONS entry
   * already present on the post starts out checked, so the user is
   * computing a delta against the live state at modal-open time.
   *
   * Not cached: notes the user took a few minutes ago shouldn't pin
   * a stale tag set, and the request is small (`?only=tag_string`).
   *
   * @return {Promise<string>}
   */
  function fetchPostTagString() {
    const id = getPostId();
    if (!id) {
      return Promise.reject(new Error('No post id in URL'));
    }
    return fetch(
        `/posts/${id}.json?only=tag_string`,
        {credentials: 'same-origin'})
        .then((r) => {
          if (!r.ok) {
            throw new Error(`HTTP ${r.status}`);
          }
          return r.json();
        })
        .then((data) => String(data.tag_string || ''));
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
   * Spawns a default-sized box centered at the given client coords.
   * Shared by `handleImageClick` (browser click event) and
   * `onImageDragPointerUp` (synthesized tap when pointerdown was
   * preventDefault'd, suppressing the click chain). Resolves to the
   * new note id, or null if the spawn was a no-op (image not visible
   * / dimensions unavailable / cancelled while waiting on metadata).
   *
   * Async because of the C1 race fix: when fired during the
   * setMode('active') → enterActiveMode metadata-fetch window, the
   * function awaits `postMetaPromise` rather than dropping the user's
   * tap with an "Image dimensions unknown" toast. Callers fire-and-
   * forget; the return value isn't used in production, only the
   * `__dmna3` debug surface inspects it.
   *
   * The textarea autofocus uses requestAnimationFrame so the popover's
   * `.show` flip + layout settles before `.focus()` runs (pre-flip the
   * popover is `display: none`, which would no-op the focus). The
   * `activeNoteId === id` guard handles the unlikely case where the
   * user dismissed the popover within the same frame.
   * @param {number} clientX
   * @param {number} clientY
   * @return {Promise<?string>}
   */
  async function spawnDefaultBoxAtClient(clientX, clientY) {
    if (!postOriginalWidth || !postOriginalHeight) {
      // Race window: setMode('active') flips the mode + body class
      // synchronously, but enterActiveMode's metadata fetch is async.
      // A click in the gap (1–3s on slow cellular) used to surface
      // "Image dimensions unknown" — instead, wait for the in-flight
      // promise so the user's intent isn't dropped (Phase 6 audit C1).
      if (postMetaPromise) {
        try {
          await postMetaPromise;
        } catch (err) {
          showToast('⚠️ Failed to load image info', 'error', err);
          return null;
        }
        // While we awaited, the user could have left active mode or
        // selected another box. Silently bail in those cases — they're
        // not "errors," they're cancelled intent.
        if (mode !== 'active' || activeNoteId !== null) {
          return null;
        }
      }
      if (!postOriginalWidth || !postOriginalHeight) {
        showToast('⚠️ Image info unavailable — refresh the page', 'error');
        return null;
      }
    }
    const rect = getImageDisplayRect();
    if (!rect) {
      showToast('⚠️ Image not on screen', 'warning');
      return null;
    }
    const shortSide = Math.min(rect.width, rect.height);
    const sizeDisplay = Math.max(MIN_INITIAL_SIZE,
        Math.min(MAX_INITIAL_SIZE, shortSide * INITIAL_SIZE_RATIO));

    const pageX = clientX + window.pageXOffset;
    const pageY = clientY + window.pageYOffset;
    let leftDisplay = pageX - (sizeDisplay / 2);
    let topDisplay = pageY - (sizeDisplay / 2);

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
      showToast('⚠️ Image not on screen', 'warning');
      return null;
    }
    const id = createTempNote({
      x: imgState.x,
      y: imgState.y,
      w: imgState.w,
      h: imgState.h,
      text: '',
    });
    setActiveNote(id);
    requestAnimationFrame(() => {
      if (popoverInputElement && activeNoteId === id) {
        popoverInputElement.focus();
      }
    });
    return id;
  }

  /**
   * Click handler for the post image. In active mode, an empty-area
   * click spawns a default-sized box centered on the click and activates
   * it. Idle-mode clicks are no-ops (the body class also makes this a
   * dead path visually).
   *
   * Note: PC mouse paths route through `onImageDragPointer*` instead —
   * those preventDefault on pointerdown to suppress Danbooru's native
   * mousedown handler, which also kills the click event chain. So this
   * handler typically only runs for touch taps and as a safety net for
   * spurious clicks (e.g., when activeNoteId guard early-returns from
   * pointerdown without preventDefault, the click then dismisses).
   * @param {MouseEvent} e
   */
  function handleImageClick(e) {
    if (mode !== 'active') {
      return;
    }
    // Safety net for PC drag-to-create: if a click somehow leaks through
    // despite our pointerdown preventDefault (Safari quirks etc.), the
    // suppress flag set in pointerup consumes it.
    if (suppressNextImageClick) {
      suppressNextImageClick = false;
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
    spawnDefaultBoxAtClient(e.clientX, e.clientY);
  }

  /**
   * Clamps a page coord to a rect. Inline because the call sites only
   * need it twice (start and current).
   * @param {number} v
   * @param {number} lo
   * @param {number} hi
   * @return {number}
   */
  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  /**
   * @return {?{left: number, top: number, width: number, height: number}}
   *     Drag rect in page coords (clamped to the snapshotted image rect),
   *     or null if `dragCreate` isn't active.
   * @param {number} curX
   * @param {number} curY
   */
  function computeDragRect(curX, curY) {
    if (!dragCreate) {
      return null;
    }
    const r = dragCreate.imageRect;
    const x1 = clamp(dragCreate.startX, r.left, r.left + r.width);
    const y1 = clamp(dragCreate.startY, r.top, r.top + r.height);
    const x2 = clamp(curX, r.left, r.left + r.width);
    const y2 = clamp(curY, r.top, r.top + r.height);
    return {
      left: Math.min(x1, x2),
      top: Math.min(y1, y2),
      width: Math.abs(x2 - x1),
      height: Math.abs(y2 - y1),
    };
  }

  /**
   * pointerdown on the image (PC mouse only). Snapshots the start coord +
   * current image display rect, then attaches doc-level move/up/cancel
   * listeners. Touch path falls through unchanged — mobile users keep
   * tap-to-create via the `click` event chain.
   *
   * Critical: `preventDefault()` here suppresses the compatibility mouse
   * events (mousedown/mousemove/mouseup/click) for the rest of the
   * gesture. That kills Danbooru's native mousedown handler on
   * `#image-container` (drag-to-create-note + `.hide-notes` toggle)
   * regardless of which propagation phase it's bound on — the existing
   * capture-phase blocker can be bypassed if Danbooru registers in
   * capture phase too. Suppressing the click chain also means we have
   * to simulate the tap-to-create path ourselves on pointerup.
   *
   * Guards mirror `handleImageClick`: only fires in active mode with no
   * box currently active. With a box active, we early-return WITHOUT
   * preventDefault — the trailing click then reaches `handleImageClick`
   * and runs the dismiss path.
   * @param {PointerEvent} e
   */
  function onImageDragPointerDown(e) {
    if (e.pointerType !== 'mouse' || e.button !== 0) {
      return;
    }
    if (mode !== 'active' || activeNoteId !== null) {
      return;
    }
    if (!postOriginalWidth || !postOriginalHeight) {
      return;
    }
    const rect = getImageDisplayRect();
    if (!rect) {
      return;
    }
    e.preventDefault();
    dragCreate = {
      startX: e.clientX + window.pageXOffset,
      startY: e.clientY + window.pageYOffset,
      imageRect: rect,
      ghostEl: null,
      moved: false,
    };
    document.addEventListener('pointermove', onImageDragPointerMove);
    document.addEventListener('pointerup', onImageDragPointerUp);
    document.addEventListener('pointercancel', onImageDragPointerCancel);
  }

  /**
   * pointermove during drag-to-create. Lazily creates the ghost element
   * once movement crosses DRAG_THRESHOLD_PX, then keeps its rect synced
   * with the current pointer position (clamped to the image).
   * @param {PointerEvent} e
   */
  function onImageDragPointerMove(e) {
    if (!dragCreate) {
      return;
    }
    const x = e.clientX + window.pageXOffset;
    const y = e.clientY + window.pageYOffset;
    if (!dragCreate.moved) {
      const dist = Math.hypot(x - dragCreate.startX, y - dragCreate.startY);
      if (dist < DRAG_THRESHOLD_PX) {
        return;
      }
      dragCreate.moved = true;
      const ghost = document.createElement('div');
      ghost.id = 'dmna-drag-ghost';
      document.body.appendChild(ghost);
      dragCreate.ghostEl = ghost;
    }
    const rect = computeDragRect(x, y);
    if (rect && dragCreate.ghostEl) {
      dragCreate.ghostEl.style.left = `${rect.left}px`;
      dragCreate.ghostEl.style.top = `${rect.top}px`;
      dragCreate.ghostEl.style.width = `${rect.width}px`;
      dragCreate.ghostEl.style.height = `${rect.height}px`;
    }
  }

  /**
   * pointerup ending a drag-to-create gesture. Owns BOTH paths because
   * pointerdown's preventDefault killed the click chain:
   *   - Drag (moved past threshold AND rect ≥ MIN_BOX_SIZE_DISPLAY) →
   *     create temp note from drag rect.
   *   - Tap (no movement) or sub-min drag → spawn a default-sized box
   *     at the release point, mirroring `handleImageClick`'s tap path.
   *
   * `suppressNextImageClick` is set as a safety net in case some browser
   * quirk leaks the click through despite preventDefault.
   * @param {PointerEvent} e
   */
  function onImageDragPointerUp(e) {
    if (!dragCreate) {
      return;
    }
    const moved = dragCreate.moved;
    let finalRect = null;
    if (moved) {
      const x = e.clientX + window.pageXOffset;
      const y = e.clientY + window.pageYOffset;
      finalRect = computeDragRect(x, y);
    }
    cleanupDragCreate();
    suppressNextImageClick = true;

    const usableDrag = moved && finalRect &&
        finalRect.width >= MIN_BOX_SIZE_DISPLAY &&
        finalRect.height >= MIN_BOX_SIZE_DISPLAY;
    if (usableDrag) {
      const imgState = screenToImageRect(finalRect);
      if (!imgState) {
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
      requestAnimationFrame(() => {
        if (popoverInputElement && activeNoteId === id) {
          popoverInputElement.focus();
        }
      });
      return;
    }
    // Tap / sub-min drag → default-size box at release point (the click
    // event won't fire because pointerdown was preventDefault'd).
    spawnDefaultBoxAtClient(e.clientX, e.clientY);
  }

  /** pointercancel during drag-to-create — drop the in-flight drag. */
  function onImageDragPointerCancel() {
    cleanupDragCreate();
  }

  /** Removes ghost element + listeners + state. Idempotent. */
  function cleanupDragCreate() {
    if (dragCreate && dragCreate.ghostEl) {
      dragCreate.ghostEl.remove();
    }
    dragCreate = null;
    document.removeEventListener('pointermove', onImageDragPointerMove);
    document.removeEventListener('pointerup', onImageDragPointerUp);
    document.removeEventListener('pointercancel', onImageDragPointerCancel);
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
    // PC drag-to-create: bubble-phase pointerdown — capture-phase
    // `blockNativeIfActive` below already stopped propagation upward
    // so Danbooru's notes.js never sees it; our listener on the same
    // element still fires regardless.
    img.addEventListener('pointerdown', onImageDragPointerDown);

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
  // Phase 4 batch send (D10 + D11)
  //
  // Sequential per-call HTTP wiring driven by `classifyChanges()` output.
  // Send order: DELETE → PUT → POST → tag PATCH (D10). Each call is its
  // own try/catch so a single failure doesn't sink the rest — the
  // returned result splits successful vs. failed buckets, and Task 4.4
  // routes from there.
  //
  // CSRF: the post-render <meta name="csrf-token"> carries Rails' CSRF
  // token. Danbooru rejects mutating calls without `X-CSRF-Token`; same
  // pattern v2.6 used.
  //
  // UI lock (D11): `isSending` flag + `body.dmna-sending` CSS class.
  // The floating button shows ⏳, the menu / popover / box pointer-events
  // are gated by CSS, and the keyboard shortcut handler bails on
  // `isSending`. setMode is intentionally not blocked at the function
  // level — Task 4.4's `setMode('idle')` after success runs while
  // `isSending` is still true.
  // --------------------------------------------------------------------------

  /**
   * @return {string} The CSRF token from the page's <meta> tag, or
   *     an empty string. Empty fallback lets requests proceed and
   *     fail with HTTP 422 (which the result object captures), rather
   *     than masking the real diagnostic with a thrown error here.
   */
  function getCsrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]');
    return meta ? (meta.getAttribute('content') || '') : '';
  }

  /**
   * Generic fetch wrapper for our mutating calls. JSON body when present,
   * always includes credentials + CSRF, normalizes empty / non-JSON
   * responses (DELETE returns 204) to `null`.
   * @param {'POST' | 'PUT' | 'DELETE'} method
   * @param {string} url
   * @param {?Object} body
   * @return {Promise<?Object>}
   */
  async function apiCall(method, url, body) {
    const headers = {
      'Accept': 'application/json',
      'X-CSRF-Token': getCsrfToken(),
    };
    /** @type {RequestInit} */
    const opts = {method, credentials: 'same-origin', headers};
    if (body !== undefined && body !== null) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const r = await fetch(url, opts);
    if (!r.ok) {
      // Surface Danbooru's error body when present — 422s typically carry
      // actionable messages (e.g., "Box overlaps existing note", "tag_string
      // can't be blank") that "HTTP 422" alone hides. Best-effort: ignore
      // body-read or JSON-parse failures and fall back to the bare status.
      let detail = '';
      try {
        const errText = await r.text();
        if (errText) {
          try {
            const errJson = JSON.parse(errText);
            detail = errJson.message || errJson.error ||
                (errJson.errors ? JSON.stringify(errJson.errors) : '') ||
                errText;
          } catch (_parseErr) {
            detail = errText;
          }
        }
      } catch (_readErr) {
        // r.text() can throw on aborted/network errors; leave detail empty.
      }
      const head = `HTTP ${r.status} ${r.statusText}`.trim();
      const truncated = detail.length > 200 ?
          detail.slice(0, 197) + '...' : detail;
      throw new Error(truncated ? `${head} — ${truncated}` : head);
    }
    // Empty / 204 responses are fine; only parse when there's a body.
    const text = await r.text();
    return text ? JSON.parse(text) : null;
  }

  /**
   * POST /notes.json — creates a new note. Coords/size are stored as
   * floats locally but the API wants integers, so round at send time.
   * @param {NoteState} state
   * @return {Promise<{id: number} & Record<string, unknown>>}
   */
  async function apiPostNote(state) {
    const postId = Number(getPostId());
    const payload = {
      note: {
        post_id: postId,
        x: Math.round(state.x),
        y: Math.round(state.y),
        width: Math.round(state.w),
        height: Math.round(state.h),
        body: state.text || '',
      },
    };
    return /** @type {any} */ (await apiCall('POST', '/notes.json', payload));
  }

  /**
   * PUT /notes/{id}.json — updates an existing server note.
   * @param {string} serverId
   * @param {NoteState} state
   * @return {Promise<?Object>}
   */
  async function apiPutNote(serverId, state) {
    const payload = {
      note: {
        x: Math.round(state.x),
        y: Math.round(state.y),
        width: Math.round(state.w),
        height: Math.round(state.h),
        body: state.text || '',
      },
    };
    return apiCall('PUT', `/notes/${serverId}.json`, payload);
  }

  /**
   * DELETE /notes/{id}.json — soft-deletes server-side.
   * @param {string} serverId
   * @return {Promise<?Object>}
   */
  async function apiDeleteNote(serverId) {
    return apiCall('DELETE', `/notes/${serverId}.json`, null);
  }

  /**
   * Re-fetches the post's tag_string, applies the user's add/remove
   * delta, and PUTs the updated tag_string back. Re-fetch (vs. using
   * the snapshot from the modal) closes the race where a co-editor
   * changed tags between modal-open and Confirm-submit; the delta is
   * still meaningful (it only adds tags the user wants ON and removes
   * tags they wanted OFF, leaving everything else alone).
   * @param {string[]} tagsToAdd
   * @param {string[]} tagsToRemove
   * @return {Promise<?Object>}
   */
  async function apiPatchPostTags(tagsToAdd, tagsToRemove) {
    const current = await fetchPostTagString();
    const tags = new Set(current.split(/\s+/).filter(Boolean));
    tagsToAdd.forEach((t) => tags.add(t));
    tagsToRemove.forEach((t) => tags.delete(t));
    const newTagString = [...tags].join(' ');
    return apiCall(
        'PUT',
        `/posts/${getPostId()}.json`,
        {post: {tag_string: newTagString}});
  }

  /**
   * Engages the in-flight UI lock: ⏳ icon, body class, menu close.
   * setMode-driven icon swap is paused for the duration — endSendingUI
   * restores from the current `mode`.
   */
  function startSendingUI() {
    isSending = true;
    document.body.classList.add('dmna-sending');
    if (isMenuOpen) {
      closeMenu();
    }
    const btn = document.getElementById('dmna-float-btn');
    if (btn) {
      btn.textContent = '⏳';
    }
  }

  /** Reverses startSendingUI. */
  function endSendingUI() {
    isSending = false;
    document.body.classList.remove('dmna-sending');
    const btn = document.getElementById('dmna-float-btn');
    if (btn) {
      btn.textContent = mode === 'active' ? '✏️' : '📝';
    }
  }

  /**
   * @typedef {Object} SendBatchResult
   * @property {{
   *   posts: Array<{noteId: string, state: NoteState, serverResponse: ?Object}>,
   *   puts: Array<{noteId: string, serverId: string, state: NoteState,
   *                textChanged: boolean}>,
   *   deletes: Array<{noteId: string, serverId: string}>,
   * }} successful
   * @property {{
   *   posts: Array<{noteId: string, state: NoteState, error: string}>,
   *   puts: Array<{noteId: string, serverId: string, state: NoteState,
   *                textChanged: boolean, error: string}>,
   *   deletes: Array<{noteId: string, serverId: string, error: string}>,
   *   tagPatch: ?string
   * }} failed
   */

  /**
   * Sends the classified batch in DELETE → PUT → POST → tag PATCH order.
   * Sequential within each group so a partial failure has a deterministic
   * "which item broke" answer. Tag PATCH is skipped when the delta is
   * empty (pure submit-without-changes).
   *
   * Always engages and releases the UI lock (try/finally); never throws —
   * caller reads the result object. Task 4.4 (`handleMenuAction('confirm')`
   * dispatch) interprets the result.
   *
   * @param {ReturnType<typeof classifyChanges>} classified
   * @param {?{tagsToAdd: string[], tagsToRemove: string[]}} tagDelta
   * @return {Promise<SendBatchResult>}
   */
  async function sendBatch(classified, tagDelta) {
    /** @type {SendBatchResult} */
    const result = {
      successful: {posts: [], puts: [], deletes: []},
      failed: {posts: [], puts: [], deletes: [], tagPatch: null},
    };
    startSendingUI();
    try {
      for (const item of classified.deletes) {
        try {
          await apiDeleteNote(item.serverId);
          result.successful.deletes.push(item);
        } catch (err) {
          // The error modal shows result.failed[...].error (a compact
          // string). Log the full Error here so its stack trace is
          // available in the console for cross-referencing — useful
          // when triaging "what actually went wrong" across multiple
          // partial failures in one batch.
          console.error(
              `[${SCRIPT_NAME}] DELETE note ${item.serverId} failed`, err);
          result.failed.deletes.push({...item, error: String(err.message || err)});
        }
      }
      for (const item of classified.puts) {
        try {
          await apiPutNote(item.serverId, item.state);
          result.successful.puts.push(item);
        } catch (err) {
          console.error(
              `[${SCRIPT_NAME}] PUT note ${item.serverId} failed`, err);
          result.failed.puts.push({...item, error: String(err.message || err)});
        }
      }
      for (const item of classified.posts) {
        try {
          const serverResponse = await apiPostNote(item.state);
          result.successful.posts.push({...item, serverResponse});
        } catch (err) {
          console.error(
              `[${SCRIPT_NAME}] POST temp ${item.noteId} failed`, err);
          result.failed.posts.push({...item, error: String(err.message || err)});
        }
      }
      if (tagDelta &&
          (tagDelta.tagsToAdd.length > 0 || tagDelta.tagsToRemove.length > 0)) {
        try {
          await apiPatchPostTags(tagDelta.tagsToAdd, tagDelta.tagsToRemove);
        } catch (err) {
          console.error(`[${SCRIPT_NAME}] tag PATCH failed`, err);
          result.failed.tagPatch = String(err.message || err);
        }
      }
    } finally {
      endSendingUI();
    }
    return result;
  }

  // --------------------------------------------------------------------------
  // Phase 4 result handling (D12 + D13)
  //
  // sendBatch() returns; this layer interprets the result:
  //
  //   - Apply locally what server-confirmed: temp notes that POSTed
  //     get re-keyed under their server id and reborn as server notes;
  //     PUT'd server notes drop their accumulated dirty/log state;
  //     DELETE'd notes leave the local Map. This is the "no double
  //     send" guarantee — a Retry from the error modal re-runs
  //     classifyChanges and the already-confirmed items are now in
  //     the appropriate "skip" buckets.
  //
  //   - Full success → clear actionLog, toast, brief delay, reload.
  //     The reload is deliberate: Danbooru's native note overlays
  //     come from server data, and a fresh page is the cheapest way
  //     to put them in sync with our just-committed changes.
  //
  //   - Any failure → error modal. User picks Retry (re-classify and
  //     re-send) or Cancel (stay in active mode with the partial
  //     state, which now reflects the server's truth).
  // --------------------------------------------------------------------------

  /**
   * Reflects sendBatch's successful results onto the local notes Map +
   * actionLog. Failed items are left untouched (their actionLog entries
   * are preserved so per-note ↶ keeps working until the user gives up
   * via Cancel).
   * @param {SendBatchResult} result
   */
  function applyServerStateToLocal(result) {
    // POST: temp note becomes a server note. Replace in-place rather
    // than mutate the existing entry, because the noteId itself is
    // changing (temp- → server numeric id) and the closures inside
    // the rendered DOM/handlers were captured against the old id.
    // Cheaper to re-render than to surgery the closures.
    for (const item of result.successful.posts) {
      const sr = item.serverResponse;
      const serverId = sr && sr.id != null ? String(sr.id) : '';
      if (!serverId) {
        continue;
      }
      // Use the server's normalized values (post-clamp / post-round)
      // as the new local baseline rather than the locally-rounded copy
      // we sent. Otherwise a Retry path that follows a sibling failure
      // can mis-classify this note as "dirty" because our sent rect
      // and the server's stored rect differ by a pixel (Phase 6 audit
      // C3). Falls back to item.state for any field the server didn't
      // echo, which keeps the path safe across API shape changes.
      /** @type {NoteState} */
      const baselineState = {
        x: typeof sr.x === 'number' ? sr.x : Math.round(item.state.x),
        y: typeof sr.y === 'number' ? sr.y : Math.round(item.state.y),
        w: typeof sr.width === 'number' ?
            sr.width : Math.round(item.state.w),
        h: typeof sr.height === 'number' ?
            sr.height : Math.round(item.state.h),
        text: typeof sr.body === 'string' ? sr.body : (item.state.text || ''),
      };
      // Drop the temp side first (DOM gone, Map gone, actionLog
      // entries gone). Then add the fresh server-note entry under
      // the new id and render it.
      hardDeleteNote(item.noteId);
      /** @type {Note} */
      const newNote = {
        current: {...baselineState},
        initialState: {...baselineState},
        confirmedState: {...baselineState},
        isDeleted: false,
        isServerNote: true,
        everConfirmed: true,
        domElement: null,
      };
      notes.set(serverId, newNote);
      renderNoteBox(serverId);
    }
    // PUT: the just-sent state is now the server's truth. Reset
    // initialState so the next isDirty/classifyChanges sees a clean
    // baseline. Strip any actionLog history for this note (it can
    // no longer be undone — it's persisted).
    for (const item of result.successful.puts) {
      const note = notes.get(item.noteId);
      if (!note) {
        continue;
      }
      note.initialState = {...note.current};
      note.confirmedState = {...note.current};
      actionLog.delete(item.noteId);
      updateNoteVisuals(item.noteId);
    }
    // DELETE: nuke locally too.
    for (const item of result.successful.deletes) {
      hardDeleteNote(item.noteId);
    }
  }

  /**
   * Builds the human-readable failure list for the error modal.
   * Each line: `<METHOD> <id-or-target>: <error>`. Ordered to match
   * sendBatch's send order (deletes → puts → posts → tagPatch).
   * @param {SendBatchResult} result
   * @return {string[]}
   */
  function buildFailureLines(result) {
    const lines = [];
    for (const f of result.failed.deletes) {
      lines.push(`DELETE note ${f.serverId}: ${f.error}`);
    }
    for (const f of result.failed.puts) {
      lines.push(`PUT note ${f.serverId}: ${f.error}`);
    }
    for (const f of result.failed.posts) {
      lines.push(`POST new note: ${f.error}`);
    }
    if (result.failed.tagPatch) {
      lines.push(`Tag PATCH: ${result.failed.tagPatch}`);
    }
    return lines;
  }

  /**
   * Counts successes + failures across all groups for the modal's
   * summary line.
   * @param {SendBatchResult} result
   * @return {{successCount: number, failureCount: number}}
   */
  function countSendResult(result) {
    const s = result.successful;
    const f = result.failed;
    const successCount =
        s.posts.length + s.puts.length + s.deletes.length;
    const failureCount =
        f.posts.length + f.puts.length + f.deletes.length +
        (f.tagPatch ? 1 : 0);
    return {successCount, failureCount};
  }

  /**
   * Builds the error modal DOM (idempotent). Body content (failure
   * list) is filled in per-open by `openErrorModal`.
   */
  function createErrorModal() {
    if (errorModalElement) {
      return;
    }
    errorModalBackdropElement = document.createElement('div');
    errorModalBackdropElement.id = 'dmna-error-modal-backdrop';
    errorModalBackdropElement.addEventListener('click', () => {
      submitErrorModal('cancel');
    });

    errorModalElement = document.createElement('div');
    errorModalElement.id = 'dmna-error-modal';
    errorModalElement.addEventListener('click', (e) => e.stopPropagation());

    const header = document.createElement('div');
    header.className = 'dmna-error-modal-header';
    header.textContent = 'Confirm — partial failure';
    errorModalElement.appendChild(header);

    const summary = document.createElement('div');
    summary.className = 'dmna-error-modal-summary';
    summary.id = 'dmna-error-modal-summary';
    errorModalElement.appendChild(summary);

    const list = document.createElement('div');
    list.className = 'dmna-error-modal-list';
    list.id = 'dmna-error-modal-list';
    errorModalElement.appendChild(list);

    const buttons = document.createElement('div');
    buttons.id = 'dmna-error-modal-buttons';

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = 'dmna-error-modal-btn';
    retryBtn.dataset.action = 'retry';
    retryBtn.textContent = 'Retry';
    retryBtn.addEventListener('click', () => submitErrorModal('retry'));

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'dmna-error-modal-btn';
    cancelBtn.dataset.action = 'cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => submitErrorModal('cancel'));

    buttons.appendChild(retryBtn);
    buttons.appendChild(cancelBtn);
    errorModalElement.appendChild(buttons);

    document.body.appendChild(errorModalBackdropElement);
    document.body.appendChild(errorModalElement);
  }

  /**
   * Reveals the error modal with the given result's failure list.
   * @param {SendBatchResult} result
   */
  function openErrorModal(result) {
    createErrorModal();
    const {successCount, failureCount} = countSendResult(result);
    const total = successCount + failureCount;
    const summaryEl = errorModalElement.querySelector(
        '#dmna-error-modal-summary');
    if (summaryEl) {
      summaryEl.textContent =
          `${successCount} of ${total} operation(s) succeeded; ` +
          `${failureCount} failed.`;
    }
    const listEl = errorModalElement.querySelector(
        '#dmna-error-modal-list');
    if (listEl) {
      listEl.textContent = '';
      buildFailureLines(result).forEach((line) => {
        const div = document.createElement('div');
        div.className = 'dmna-error-modal-list-item';
        div.textContent = line;
        listEl.appendChild(div);
      });
    }
    document.body.classList.add('dmna-error-modal-open');
    errorModalBackdropElement.classList.add('show');
    errorModalElement.classList.add('show');
    document.addEventListener('keydown', errorModalKeyHandler, true);
  }

  /** Hides the error modal without destroying it. */
  function closeErrorModal() {
    document.body.classList.remove('dmna-error-modal-open');
    if (errorModalBackdropElement) {
      errorModalBackdropElement.classList.remove('show');
    }
    if (errorModalElement) {
      errorModalElement.classList.remove('show');
    }
    document.removeEventListener('keydown', errorModalKeyHandler, true);
  }

  /**
   * Resolves the in-flight `showErrorModal()` promise.
   * @param {'retry' | 'cancel'} choice
   */
  function submitErrorModal(choice) {
    const resolver = pendingErrorModalResolver;
    if (!resolver) {
      return;
    }
    pendingErrorModalResolver = null;
    closeErrorModal();
    resolver(choice);
  }

  /**
   * PC keyboard shortcuts inside the error modal: Esc = Cancel,
   * Ctrl/Cmd+Enter = Retry. Capture-phase + stopPropagation to
   * preempt any other Esc handler that might still be live.
   * @param {KeyboardEvent} e
   */
  function errorModalKeyHandler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      submitErrorModal('cancel');
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      submitErrorModal('retry');
    }
  }

  /**
   * Opens the error modal and waits for the user's choice.
   * @param {SendBatchResult} result
   * @return {Promise<'retry' | 'cancel'>}
   */
  function showErrorModal(result) {
    return new Promise((resolve) => {
      if (pendingErrorModalResolver) {
        const stale = pendingErrorModalResolver;
        pendingErrorModalResolver = null;
        stale('cancel');
      }
      pendingErrorModalResolver = resolve;
      openErrorModal(result);
    });
  }

  /**
   * Post-sendBatch orchestration. Updates local state to mirror what
   * the server confirmed, then either:
   *   - All clear: clears actionLog, toasts, reloads after 1s.
   *   - Any failure: shows the error modal. On Retry, re-classifies
   *     (the just-applied successes are now skip-bucket entries) and
   *     re-sends, recursing through this same handler. On Cancel,
   *     the user is left in active mode with the local state already
   *     mirroring the server's partial-success truth.
   *
   * The retry path passes `tagDelta` along only when the previous
   * attempt's tag PATCH actually failed — if it had succeeded (or
   * wasn't needed), we skip it on retry rather than re-PATCHing
   * a no-op delta.
   *
   * @param {SendBatchResult} result
   * @param {?{tagsToAdd: string[], tagsToRemove: string[]}} tagDelta
   */
  async function handleSendResult(result, tagDelta) {
    applyServerStateToLocal(result);

    const hasFailures =
        result.failed.posts.length > 0 ||
        result.failed.puts.length > 0 ||
        result.failed.deletes.length > 0 ||
        result.failed.tagPatch !== null;

    if (!hasFailures) {
      // Defensive: applyServerStateToLocal stripped per-note entries
      // for committed items, but unchangedServer notes / drift could
      // theoretically still leave entries. Clear the rest — the
      // session is done.
      actionLog.clear();
      showToast('✓ Saved', 'success');
      // Brief pause so the user sees the success toast before the
      // page swaps. setMode('idle') is overkill (reload nukes
      // everything anyway) but keeps state consistent if reload
      // races against something unexpected.
      setTimeout(() => {
        setMode('idle');
        window.location.reload();
      }, 1000);
      return;
    }

    const choice = await showErrorModal(result);
    if (choice !== 'retry') {
      return;
    }

    const newClassified = classifyChanges();
    const retryTagDelta = result.failed.tagPatch ? tagDelta : null;
    if (!newClassified.hasChanges && !retryTagDelta) {
      // Nothing left to retry — this is rare (would mean failures
      // self-resolved between modal and click), but bail cleanly
      // rather than spin sendBatch on an empty payload.
      showToast('Nothing left to retry', 'info');
      return;
    }
    const retryResult = await sendBatch(newClassified, retryTagDelta);
    return handleSendResult(retryResult, retryTagDelta);
  }

  /**
   * Phase 4 entrypoint — orchestrates classify → tag-popover →
   * sendBatch → handleSendResult. Called from `handleMenuAction('confirm')`
   * (the arc menu's ✅ item). Async but the caller doesn't await; the
   * flow runs to completion in its own task.
   *
   * Re-entrancy: the `isSending` guard at the top covers the rare race
   * where a second Confirm click slips through (the floating button is
   * pointer-events:none during send, but defensive). Modal-open phases
   * are guarded by their own backdrops covering the floating button.
   */
  async function runConfirmFlow() {
    if (isSending) {
      return;
    }
    // Close any open popover before showing modals or starting sends —
    // the popover is positioned above boxes but below modals; leaving
    // it open would visually layer awkwardly behind a tag modal, and
    // its textarea stays editable until sendBatch's CSS lock kicks in.
    setActiveNote(null);

    const classified = classifyChanges();
    if (!classified.hasChanges) {
      showToast('No changes to confirm', 'info');
      return;
    }

    /** @type {?{tagsToAdd: string[], tagsToRemove: string[]}} */
    let tagDelta = null;
    if (needsTagPopover(classified)) {
      tagDelta = await showTagPopover();
      if (tagDelta === null) {
        // User canceled the tag modal — abort the entire Confirm
        // flow. State unchanged, user back in active mode.
        return;
      }
    }

    const result = await sendBatch(classified, tagDelta);
    await handleSendResult(result, tagDelta);
  }

  // --------------------------------------------------------------------------
  // Tag Popover (v3.0 Phase 4 D9)
  //
  // Anchored to the LEFT of the floating button (arrow points right),
  // surfaced before sendBatch when the classification triggers it (any
  // create / any delete / any text edit — D9 / `needsTagPopover`). The
  // anchor was moved off the Confirm arc-menu item because the floating
  // button sits near the right viewport edge by default, which made the
  // popover overflow horizontally. Counter-scaled by visualViewport so
  // its visual size stays constant across pinch zoom, like the active-
  // note popover.
  //
  // Toggle interaction rules (per user spec, restored from v2.6):
  //   1. translated ON → all others OFF
  //   2. any non-translated tag ON → translated OFF
  //   3. check_translation OR partially_translated ON → translation_request ON
  //      (and the t_r toggle locks while either of those two is ON)
  //   4. translation_request can be ON independently (rule 3 is one-way)
  //
  // PC ergonomics: Esc = Cancel, Ctrl/Cmd+Enter = Submit. While the
  // popover is open, `body.dmna-tag-popover-open` makes handleGlobalHotkeys
  // bail out so its Esc / Shift+N don't double-fire.
  // --------------------------------------------------------------------------

  /**
   * Applies the four toggle interaction rules and returns the resulting
   * state. Stateless helper — caller owns `tagPopoverState`.
   * @param {Object<string, boolean>} state
   * @param {string} changedTag
   * @param {boolean} newValue
   * @return {Object<string, boolean>}
   */
  function applyTagConstraints(state, changedTag, newValue) {
    const next = {...state};
    next[changedTag] = newValue;
    if (newValue) {
      // Turning ON.
      if (changedTag === 'translated') {
        // Rule 1: translated is exclusive — all others OFF.
        next.translation_request = false;
        next.check_translation = false;
        next.partially_translated = false;
      } else {
        // Rule 2: any non-translated tag ON → translated OFF.
        next.translated = false;
        // Rule 3: c_t / p_t turning ON forces t_r ON.
        if (changedTag === 'check_translation' ||
            changedTag === 'partially_translated') {
          next.translation_request = true;
        }
      }
    } else {
      // Turning OFF.
      if (changedTag === 'translation_request' &&
          (next.check_translation || next.partially_translated)) {
        // Rule 3 lock: t_r can't go OFF while c_t or p_t is ON.
        next.translation_request = true;
      }
      // Other tags: just turn off, no implications. Rule 4 — turning
      // c_t/p_t off doesn't force t_r off (it stays ON unless the user
      // explicitly turns it off later).
    }
    return next;
  }

  /**
   * Whether a toggle should be `disabled` (visually + non-interactive).
   * Currently only translation_request locks (rule 3); the other three
   * are always toggleable.
   * @param {Object<string, boolean>} state
   * @param {string} tag
   * @return {boolean}
   */
  function isTagToggleDisabled(state, tag) {
    if (tag === 'translation_request') {
      return state.check_translation || state.partially_translated;
    }
    return false;
  }

  /**
   * Re-applies `tagPopoverState` to each toggle's class + disabled
   * attribute. Called after every click and on initial open.
   */
  function renderTagToggles() {
    if (!tagPopoverElement || !tagPopoverState) {
      return;
    }
    TAG_OPTIONS.forEach((tag) => {
      const btn = tagPopoverElement.querySelector(
          `button.dmna-tag-toggle[data-tag="${tag}"]`);
      if (!(btn instanceof HTMLButtonElement)) {
        return;
      }
      btn.classList.toggle('is-on', !!tagPopoverState[tag]);
      btn.disabled = isTagToggleDisabled(tagPopoverState, tag);
    });
  }

  /**
   * Builds the tag popover DOM (idempotent). Toggle click handlers run
   * `applyTagConstraints` and re-render. Submit/Cancel call
   * `submitTagPopover`.
   */
  function createTagPopover() {
    if (tagPopoverElement) {
      return;
    }
    tagPopoverElement = document.createElement('div');
    tagPopoverElement.id = 'dmna-tag-popover';
    // Stop click bubbling so a tap inside the popover doesn't reach
    // the document-level outside-click handlers (defensive — none of
    // ours fire in this state, but the active-note popover's pattern
    // is the same).
    tagPopoverElement.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    const arrow = document.createElement('div');
    arrow.id = 'dmna-tag-popover-arrow';
    tagPopoverElement.appendChild(arrow);

    const header = document.createElement('div');
    header.className = 'dmna-tag-popover-header';
    header.textContent = 'Translation tags';
    tagPopoverElement.appendChild(header);

    const list = document.createElement('div');
    list.id = 'dmna-tag-popover-toggles';
    TAG_OPTIONS.forEach((tag) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'dmna-tag-toggle';
      btn.dataset.tag = tag;

      const label = document.createElement('span');
      label.className = 'dmna-tag-label';
      label.textContent = TAG_LABELS[tag];
      btn.appendChild(label);

      const sw = document.createElement('span');
      sw.className = 'dmna-tag-switch';
      const thumb = document.createElement('span');
      thumb.className = 'dmna-tag-switch-thumb';
      sw.appendChild(thumb);
      btn.appendChild(sw);

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (btn.disabled || !tagPopoverState) {
          return;
        }
        const currentlyOn = !!tagPopoverState[tag];
        tagPopoverState = applyTagConstraints(
            tagPopoverState, tag, !currentlyOn);
        renderTagToggles();
      });
      list.appendChild(btn);
    });
    tagPopoverElement.appendChild(list);

    const buttons = document.createElement('div');
    buttons.id = 'dmna-tag-popover-buttons';
    // Danbooru convention: primary action (Submit) before Cancel
    // (`reference_danbooru_dialog_button_order`).
    const submitBtn = document.createElement('button');
    submitBtn.type = 'button';
    submitBtn.className = 'dmna-tag-popover-btn';
    submitBtn.dataset.action = 'submit';
    submitBtn.textContent = 'Submit';
    submitBtn.addEventListener('click', () => submitTagPopover(false));

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'dmna-tag-popover-btn';
    cancelBtn.dataset.action = 'cancel';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => submitTagPopover(true));

    buttons.appendChild(submitBtn);
    buttons.appendChild(cancelBtn);
    tagPopoverElement.appendChild(buttons);

    document.body.appendChild(tagPopoverElement);
  }

  /**
   * Reveals the tag popover with the given initial-on tags. Pre-positions
   * with `visibility: hidden` so the user never sees a one-frame flash
   * at the popover's stale transform (same trick the active-note popover
   * uses on first show).
   * @param {Set<string>} initialTags
   */
  function openTagPopover(initialTags) {
    createTagPopover();
    tagPopoverInitialTags = initialTags;
    /** @type {Object<string, boolean>} */
    const initState = {};
    TAG_OPTIONS.forEach((t) => {
      initState[t] = initialTags.has(t);
    });
    // Self-heal a rule-3 violation in the loaded state: if c_t or p_t
    // is ON but t_r is OFF (e.g., another editor stripped t_r), pull
    // t_r back ON. The user sees it locked-on; submitting then adds
    // t_r to the server tag_string.
    if (initState.check_translation || initState.partially_translated) {
      initState.translation_request = true;
    }
    tagPopoverState = initState;
    renderTagToggles();
    document.body.classList.add('dmna-tag-popover-open');
    // Pre-position trick: render hidden, measure, position, then reveal.
    tagPopoverElement.style.visibility = 'hidden';
    tagPopoverElement.classList.add('show');
    updateTagPopoverPosition();
    tagPopoverElement.style.visibility = '';
    document.addEventListener('keydown', tagPopoverKeyHandler, true);
  }

  /**
   * Hides the tag popover without destroying it. Keeps the singleton
   * for the next Confirm.
   */
  function closeTagPopover() {
    document.body.classList.remove('dmna-tag-popover-open');
    if (tagPopoverElement) {
      tagPopoverElement.classList.remove('show');
    }
    document.removeEventListener('keydown', tagPopoverKeyHandler, true);
    tagPopoverInitialTags = null;
    tagPopoverState = null;
  }

  /**
   * Re-projects the tag popover to the LEFT of the floating button,
   * with its bottom edge aligned to the button's bottom edge so the
   * popover extends UPWARD. The arrow (CSS-positioned at popover's
   * bottom-right with bottom:12px) lines up with the button's vertical
   * center. Called on open and every visualViewport change so the
   * popover follows the floating button under pinch zoom / scroll.
   *
   * Bottom-anchoring (vs. vertical-centering on the button) is what
   * keeps the popover's Submit/Cancel row visible: with the floating
   * button typically near the bottom of the viewport, a centered
   * popover overflows below the fold.
   */
  function updateTagPopoverPosition() {
    if (!tagPopoverElement) {
      return;
    }
    const vv = window.visualViewport;
    const scale = vv ? vv.scale : 1;
    const invScale = 1 / scale;
    const vvWidth = vv ? vv.width : window.innerWidth;
    const vvHeight = vv ? vv.height : window.innerHeight;
    const vvPageLeft = vv ? vv.pageLeft : window.pageXOffset;
    const vvPageTop = vv ? vv.pageTop : window.pageYOffset;

    // Floating button center in viewport CSS pixels (counter-scaled).
    const btnCenterX = vvWidth -
        (userBtnMarginX + (BTN_SIZE / 2)) * invScale;
    const btnCenterY = vvHeight -
        (userBtnMarginY + (BTN_SIZE / 2)) * invScale;

    // Horizontal: arrow tip sits TAG_POPOVER_GAP visual pixels left of
    // the floating button's left edge. Popover extends left from there.
    // Vertical: popover bottom = button bottom; popover extends up.
    const btnVisualHalf = (BTN_SIZE / 2) * invScale;
    const arrowW = 8;        // CSS px (intrinsic, scaled by invScale visually)
    const popW = TAG_POPOVER_WIDTH;
    const popH = tagPopoverElement.offsetHeight;
    const arrowTipX = btnCenterX - btnVisualHalf - TAG_POPOVER_GAP * invScale;
    const popoverRightX = arrowTipX - arrowW * invScale;
    const popoverLeftX = popoverRightX - popW * invScale;
    const popoverBottomY = btnCenterY + btnVisualHalf;
    const popoverTopY = popoverBottomY - popH * invScale;

    // transform-origin is 0 0; convert viewport coords to page coords.
    const tx = vvPageLeft + popoverLeftX;
    const ty = vvPageTop + popoverTopY;
    tagPopoverElement.style.transform =
        `translate(${tx}px, ${ty}px) scale(${invScale})`;
  }

  /**
   * Resolves the in-flight `showTagPopover()` promise:
   *   - canceled=true  → null (caller aborts the Confirm flow)
   *   - canceled=false → {tagsToAdd, tagsToRemove} delta.
   * @param {boolean} canceled
   */
  function submitTagPopover(canceled) {
    const resolver = pendingTagPopoverResolver;
    if (!resolver) {
      return;
    }
    if (canceled) {
      pendingTagPopoverResolver = null;
      closeTagPopover();
      resolver(null);
      return;
    }
    const initial = tagPopoverInitialTags || new Set();
    const state = tagPopoverState || {};
    const tagsToAdd = [];
    const tagsToRemove = [];
    TAG_OPTIONS.forEach((tag) => {
      const wasOn = initial.has(tag);
      const isOn = !!state[tag];
      if (isOn && !wasOn) {
        tagsToAdd.push(tag);
      } else if (!isOn && wasOn) {
        tagsToRemove.push(tag);
      }
    });
    pendingTagPopoverResolver = null;
    closeTagPopover();
    resolver({tagsToAdd, tagsToRemove});
  }

  /**
   * PC keyboard shortcuts inside the tag popover. Capture-phase so it
   * preempts any other Esc handler.
   * @param {KeyboardEvent} e
   */
  function tagPopoverKeyHandler(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      submitTagPopover(true);
    } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      submitTagPopover(false);
    }
  }

  /**
   * Phase 4 D9 entry point: fetches the post's current tag_string,
   * opens the popover with toggles pre-set per existing tags, waits
   * for the user. Resolves with the add/remove delta on Submit or
   * `null` on Cancel.
   *
   * Tag-string fetch failures are non-fatal — the popover opens with
   * all toggles OFF after a toast. tagsToRemove will be empty in that
   * case (initialTags is empty), so submit can't accidentally strip
   * tags we couldn't see.
   *
   * @return {Promise<?{tagsToAdd: string[], tagsToRemove: string[]}>}
   */
  async function showTagPopover() {
    let tagString = '';
    try {
      tagString = await fetchPostTagString();
    } catch (err) {
      showToast('⚠️ Failed to load post tags', 'error', err);
    }
    const initialTags = new Set(
        tagString.split(/\s+/).filter((t) => TAG_OPTIONS.includes(t)));
    return new Promise((resolve) => {
      // Defensive: if a previous popover somehow stayed open, cancel
      // it before opening a new one.
      if (pendingTagPopoverResolver) {
        const stale = pendingTagPopoverResolver;
        pendingTagPopoverResolver = null;
        stale(null);
      }
      pendingTagPopoverResolver = resolve;
      openTagPopover(initialTags);
    });
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
    hasPending() {
      return hasPendingChanges();
    },

    /** @return {ReturnType<typeof classifyChanges>} Phase 4 D8 buckets. */
    classify() {
      return classifyChanges();
    },

    /** @param {ReturnType<typeof classifyChanges>} c */
    needsTagPopover(c) {
      return needsTagPopover(c);
    },

    /** Opens the Phase 4 D9 tag modal directly. Resolves with the
     *  add/remove delta on Submit, or null on Cancel. */
    showTagPopover() {
      return showTagPopover();
    },

    /** Phase 4 D10 + D11: runs the batch send for the current
     *  classification with no tag delta. Useful for direct console
     *  testing without going through Confirm's UI flow. */
    sendBatch(classified, tagDelta) {
      return sendBatch(
          classified || classifyChanges(),
          tagDelta || null);
    },

    /** @return {boolean} */
    isSending() {
      return isSending;
    },

    /** Phase 4 D12: shows the error modal with a synthetic result.
     *  Useful for styling / interaction testing without forcing real
     *  failures. Resolves with 'retry' or 'cancel'.
     *  @param {SendBatchResult} [result]
     */
    showErrorModal(result) {
      const synthetic = result || {
        successful: {posts: [], puts: [], deletes: []},
        failed: {
          posts: [{noteId: 'temp-fake', state: {}, error: 'HTTP 500'}],
          puts: [],
          deletes: [],
          tagPatch: 'HTTP 503',
        },
      };
      return showErrorModal(synthetic);
    },

    /** Phase 4: applies a sendBatch result locally (POST→server,
     *  PUT→reset baseline, DELETE→remove). For testing the
     *  re-keying logic in isolation. */
    applyServerStateToLocal(result) {
      applyServerStateToLocal(result);
    },

    /** Phase 4 entrypoint — same flow the arc menu's ✅ runs. */
    runConfirmFlow() {
      return runConfirmFlow();
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
