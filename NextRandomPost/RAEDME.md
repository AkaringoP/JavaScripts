# Danbooru Next Random Post

A UserScript for Danbooru that allows you to navigate to a random post while **preserving your current search context (tags and sort order)**.

Unlike the default "Random" feature which jumps to a random post from the entire database, this script ensures that you stay within your current search query (e.g., specific artist, character, or tag combination).

## ✨ Features

* **🔍 Context Preservation**
    * Navigates to a random post only within the currently searched tags (e.g., `user:AkaringoP tsujino_akari`).
    * Preserves your original URL parameters and sort order (e.g., `order:change`) after navigation.
* **⚡️ Keyboard Shortcut**
    * **`Alt` + `Shift` + `→` (Right Arrow)**: Instantly jump to the next random post.
    * Includes safety checks to prevent accidental triggering while typing in search bars or comments.
* **🖱 UI Integration**
    * Adds a convenient **"Next random post"** link to the bottom of the sidebar "Options" menu.

## 🚀 Installation

You need a UserScript manager extension installed in your browser to use this script.

1.  **Install a UserScript Manager:**
    * [Tampermonkey](https://www.tampermonkey.net/) (Recommended for Chrome, Edge, Firefox, Safari)
    * [Violentmonkey](https://violentmonkey.github.io/)

2.  **Install the Script:**
    * **[Click here to install the script](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/NextRandomPost/NextRandomPost.user.js)**
    
## 📖 Usage

### Method 1: Mouse
1.  Navigate to any post on Danbooru.
2.  Look at the **Options** menu on the left sidebar.
3.  Click the **Next random post** link at the bottom.

### Method 2: Keyboard Shortcut
* Press **`Alt` + `Shift` + `→`** (Right Arrow key) to jump to the next random post.

## 🛠 How it Works

1.  The script reads the current search query (tags) from the URL.
2.  It temporarily modifies the query to `order:random` for an API request.
3.  It fetches a single post ID from the Danbooru API (`/posts.json`) that matches the current tags.
4.  It redirects the browser to the new post ID while appending the **original** search query string to the URL, ensuring the user's browsing context remains unchanged.

## 📝 License

This project is licensed under the MIT License.

---
**Author:** [AkaringoP](https://github.com/AkaringoP)
