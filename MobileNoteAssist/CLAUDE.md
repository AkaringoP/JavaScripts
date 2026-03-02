# MobileNoteAssist - Claude Instructions

## Overview
A userscript that provides a mobile-friendly note creation tool for Danbooru.
Single file (`MobileNoteAssist.user.js`, ~1,200 lines). `@grant none`.

## How It Works
Adds a floating button to post pages. When enabled, users can tap/drag on the image to create note boxes, then submit notes via the Danbooru API. Includes translation tag management.

## Key Features
- Floating toggle button with drag-to-reposition (stored in localStorage)
- Tap to create default-sized note box, or drag to draw custom size
- Note box drag/resize with boundary constraints (stays within image)
- Translation tag toggles (translated, translation_request, check_translation, partially_translated)
- Visual Viewport API support for pinch-zoom scenarios
- Long-press button to toggle debug zones
- CSRF token handling for Danbooru API submissions

## Code Structure (Sections)
| Section | Line | Content |
|---|---|---|
| Constants & Configuration | ~15 | `STATE_KEY`, `TAG_MAP`, sizing constants |
| `STYLES` | ~109 | All CSS in a single constant |
| UI Helpers | ~283 | `showToast`, `updateVisualViewportPositions` |
| `init()` | ~351 | Main initialization, VisualViewport listeners |
| Tag Logic | ~394 | `loadTagsFromDOM`, `fetchPostData`, toggle states |
| `createUI()` | ~569 | Floating button, sidebar link, popover, keyboard handler |
| Button Interactions | ~702 | Drag-to-reposition, tap-to-toggle logic |
| State Management | ~770 | `toggleState`, `updateStateUI` |
| Creation Interaction | ~811 | Touch/mouse handlers for drawing note boxes |
| Box Management | ~947 | `showBox`, `hideBox`, `updatePopoverPosition` |
| Drag & Resize | ~1008 | Note box manipulation within image bounds |
| `submitNote()` | ~1119 | API submission (note creation + tag updates) |

## Notes
- All touch events use `{ passive: false }` to prevent default scrolling
- Coordinates are converted from display to original image dimensions for API submission
- The script handles both `#image` container and `visualViewport` for mobile zoom
