# Changelog

All notable changes to Danbooru Insights are documented here.

---

## v9.0.0 — Mobile Support, Scatter Plot Overhaul & Schema Migration

### Mobile Compatibility
- **Fullscreen Modal**: UserAnalyticsApp and TagAnalyticsApp dashboards now fill the viewport on mobile (`100dvh` so the URL bar no longer leaks the page beneath).
- **Responsive Layout**: Pie chart + legend stack vertically; summary cards collapse to one column; top posts, trending thumbnails, scatter plot toggle/filter, and tag analytics header all reflow under 768 px. TagAnalytics rankings switch to a horizontal scroll-snap swipe.
- **Touch Interactions** (2-step pattern: tap → tooltip → action):
  - **CalHeatmap cells**: tap or drag shows tooltip with date + count, tooltip tap navigates to `/posts`.
  - **D3 pie chart**: same 2-step pattern, slice enlarges on touch with viewport-clamped tooltip.
  - **Tag cloud**: 1st tap highlights word + shows tooltip, 2nd tap navigates. Desktop hover suppressed on touch. Invisible stroke widens hit area.
  - **Scatter plot**: drag selection disabled on touch; year tap zoom retained.
  - **Monthly bar chart**: milestone stars no longer navigate (tap-through to bar's month query).
- **Modal Close Behaviors**: Browser back button closes the modal via `history.pushState/popstate` (both apps); X button and Escape route through `history.back()` for state sync. UserAnalyticsApp gains Escape key support (was TagAnalytics-only). TagAnalytics modal restructured so the X button stays sticky during scroll.
- **Milestone cards** in TagAnalytics rebuilt with absolute thumbnail positioning to avoid flex `min-content` overflow on narrow viewports.
- **Tag cloud font size** and SVG `overflow: hidden` tuned for narrow viewports.

### Scatter Plot Enhancements
- **Tag Count mode Y=10 click**: The "10" tick is rendered red bold and is clickable. Clicking it shows a tooltip with two counts (`gentags:<10` / `tagcount:<10`) and deep links to the corresponding `/posts` queries. Points with t < 10 are highlighted in black on hover/active.
- **Score mode downvote filter**: Four mutually-exclusive toggle buttons (`>0`, `>2`, `>5`, `>10`) above the chart. The filter applies to both the rendered points and the drag-selection popover so the count and list always agree.
- **Post hover preview card**: Hovering a post in the scatter popover or the GrassApp approval popover now shows a small floating card with thumbnail, score, fav count, rating, and first artist/copyright/character tag. 100 ms debounce + in-memory cache. Disabled on touch devices.
- **Drag selection persistence**: The selection rectangle stays visible while the popover is open (used to vanish immediately on mouseup) and is hidden on any re-render or popover close.
- **Deleted/banned posts in popover list**: shown as gray dots with a "Deleted" / "Banned" tooltip.
- **Effort scatter mode removed**: The previous attempt at correlating tag effort with score did not surface meaningful insight and was rolled back.

### Milestones
- **Next Milestone Card**: Both UserAnalyticsApp and TagAnalyticsApp now show an extra "next milestone" placeholder card at the end of the milestones grid, with the upcoming milestone label, "X remaining", and a progress bar measured against the previous milestone. Respects the active step selector mode in UserAnalyticsApp.

### Database Schema (v9 → v10)
- **New `user_stats` table**: caches `gentags_lt_10` and `tagcount_lt_10` counts per user with a 24 h expiry, used by the scatter plot Y=10 click feature.
- **`posts` table** gains four new fields: `up_score`, `down_score`, `is_deleted`, `is_banned`. Sync requests now use `only=...,up_score,down_score,is_deleted,is_banned,...` and `score` is stored as `up_score + down_score`.
- **Silent backfill** runs the next time the dashboard opens for any user with cached posts that predate these fields. It uses cursor pagination over `id:>X order:id status:any` so deleted/banned posts are included, fetches only the new fields, and merges them into existing records. Disables the downvote filter buttons with a "updating XX%" indicator until complete.

### GrassApp
- **Width restoration fix**: Long-standing issue where the saved grass width / xOffset was clobbered on every dashboard open. The `renderGraph()` column wrapper used to force `mainContainer.style.width = '100%'` after `applyConstraints()` had already set the px value. Removing those two lines lets `applyConstraints` win, and a `ResizeObserver` re-applies once the wrapper has finished its initial layout pass so a 0-width first frame can no longer clamp the saved width down to 300 px.

### Internal
- **Centralized version constant**: New `src/version.ts` exports `APP_VERSION`, `APP_REPO_URL`, `APP_AUTHOR`. `vite.config.ts` imports the version instead of hardcoding it, so future bumps only touch one file.
- **Dashboard credit footer**: Both apps append a small centered credit line at the bottom of the dashboard with the version (linking to the GitHub repo) and author. Shared via `src/ui/dashboard-footer.ts`.
- **Per-theme grass palette memory**: Grass palette selection is now remembered per theme instead of resetting to default on theme switch. Uses a `grassIndexByTheme` map with legacy `grassIndex` migration.

---

## v8.1.0 — Cross-Tab Rate Coordination

- **TabCoordinator**: Uses `BroadcastChannel` to track active tabs and divides the rate budget (RPS, concurrency) equally among them, preventing 429 errors when the user has multiple Danbooru tabs open.
- **Global 429 Backoff**: On a 429 response, all requests pause for 5 s and the backoff is broadcast to other tabs via TabCoordinator.
- **Single shared RateLimitedFetch** per tab instead of independent instances per app class.
- **Dynamic rate reconfiguration**: `RateLimitedFetch.updateLimits()` for runtime changes and `setBackoff()` for cross-tab backoff propagation.

Closes #5.

---

## v8.0.5 — Skip Error Pages

- **Hotfix**: Detect non-Danbooru pages (nginx 429 / 502) by checking `document.body.classList`. Error pages have a bare `<body>` with no classes, which previously caused `ProfileContext` to misparse the error title as a username.
- `injectGlobalStyles()` is now called after the guard so CSS is not injected on error pages.

---

## v8.0.4 — User History Timeline Discoverability

- **Slim always-visible scrollbar** (8 px) on the User History timeline via `::-webkit-scrollbar` and `scrollbar-width: thin`. Works on Chrome/Firefox where a custom scrollbar style disables overlay auto-hide. Hovering darkens the thumb.
- **Bottom fade gradient** as a fallback for Safari/macOS where overlay scrollbars auto-hide regardless of custom styles. Only shown when the `has-overflow` class is set via JS after measuring `scrollHeight`.

---

## v8.0.3 — Member(Blue) 2-Tag Query Limit Compatibility

- **Fix**: Gender and Translation Untagged count queries used 4–6 tags, exceeding the Member(Blue) 2-tag search limit and failing silently on those accounts.
- Decompose Gender into parallel single-tag fetches (summed) and compute Translation Untagged via inclusion-exclusion over 6 subqueries (all ≤ 2 tags).
- Click navigation URLs are kept aligned with the conceptual count query via `DistributionItem.originalTag`, so Gold+ users see unchanged behavior while Member users get consistent error pages on over-limit categories instead of missing data.

---

## v8.0.2 — Commentary/Translation Pie Chart Click Fix

- **Fix**: Commentary and Translation pie chart click navigation was using the wrong tag for some categories.

---

## v8.0.1 — Firefox Pie Chart Pointer Events Fix

- **Fix**: Firefox breaks SVG pointer events inside CSS 3D-transformed containers (`perspective + rotateX`), making pie chart hover tooltips and click navigation completely non-functional.
- Detect Firefox via `navigator.userAgent` and skip the 3D perspective, `rotateX`, `preserve-3d`, and shadow layer on Firefox. Use a simple `scale(1.05)` hover instead.
- Chrome/Safari/Edge: unchanged (3D tilt effect preserved).

---

## v8.0.0 — New Widgets, Theme System Overhaul & UX Improvements

### New Widgets
- **Tag Cloud**: d3-cloud word cloud visualizing user's most-used tags across 4 categories (General/Artist/Copyright/Character). Log-scale font sizing, crossfade tab transitions, layout caching. General tags selected by Cosine similarity for user-characteristic results.
- **Created Tags**: Discovers general tags created by the user via NNTBot forum report parsing. Auto-detects previous usernames, shows current status (Active/Aliased/Deprecated/Empty) with alias post counts. Lazy-loaded with progress indicator.

### Pie Chart Enhancements
- **Gender Tab**: Girl/Boy/Other/No Humans distribution via OR queries.
- **Commentary Tab**: Commentary/Requested/Untagged distribution.
- **Translation Tab**: Translated/Requested/Untagged distribution.
- **2-Row Tab Layout**: Top row (Copy, Char, Fav_Copy, Status, Rate, Cmnt, Tran), bottom row (Gender, Boobs, Hair_L, Hair_C).
- **Tab Tooltips**: Hover for full name (e.g., "Copy" → "Copyright").
- **Thumbnail Fix**: `enrichThumbnails()` now awaited — thumbnails fully loaded before dashboard opens.

### Theme System
- **3 New Themes**: Lavender (Light), Monokai (Dark), Ember (Dark gradient). Sunset removed.
- **Grass Color Picker**: 4 selectable grass palettes per theme (48 total). Flyout UI appears on theme icon click. d3-scale-chromatic inspired palettes (Viridis, Inferno, Plasma, etc.).
- **Live Preview**: CalHeatmap destroy+repaint on theme/grass change with scroll position preserved.
- **ThemeChanged Event**: Cross-component reactivity for instant color updates.

### Scatter Plot
- **Drag Range Display**: Shows date range, score/tag count range, and post count during drag selection. Dark tooltip above selection box, debounced (50ms).
- **Crosshair Cursor**: Visual indication of drag capability.

### Milestones
- **Repdigit Option**: Milestones at repdigit numbers (11, 111, 222, ..., 9999, 11111+).
- **Every 10k Option**: For large uploaders.

### Architecture & Quality
- **Architecture Fitness Tests** (5): Dependency direction enforcement, `[key: string]: any` ban, raw `fetch()` ban. Found and fixed 2 existing raw fetch violations.
- **Git Pre-commit Hook**: Auto-runs `npm run build` on DanbooruInsights changes.
- **Rate Limit Fix**: `enrichThumbnails` concurrency reduced from 3 to 2 to prevent 429 errors.
- **Settings Popover**: Moved to `document.body` (position:fixed) for correct z-index stacking. Scroll-anchored to settings button.
- **Hourly Panel Sync**: Follows heatmap container position on resize/move.
- **Bug Fix**: `has:comments` → `has:commentary` in TagAnalytics commentary pie chart.

### Stats
- **112 automated tests** (up from 86)
- **12 themes** with 48 grass color options
- **~15,000 lines of TypeScript**

---

## v7.x — Architecture Refinement & Incremental Features

### v7.5.0
- **Pie Chart**: Added Gender, Commentary, Translation tabs. 2-row tab layout. Title tooltips on hover.
- **Scatter Plot**: Drag range display (date + score/tag count + post count), crosshair cursor.
- **Milestones**: Repdigit (111, 222, ...) and Every 10k options.
- **Bug Fix**: TagAnalytics `has:comments` → `has:commentary`.

### v7.4.0
- **Created Tags Widget**: NNTBot forum report parsing to discover tags created by user.
- Auto-detect previous usernames via `user_name_change_requests` API.
- Optimized alias checking: only post_count=0 tags + parallel (concurrency 5).
- Lazy loading with real-time progress indicator.

### v7.3.0
- **Tag Cloud Widget**: d3-cloud word cloud with 4 category tabs (General/Artist/Copyright/Character).
- Log-scale font sizing, crossfade transitions, layout caching.
- General tags selected by Cosine similarity for user-characteristic results.

### v7.2.2
- **Architecture Separation (Phase 5)**: Split monolithic TagAnalyticsApp and UserAnalyticsApp into data/charts/app modules.
- **Type Safety**: Added core interfaces (TagCloudItem, CreatedTagItem, PostRecord, etc.), removed `[key: string]: any` index signatures.
- **Code Cleanup**: Extracted shared utilities, centralized magic numbers, added debug logging to empty catch blocks.
- **Test Coverage**: 86 tests (up from 55).

### v7.0.0

> Developer release — no user-facing changes. Functionally identical to v6.5.2.

- **TypeScript Rewrite**: Migrated the entire codebase (~12,000 lines) from a single JavaScript file to 13 TypeScript modules with full type annotations.
- **Build System**: Introduced Vite + vite-plugin-monkey for bundling and `tsc` for type checking, replacing the hand-edited single file workflow.
- **Test Suite**: Added 55 automated unit tests (Vitest) covering `config`, `settings`, `rate-limiter`, `utils`, `analytics-data-manager`, and `main`.
- **Module Architecture**: Codebase split into `config`, `styles`, `types`, `utils`, `core/*`, `ui/*`, and `apps/*`.

---

## v6.x — Tag Analytics & Architecture Overhaul

### v6.5.2
- **Fix**: Extracted `isTopLevelTag()` as a shared utility, replacing duplicated inline implication-check logic in `TagAnalyticsApp` and `AnalyticsDataManager`.
- **Fix**: Corrected copyright tag filtering to properly exclude sub-tags via `isTopLevelTag()`.

### v6.5
- **3-Pane Animated Summary Card**: Redesigned the Tag Analytics Summary Card — Profile Info, Key Milestones (progress rings), and D3.js Pie Charts with hover states.
- **Streak Duration**: Summary card now calculates and displays the user's maximum contribution streak.
- **Dynamic Username Colors**: Username in Dashboard Header and Ranking Columns is colored by Danbooru level tier.
- **CSS Architecture**: Consolidated all inline `<style>` strings into a single injected `GLOBAL_CSS` stylesheet. Renamed all internal CSS classes with `.di-` namespace prefix.

### v6.4
- **UI**: Removed Bubble Chart for a cleaner dashboard.
- **Performance**: Optimized thumbnail logic to prioritize WebP format; reduced storage/API overhead.
- **Fix**: Corrected monthly chart date range; added random post refresh button; added link button to Recent Popular post.

### v6.3
- **UI**: Refactored pie chart tabs into pill-shaped buttons.
- **Feature**: Added dropdown menu for Most/Recent Popular and Random posts.
- **Performance**: Implemented strict rate limiting (6 req/s) using Token Bucket algorithm.
- **Fix**: Improved thumbnail loading with video support and quality priority.

### v6.2
- **UI**: Dynamic level-tier colors for usernames in ranking lists.
- **Fix**: Corrected hourly uploads distribution rendering.
- **Feature**: Enabled commentary support for small tags; refined dashboard layout.

### v6.1
- **Feature**: Added resizable and movable layout to GrassApp with per-user IndexedDB storage.
- **Fix**: Fixed duplicate data rendering in UserAnalyticsApp during refresh.
- **Compatibility**: Added support for other Danbooru-compatible boorus and subdomains.

### v6.0
- **TagAnalyticsApp**: Full analytics support for any Tag, Artist, Copyright, or Character — historical trends, rankings, and milestones.
- **Enhanced Progress Tracking**: Real-time, descriptive loading indicators replacing generic messages.
- **Unified Architecture**: Single entry point (`main`), shared `Database`, optimized `SettingsManager`.
- **Smart Button Injection**: Improved analytics button injection across all page layouts.

---

## v5.x — Advanced Analytics

### v5.3
- **Approvals Overhaul**: Migrated to `/post_approvals.json` with server-side filtering for a massive speed improvement.
- **Fix**: Fixed critical fetching bugs (missing `creator_id`, empty current-year data).
- **UX**: Improved loading progress indicators; restored click interactions; added GJS-compliant JSDoc.

### v5.2
- **Stability**: Enhanced sync reliability for large datasets.
- **Performance**: Refined thumbnail selection logic.

### v5.1
- **Feature**: Bubble Chart visualizing Jaccard Similarity vs. Frequency for character tags.
- **Feature**: Added Hair Length and Hair Color analysis tabs to Pie Chart.
- **UX**: Improved Pie Chart interactivity (popup overlay, search navigation).
- **Refactor**: Codebase aligned to Google JavaScript Style Guide with JSDoc.

### v5.0
- **Advanced Approvals Tracking**: Tracks exact Post IDs for approval actions with a paginated "Detail View".
- **Hourly Activity Analysis**: Visualizes contribution intensity by hour of day (00:00–23:00) with a dynamic heatmap.

---

## v4.x — Analytics Dashboard

### v4.5
- **Fix**: Resolved new year / January 1st edge cases in GrassApp date calculation.

### v4.4
- **Feature**: Refined Milestone tracking, Monthly Activity chart, and Post Performance analytics.

### v4.2
- Incremental fixes and UX improvements.

### v4.0
- **Rebrand**: Renamed from *Danbooru Grass* to *Danbooru Insights*.
- **Analytics Dashboard**: Comprehensive dashboard with Tag Distribution, Milestones, and Top Posts.
- **Scatter Plot**: Visualized post scores over time with interactive filtering and zoom.
- **Enhanced Sync**: Background processing and progress indicators.
- **UI/UX**: Refined popovers, smart positioning, and improved modal interactions.

---

## v3.x — Themes & Settings

- **Advanced Theme Customization**: 6 color themes including gradient options.
- **Settings System**: Custom contribution thresholds and visual editors.
- **Performance**: Parallel batch fetching and optimized rendering.
- **Robustness**: Improved DOM independence and error handling.

---

## v2.0 — Core Implementation

- **Core Implementation**: Rebuilt using `d3.v7` and `cal-heatmap`.
- **Local Database**: Integrated `Dexie.js` for IndexedDB storage.
