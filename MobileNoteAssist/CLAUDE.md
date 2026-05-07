# MobileNoteAssist - Claude Instructions

## Overview
A userscript that provides a mobile-friendly note creation tool for Danbooru.
Single file (`MobileNoteAssist.user.js`). `@grant none`.

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

## Key Constraints
- All touch events use `{ passive: false }` to prevent default scrolling
- Coordinates are converted from display to original image dimensions for API submission
- The script handles both `#image` container and `visualViewport` for mobile zoom
- All CSS in a single `STYLES` constant, injected via JS
