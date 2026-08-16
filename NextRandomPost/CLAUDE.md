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
- Keyboard shortcut: `Alt + Shift + Right Arrow` (ignored when Ctrl/Meta is held or an input/select is focused)
- Banned post escape: when the current post is hidden for the user (takedown blank page), a double-tap zone with a subtle hint is injected on the right third of the viewport; double-tap triggers the same navigation. Detection order: normal post UI absent (`#image-container`/`#post-options`) → `is_banned` API cross-check (`/posts/{id}.json?only=id,is_banned`) → takedown-message text fallback. Approvers see the normal page, so they are never affected. CSS lives in the `GLOBAL_CSS` constant and is injected only on detected pages.
