# Changelog

All notable changes to **Danbooru Mobile Note Assist** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[2.6]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.5]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.4]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.3]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.2]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
