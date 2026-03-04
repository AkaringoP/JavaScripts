# Danbooru Insights

**Danbooru Insights** (formerly **Danbooru Grass**) is a comprehensive analytics suite for Danbooru users and tags. It injects GitHub-style contribution graphs and advanced dashboards directly into profile and wiki pages.

The script consists of three main components:
* **GrassApp**: Visualizes user contributions (Uploads, Approvals, Notes) on a GitHub-like calendar heatmap with support for hourly activity analysis and various themes.
* **UserAnalyticsApp**: Provides deep insights into a user's posting habits, including milestones, tag usage, post scores, and rating distributions.
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

## Features (v7.0)

> ⚙️ **Developer Release** — No user-facing changes. Functionally identical to v6.5.2.

* **TypeScript Rewrite**: Migrated the entire codebase (~12,000 lines) from a single JavaScript file to 13 TypeScript modules with full type annotations.
* **Build System**: Introduced Vite + vite-plugin-monkey for bundling and `tsc` for type checking, replacing the hand-edited single file workflow.
* **Test Suite**: Added 55 automated unit tests (Vitest) covering core logic modules (`config`, `settings`, `rate-limiter`, `utils`, `analytics-data-manager`, `main`).
* **Module Architecture**: Codebase is now split into logical units — `config`, `styles`, `types`, `utils`, `core/*`, `ui/*`, and `apps/*`.

## Version History

See [CHANGELOG.md](CHANGELOG.md) for the full version history.

### v6.x — Tag Analytics & Architecture Overhaul

* **TagAnalyticsApp**: Full analytics support for any Tag, Artist, Copyright, or Character.
* **3-Pane Animated Summary Card** with streak duration and dynamic username colors.
* **Performance**: Lazy loading for large tag histories; Token Bucket rate limiting (6 req/s).
* **CSS**: Centralized `GLOBAL_CSS` with `.di-` namespace prefix.
* **GrassApp**: Resizable/movable layout with per-user IndexedDB storage.

### v5.x — Advanced Analytics

* **Hourly Activity Analysis**: Contribution intensity heatmap by time of day.
* **Advanced Approvals Module**: Exact Post ID tracking with paginated "Detail View".
* **Bubble Chart**: Jaccard Similarity analysis for character tags.
* **Performance**: Migrated to `/post_approvals.json` with server-side filtering.

### v4.x — Analytics Dashboard

* **Rebrand**: Renamed from *Danbooru Grass* to *Danbooru Insights*.
* **Analytics Dashboard**: Tag Distribution, Milestones, and Top Posts.
* **Scatter Plot**: Post scores over time with interactive filtering and zoom.

### v3.x — Themes & Settings

* **Advanced Theme Customization**: 6 color themes including gradient options.
* **Settings System**: Custom contribution thresholds and visual editors.
* **Performance**: Parallel batch fetching and optimized rendering.

### v2.0 — Core Implementation

* Built using `d3.v7` and `cal-heatmap` with `Dexie.js` for local storage.

## Installation

1. Install a UserScript manager like **[Tampermonkey](https://www.tampermonkey.net/)**.
2. **[Click Here to Install](https://github.com/AkaringoP/JavaScripts/raw/main/DanbooruInsights/DanbooruInsights.user.js)**
3. Confirm the installation in Tampermonkey.

## Usage

1. Go to any user profile on Danbooru (e.g., `https://danbooru.donmai.us/users/701499`).
2. The **Contribution Graph** will appear automatically above the statistics section.
3. Click the **📊 Button** next to the username to open the **Analytics Dashboard**.
4. In the dashboard, explore stats, charts, and the new **Scatter Plot**.
5. Use the **Settings (⚙️)** in the graph header to change themes or thresholds.

## Credits

- **Author**: AkaringoP
- **Co-Author**: Antigravity (AI)

## Compatibility

* Tested on Chrome/Edge with Tampermonkey.
* Requires `d3.v7`, `cal-heatmap`, and `dexie.js` (automatically included via `@require`).
