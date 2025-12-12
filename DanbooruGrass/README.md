# Danbooru Grass

**Danbooru Grass** is a UserScript that injects a GitHub-style contribution graph into Danbooru profile pages. It allows you to visualize your upload, approval, and note editing history over the years.

<img width="1371" height="382" alt="image" src="https://github.com/user-attachments/assets/6768a5ca-6fff-47c0-a1f8-b6697d3f6664" />


## Features

-   **GitHub-Style Graph**: A familiar "grass" heatmap showing your daily activity.
-   **Accurate & Sync-Aligned**: Uses raw API data to ensure the graph matches Danbooru's search operators (UTC) perfectly.
-   **Smart Caching (v2.0)**: Uses **IndexedDB (Dexie.js)** to cache history locally.
    -   **Incremental Updates**: Only fetches new data since your last visit.
    -   **Lightning Fast**: Instant loading for previously visited years.
-   **Multi-Metric**: Switch between **Uploads**, **Approvals**, and **Notes**.
-   **History Navigation**: View contributions all the way back to 2005.

## Version History

### v2.0 (2025-12-12)
-   **Major Overhaul**: Switched from HTML scraping to Raw JSON API.
-   **Database**: Added Dexie.js for persistent local caching.
-   **Optimization**: Implemented Delta-Updates (Incremental Fetching) to minimize API usage.
-   **Fix**: Resolved discrepancy between graph click and search results.

### v1.0
-   Initial Release.

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
