# Danbooru Bottom-Up Tag Removal

A UserScript for [Danbooru](https://danbooru.donmai.us/) that catches the tags you remove on submit and offers to also remove their **implied parent tags** through a small confirmation popover.

> **The gap this fills.** When you *add* a tag, Danbooru automatically applies its implications upward — adding `pinafore_dress` also adds `sleeveless_dress` and `sleeveless`. When you *remove* a tag, those parents stay behind. Without this script, you'd have to manually retrace the implication chain every time. This script does the trace for you and lets you decide which parents to also remove.

## At a Glance

- **Confirms before deleting.** Never auto-removes anything. You see every candidate and uncheck what you want to keep.
- **Multi-step chains.** Handles transitive implications — removing `idolmaster_cinderella_girls_u149` walks all three levels up.
- **Smart bypass.** If your edit doesn't actually trigger any cleanup (no removal / no parents / parents would be re-added by other tags you kept), the popover stays out of the way and submit goes through normally.
- **Keyboard-friendly.** Number/letter shortcuts to toggle rows, `Ctrl+Enter` to submit, `Esc` to cancel.
- **Cancel-safe.** Cancel closes the popover and leaves you on the edit page with your input untouched. Optional opt-in restore.
- Works on both `/posts/{id}` and `/posts/{id}/edit`.

## Install

1. Install a UserScript manager:
   - **[Tampermonkey](https://www.tampermonkey.net/)** (recommended — Chrome / Edge / Firefox / Safari)
   - **[Violentmonkey](https://violentmonkey.github.io/)**
2. **[Click here to install](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/BottomUpTagRemoval/BottomUpTagRemoval.user.js)**
3. Confirm the installation in your manager.

No login or extra permissions required (`@grant none`). All API calls are same-origin to Danbooru.

## How It Works

### The flow

1. When the post page loads, the script remembers the current tag string.
2. You edit tags as usual — delete some, add some, prepend `-tag` to subtract, all of these are detected.
3. When you click **Submit** (or press `Ctrl+Enter`), the script computes which tags you removed and queries Danbooru's `/tag_implications.json` for everything those removed tags used to imply.
4. A small popover appears anchored under the Submit button with the candidate parent tags.
5. You uncheck anything you want to keep, then click **Submit** in the popover. The selected parents are spliced out of the tag string and the post is saved.

The original Submit button is disabled while the popover is open, so you can't double-submit by mistake.

### Reading the popover

```
                       ┌───────────────────────────────┐
                       │ Remove their implied parents? │
                       │  ☑ Delete all                 │  ← master toggle
                       │  ─────────────────────        │
                       │  ☑ dress                      │  ← more general (top)
                       │  ☑ sleeveless                 │
                       │      ☑ sleeveless_dress       │  ← indented = closer to seed
                       │  ── from pinafore_dress ──    │  ← the seed (already removed)
                       │                               │
                       │  ☑ smile                      │
                       │  ☑ one_eye_closed             │
                       │  ── from ;D ──                │  ← second seed section
                       │                               │
                       │  ☐ Restore removed tags       │
                       │      on Cancel                │
                       │       [Submit] [Cancel]       │
                       └───────────────────────────────┘
```

- **BottomUp ordering.** Within each section, more general parents sit flush at the top and more specific children are indented one tab to the right per step toward the seed. The very last line of each section shows the seed tag you removed. Reading the section top-to-bottom mirrors the implication chain "wider category → narrower category → the tag you deleted."
- **Sections per seed.** Each removed child gets its own section. If you remove two unrelated tags in one edit, you'll see two sections.
- **Same parent in multiple sections.** When two removed children share a parent (e.g. you delete both `pinafore_dress` and `blue_dress`, and both imply `dress`), `dress` appears in *both* sections. Toggling one clone toggles the other automatically.
- **`Delete all` master.** Toggles every candidate at once. The master is unchecked whenever any individual candidate is unchecked (no indeterminate state — easier to read at a glance).

### Cascade uncheck

If you uncheck a candidate, the script also unchecks every parent of it in the same chain. This keeps your selection consistent: the server will re-add any parent that still has a child below it, so unchecking the child means unchecking the parents you can't actually remove either.

Re-checking a parent does **not** propagate downward — that's a deliberate user choice. Toggling the master `Delete all` ignores cascade and just bulk-toggles everything.

### Bypass cases — when the popover doesn't appear

The popover stays out of your way and submit goes straight through if any of these are true:

- You didn't remove any tags (you only added).
- The tags you removed don't imply anything.
- Every candidate parent is **still-implied** — meaning some tag you kept in the input would force the server to re-add it. There's nothing for you to decide, so no popover.

This last case is the most subtle. Example: you remove `ribbed_sweater` but `red_sweater` is still in your input — `sweater` would get re-added by `red_sweater`, so the popover skips that row. If `sweater` was the *only* candidate, the whole popover is skipped and your submit goes through immediately.

## Usage

### The basic case

You want to clean up a misapplied tag chain.

1. Remove `pinafore_dress` from the tag textarea.
2. Click **Submit**.
3. Popover shows ☑ `sleeveless_dress`, ☑ `sleeveless` — both pre-checked.
4. Click **Submit** in the popover. All three (`pinafore_dress`, `sleeveless_dress`, `sleeveless`) are removed.

### Keep the parent, drop the child

You want to remove a more specific tag but keep its franchise/series parent.

1. Remove `idolmaster_cinderella_girls_u149` only.
2. Click **Submit**.
3. Popover shows ☑ `idolmaster_cinderella_girls`, ☑ `idolmaster`.
4. Uncheck both, then click **Submit**. Only the child is removed; the franchise tags stay.

### A different child still implies the parent

You want to remove `pinafore_dress` but the post also has `sundress` (which also implies `dress`).

- The `dress` row is filtered out of the popover automatically (still-implied by `sundress`).
- You'll only see `sleeveless_dress` and `sleeveless` as candidates.
- If you removed both `pinafore_dress` and `sundress`, `dress` would appear and you'd decide.

### Cancel

- **`Cancel`** button, **`Esc`**, click anywhere outside the popover — all do the same thing: close the popover, stay on the edit page, leave your input as you typed it. Submit is *not* sent.
- This means the safest "undo" is just to press `Esc`. Your edits are preserved, and you can keep typing.

### Optional: restore on Cancel

If you want Cancel to also undo the seed tag removal (so the post returns to its original state on the page), tick the **"Restore removed tags on Cancel"** checkbox above the buttons. This is **off by default** and the choice is remembered across pages (in `localStorage`).

- Implicit removals (text deletion) are restored by appending the tag back to the textarea.
- `-tag` subtraction directives are dropped (and the tag is appended if it isn't already in the input), so the originally-removed tag is effectively present again.
- Tags that are already there with no matching `-tag` directive are left alone (idempotent).

If you click **Submit** with this checkbox ticked, restore does nothing — Submit always proceeds with your selection.

### Keyboard shortcuts

All shortcuts are active only when the popover is open and your focus is **not** in the textarea (the popover auto-moves focus to the Submit button when it opens). Modifier keys (`Ctrl`/`Cmd`/`Alt` + letter) are passed through to the browser.

| Key | Action |
|---|---|
| `Esc` | Cancel |
| `Ctrl+Enter` | Submit (works on macOS too — matches Danbooru's own convention) |
| `0` | Toggle `Delete all` master |
| `1`–`9` | Toggle the 1st through 9th candidate row (top to bottom across sections) |
| `a`–`z` (case-insensitive) | Toggle rows 10–35 (`a`=10, `b`=11, … `z`=35) |
| Mouse | Always works for any row |

A small grey hint label is shown to the left of each row (e.g. `1`, `a`, `b` …) so you can see which key maps to which row. Rows beyond 35 have no shortcut and need to be clicked.

## FAQ

**Does this work on the bulk update / post versions / wiki pages?**
The script runs only on `/posts/{id}` and `/posts/{id}/edit`. Bulk update has different syntax (`add:` / `remove:`) and is on the backlog.

**What about `-tag` subtraction syntax (Method B)?**
Detected. If your input has `pinafore_dress -pinafore_dress`, the `-tag` form is treated as a removal, the popover shows the same candidates as a plain delete, and you can decide which parents to also remove.

**Will it slow down my submit?**
Most of the BFS work is prefetched as you edit. The popover usually appears with candidates already filled in (no spinner). The first edit after a page load may briefly show a spinner. If your network is slow or the API is degraded, the script retries 3 times with 1s/2s/4s backoff (worst case ~7s) before showing a fallback dialog asking whether to submit anyway or cancel.

**What happens if the API call fails completely?**
You'll see a small fallback dialog with **`Submit anyway`** and **`Cancel`** buttons in the same spot as the normal popover. No silent submission and no silent failure.

**Is anything saved to my browser storage?**
Only one optional flag: `butr_restore_on_cancel`, written when you tick the restore checkbox. Toggle it off to remove the key. Nothing else is persisted — no caches, no usage tracking.

**Can I disable it temporarily?**
Use the toggle in your UserScript manager (Tampermonkey/Violentmonkey). Cancelling the popover is functionally identical to having the script off — your input is submitted unchanged when you re-submit without it.

**Does it interact with Danbooru's autocomplete?**
The autocomplete dropdown is closed automatically when the popover opens, so the two never visually overlap. Pressing `Ctrl+Enter` while autocomplete is still open also dismisses it and submits in a single press — no double-press needed.

**It's not appearing on a tag I removed — why?**
Most common reason: the tag has no implications, or its parents would all be re-added by other tags you kept (still-implied → filtered). Both are bypass cases by design. If you suspect a real bug, check the browser console for warnings starting with `[BUTR]`.

## Compatibility

- Tested with Tampermonkey on Safari (the maintainer's primary browser).
- Should work on any UserScript manager that supports standard `@match` and `@grant none`.
- Requires a modern browser (`fetch`, `AbortController`, `URLSearchParams`, optional chaining).

## License

MIT. See the repository [LICENSE](https://github.com/AkaringoP/JavaScripts/blob/main/LICENSE) for details.
