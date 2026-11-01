# PersonalFavoritePages - Claude Instructions

## Overview

A userscript that keeps a per-account list of Danbooru **pages** (searches, wiki pages, forum topics, reports, users, API addresses…) with a title, a memo, pins and a custom order. Single file (`PersonalFavoritePages.user.js`), `@grant none`, `@run-at document-start`, `danbooru.donmai.us` only.

- **Storage**: the browser's IndexedDB on the Danbooru origin, separately per account (`body[data-current-user-id]`). Nothing leaves the browser except two same-origin Danbooru requests (see Key Design Decisions).
- **Entry points**: navbar save button (`Shift+B`; double-click / long-press saves without the dialog), navbar panel button (`Shift+L` popover; a drawer on phones), a forum post's or comment's `…` menu, the list page's **New**, the site map and the profile statistics row.
- **List page** `/favorite_pages`: a virtual page drawn over Danbooru's own 404 page (there is no such Danbooru route).
- **Export / Import**: JSON files or clipboard text; Sync (merge your own export) or Add (anything else, only adds).

User-facing documentation: [README.md](README.md). Design log: `PLAN.md` / `TASK.md` (gitignored, local only). Code comments cite `Resolved N` and `PLAN Dn` from that log; the decisions that matter for future work are summarised below so they survive without it.

## Working Principles (extends root [/CLAUDE.md](../CLAUDE.md))

Root CLAUDE.md covers the universal principles (search before reading, report before changing behavior, report changed files, one task at a time, preserve UserScript headers). Additions specific to this project:

- **Self-verify after each edit**: run G1 (below) right away, not only at the end. It also catches a backtick inside `GLOBAL_CSS`, which silently ends the template literal.
- **CSS is verified by computed values, not by reading rules**: Danbooru's global `button`, `form`, `table.striped` rules out-cascade naive selectors. Check the real computed style in headless Chrome (localhost page, phone widths via `<iframe width=360>`), never trust "the rule is there".
- **Phones are verified by the user**: the reference devices are Windows Chrome + Tampermonkey and Android Firefox + a userscript manager. Tampermonkey updates from the `@updateURL` branch, so a change must be pushed before the user can check it on a phone.
- **Commit / merge / push each need explicit approval** (memory `feedback_commit_approval`).
- **`@version` bump on every functional change** (patch = fix, minor = feature). README Changelog lists major / minor versions only (memory `feedback_changelog_policy`).

## Critical Rules (not mechanically enforced — apply them yourself)

- **Account isolation**: every storage function takes `userId` explicitly and reads through the per-user indexes (`by_user`, `by_user_url`, …). No code path may read or write another account's records. `applyImport` gives a record a new id rather than write over an id that belongs to another account on the same browser.
- **`sanitizeUrl` is the single gate** for every stored URL: saving, editing, importing, alias moves. It accepts `https://danbooru.donmai.us` only (scheme and origin — a `blob:` URL has the site's origin), applies the deny rules (login / account security / editing forms / one-time tokens / the list page itself), strips `api_key`, `login`, `commit`, `z`, drops empty `search[...]`, and re-serialises the query so equal searches compare equal. Never store a URL that did not come out of it.
- **No `innerHTML`, ever**: all DOM is built with `makeElement` (text goes in as `textContent`). Titles and memos may come from another user's file. Attribute values that are URLs come from `sanitizeUrl` output or constants only. `grep -n innerHTML` must find only the comment in `makeElement`'s JSDoc.
- **Imported files are untrusted input** (Import section): size checked before reading (20 MB), values counted outside strings before `JSON.parse` (1,000,000), at most 50,000 entries and 10,000 saved pages, each entry rebuilt from its allowed fields, text read only up to 4× its limit and stripped of control and bidi characters, URLs through `sanitizeUrl`. **Sync mode only when `kind === 'sync'` and `user_id` equals the current account**; anything else is Add mode and can only add pages. Nothing is written before Apply; Apply is one transaction, planned again on what is stored at that moment.
- **`withStore` transactions**: the `work` callback may await IndexedDB requests only. Awaiting anything else (fetch, timers) lets the transaction auto-commit early. A throw aborts and rolls back.
- **document-start code is minimal**: only the list-page cloak (`LIST_CLOAK_CSS`, lifted in `initListPage`'s `finally`), the tab title, and the latest-forum-page / latest-report redirects run before the DOM exists. Everything else waits for `DOMContentLoaded`. Keep it that way, or the 404 page flashes (Resolved 25).
- **Hotkeys** match `event.code` (the Korean IME reports ㅠ for Shift+B), skip typing targets, repeats, IME composition and open overlays. Every overlay stops `keydown` propagation so Danbooru's shortcuts and ours never fire behind it.
- **Colours only from Danbooru's semantic CSS variables** in `GLOBAL_CSS` (G4). The toast alone has system-colour fallbacks, because it also shows on JSON documents where Danbooru's stylesheet is absent.
- **Danbooru markup the script depends on** (breaks if Danbooru changes it; each place logs a `[PFP]` warning and degrades): `#a-not-found` (404 page), `#nav` / `#main-menu` / `#nav-more`, `table.user-statistics` (Favorite Groups row), `div.popup-menu > ul.popup-menu-content` (tippy takes the `<ul>` on first open, so the item is added on the press), `/static/site_map` Profile list, `/static/keyboard_shortcuts` (also loaded into a jQuery UI `.ui-dialog` by the `?` key), the wiki alias notice (`#wiki-page-body > p.fineprint`), Danbooru's paginator classes (its delegated handler on `.paginator-ellipsis` reloads the page, so ours stops propagation).
- **Firefox for Android quirks**: `navigator.vibrate` is a no-op (the quick-save flash is the feedback); a tap on empty space is retargeted to a nearby button, so list rows carry an empty click listener.

## Code Structure

| Section (line) | Responsibility |
|---|---|
| Constants (~20) | Limits, save-scope rules (`STRIPPED_PARAMS`, `DENY_RULES`), page types, latest-state patterns, import limits, `GLOBAL_CSS` |
| Storage (~1814) | `openDB`, `withStore`, CRUD (`savePage`, `updatePage`, `deletePages`, `setPagePinned`, `renumberAll`), settings (`readSettings`), alias-check claim |
| Model (~2342) | `getCurrentUser`, `sanitizeUrl`, `classify`, titles (`suggestTitle`), latest page / date (`openableUrl`, `withLatest`) |
| UI primitives (~2712) | `makeElement`, `fitToVisualViewport`, `showToast`, `describeError` |
| Save dialog (~2902) | `openModal` (shared by Export / Import / Help), `openSaveDialog`, `renderSaveDialog` |
| Quick-jump popover (~3340) | `openPopover` / `renderPopover`, phone drawer with Back and swipe-to-close |
| Hotkeys (~3850) | `onGlobalKeydown`, `saveCurrentPage`, `quickSaveCurrentPage` |
| Icons (~3976) | Inline SVG shapes, `makeIcon` |
| List page (~4054) | `sortPages` (pins first), `initListPage`, subnav, `createListView` (filter, sort, selection incl. "Select all N", paginator, row menu, pointer drag) |
| Export (~5478) | `exportData`, `openExportDialog` (Download / Copy, storage protection) |
| Help (~5705) | `openHelpDialog` |
| Import: reading and merging (~5790) | `parseImport`, `readImportedPage`, `countJsonValues`, `planSync`, `planAdd`, `applyImport` |
| Import: dialog and drop zone (~6228) | `openImportDialog`, `initImportDrop` |
| Profile row / Shortcuts / Site map (~6558) | `initProfileRow`, `initShortcutsHelp`, `initSiteMapLink` |
| Navbar item (~6710) | `initNavItem`, `addQuickSave`, saved-state tracking |
| Message menu item (~6914) | `…` menu item, message title and memo excerpt |
| Aliased wiki pages (~7140) | On-visit move, daily list check (`checkWikiAliases`, `fetchAliases`) |
| Latest forum page / report (~7350) | document-start redirects |
| Lifecycle (~7419) | `init`, bfcache `pagehide` / `pageshow`, `notifyPagesChanged` |

## Data Model

- **DB** `PersonalFavoritePagesDB` version 1 (the version doubles as the record schema version).
  - `pages` (keyPath `id`): `{id, userId, url, title, memo, type, sortOrder, pinned, createdAt, updatedAt, deletedAt}`. Indexes `by_user`, `by_user_url` (**unique** `[userId, url]`), `by_user_created`, `by_user_order`. `type` is informative; the UI recomputes it from the URL with `classify`.
  - `settings` (keyPath `key`): `global` = `{defaultSort, defaultSortDir}` only (the hotkeys are fixed), and `aliasCheckedAt:<userId>` = last daily alias check.
- **Removals are tombstones** (`deletedAt` set) so Sync exports carry them to other devices; purged after 30 days when the list page opens. Saving a removed URL revives its record (same id).
- **Order**: `sortOrder` with gaps of 1000; a drop takes the midpoint, `renumberAll` re-spaces when gaps run out. New pages go to the top of the unpinned part. **Pinned pages come first in every order** and moves never cross the pinned / unpinned boundary.
- **Limits**: title 300 / memo 1,000 characters, **10,000 saved pages per account** (imports included, removals not counted).
- **Export file** (`schema_version: 1`): `{schema_version, exported_at, user_id, user_name, kind: 'sync'|'share', pages: [...]}`. Sync / Backup takes every record incl. tombstones; Share takes saved pages only, memos on request.

## Key Design Decisions

- **Virtual list page over the 404** (Resolved 3, 25): `/favorite_pages` is Danbooru's catch-all 404. The script hides `#a-not-found`'s content at document-start and replaces it. If the route ever becomes a real Danbooru page (no `#a-not-found`), the list page disables itself and the cloak hides nothing.
- **Save scope = deny list** (Resolved 11, 17, 19): anything worth reopening is savable; login, account security, editing forms (except `/uploads/new`, `/dmails/new`), one-time tokens, error pages and the list itself are refused with a reason. JSON documents cannot confirm the account, so API addresses are added through **New**.
- **Latest state** (Resolved 34, 48): a forum topic saved as `?page=last` opens at its newest page (one `/forum_topics/<id>.json?only=response_count` request at document-start); a report saved with `search[to]=latest` opens with tomorrow's date (Danbooru counts up to the start of the end date).
- **Aliased wiki pages** (Resolved 49, 51): a saved wiki page for an aliased tag moves to the new tag's wiki when opened, and in a daily list-page check (`/tag_aliases.json`, batched, claimed in one transaction so two tabs ask once). A title the user wrote is kept.
- **Sync merge** (Resolved 9, D10): per record, the newer `updatedAt` wins (title, memo, order, pin, removal). A page removed here later stays removed; the same URL saved on two devices becomes one record under the id saved first; a URL change that would collide is left out. Add mode ignores pins, removals and ids in the file and adds a block under the pinned pages.
- **Phones** (Resolved 39, 43–46, 50): ≤ 660px the list becomes cards (round select mark, `⋯` with Edit / Remove, `≡` drag handle on the right); the panel is a right-edge drawer with its own history entry (Back closes it) and swipe-to-close. Dialogs follow the visual viewport (on-screen keyboard, zoom).
- **No Settings window** (Resolved 57): the order last picked is remembered automatically; the hotkeys are fixed. Storage protection (`navigator.storage.persist()`, only on a button press) lives in Export.
- **Selection across pages** (Resolved 54): ticking a whole list page offers "Select all N" (Gmail style); unticking any row returns to the visible rows, and removal says how many are out of sight.

## Evaluator Rubric (run before declaring done)

| # | Gate | Command | Notes |
|---|---|---|---|
| G1 | Syntax | `node -e "new Function(require('fs').readFileSync('PersonalFavoritePages/PersonalFavoritePages.user.js','utf8'))"` | IIFE userscript; catches `GLOBAL_CSS` backtick traps |
| G2 | Userscript metadata | Manual: reinstall in Tampermonkey, `@version` recognised, no permission prompt | `@grant none` |
| G3 | Behaviour | Manual on PC Chrome + Tampermonkey and Android Firefox: save (dialog, quick save, `…` menu), list page (filter, sort, pin, drag, select, remove), popover / drawer, Export / Import | User-run |
| G4 | No colour literals | `grep -nE '#[0-9a-fA-F]{3,8}\b' PersonalFavoritePages/PersonalFavoritePages.user.js \| grep -vi svg` returns nothing | Theme variables only |
| — | Line length | 80 columns (GJS); only header lines 5, 10, 11 exceed | |
| — | `innerHTML` | `grep -n innerHTML` finds the `makeElement` comment only | |

## Testing Notes

- v1.0 was developed against an automated suite that is **not in this repository**: Node `node:test` + jsdom 25 + fake-indexeddb 6 (130 tests: storage, sanitising, import security and merging, list page, popover / drawer, menus, export, help, review follow-ups), plus headless Chrome probes for computed CSS and pointer drags.
- The release script has no test hook. The suite reached internals through a `window.pfpDebug` object; a small generator re-inserts it into a **copy** of the release script just before the document-start code, and the tests run against that copy (`PFP_SCRIPT=<copy> node --test phase*.test.mjs`).
- jsdom pitfalls met so far: stub `matchMedia`, `fetch`, `prompt`, `confirm`, `navigator.clipboard` / `storage`; objects from the page realm need `JSON.parse(JSON.stringify(x))` before `deepEqual`; jsdom `Blob` has no `.text()`; jsdom does not implement a form field named `method` shadowing `form.method`.

## File Layout

```
PersonalFavoritePages/
├── README.md                        # User-facing
├── CLAUDE.md                        # This file
├── PersonalFavoritePages.user.js    # The userscript
├── PLAN.md                          # Design log, Resolved decisions (gitignored)
└── TASK.md                          # Phased task tracking (gitignored)
```
