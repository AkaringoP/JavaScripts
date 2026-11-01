# Danbooru Personal Favorite Pages

A Tampermonkey userscript that keeps your own list of Danbooru **pages** — searches, wiki pages, forum topics, reports, users, posts, anything you open again and again — with a title, a memo and an order of your choosing.

Danbooru's favorites hold posts, and saved searches hold tag searches. This holds the rest: `/post_versions?search[updater_name]=…`, a forum thread you follow, `/reports/posts?…`, the wiki page you keep checking, an API address.

[**Click here to install**](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/PersonalFavoritePages/PersonalFavoritePages.user.js) — requires [Tampermonkey](https://www.tampermonkey.net/) or [Violentmonkey](https://violentmonkey.github.io/). No extra permissions (`@grant none`).

## At a glance

- **Save the page you are on** from the navbar or with `Shift+B` — or without any dialog, by double-clicking the button (holding it on a phone).
- **Find it again** in a quick panel (`Shift+L`) that filters as you type, or on the full list page at `/favorite_pages`.
- **Arrange it your way**: pin pages to the top, drag them into order, add memos.
- **Take it with you**: export to a file or the clipboard, import on another device or from another user.
- **Per account**: each Danbooru account you log in with has a list of its own.

## Saving a page

| Where | What it does |
| :--- | :--- |
| Bookmark button in the navbar, or `Shift+B` | Opens the save dialog for the page you are on (title, memo). On a page already saved it edits the entry instead. |
| Double-click the bookmark (PC) / hold it for a second (phone) | Saves at once with the suggested title and no memo. A saved page opens the edit dialog instead, so a slip never removes anything. |
| A forum post's or comment's `…` menu | **Save to Favorite Pages**, under Copy Link. The title names the topic or post and the author; the memo starts with the message's own words. |
| **New** on the list page | Adds any Danbooru address by hand, including `.json` API addresses. |

A few kinds of page can follow their newest state, set by a box in the save dialog:

- **Forum topics** can open at their **latest page** (on by default).
- **Reports** (`/reports/…`) can **end on the latest date**, so a report you saved last month still includes today (on by default when the report already runs up to today).

Pages that make no sense to keep are refused with a short reason: login and account-security pages, editing forms, one-time links, error pages, and other sites. Clutter such as `api_key`, `login`, `commit=Search` and the `z=` search marker is removed from saved addresses, so the same search is never saved twice.

## The list page

Open it from **Favorite Pages** in the navbar, the site map ("More »"), or the count on your profile page. It lives at `/favorite_pages`.

- **Filter** by title, memo or address (`q` jumps to the filter), and **sort** by custom order, date added, title or type. The order you pick is remembered, here and in the quick panel.
- **Pin** (the pin icon next to a title) keeps a page at the top in every order. New pages go right under the pinned ones.
- **Custom order**: drag the `≡` handle with the mouse (or a finger on a phone). The `⋯` menu moves a page to the previous or next list page, or to the top or bottom. Pinned pages and the rest each keep to their own part.
- **Remove several at once**: tick them and press **Remove selected**. After ticking a whole list page, **Select all N** takes every match on every page; the confirmation says how many are out of sight.
- 20 pages per list page; the `…` in the page numbers asks for a page to jump to.

## The quick panel

`Shift+L` (or the list button next to the bookmark in the navbar) opens a panel over any page: type to filter, `↑` `↓` to pick, `Enter` to open, `Shift+Enter` for a new tab, `Esc` to close. It has its own order picker, and pinned pages come first with a pin.

## On a phone

- The bookmark, the list button and the **Favorite Pages** link sit together in Danbooru's menu.
- The list button slides the panel in from the right. Swipe it back to the right, or press **Back**, to close it.
- The list page turns into cards: a round tick on the left, `⋯` (with Edit and Remove) and the `≡` handle on the right, and a **Memo** button that unfolds the memo.

## Other devices and backups

Your list is stored in the browser, so another browser or device starts empty. **Export** and **Import** (on the list page, or `e` / `i`) carry it over.

**Export** — pick what to take, then how:

- **Sync / Backup**: everything, with memos, pins and recent removals. For your other devices, or to keep a copy.
- **Share**: the saved pages only, memos only if you tick **Include memos**. For another user.
- **Download** saves `danbooru-favorite-pages-<name>-<date>.json`; **Copy** puts the same text on the clipboard, to paste into Import elsewhere.

**Import** — choose the file, drop it anywhere on the list page, or paste the copied text. Nothing changes until you press **Apply** under a preview of what would happen.

- **Your own Sync / Backup export merges**: for each page the newer change wins — titles, memos, order, pins and removals alike. A page you removed stays removed; re-importing the same file changes nothing.
- **Any other file only adds pages** (another account's export, or a Share export). Pages you already have are skipped, nothing you saved changes, and pins in the file are ignored. You can untick pages in the preview.

Imported files are treated as untrusted: they are checked for size before being read, every address goes through the same checks as a page you save yourself (Danbooru only, no `javascript:` links, keys removed), text is stripped of hidden and direction-changing characters, and everything is shown as plain text. If a file claims to be yours but names another account, the preview warns you, and lists every page it would remove.

## Where your list is kept

- In the browser's own storage (IndexedDB) on `danbooru.donmai.us`, separately for each Danbooru account. Nothing is sent anywhere else.
- Up to **10,000** pages per account.
- When disk space runs low, browsers may clear a site's data. **Export → Protect** asks the browser to keep this list (Firefox asks you to allow it; Chrome decides by itself). Exporting now and then keeps a copy either way.
- Removed pages are kept as removal records for 30 days so that Sync exports can carry the removal to your other devices.

## Keeping itself tidy

- When a tag is **aliased**, Danbooru moves its wiki page to the new tag. A saved wiki page for the old tag moves along with it: when you open it, and in a check the list page runs at most once a day (one small request for all your saved wiki pages). A title you wrote yourself stays as it is.

The only requests the script makes are to Danbooru itself: that daily alias check, and the post count of a forum topic you open at its latest page.

## Keyboard shortcuts

| Key | Where | Action |
| :--- | :--- | :--- |
| `Shift+B` | Any page | Save this page (or edit it) |
| `Shift+L` | Any page | Open the quick panel |
| `e` / `i` | List page | Export / Import |
| `q` | List page | Focus the filter (Danbooru's own "focus search box") |
| `↑` `↓` `Enter` `Shift+Enter` `Esc` | Quick panel | Pick, open, open in a new tab, close |
| `Ctrl+Enter` / `Esc` | Save dialog | Save / cancel |

The keys also show in Danbooru's own keyboard shortcuts window (`?`), under **Favorite Pages**. **Help** on the list page sums all of this up.

## Compatibility

- Tested with Tampermonkey on Chrome (Windows) and a userscript manager on Firefox for Android.
- Runs on `danbooru.donmai.us` only; other Danbooru sites have separate storage.

## Changelog

- **v1.0.0** (2026-11-01) — Initial release: saving from the navbar, `Shift+B` or a message's `…` menu; the list page with pins, custom order and bulk removal; the quick panel (`Shift+L`) and phone drawer; Export / Import; latest forum pages and report dates; aliased wiki pages followed.

## License

MIT. See the repository [LICENSE](https://github.com/AkaringoP/JavaScripts/blob/main/LICENSE) for details.
