# Danbooru Insights

This userscript injects a GitHub-style contribution graph and a comprehensive analytics dashboard into Danbooru profile pages. Formerly known as **Danbooru Grass**, the project has been renamed to **Danbooru Insights** to reflect the addition of advanced analytics features (`AnalyticsApp`). It visualizes your activity (Uploads, Post Approvals, Note Updates) and provides deep insights into your posting habits, offering a clearer view of your contributions to the community.
<img width="1365" height="404" alt="image" src="https://github.com/user-attachments/assets/a4c0bf04-0adf-4ebc-92c6-7123a693e237" />

## Features

* **Contribution Visualization**: Draws a calendar heatmap similar to GitHub's contribution graph.
* **Advanced Analytics Dashboard**: A dedicated modal providing detailed stats like total uploads, top posts, and tag distributions.
* **Detailed Post Analysis**: Includes a **Scatter Plot** to visualize post scores over time and a **Monthly Activity** chart.
* **Multiple Metrics**: Supports switching between **Uploads**, **Approvals**, and **Notes**.
* **Per-User Caching**: Data is cached locally using **Dexie.js** to minimize API calls and load times.
* **Interactive Tooltips & Popovers**: detailed information on hover and click for granular data exploration.
* **Search Integration**: Click on a day or graph element to search specifically for relevant posts.
* **Advanced Customization**: Full control over themes (including light/dark presets) and contribution thresholds.

## Version History

### v4.0 (Latest)

* **📊 Comprehensive Analytics Dashboard**: Added a new dashboard view accessible via a button next to the username.
  * **Tag Distribution**: Visualizes post breakdown by Rating, Character, and Copyright.
  * **Milestones**: Tracks posting milestones (e.g., 1st, 100th, 1000th upload).
  * **Top Posts**: Highlights your highest-rated content.
* **📈 Scatter Plot Widget**: A powerful tool to visualize the correlation between upload date and post score.
  * **Interactive Filtering**: Filter standard/nsfw ratings dynamically.
  * **Zoom & Select**: Drag to zoom into specific time ranges or score brackets.
* **🔄 Enhanced Data Sync**: Improved synchronization logic with progress indicators and background processing.
* **✨ UI/UX Refinements**:
  * **Popovers**: Added detailed popovers for scatter plot points with direct links.
  * **Smart Positioning**: Popovers automatically adjust to stay on-screen.
  * **Close Logic**: Easy-to-use close buttons and click-outside behavior for modals.

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
