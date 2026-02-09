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

## Features (v6.0)

* **Tag Analytics (`TagAnalyticsApp`)**: Full analytics support for any Tag, Artist, Copyright, or Character. Analyze historical trends, rankings, and milestones for specific tags.
* **Enhanced Progress Tracking**: Real-time, descriptive loading indicators (e.g., "Analyzing monthly trends...", "Ranking top uploaders...") replacing generic loading messages.
* **Immediate Visibility**: Analytics buttons appear immediately on page load in a "Waiting" state, ensuring accessibility even before data is fully processed.
* **Unified Architecture**: Completely refactored codebase with a single entry point (`main`), shared `Database`, and optimized `SettingsManager`.
* **Smart Button Injection**: Improved logic to inject analytics buttons reliably across various page layouts (Artist, Wiki, Post Lists).
* **Refined User Experience**: Better feedback for invalid tags, automatic cleanup of old cache data, and smoother UI transitions.

## Version History

### v5.x Features

* **Hourly Activity Analysis**: Visualizes contribution intensity by time of day (00:00 - 23:00) with a dynamic heatmap.
* **Advanced Approvals Module**: Tracks exact Post IDs for approval actions with a paginated "Detail View".
* **Core Analytics**: Includes Contribution Calendars, Scatter Plots for post scores, and Monthly Activity charts.
* **Multiple Metrics**: Supports switching between **Uploads**, **Approvals**, and **Notes** with local caching (Dexie.js).
* **Customization**: Full control over themes (light/dark presets), contribution thresholds, and visual settings.
* **Robust Data Architecture**: Refactored caching layer ensuring consistency and performance.

### v4.x

* **Analytics Dashboard**: Added a comprehensive dashboard with Tag Distribution, Milestones, and Top Posts analysis.
* **Scatter Plot**: Visualized post scores over time with interactive filtering and zoom capabilities.
* **Enhanced Sync**: Improved synchronization with background processing and progress indicators.
* **UI/UX**: Refined popovers, smart positioning, and better modal interactions.

### v3.x

* **🎨 Advanced Theme Customization**: 6 Color Themes including Gradient options.
* **⚙️ Settings System**: Custom contribution thresholds and visual editors.
* **🏎️ Performance**: Parallel batch fetching and optimized rendering logic.
* **🛡️ Robustness**: Improved DOM independence and error handling.

### v2.0

* **Core Implementation**: Rebuilt using `d3.v7` and `cal-heatmap`.
* **Local Database**: Integrated `Dexie.js` for storage.

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
