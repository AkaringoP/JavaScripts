# Danbooru Grouping Tags

A professional-grade UserScript that transforms the Danbooru tag input experience. It introduces a powerful grouping system, intelligent sorting, and a state-of-the-art visual interface to help users manage complex tag lists with ease.

## ✨ Key Features

### 📦 Tag Grouping
Organize your tags into logical sections using the `GroupName[ tag1 tag2 ]` syntax. Groups are automatically parsed and displayed as distinct visual blocks.

### ⚡ Intelligent Sorting
- **Character Priority**: Automatically fetches character data from the Danbooru API to ensure character tags appear first within groups.
- **Alphabetical Ordering**: Keeps remaining tags within groups neatly organized.
- **Caching**: Local database caching for API responses to ensure lighting-fast performance.

### 🎨 Advanced Highlighter (Phantom UI)
- **Visual Clarity**: Groups are styled with subtle background colors for better separation.
- **Bracket Highlighting**: Highlights matching brackets to prevent syntax errors.
- **Phantom Mode**: Highlighting stays active even when the input field is not focused, providing a clean "preview" of the final tags.

### ⌨️ Smart Input Handler
- **Bracket Auto-completion**: Typing `[` automatically creates a pair `[  ]` and places your cursor inside.
- **Tab Escape**: Press `Tab` to quickly jump out of a group bracket.
- **Smart Merging**: Prevents duplicate groups by merging tags into existing groups automatically.

### 🔄 Gist Sync
Never lose your groupings. Sync your configurations across devices using a private GitHub Gist. Support for multiple "shards" ensures that even large tag lists are synced reliably.

## 🚀 Installation

1.  Install a UserScript manager like [Tampermonkey](https://www.tampermonkey.net/).
2.  Click the **[Install]** link below:
    -   **[Install groupingtags.user.js](https://github.com/AkaringoP/JavaScripts/raw/main/GroupingTags/dist/groupingtags.user.js)**

## 🛠️ Development

This project is built with modern web technologies:

- **Language**: TypeScript
- **Bundler**: Vite + [vite-plugin-monkey](https://github.com/lisonge/vite-plugin-monkey)
- **Testing**: Vitest
- **Style**: GTS (Google TypeScript Style)
- **CI/CD**: GitHub Actions

### Setup
```bash
npm install
```

### Build
```bash
npm run build
```

### Testing
```bash
npm run test
```

## 📜 License
MIT
