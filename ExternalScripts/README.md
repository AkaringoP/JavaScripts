# External Scripts

Third-party userscripts that are kept and maintained in this repository.
They were not written by AkaringoP. Each script keeps its original author's
license; the repository's root MIT license does not cover them.

## Layout

| Path | Purpose |
| :--- | :--- |
| `*.user.js` | Working copy. Local fixes go here. |
| `archives/<Name>-<version>.user.js` | The file exactly as it was received. Never edited. |

When a new upstream version is imported, add it to `archives/` unchanged first,
then port it into the working copy in a separate commit so the diff shows the
local changes.

## Scripts

| Script | Origin | Archived original |
| :--- | :--- | :--- |
| [Pixiv Image Searches and Stuff](./Pixiv_Image_Searches_and_Stuff.user.js) | `nottalulah/userscripts` (per its `@downloadURL`) | [`2026.04.16`](./archives/Pixiv_Image_Searches_and_Stuff-2026.04.16.user.js) |

## Pixiv Image Searches and Stuff

Runs on pixiv. Looks up each artwork thumbnail on Danbooru and marks it as
found, source mismatch, bad revision, or missing. Desktop shows a status link
plus IQDB/SauceNAO search links; mobile shows a colored bar under each
thumbnail and one under the main artwork.

### Local changes from the archived 2026.04.16

Bug fixes:

- **Retries no longer multiply.** A failed request used to be retried twice, once
  by `onerror` and once by the 20-second timer, so a Danbooru outage produced an
  exponential number of requests. Requests now use the `GM_xmlhttpRequest`
  timeout, with a fallback timer for managers that ignore it, and retry
  exactly once per attempt. A response slower than 20 seconds is now dropped
  and retried instead of being processed late.
- **Main artwork bar shows errors.** A failed request used to leave the bar grey
  forever; it now turns the error color.
- **Added `@connect donmai.us`** so Tampermonkey does not ask for cross-origin
  permission on the first request. It also covers Danbooru mirrors on
  `donmai.us`.
- **One bad thumbnail no longer breaks the batch.** Each thumbnail is processed
  in its own `try`/`catch`, and the polling loop isolates the thumbnail and
  main-artwork steps. An `<img>` with an empty `src` on an artwork page used to
  throw and leave every later thumbnail in that batch unsearched. Such a
  thumbnail now matches posts for any page of the work.
- **Layout is fixed per batch.** Crossing the 768px breakpoint between a request
  and its retry used to throw and leave the bars grey.
- **Late pixiv IDs are picked up.** A thumbnail whose ID can't be read yet is
  checked again on later polls, up to `maxIdAttempts` times.
- **Main artwork bar is restored** if a page re-render removes it.
- **Thumbnails reused by pixiv get a fresh status.** pixiv reuses thumbnail
  elements when moving between pages, so a bar could keep showing the previous
  artwork's result. The script now remembers which artwork each bar was made
  for and replaces the bar when the thumbnail starts showing another one. This
  also stops a duplicate bar on the home page when an image is re-created.
- **Placeholder thumbnails on expanded-view pages are matched.** A thumbnail
  whose image is still a `data:`/`blob:` placeholder used to show
  "(no sources)" there even when the post existed; it now matches posts for any
  page of the work.

Performance:

- The debug-only DOM dump and layout reads now run only when `PISAS_DEBUG` is on.
  The dump used to run every second on pages with no new thumbnails.
- XPath lookups were replaced with equivalent CSS selectors (`querySelectorAll`).
- The like-button scan checks child count before reading `textContent`.
- API calls request only the fields used (`only=`).
- Result matching uses a map keyed by pixiv ID instead of a nested scan.
- Retries stop for thumbnails that are no longer on the page.
- jQuery (`@require` 3.2.1) was removed.

Cleanup:

- Removed unused options (`addIQDBSearch`, `thumbCheckPeriod`,
  `pixivTransparentSrc`), unused grants (`GM_getValue`, `GM_setValue`,
  `GM_deleteValue`), and two unused selectors.
- Selectors are referenced by name instead of by index.
- Added `@noframes`.
- Renamed to `Pixiv Image Searches and Stuff (Mod)` so it is never mistaken
  for, or replaced by, the upstream script.
- `@downloadURL none` turns off automatic update checks, so an upstream
  release can't overwrite the local changes.
- IQDB and SauceNAO links URL-encode the image URL.
- `var` → `const`/`let`, `==` → `===`.

Behavior change:

- The "new layout" check now matches only `/` and `/en/` (plus request pages).
  It used to match any path ending in `/`.

### Notes

- Because of the new name, the script manager installs this as a separate
  script. Disable or delete the original "Pixiv Image Searches and Stuff",
  otherwise both run on the same page and split the thumbnails between them.
- `@downloadURL none` is honored by Tampermonkey. On other script managers,
  turn off update checks for this script in its settings.
- `@version` is still `2026.04.16`. Updates are installed by hand.
