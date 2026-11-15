# Changelog

All notable changes to **Danbooru Bottom-Up Tag Removal** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-11-15

### Removed
- Letter shortcuts `a`–`z` for candidate rows 10–35. Danbooru binds single letters on the post page (`a` / `d` previous / next post, `f` favorite, `e` edit, …) and those fired together with the row toggle — `a` toggled row 10 *and* left the page. Rows beyond the 9th are click-only; `0`, `1`–`9`, `Esc`, `Ctrl+Enter` are unchanged.

### Fixed
- Rewriting an existing tag with a category prefix (`char:tag`, and `gen:` / `general:` / `character:` / `copy:` / `copyright:` / `art:` / `artist:` / `meta:`) was treated as removing the tag and opened the popover. The server keeps such a tag, so it is now treated as present. `ch:` / `co:` are left as removals — the server does not count their value as a present tag.
- A parent present only in prefixed form (`copy:vocaloid`) can now be removed from the popover.
- The internal submit-bypass flag could stay set when the re-submit dispatched no `submit` event, silently skipping the popover on the next submit.

### Changed
- Implication lookups are memoized for the lifetime of the page. Typing after a removal no longer re-downloads the same implications on every pause.
- API requests ask only for `id`, `antecedent_name`, `consequent_name` (`only=`).
- The upward search stops after 20 levels (safety cap; real chains are far shallower).

## [1.1.1] - 2026-05-02

### Added
- Small `BottomUpTagRemoval v1.1.1` overline label above the popover title (kicker style, center-aligned, muted, plain text). Acts as a pure identity label — no link — keeping the popover's interactive surfaces limited to checkboxes and Submit/Cancel.
- `SCRIPT_NAME` / `SCRIPT_VERSION` constants in the script body, mirroring the `@version` header for Tampermonkey auto-update.
- `.butr-overline` CSS class (centered, 10px, muted, no divider).

## [1.1.0] - 2026-05-02

### Changed
- Maintenance release. **No user-visible behavior change.**
- Removed dead debug exposure block.
- Documented the fragile dispatch invariant in `applyAndSubmit`.
- Dropped the `positionPopover` form-fallback path: when the Submit anchor is lost, the popover now cancels cleanly instead of guessing a position.

### Added
- Console warning when Danbooru's tag-input selector goes missing on a `/posts/{id}` page (selector observability).

## [1.0.4] - 2026-04-26

### Fixed
- Restore-on-Cancel now correctly drops `-tag`-only seed directives, so cancelling really does return the input to its original state when only the subtraction syntax was used.

## [1.0.3] - 2026-04-26

### Fixed
- Cache-hit bypass no longer requires a second Submit press. When the prefetch has already determined that no popover is needed, the first Submit click goes straight through.

## [1.0.2] - 2026-04-26

### Fixed
- `Ctrl+Enter` while the autocomplete dropdown is still open now submits in a single press. Previously the keystroke was consumed by autocomplete and a second press was needed.

## [1.0.1] - 2026-04-26

### Fixed
- Popover now shows for `-tag` subtraction syntax (Method B). Inputs like `pinafore_dress -pinafore_dress` are detected as removals and offered the same parent-cleanup candidates as a plain delete.

### Changed
- Refined popover label wording and per-depth indentation in the candidate list.

## [1.0.0] - 2026-04-26

### Added
- Initial release.
- Confirmation popover for implied parent tag removal — when a tag is removed on submit, candidate parent tags are queried via `/tag_implications.json` and offered for cleanup.
- Multi-step (transitive) implication chain walking, depth-indented in the popover.
- Per-seed sections in the popover; shared parents are cloned across sections and stay in sync.
- "Delete all" master toggle.
- Cascade-uncheck: unchecking a child also unchecks its parents in the same chain (re-checking a parent does not propagate downward).
- Bypass cases: no removals, no implications, or all candidates still-implied by tags you kept — popover is skipped and submit goes through.
- Detection of both implicit removal (text deletion) and `-tag` subtraction syntax.
- Keyboard shortcuts: `Esc` cancel, `Ctrl+Enter` submit, `0` master, `1`–`9` and `a`–`z` for candidate rows. Per-row hint label shown.
- Optional opt-in **Restore removed tags on Cancel** checkbox; preference persisted via `localStorage` key `butr_restore_on_cancel`.
- Fallback dialog with **Submit anyway** / **Cancel** when the implication API fails (3 retries with 1s/2s/4s backoff before fallback).
- Prefetch of BFS work as the user edits, so the popover usually appears with candidates already filled in.
- Original Submit button is disabled while the popover is open to prevent double-submit.
- Works on `/posts/{id}` and `/posts/{id}/edit`. `@grant none`, no extra permissions.

[1.1.1]: https://github.com/AkaringoP/JavaScripts/commits/main/BottomUpTagRemoval
[1.1.0]: https://github.com/AkaringoP/JavaScripts/commits/main/BottomUpTagRemoval
[1.0.4]: https://github.com/AkaringoP/JavaScripts/commits/main/BottomUpTagRemoval
[1.0.3]: https://github.com/AkaringoP/JavaScripts/commits/main/BottomUpTagRemoval
[1.0.2]: https://github.com/AkaringoP/JavaScripts/commits/main/BottomUpTagRemoval
[1.0.1]: https://github.com/AkaringoP/JavaScripts/commits/main/BottomUpTagRemoval
[1.0.0]: https://github.com/AkaringoP/JavaScripts/commits/main/BottomUpTagRemoval
