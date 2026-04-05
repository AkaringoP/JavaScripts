# Danbooru Insights

**Danbooru Insights** (formerly **Danbooru Grass**) is a comprehensive analytics suite for Danbooru users and tags. It injects GitHub-style contribution graphs and advanced dashboards directly into profile and wiki pages.

The script consists of three main components:
* **GrassApp**: Visualizes user contributions (Uploads, Approvals, Notes) on a GitHub-like calendar heatmap with support for hourly activity analysis, 12 themes, and selectable grass color palettes.
* **UserAnalyticsApp**: Provides deep insights into a user's posting habits, including milestones, tag usage, tag cloud, created tags discovery, post scores, and extensive distribution charts.
* **TagAnalyticsApp**: A specialized dashboard for Artist, Copyright, and Character tags. It analyzes extensive data including historical trends, popular posts, active uploaders/approvers, and milestones for any specific tag.

## Examples
#### GrassApp
<img width="1365" height="404" alt="GrassApp" src="https://github.com/user-attachments/assets/a4c0bf04-0adf-4ebc-92c6-7123a693e237" />

#### UserAnalyticsApp
<img width="706" height="500" alt="UserAnalyticsApp 1" src="https://github.com/user-attachments/assets/30116ec5-497a-471e-bff5-9fb9a48baa41" />
<img width="706" height="525" alt="UserAnalyticsApp 2" src="https://github.com/user-attachments/assets/9ce42888-1f12-4b15-90bf-be2809d1b5b5" />

#### TagAnalyticsApp
<img width="608" height="685" alt="TagAnalyticsApp 1" src="https://github.com/user-attachments/assets/981b57c3-bb01-423b-927c-8a5f5a17d55b" />
<img width="564" height="551" alt="TagAnalyticsApp 2" src="https://github.com/user-attachments/assets/a66065f8-87cc-4d3e-9772-953ee037871e" />

## Features (v8.0)

### New Widgets
* **Tag Cloud**: d3-cloud word cloud showing user's most characteristic tags. 4 category tabs (General/Artist/Copyright/Character), log-scale font sizing, crossfade transitions.
* **Created Tags**: Discovers general tags created by the user via NNTBot forum reports. Shows status (Active/Aliased/Deprecated/Empty) with lazy loading.

### Pie Chart (11 Tabs)
* Copyright, Character, Fav Copyright, Status, Rating, Commentary, Translation, Gender, Breast Size, Hair Length, Hair Color.

### Theme System (12 Themes)
* **Light**: Light, Solarized Light, Sakura, Lavender, Ice, Aurora
* **Dark**: Midnight, Solarized Dark, Newspaper, Ocean, Monokai, Ember
* **Grass Color Picker**: 4 selectable grass palettes per theme (48 total), inspired by d3-scale-chromatic.

### Scatter Plot
* Drag range display with date, score/tag count, and post count.
* Crosshair cursor for drag indication.

### Milestones
* Auto, Every 1k/2.5k/5k/10k, and Repdigit (111, 222, ..., 11111) options.

### Architecture
* 112 automated tests (Vitest)
* Architecture fitness tests (dependency direction, type safety, rate limit enforcement)
* Git pre-commit hook for build verification

## Version History

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

### v7.0 — TypeScript Migration

* **TypeScript Rewrite**: ~12,000 lines migrated to 13+ TypeScript modules.
* **Build System**: Vite + vite-plugin-monkey, `tsc` type checking.
* **Test Suite**: Automated unit tests with Vitest.

### v6.x — Tag Analytics & Architecture Overhaul

* **TagAnalyticsApp**: Full analytics support for any Tag, Artist, Copyright, or Character.
* **3-Pane Animated Summary Card** with streak duration and dynamic username colors.
* **Performance**: Token Bucket rate limiting (6 req/s).
* **GrassApp**: Resizable/movable layout with per-user IndexedDB storage.

### v5.x — Advanced Analytics

* **Hourly Activity Analysis**: Contribution intensity heatmap by time of day.
* **Advanced Approvals Module**: Exact Post ID tracking with paginated "Detail View".

### v4.x — Analytics Dashboard

* **Rebrand**: Renamed from *Danbooru Grass* to *Danbooru Insights*.
* **Analytics Dashboard**: Tag Distribution, Milestones, Top Posts, Scatter Plot.

### v3.x — Themes & Settings

* Theme customization, contribution thresholds, parallel batch fetching.

### v2.0 — Core Implementation

* Built using `d3.v7` and `cal-heatmap` with `Dexie.js` for local storage.

## Installation

1. Install a UserScript manager like **[Tampermonkey](https://www.tampermonkey.net/)**.
2. **[Click Here to Install](https://github.com/AkaringoP/JavaScripts/raw/build/danbooruinsights.user.js)**
3. Confirm the installation in Tampermonkey.

## Usage

1. Go to any user profile on Danbooru (e.g., `https://danbooru.donmai.us/users/701499`).
2. The **Contribution Graph** will appear automatically above the statistics section.
3. Click the **📊 Button** next to the username to open the **Analytics Dashboard**.
4. In the dashboard, explore stats, charts, tag cloud, created tags, and the scatter plot.
5. Use the **Settings (⚙️)** in the graph header to change themes, grass colors, or thresholds.

## Credits

- **Author**: AkaringoP
- **Co-Author**: Claude Code with VS Code (AI)

## Compatibility

* Tested on Chrome/Edge/Whale with Tampermonkey.
* Requires `d3.v7`, `d3-cloud`, `cal-heatmap`, and `dexie.js` (automatically included via `@require`).
* **Works with all account levels** — every feature operates correctly on basic Member (Blue) accounts. No Gold-only search features (3+ tag queries) are used.
