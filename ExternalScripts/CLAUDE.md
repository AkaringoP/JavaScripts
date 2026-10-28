# ExternalScripts - Claude Instructions

## Overview
Third-party userscripts kept and maintained in this repository. See `README.md`
for the list of scripts, their origin, and the local changes made to each.

## Rules
- `archives/` holds files exactly as received. Never edit them.
- Import a new upstream version in two commits: (1) add it to `archives/`
  unchanged, (2) port it into the working copy. This keeps local changes
  reviewable as a diff.
- Record every local change in `README.md` under the script's section.
- Keep each script's original code style (indentation, quotes) to make
  upstream diffs readable. Root GJS rules apply only to new code.
- Header changes (`@downloadURL`, `@version`, `@match`, `@grant`) need the
  user's confirmation, as in the root `CLAUDE.md`.

## Pixiv_Image_Searches_and_Stuff.user.js
Single file, `@grant GM_xmlhttpRequest`, no `@require`. Polls every
`imageCheckPeriod` ms:

1. `processThumbs()` picks the page's selectors from `pageSelectors` (path
   regex → keys of `thumbSelectors`), marks matched `<img>` with `pisas`, and
   calls `prepareThumb()` per image to place the status element.
2. `sourceSearch(thumbList, mobile, ...)` queries `posts.json` with
   `pixiv:<ids>`, retries up to `maxAttempts`, follows pagination when a page
   returns 100 posts, and colors results via `resolveColor()`.
3. `processMainArtwork()` (mobile only) places one bar above the like row on
   `/artworks/:id` and re-attaches it if a re-render removes it.

Key behaviors to preserve:
- `mobile` is decided once per batch and passed through retries and pages.
- Narrow the thumbnail list only on page 1; later pages must repeat the same
  query or results shift.
- `thumbSelectors` must stay equivalent to the XPath selectors in the archived
  original unless a change is intended.
