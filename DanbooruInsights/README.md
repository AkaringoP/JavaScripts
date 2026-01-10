# Danbooru Insights

This userscript injects a GitHub-style contribution graph and a comprehensive analytics dashboard into Danbooru profile pages. Formerly known as **Danbooru Grass**, the project has been renamed to **Danbooru Insights** to reflect the addition of advanced analytics features (`AnalyticsApp`). It visualizes your activity (Uploads, Post Approvals, Note Updates) and provides deep insights into your posting habits, offering a clearer view of your contributions to the community.

## Examples
#### GrassApp
<img width="1365" height="404" alt="GrassApp" src="https://github.com/user-attachments/assets/a4c0bf04-0adf-4ebc-92c6-7123a693e237" />

#### AnalyticsApp
<img width="706" height="500" alt="AnalyticsApp 1" src="https://github.com/user-attachments/assets/30116ec5-497a-471e-bff5-9fb9a48baa41" />
<img width="706" height="525" alt="AnalyticsApp 2" src="https://github.com/user-attachments/assets/9ce42888-1f12-4b15-90bf-be2809d1b5b5" />

## Features

* **Hourly Activity Analysis**: New heatmap grid to visualize contribution patterns by time of day (AM/PM).
* **Advanced Approvals Tracking**: Dedicated detail view for approvals, tracking exact post IDs and daily counts.
* **Contribution Visualization**: Draws a calendar heatmap similar to GitHub's contribution graph.
* **Advanced Analytics Dashboard**: A dedicated modal providing detailed stats like total uploads, top posts, and tag distributions.
* **Detailed Post Analysis**: Includes a **Scatter Plot** to visualize post scores over time and a **Monthly Activity** chart.
* **Multiple Metrics**: Supports switching between **Uploads**, **Approvals**, and **Notes**.
* **Per-User Caching**: Data is cached locally using **Dexie.js** to minimize API calls and load times.
* **Interactive Tooltips & Popovers**: detailed information on hover and click for granular data exploration.
* **Search Integration**: Click on a day or graph element to search specifically for relevant posts.
* **Advanced Customization**: Full control over themes (including light/dark presets) and contribution thresholds.

## Version History

### v5.0 (Latest)

* **Hourly Activity Analysis**: Introduced a new **Hourly Summary Grid** that visualizes contribution intensity by time of day (00:00 - 23:00). This provides deep insights into peak activity hours for uploads, approvals, and notes, complete with a dynamic heatmap and legend.
* **Advanced Approvals Module**: Implemented a specialized data fetching and storage engine for **Approvals**. It now tracks exact Post IDs for every approval action, enabling a paginated "Detail View" to browse all approved posts for any specific day.
* **Robust Data Architecture**: Completely refactored the caching layer (`completed_years`, `hourly_stats`) and sync logic. This ensures perfect data consistency across years, robust handling of API limits, and seamless integration of new metrics without affecting legacy data.

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
