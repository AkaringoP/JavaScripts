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
  timeout and retry exactly once per attempt. A response slower than
  20 seconds is now dropped and retried instead of being processed late.
- **Main artwork bar shows errors.** A failed request used to leave the bar grey
  forever; it now turns the error color.
- **Added `@connect donmai.us`** so Tampermonkey does not ask for cross-origin
  permission on the first request. It also covers Danbooru mirrors on
  `donmai.us`.
- **One bad thumbnail no longer breaks the batch.** Each thumbnail is processed
  in its own `try`/`catch`, and the polling loop isolates the thumbnail and
  main-artwork steps. An `<img>` with an empty `src` on an artwork page used to
  throw and leave every later thumbnail in that batch unsearched.
- **Layout is fixed per batch.** Crossing the 768px breakpoint between a request
  and its retry used to throw and leave the bars grey.
- **Late pixiv IDs are picked up.** A thumbnail whose ID can't be read yet is
  checked again on later polls, up to `maxIdAttempts` times.
- **Main artwork bar is restored** if a page re-render removes it.

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
- IQDB and SauceNAO links URL-encode the image URL.
- `var` → `const`/`let`, `==` → `===`.

Behavior change:

- The "new layout" check now matches only `/` and `/en/` (plus request pages).
  It used to match any path ending in `/`.

### Notes

- `@downloadURL` still points to the upstream repository. If the script manager
  auto-updates from there, a newer upstream version replaces these local
  changes.
- `@version` is still `2026.04.16`.
