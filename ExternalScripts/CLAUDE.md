# ExternalScripts - Claude Instructions

## Overview
Third-party userscripts kept for personal use. `README.md` holds the rules, the
script list, and one short section per script. Follow it when adding or
updating a script.

## Rules
- `archives/` holds files exactly as received. Never edit them.
- No folders other than `archives/`, and no per-script note files. All notes go
  in `README.md`.
- Import in two commits: (1) the original into `archives/` unchanged, (2) the
  working copy. Local changes must stay reviewable as a diff.
- Keep each script's original code style (indentation, quotes) so upstream
  diffs stay readable. Root GJS rules apply only to new code.
- Header changes (`@name`, `@downloadURL`, `@version`, `@match`, `@grant`) need
  the user's confirmation, as in the root `CLAUDE.md`.
- Do not list these scripts in the root `README.md`.
- After changing a script, update its table row and change list in
  `README.md` (one-line bullets, eight at most). Details go in the commit
  message.
- Check behavior changes against the archived original before committing.

## Script notes
Only what must not break. One subsection per script.

### Pixiv_Image_Searches_and_Stuff.user.js
- Polls every `imageCheckPeriod` ms: `processThumbs()` → `prepareThumb()` per
  image → `sourceSearch()`. `processMainArtwork()` adds the mobile main bar.
- `pageSelectors` maps a path regex to keys of `thumbSelectors`. The selectors
  must stay equivalent to the XPath selectors in the archived original unless
  a change is intended.
- `mobile` is decided once per batch and passed through retries and pages.
- Narrow the thumbnail list only on page 1 of a search; later pages must repeat
  the same query or results shift.
- pixiv reuses thumbnail elements. `thumbState` (img → anchor, src+href key,
  bar) and `barInfo` (bar → owner img, pixiv ID) drive `resetReusedThumbs()`,
  `reconcileExistingBars()`, and `releaseThumb()`. Never remove a bar owned by
  another live image, and record the key for skipped images so they are not
  re-queued every poll.

### upload-to-danbooru.user.js
- `findAndAttach()` marks handled elements with the `ex-utb` attribute, and the
  mark is shared by every call. Fantia "1 - original" (sync) and "1 - thumbnail"
  (async) use the same predicate and differ only by call order: images present
  at load get the direct link, images added later go through the API. Keep the
  order.
- `selector` must stay a plain tag/attribute selector: MutationSummary element
  queries accept no combinators or pseudo-classes. Finer matching goes in
  `predicate`.
- Sync attach computes the href once; `asyncClick` attach has no href and opens
  the tab from the click handler via `GM_openInTab` (needed for the Firefox
  container option).
- pixiv main image: its src flips from a placeholder to i.pximg.net after
  insertion, which element queries cannot see, so `scanMainArtwork()` polls
  every second and attaches to the largest unmarked pximg image. It records
  its own buttons in `mainButtons` and removes only those on navigation;
  thumbnail buttons must survive, since their anchors keep `ex-utb` and are
  never attached again.
