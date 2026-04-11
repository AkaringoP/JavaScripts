# JavaScripts

![license](https://img.shields.io/badge/license-MIT-green)
![javascript](https://img.shields.io/badge/javascript-ESNext-yellow)
![typescript](https://img.shields.io/badge/typescript-✓-blue)
![platform](https://img.shields.io/badge/platform-Userscript-orange)
![build](https://img.shields.io/badge/build-Vite-646CFF)

A collection of UserScripts developed by **AkaringoP** (with Claude Code).

## Scripts

| Script Name | Description | Install |
| :--- | :--- | :--- |
| **[Danbooru Insights](https://github.com/AkaringoP/Danbooru-Insights)** *(moved)* | Injects a GitHub-style contribution graph and advanced analytics dashboard into Danbooru profile pages. Now lives in its own dedicated repository. | [Install](https://github.com/AkaringoP/Danbooru-Insights/raw/build/danbooruinsights.user.js) |
| **[Danbooru Next Random Post](./NextRandomPost)** | Navigates to a random post while preserving search query. | [Install](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/NextRandomPost/NextRandomPost.user.js) |
| **[Danbooru Locate in Gallery](./LocateInGallery)** | Finds the gallery page of the current post using O(1) calculation or parallel search. | [Install](https://github.com/AkaringoP/JavaScripts/raw/main/LocateInGallery/LocateInGallery.user.js) |
| **[Danbooru Mobile Note Assist](./MobileNoteAssist)** | Assist creating notes on mobile with accurate scaling and touch-friendly controls. | [Install](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/MobileNoteAssist/MobileNoteAssist.user.js) |
| **[Danbooru Grouping Tags](./GroupingTags)** | Advanced tag management system featuring visual grouping, character-first sorting, and Gist synchronization. | [Install](https://github.com/AkaringoP/JavaScripts/raw/build/groupingtags.user.js) |
| **[Danbooru Post Timeline](./PostTimeline)** | Displays the upload timeline of a post — source platform publish date, media asset upload, and post creation — in Danbooru's Information section. | [Install](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/PostTimeline/PostTimeline.user.js) |

## How to Install

1.  Install a UserScript manager extension:
    -   **[Tampermonkey](https://www.tampermonkey.net/)** (Recommended)
    -   **[Violentmonkey](https://violentmonkey.github.io/)**
2.  Click the **[Install]** link in the table above.
3.  Confirm the installation in your extension.

## Build Instructions (for contributors)

Scripts with a build step (**GroupingTags**) require Node.js:

```bash
cd GroupingTags
npm install
npm run build         # runs vitest + tsc + vite build
```

The compiled UserScript is output to `dist/*.user.js`.

> **Danbooru Insights** has its own repository with its own build setup.
> See [AkaringoP/Danbooru-Insights](https://github.com/AkaringoP/Danbooru-Insights) for instructions.
