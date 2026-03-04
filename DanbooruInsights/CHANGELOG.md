# Changelog

All notable changes to Danbooru Insights are documented here.

---

## v7.0.0 — TypeScript Migration

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
