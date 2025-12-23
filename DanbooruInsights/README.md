# Danbooru Grass

This userscript injects a GitHub-style contribution graph into Danbooru profile pages. It visualizes your activity (Uploads, Post Approvals, Note Updates) over the last year, allowing for quick insights into your contribution habits.
<img width="1365" height="404" alt="image" src="https://github.com/user-attachments/assets/a4c0bf04-0adf-4ebc-92c6-7123a693e237" /> 

## Features

*   **Contribution Visualization**: Draws a calendar heatmap similar to GitHub's contribution graph.
*   **Multiple Metrics**: Supports switching between **Uploads**, **Approvals**, and **Notes**.
*   **Per-User Caching**: Data is cached locally using **Dexie.js** to minimize API calls and load times.
*   **Interactive Tooltips**: Hover over cells to see exact counts and dates.
*   **Search Integration**: Click on a day to search specifically for posts/events on that date.
*   **Advanced Customization**: Full control over themes and contribution thresholds.

## Version History

### v3.1 (Latest)
*   **🛡️ Robust DOM Independence**: Improved profile extraction logic to be more resistant to layout changes.
*   **💬 Friendly Error UI**: Replaced intrusive alerts with graceful inline error messages and retry options.
*   **🧹 Advanced Cache Management**: Added real-time stats panel and a one-click purge button (red icon) for easier management.
*   **✨ UI Refinements**: Improved Settings Popover positioning, text visibility (shadows), and state persistence.

### v3.0
*   **🎨 Advanced Theme Customization**: 
    *   6 Color Themes: Light, Sakura, Sunset, Ocean, Midnight, and **Aurora (Gradient)**.
    *   Themes apply dynamically to the graph and UI components.
*   **⚙️ Advanced Settings System**:
    *   **Custom Thresholds**: Configure distinct contribution levels for *Uploads*, *Approvals*, and *Notes*.
    *   **Visual Editor**: Input fields color-coded to match the graph for intuitive editing.
    *   **Auto-Refresh**: Graph automatically updates when settings are changed.
*   **🏎️ Performance Optimization**:
    *   **Parallel Batch Fetching**: Data is now fetched in batches of 4 pages simultaneously (Strategy 1).
    *   **Speedup**: Reduced load times by ~3-4x for heavy users.
    *   **Rate Limiting**: Intelligent 150ms delays to respect server limits.
*   **🧠 Usability Improvements**:
    *   **Remember Last Mode**: Remembers the last viewed tab (e.g., Approvals) for each user profile.
    *   **Dynamic Tooltips**: Legend tooltips now show exact ranges (e.g., "150+ (More)") based on custom thresholds.
    *   **Smart Legend**: The legend's "empty" cell color syncs perfectly with your selected theme.

### v2.0
*   **Core Implementation**: Rebuilt using `d3.v7` and `cal-heatmap` for robust rendering.
*   **Local Database**: Integrated `Dexie.js` (IndexedDB wrapper) for efficient data storage and retrieval.
*   **Multi-Mode Support**: Added support for 'Approvals' and 'Notes' in addition to 'Uploads'.
*   **User Interface**: Improved layout with a sticky header and better integration into Danbooru's profile page.

## Installation

1.  Install a UserScript manager like **[Tampermonkey](https://www.tampermonkey.net/)**.
2.  **[Click Here to Install](https://github.com/AkaringoP/JavaScripts/raw/main/DanbooruGrass/DanbooruGrass.user.js)**
3.  Confirm the installation in Tampermonkey.

## Usage

1.  Go to any user profile on Danbooru (e.g., `https://danbooru.donmai.us/users/701499`).
2.  The graph will appear automatically above the statistics section.
3.  Click the **Year** in the title to change the year.
4.  Use the **Dropdown** on the right to switch between Uploads, Approvals, and Notes.

## Credits

-   **Author**: AkaringoP
-   **Co-Author**: Antigravity (AI)

## Compatibility

*   Tested on Chrome/Edge with Tampermonkey.
*   Requires `d3.v7`, `cal-heatmap`, and `dexie.js` (automatically included via `@require`).
