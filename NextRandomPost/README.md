# Danbooru Next Random Post

A high-performance UserScript for [Danbooru](https://danbooru.donmai.us/) that allows users to navigate to a random post within their current search context instantly.

## 🚀 Overview

This script adds a **"Next random post"** button to the post options sidebar and enables a keyboard shortcut (`Alt` + `Shift` + `→`). Unlike the default random feature, this script:
1.  **Preserves your search tags** (keeps you inside your current query).
2.  **Pre-fetches the next post** for zero-latency navigation.
3.  **Detects input changes** to ensure accurate search results.
4.  **Skips posts you have just seen**, along with banned and deleted posts you would not normally see.

## 📝 Update Notes

### v2.4
* **Works at your tag limit:** The script now asks Danbooru's `/posts/random.json` for the next post. The old request quietly added a `random:1` term that counted against your search tag limit, so a search that already used every allowed tag always fell back to Danbooru's slower random page.
* **No dead ends:** When no other post matches your search, a notice says so and you stay on the page, instead of reloading the same post or landing on an error page.
* **Skips banned, deleted, and recently viewed posts:** Banned posts (a blank "Page Removed" page below Approver level) and deleted posts are left out, unless your search asks for them (e.g. `status:deleted`) or your account is set to show deleted posts. The last 20 posts you viewed in the current tab, including ones you opened from it in a new tab, are skipped too; once a small search has shown every post, it starts over.
* **Open in a new tab:** The sidebar link now points at the actual next post, so middle-click, Ctrl/⌘+click, and "Open link in new tab" all work. With middle-click and Ctrl/⌘+click, each new tab gets a different post. The right-click menu's "Open link in new tab" can't be detected by the script, so using it twice in a row opens the same post.
* **Fixes:**
    * Tags with `order:` inside their name (e.g. `fate/grand_order:_first_order`) no longer break the search.
    * The script stays inactive on post sub-pages such as `/posts/123/events` and `/posts/123/favorites`.
    * If a navigation is cancelled (e.g. with the browser's Stop button), the link and shortcut work again after a few seconds.
    * Clicking while a large image is still loading no longer allows a second jump right after the first.
    * Banned pages are recognized without an extra request, and the double-tap area stays below the header after rotating the screen.

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

To open a random post in a **new tab** instead, middle-click or Ctrl/⌘+click the link (or use "Open link in new tab").

If no other post matches your search, a notice appears and you stay on the current page.

### Method 2: Keyboard Shortcut
Press **`Alt` + `Shift` + `Right Arrow (→)`** to instantly jump to the next random image.

*Note: The shortcut is disabled while typing in the search bar or comment box to prevent accidental navigation.*

### Method 3: Double-Tap on Banned Posts (Touch Devices)
If a random jump lands on a banned post ("This page has been removed because of a takedown request."), the page is blank for users below Approver level and has no sidebar. On touch devices, **double-tap the right side of the screen** (marked by a subtle `»` hint) to move on to the next random post. On desktop, the keyboard shortcut also works on these pages.

## 📜 License

Distributed under the MIT License. See `LICENSE` for more information.
