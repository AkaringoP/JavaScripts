# Changelog

All notable changes to **Danbooru Mobile Note Assist** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[2.5]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.4]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.3]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
[2.2]: https://github.com/AkaringoP/JavaScripts/commits/main/MobileNoteAssist
