# Danbooru Locate in Gallery

A UserScript for Danbooru that finds the exact page number of the current post within a search query and navigates back to the list.

Unlike manually guessing which page a post belongs to, this script automatically calculates or searches for the post's location in the gallery using optimized algorithms.

## ✨ Features

* **⚡️ Smart Calculation Mode (O(1))**
    * For standard searches (sorted by **ID** or **Date**), it uses a mathematical formula to determine the page number **instantly**.
    * It utilizes the JSON API to count preceding posts, requiring only 1-2 API calls regardless of the total result count.
    * ~~Tbh, loading thumbnails takes much longer.~~
* **🔍 Parallel Batch Search Mode**
    * For non-deterministic searches (e.g., `order:score`, `order:favcount`), it scans multiple pages (default: 5) in parallel to find the post quickly.
* **🎲 Random Mode Support (Context Restore)**
    * If you use `order:random`, the script finds the post's position in the default list (to ensure a stable URL) but **restores your random search query** in the search box upon arrival.
* **⌨️ Keyboard Shortcut**
    * **`Alt` + `Shift` + `←` (Left Arrow)**: Instantly trigger the locate function.
* **⚙️ User Settings Support**
    * Automatically detects your "Posts per page" setting (e.g., 20, 100) to ensure accurate page calculation.
* **🖱 UI Integration**
    * Adds a **"Locate in gallery"** link to the sidebar "Options" menu.

## 🚀 Installation

You need a UserScript manager extension installed in your browser.

1.  **Install a UserScript Manager:**
    * [Tampermonkey](https://www.tampermonkey.net/) (Recommended)
    * [Violentmonkey](https://violentmonkey.github.io/)

2.  **Install the Script:**
    * **[Click here to install the script](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/LocateInGallery/LocateInGallery.user.js)**
    
## 📖 Usage

### Method 1: Sidebar Menu
1.  Navigate to any post page on Danbooru.
2.  Ensure there is a query in the search box (e.g., `user:AkaringoP`).
3.  Click the **"Locate in gallery"** link at the bottom of the **Options** menu.

### Method 2: Keyboard Shortcut
1.  Press **`Alt` + `Shift` + `←`** (Left Arrow key).
2.  The script will display the status (e.g., "Calculating...") and redirect you to the correct page.

## 🛠 How it Works

The script automatically chooses the best strategy based on your search query:

1.  **Calculation Strategy**:
    * Triggered when sorting by `id` (default), `id_desc` or not having `order:` clause.
    * It fetches the count of posts that are "newer" (or older) than the current post using `/counts/posts.json`.
    * Calculates `(Count / Limit) + 1` to find the exact page immediately.
2.  **Batch Search Strategy**:
    * Triggered for other sorts like `order:score` or `order:comment`.
    * It fetches metadata for 5 pages simultaneously using `Promise.all` and repeats until found.
3.  **Random Handling**:
    * For `order:random`, it temporarily removes the random tag to calculate the canonical page number (to avoid broken links).
    * After redirecting, it automatically re-inserts `order:random` into the search bar so you can continue browsing.

## 📝 License

This project is licensed under the MIT License.

---
**Author:** [AkaringoP](https://github.com/AkaringoP)
**Version:** 1.0.0

