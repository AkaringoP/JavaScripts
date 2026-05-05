# Changelog

All notable changes to **Danbooru Mobile Note Assist** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.0.0] - 2026-05-05

### Changed (BREAKING)
- **Workflow paradigm shift**: single-note immediate-save replaced with multi-note batched Confirm. Users now create/edit/delete several boxes in active mode and commit them all at once via the arc menu's ✓ Confirm — instead of each box round-tripping to the server on its own ✔. Rationale: bulk translation work was the dominant use case and per-note saves were 90% network-waiting.
- **Sidebar link removed**. The script entry point is now solely the floating button (and the new `Shift+N` shortcut). The Note Assist: ON/OFF link in the post sidebar is gone — its state was always redundant with the floating button.
- **Tag toggles moved**: translation tag toggles (translated / translation_request / check_translation / partially_translated) are no longer part of the per-note popover. They appear once per Confirm flow in a dedicated tag popover anchored to the Confirm button. Per-note popover only carries the textarea + ✔/✖/🗑/👁 + ↶.
- **`@version` now follows MAJOR.MINOR.PATCH**: `2.6` → `3.0.0`. Previous releases used `MAJOR.MINOR` only.

### Added
- **Arc menu UI**: long-press / tap-and-hold on the floating button opens a 2-item arc (✓ Confirm at -100°, ✏️ Edit at -150°). Replaces the v2.6 single button + sidebar combo.
- **Multi-note active mode**: `notes` Map indexed by id holds both temp (`temp-…`) and server-loaded notes. Boxes color-code by state (green = uncommitted, blue = ✔'d, red dashed = soft-deleted, etc.).
- **Per-note undo (↶)**: each note's popover has its own ↶ button, backed by a `Map<noteId, ActionLogEntry[]>` per-note stack. Undoes 4 action types: `create` (hard-delete), `edit` (revert ✔), `delete` (un-soft-delete), `transform` (geometry only — text/checkpoint preserved).
- **PC drag-to-create**: mouse-only. Drag on the image to draw a custom-size rectangle (with dashed yellow ghost preview); tap stays as default-size spawn. Touch tap behavior unchanged.
- **PC keyboard shortcuts**: `Ctrl/Cmd+Enter` from the textarea = ✔ Confirm box; `Esc` (when popover open) = dismiss with fresh-new=hard-delete / confirmed=revert routing; `Shift+N` (no popover, no input focus) = toggle Edit on/off.
- **iOS-style pill toggle switches** in the tag popover (label + 36×20 track + 16×16 thumb, ON = green track + thumb slides right). Restores v2.6's 4-rule interaction (translated exclusivity, c_t/p_t imply t_r).
- **Per-note popover side-stack**: 👁 (hold to show debug zones) above ↶ (per-note undo).
- **API error body surface**: `apiCall` now extracts `message` / `error` / `errors` from Danbooru's 4xx JSON bodies (or falls back to raw text, truncated to 200 chars). Previously a 422 from "Box overlaps existing note" or "tag_string can't be blank" showed only `HTTP 422` — now shows the actionable detail.
- **Per-type toast messages**: `showToast(msg, type)` accepts `'info' | 'success' | 'warning' | 'error'`. Each type has its own accent border color and auto-dismiss duration (success 1.8s, info 2.5s, warning 3s, error 4.5s). Existing call sites updated with appropriate types.
- **Confirm batch flow**: `classifyChanges` → tag popover (if needed) → `sendBatch` (DELETE → PUT → POST → tag PATCH) → `handleSendResult` (success: clear log + reload; failure: error modal with retry).
- **`Edit mode on/off` toast** on Shift+N keyboard toggle (mode change is otherwise only signaled by the floating button icon flip — the toast is for keyboard-only users).
- **MIN_BOX_SIZE_DISPLAY = 24px** (down from 40px). Allows marking small details like eyes / glyphs.

### Fixed
- **Race fix**: tapping the image during the `setMode('active')` → metadata-fetch window no longer surfaces an "Image dimensions unknown" toast. `spawnDefaultBoxAtClient` now awaits `postMetaPromise` and proceeds when ready (or bails silently if the user changed their mind during the await).
- **POST success local state**: `applyServerStateToLocal` builds the new server-note baseline from the server's normalized response (`x/y/width/height/body`) instead of the locally-rounded values we sent. Prevents phantom-dirty classification on the Retry path after partial sends.
- **Tap-creates-then-cancels regression**: PC drag-to-create's `pointerdown` now `preventDefault()`s, suppressing the entire compatibility mouse event chain (mousedown/mousemove/mouseup/click). This kills Danbooru's native `#image-container` mousedown handler regardless of which propagation phase it's bound on — the previous capture-phase blocker on `<img>` could be bypassed if Danbooru registered in capture phase too. The tap path is then simulated in `pointerup` so click-to-create still works.

### Performance
- `actionLog` data structure: `Array<ActionLogEntry>` → `Map<noteId, ActionLogEntry[]>`. Per-note stack means `popoverUndo` and `hardDeleteNote` are O(1) instead of an O(n) reverse-scan. Wave 3.5's drop of global Undo made the per-note shape natural.
- `updateAllNoteBoxPositions` reads the image rect once and passes it to each `renderNoteBox` call, instead of N notes each calling `getBoundingClientRect()` interleaved with N style writes (which forced N reflows under orientation change at large note counts).

### Removed
- **Single-note infrastructure**: old `boxElement`, single popover DOM, `setupCreationInteraction`, `setupDragAndResize`, `submitNote`, `hideBox`, sidebar link, `STATE_KEY` localStorage, `loadTagsFromDOM`, immediate-save on ✔. All replaced by the multi-note `notes` Map + popover-per-note rendering pipeline.
- **Global Undo (originally planned for Phase 5)**: Wave 3.5 simplified v3.0's scope to per-note ↶ only. The arc menu's third Undo slot was dropped, leaving 2 items (Confirm + Edit). Bulk discard still possible via page refresh.
- **Touch drag-to-create**: was never enabled in v3.0 (would conflict with mobile pinch/pan). Touch users tap to spawn default-size, drag handles to resize. PC drag-to-create is mouse-only.

## [2.6] - 2026-05-03

### Fixed
- `init()` re-binding bug. The `setTimeout(init, 1000)` fallback used to be a no-op even when the first `init()` ran but `#image` wasn't yet in the DOM, leaving image click/drag handlers permanently unbound. The completion flag is now set only after the image binding succeeds, so the fallback can re-attempt.
- Out-of-bounds check now also rejects boxes whose right/bottom edge exceeds the original image size — previously only top-left negative coordinates were caught, so a box dragged past the image edge could be submitted with invalid coordinates.
- Partial save failure handling. `Promise.all` results are now branched per-endpoint: note OK + tag fail, note fail + tag OK, and full failure each get distinct toasts (`⚠️ Note saved, tags failed` / `❌ Note save failed (tags updated)` / `❌ Save failed`). Previously all non-success cases collapsed into a single opaque `Error: Server returned error`.
- `touchcancel` now triggers the same cleanup path as `touchend` in box drag/resize, so an interrupted touch (incoming call, system gesture) no longer leaves global listeners attached.
- `suppressNextClick` flag now auto-releases after 500ms. Previously, if the trailing emulated click never arrived (e.g. focus shift right after drag), the flag would stay set and consume the next valid user click.

### Added
- `contenteditable` element support in `isTextInputElement` — the floating button now also auto-hides while focus is on a contenteditable region (e.g. rich-text editors), matching its behavior for `<input>` / `<textarea>`.
- Image dimension guards in `submitNote` — explicit `⚠️ Image dimensions unknown` / `⚠️ Image not visible` toasts when the original image size or rendered rect is zero, preventing `NaN` coordinates from being POSTed.

### Removed
- Two unreachable `e.target.closest('#dmna-box' | '#dmna-popover' | '#dmna-float-btn')` guards in the image `mousedown` / `click` handlers. Those elements are `<body>` siblings of `#image`, not descendants, so events on them never bubble to the image and the guards never fired.
- Unnecessary inner `const floatBtn = document.getElementById('dmna-float-btn')` shadowing the outer `floatBtn` reference inside `createUI`.

### Changed
- `parseInt(localStorage.getItem(POS_KEY), 10) || DEFAULT_BTN_MARGIN_Y` replaced with an explicit `Number.isFinite` branch. Hardens against a future change to the position clamp that could make `0` a legal saved value (currently impossible due to `Math.max(20, ...)`).

## [2.5] - 2026-04-20

### Fixed
- Tap-creates-then-cancels regression on mobile. A regression introduced in v2.3 (when PC drag support was added) caused the `mousedown` + `mouseup` + emulated `click` sequence to dual-fire: the box was created on `mouseup` and immediately toggled off by the trailing emulated `click`. Symptoms varied by browser (WebKit reproduced it; Chromium hid it). Reported by Fhtagn (Danbooru forum #405141).
- Restored v2.2's simpler responsibility split: `click` owns tap-to-create and tap-to-toggle (both touch and mouse), `mousedown`/`mouseup` handle drag-to-create only, and a new `suppressNextClick` flag consumes the emulated click that trails a successful drag.

### Added
- `DRAG_THRESHOLD_PX` constant (5px) — pointer movement above this counts as a drag, anything below is a tap. Replaces the previously-inline magic number.

### Changed
- GJS style cleanup in the touched call sites (drag/click handlers, eye-button event binding).

## [2.4] - 2026-03-23

### Changed
- Maintenance release. **No user-visible behavior change.**

### Fixed
- Initialization guard prevents the `setTimeout(init, 1000)` fallback from registering duplicate global event listeners when the first `init()` already ran.
- Null check for the floating button in `updateStateUI` (defensive — guards against the button being absent when the sidebar link triggers a state update).

### Added
- `POPOVER_WIDTH` constant — unifies the previously hard-coded popover width into a single source of truth.
- `isTextInputElement` helper — eliminates duplicated tag/type-check logic across the focus/blur auto-hide handlers.

### Removed
- Dead `GM_addStyle` branch (never reachable: `@grant none` makes it unavailable). CSS injection now uses `style.textContent` directly.
- Stray `console.log` left over from development.

### Changed (style)
- Braces on every single-statement `if`/`else` block (GJS 5.4.1 conformance).
- Multi-statement single-line blocks split into separate lines.

## [2.3] - prior to this repo

### Added
- PC drag-to-create support (click and drag on the image to draw a custom-size rectangle, in addition to the existing tap-to-create flow).

> Note: v2.3 and earlier predate this repository's commit history for `MobileNoteAssist/`. The v2.3 entry is reconstructed from the regression context documented in the v2.5 commit message.

## [2.2] - prior to this repo

The last release before PC drag support. Touch tap-to-create was the sole creation gesture; the click-to-toggle invariant was simple and unbroken. v2.5 restores this invariant on top of v2.4's structural cleanups.

[3.0.0]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.6]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.5]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.4]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.3]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.2]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
