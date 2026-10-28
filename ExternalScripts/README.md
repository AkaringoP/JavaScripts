# External Scripts

Third-party userscripts kept here for personal use. They were not written by
AkaringoP. Each script keeps its original author's license; the repository's
root MIT license does not cover them.

## Rules

- **Layout.** Working copies sit directly in this folder next to this README.
  `archives/` holds each original exactly as received and is never edited.
  There are no other folders.
- **File names.** A working copy keeps the upstream file name. An archived
  original is named `<upstream file name without .user.js>-<@version>.user.js`.
- **Importing.** For a new script or a new upstream version, commit the
  original to `archives/` unchanged first. Then add or update the working copy
  in a separate commit, so the diff shows exactly what changed locally.
- **Headers.** Unless decided otherwise for a script, a working copy appends
  `(Mod)` to its `@name` and sets `@downloadURL none`. It then never collides
  with, or gets overwritten by, the upstream script. Disable the upstream
  script when installing the working copy.
- **Documentation.** Each script gets a row in the table below and a section
  that follows the [template](#section-template). Changes are one-line bullets,
  eight at most. Reasons and details belong in commit messages.

## Scripts

| Installed name | File | Origin | Based on |
| :--- | :--- | :--- | :--- |
| [Pixiv Image Searches and Stuff (Mod)](#pixiv-image-searches-and-stuff-mod) | [`Pixiv_Image_Searches_and_Stuff.user.js`](./Pixiv_Image_Searches_and_Stuff.user.js) | nottalulah/userscripts | [2026.04.16](./archives/Pixiv_Image_Searches_and_Stuff-2026.04.16.user.js) |
| [Upload To Danbooru (Mod)](#upload-to-danbooru-mod) | [`upload-to-danbooru.user.js`](./upload-to-danbooru.user.js) | hdk5/danbooru.user.js | [20251213184813](./archives/upload-to-danbooru-20251213184813.user.js) |

## Pixiv Image Searches and Stuff (Mod)

Looks up pixiv thumbnails on Danbooru and marks each one as found, source
mismatch, bad revision, or missing. Desktop shows a status link with IQDB and
SauceNAO search links; mobile shows a colored bar.

- **Runs on:** `www.pixiv.net`
- **Install notes:** Disable the original "Pixiv Image Searches and Stuff", or
  both run and split the thumbnails between them. Updates are manual; on
  script managers other than Tampermonkey, also turn off update checks.

Changes from the original:

- Failed requests retry once per attempt instead of multiplying; requests time out after 20 s.
- The status refreshes when pixiv reuses a thumbnail for another artwork.
- One failing thumbnail no longer stops the rest of its batch.
- The mobile main artwork bar shows errors and returns after re-renders.
- Placeholder, empty-src, and late-loading thumbnails are matched correctly.
- Faster: CSS selectors, no jQuery, smaller API responses, debug work only when enabled.
- Header: `(Mod)` name, `@downloadURL none`, `@connect donmai.us`, `@noframes`.
- The "new layout" check matches only `/` and `/en/` (was any path ending in `/`).

Full history: `git log -- ExternalScripts/Pixiv_Image_Searches_and_Stuff.user.js`

## Upload To Danbooru (Mod)

Adds an "Upload to Danbooru" button next to images and posts on pixiv,
Twitter/X, fanbox, Fantia, Bluesky, Mastodon instances and other supported
sites. The button opens `/uploads/new` on the configured Danbooru with the
source URL filled in.

- **Runs on:** fantia.jp, misskey.io, www.pixiv.net, `*.fanbox.cc`, nijie.info,
  twitter.com, x.com, ci-en.net, ci-en.dlsite.com, seiga.nicovideo.jp,
  pawoo.net, baraag.net, inkbunny.net, xfolio.jp, bsky.app, gall.dcinside.com
- **Install notes:** Disable the original "Upload To Danbooru". Updates are
  manual; the upstream repository (hdk5/danbooru.user.js) is no longer
  available. The archived baseline is not the pristine upstream build: pixiv
  mobile support had already been added locally before it was archived.

Changes from the original:

- Header: `(Mod)` name, `@downloadURL none`, `@updateURL none`.
- pixiv mobile: upload buttons on thumbnails and on the main artwork image (added locally before the baseline was archived).
- Cleanup with no behavior change: shared button helper, one code style, dead code and shadowed names removed, attach failures logged, Fantia redirect lookups no longer download the file.

Full history: `git log -- ExternalScripts/upload-to-danbooru.user.js`

## Section template

```markdown
## <Installed name>

<One or two sentences on what the script does.>

- **Runs on:** <sites>
- **Install notes:** <what to disable or set first, or "None">

Changes from the original:

- <one line per change, eight at most>

Full history: `git log -- ExternalScripts/<file name>.user.js`
```
