# Danbooru Next Random Post

A high-performance UserScript for [Danbooru](https://danbooru.donmai.us/) that allows users to navigate to a random post within their current search context instantly.

## 🚀 Overview

This script adds a **"Next random post"** button to the post options sidebar and enables a keyboard shortcut (`Alt` + `Shift` + `→`). Unlike the default random feature, this script:
1.  **Preserves your search tags** (keeps you inside your current query).
2.  **Pre-fetches the next post** for zero-latency navigation.
3.  **Detects input changes** to ensure accurate search results.

## 📝 Update Notes

### v2.3
* **Banned Post Escape (Mobile):** Banned (takedown) posts appear as a blank page for users below Approver level. On such pages the script now shows a subtle `»` hint on the right side of the screen — **double-tap** that area to jump to the next random post. Detection combines the page DOM with an `is_banned` API cross-check. The keyboard shortcut keeps working on these pages as well.
* **Hardening:** API-returned post IDs are validated, and the keyboard shortcut now ignores Ctrl/Meta combinations and focused select boxes.
* **Robustness:** Whitespace in API queries is normalized, and the query string is omitted when navigating without tags.

### v2.0
* **Smart Pre-fetching:** Implemented background pre-fetching for instant navigation.
* **Input Detection:** The script now prioritizes the search bar input over URL parameters.
* **UI Improvement:** Replaced native alert popups with non-intrusive Toast notifications.
* **Context Logic:** URL parameters now properly update to reflect modified tags upon navigation.
* **Stability:** Added request throttling and improved error handling.

### v1.0
* Initial release.
* Added "Next random post" link to the sidebar.
* Added keyboard shortcut (`Alt` + `Shift` + `→`) for quick navigation.

## 🚀 Installation

You need a UserScript manager extension installed in your browser to use this script.

1.  **Install a UserScript Manager:**
    * [Tampermonkey](https://www.tampermonkey.net/) (Recommended for Chrome, Edge, Firefox, Safari)
    * [Violentmonkey](https://violentmonkey.github.io/)

2.  **Install the Script:**
    * **[Click here to install the script](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/NextRandomPost/NextRandomPost.user.js)**
    

## 📖 Usage

### Method 1: Sidebar Link
Click the **"Next random post"** link located in the **Options** sidebar on any post page.

### Method 2: Keyboard Shortcut
Press **`Alt` + `Shift` + `Right Arrow (→)`** to instantly jump to the next random image.

*Note: The shortcut is disabled while typing in the search bar or comment box to prevent accidental navigation.*

### Method 3: Double-Tap on Banned Posts (Touch Devices)
If a random jump lands on a banned post ("This page has been removed because of a takedown request."), the page is blank for users below Approver level and has no sidebar. On touch devices, **double-tap the right side of the screen** (marked by a subtle `»` hint) to move on to the next random post. On desktop, the keyboard shortcut also works on these pages.

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
