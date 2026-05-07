# NextRandomPost - Claude Instructions

## Overview
A userscript that navigates to a random post using the current search context.
Single file (`NextRandomPost.user.js`). `@grant none`.

## How It Works
Adds a "Next random post" link to the post sidebar. Uses a prefetch strategy to cache the next random post ID for instant navigation.

### Navigation Strategy
1. **Cache Hit**: If a prefetched ID exists for the current tags, navigate immediately
2. **Cache Miss**: Fallback to Danbooru's built-in `/posts/random` endpoint

### Key Behaviors
- Prefetches a random post on page load
- Strips `order:*` tags before API calls to avoid conflicts with `random=true`
- Maintains search context (tags) across navigation via URL params (`q` or `tags`)
- Handles bfcache (back/forward cache) restoration via `pageshow` event
- Keyboard shortcut: `Alt + Shift + Right Arrow`
