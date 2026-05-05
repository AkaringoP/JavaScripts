# Changelog

All notable changes to **Danbooru Mobile Note Assist** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.2] - 2026-05-05

### Fixed
- **Box could shrink to a "dot" with overlapping touch zones.** v3.1.0/3.1.1 set `MIN_BOX_SIZE_DISPLAY = 5`, intending it as a CSS-px floor — but the clamp formula `(MIN / vvScale) / scale` actually produces a **constant device-px** on-screen footprint, not a constant CSS px. So the box could shrink to ~5 device px regardless of pinch zoom, well below the 16 device px threshold where adjacent counter-scaled handle touch zones overlap vertically (top handle's bottom edge meets bottom handle's top edge). User saw the four red debug zones merge into a tiny clump with the box reduced to a single visible dot in the middle.
- Bumped to **24 device px** (16 collision threshold + 8 buffer; also matches v3.0's CSS-px baseline at vv.scale=1). Documented the formula's actual semantics in the constant's jsdoc and the clamp comment — the v3.1.0 phrasing implied CSS-px floor + claimed a 5 device-px collision threshold, both incorrect. The image-space floor still shrinks with pinch zoom (e.g., display:image scale 0.4 → 60 image px at vv=1, 30 at vv=2, 20 at vv=3), preserving v3.1's small-feature-marking workflow without letting the box become invisible.

## [3.1.1] - 2026-05-05

### Fixed
- **SE/SW handle transform-origin** was wrong for the counter-scale system shipped in v3.1.0. The plan assumed each handle's anchor was a CSS keyword corner of the handle element (`top left` for SE, `top right` for SW), but those corners don't coincide with the box's actual bottom-right/bottom-left corners — because SE/SW handles are shifted up by half (`bottom: -16px`), the box's bottom edge passes through the **vertical middle** of those handle elements, not their tops. At small box sizes + high pinch zoom the bug placed the SE/SW anchors NORTH-WEST and NORTH-EAST of the box, so SE collapsed onto NW and SW onto NE — the user saw two visible handles at the top of the box instead of four around it. Fixed by setting SE to `transform-origin: 0% 50%` (left center) and SW to `100% 50%` (right center). NW/NE are unchanged (rewritten to the equivalent `100% 100%` / `0% 100%` percentage form for symmetry).

### Changed
- **SE corner triangle now counter-scales with pinch zoom.** The 8×8 CSS px `::after` resize-affordance was magnified by the visual viewport at high pinch zoom (e.g., 24 device px at vv.scale=3) and could fully cover a small box. Now reads the same `--dmna-handle-scale` CSS variable as the handles, anchored at `100% 100%` (the box's bottom-right corner — which the triangle is drawn FROM via its bottom-left border), so its visual footprint stays a constant ~8 device-px.
- **Handle counter-scale is driven by a CSS custom property** (`--dmna-handle-scale` on the active note element) instead of per-handle inline `style.transform`. One property write per frame instead of four; pseudo-elements like `::after` couldn't be reached from JS otherwise. CSS rule `transform: scale(var(--dmna-handle-scale, 1))` covers all five elements (4 handles + ::after) with a sensible fallback of 1 if JS hasn't run yet.

## [3.1.0] - 2026-05-05

### Added
- **Pinch-zoom counter-scaled corner handles.** Each of the 4 resize/move handles is now scaled by `1 / visualViewport.scale` per active frame, so the handle's visual footprint stays a constant ~32 device-px regardless of pinch zoom. Per-corner `transform-origin` (NW: bottom right, NE: bottom left, SE: top left, SW: top right) glues each handle's box-touching corner — so as the user pinches in, handles collapse TOWARD the box instead of away from it. Their CSS bounding box (and pointer-event hit region) shrinks proportionally, which is what unlocks the lower `MIN_BOX_SIZE_DISPLAY` below. Driven by `updateActiveHandleScales`, called from the existing RAF batch in `updateVisualViewportPositions` and pre-reveal in `showPopover` (same flicker-avoidance pattern as the popover itself).
- **`MIN_DRAG_CREATE_SIZE_DISPLAY = 24px`** constant for PC drag-to-create's "this drag was deliberate" threshold. Decoupled from `MIN_BOX_SIZE_DISPLAY` so lowering the runtime resize floor doesn't make accidental tiny mouse jitters spawn boxes.

### Changed
- **`MIN_BOX_SIZE_DISPLAY`: 24 → 5 (CSS px at vv.scale=1).** User report: small features like single hiragana glyphs in tight word balloons (e.g. post #11304460's lower-right "ちょ") couldn't be marked because the 24px floor was larger than the glyph itself. The pre-3.1 floor was set by the four 32×32 fixed-size handles colliding below ~24 CSS px; now that handles counter-scale with pinch zoom, the collision constraint lives at the device-px level, and the CSS floor can drop. Intended workflow: pinch in over the small feature → drag handles to shrink past 24 CSS px → pinch back out, box stays small. At vv.scale=1 a 5px box is too small to grab — the workflow assumes pinch-zoom, which the resize clamp now reads on every move.
- **Resize clamp accounts for `visualViewport.scale`.** `onInteractionMove`'s `minImg` formula is now `Math.max(MIN_BOX_SIZE_IMG, (MIN_BOX_SIZE_DISPLAY / vvScale) / scale)` — the display floor scales with pinch zoom, image-space safety floor (`MIN_BOX_SIZE_IMG = 8`) unchanged. At vv.scale=1 the math reduces to the v3.0 expression, preserving default behavior.

## [3.0.1] - 2026-05-05

### Changed
- **Floating button hides while a note popover is open.** The button used to remain visible at the bottom-right while a per-note popover was up, which on mobile sits in the same screen region as the popover's ✔/✖/🗑 row. An accidental thumb-tap on the button could open the arc menu and let the user fire ✓ Confirm prematurely. Now `body.dmna-note-popover-open` is toggled in `showPopover` / `hidePopover` and a CSS rule fades the floating button out (`opacity: 0; visibility: hidden; pointer-events: none`) for the duration of the popover. Reuses the existing 0.2s opacity transition.

### Fixed
- **Toasts now flash on every `showToast` call, not just the first.** Previously, calling `showToast` while a previous toast was still on screen replaced the text but left the `.show` class unchanged — same className meant CSS transitions never re-fired. Pressing Shift+Enter for "No changes to confirm" right after another toast (e.g., Shift+N's "Edit mode on") looked like the second event did nothing, because the only visible cue was the silently-replaced text. Fixed by clearing the className + forcing a reflow before re-adding it, so each call runs the opacity / visibility transitions fresh.

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

[3.0.1]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[3.0.0]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.6]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.5]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.4]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.3]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.2]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
