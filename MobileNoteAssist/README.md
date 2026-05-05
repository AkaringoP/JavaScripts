# Danbooru Mobile Note Assist

A UserScript for [Danbooru](https://danbooru.donmai.us/) that turns multi-note translation work into a one-thumb operation on mobile, with full PC keyboard + drag support.

> **The gap this fills.** Danbooru's built-in note tool was designed for a mouse on a wide screen, with each note round-tripping to the server on save. On a phone, drawing a precise rectangle, resizing it, editing tags, and saving — repeated for every speech bubble — is a mess. v3.0 collapses that into: enter Edit mode, drop boxes for every bubble at once, type each translation, then commit them all in a single Confirm.

## At a Glance

- **Multi-note batch workflow.** Drop and edit several boxes in one pass, then Confirm them all together. No more save-reload-save-reload chain per note.
- **Arc menu.** Tap (or long-press) the floating button to fan out a 2-item arc: ✓ Confirm and ✏️ Edit.
- **Per-note popover.** Tap any box to edit just that note's text and toggle ✔/✖/🗑/👁/↶. Translation tags are decided once per Confirm, not per note.
- **Per-note undo (↶).** Each box has its own undo stack. Step back through ✔'s, drags, resizes, deletes individually.
- **PC keyboard shortcuts.** `Ctrl/Cmd+Enter` = ✔ box; `Esc` = dismiss popover; `Shift+N` = toggle Edit mode.
- **PC drag-to-create.** Click and drag on the image to draw a custom-size rectangle. Tap stays as default-size spawn.
- **Color-coded boxes.** Green = uncommitted new note. Blue = ✔'d. Red dashed = soft-deleted (undo to restore).
- **Zoom-aware UI.** Popovers, menu, floating button, and toast all counter-scale via `visualViewport` so they stay readable while pinch-zooming.
- **Movable floating button.** Long-press to enter reposition mode; drag freely. Position is remembered across pages.
- Works on `/posts/{id}` — same URL the native note tool uses.

## Install

1. Install a UserScript manager:
   - **[Tampermonkey](https://www.tampermonkey.net/)** (recommended — Chrome / Edge / Firefox / Safari, including iOS Safari)
   - **[Violentmonkey](https://violentmonkey.github.io/)**
2. **[Click here to install](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/MobileNoteAssist/MobileNoteAssist.user.js)**
3. Confirm the installation in your manager.

No login or extra permissions required (`@grant none`). All API calls are same-origin to Danbooru.

## How It Works

### Edit mode

The script lives in two states: **idle** (script visible but inert) and **active** (Edit mode — interactive).

Three ways to flip state:
- **Tap the 📝 floating button** — flips active. The icon becomes ✏️.
- **Long-press the floating button** — opens the arc menu; tap ✏️ Edit to flip.
- **`Shift+N` keyboard shortcut** (PC, when no popover is open and no input has focus).

Entering Edit mode triggers two background fetches: post metadata (image dimensions) and existing notes. Existing notes appear as boxes you can move/edit/delete; their original colors are preserved until you change them.

### Creating a box

| Input | Result |
|---|---|
| **Tap on the image** (mobile or PC) | Drops a default-sized box at the tap point, clamped inside the image. Default size = 10% of the image's shorter dimension, clamped to 30–150px. |
| **Click-and-drag on the image** (PC only) | Draws a custom rectangle from the drag start point. A drag is registered when the pointer moves more than 5px; below that threshold it's treated as a tap. A dashed yellow ghost rectangle previews the size as you drag. |
| **Tap the box** | Activates that note (selects it) and opens its popover. |

Newly-created boxes auto-focus the popover textarea, so you can type immediately on PC.

### Manipulating the box

The active box has four invisible handle zones at its corners with generous touch padding.

```
   ↖ ─────────────── ✥
   │                 │
   │   note box      │
   │                 │
   ✥ ─────────────── ↘
```

- **↖ / ↘ (NW / SE corners)** — Resize. NW grows up-left, SE grows down-right. Each is constrained to stay inside the image.
- **✥ (NE / SW corners)** — Move. Drag from either to translate the whole box. Tapping the box body itself also enters drag mode.

Drag and resize gestures are individually undoable via the popover's ↶ button — each gesture is one entry on the per-note undo stack.

The 👁 button on the popover **temporarily reveals** the invisible touch zones (red squares with the handle icon) for as long as you hold it.

### The per-note popover

```
     ┌──────────────────────────────────────┐
     │ ┌────────────────────────────┐ ┌───┐ │
     │ │ Enter note...              │ │ 👁 │ │
     │ │                            │ ├───┤ │
     │ │                            │ │ ↶ │ │
     │ └────────────────────────────┘ └───┘ │
     │                                      │
     │           [ ✔ ]  [ ✖ ]  [ 🗑 ]       │
     └──────────────────────────────────────┘
                       ▲
                  (anchored under box)
```

- **✔** — Commit the current geometry + text as the note's checkpoint. Doesn't send to the server yet — that happens at Confirm time. The box turns blue.
- **✖** — Cancel uncommitted edits. On a fresh-new (never-✔'d) box, ✖ hard-deletes the box. On a ✔'d or server-loaded box, ✖ reverts text/geometry back to the last checkpoint.
- **🗑** — Delete. Fresh-new boxes are hard-deleted. ✔'d temp notes and server notes become red-dashed soft-deletions; ↶ restores them.
- **↶** — Per-note undo. Steps back through this box's history (✔ → drag → resize → 🗑 etc.).
- **👁** — Hold to reveal touch zones (debug overlay).

Translation tags **don't appear here** — they're handled once per Confirm, in the tag popover (see below).

### Confirm flow

When you're done editing all boxes, tap (or long-press → arc menu) ✓ **Confirm**:

1. The script classifies pending changes — new notes (POST), edits (PUT), deletes (DELETE), and notes that need their tags reviewed.
2. If new notes were created or text was changed, a **tag popover** appears anchored to the Confirm button. Toggle the four translation tags as iOS-style pill switches:
   - `Translated` (excludes the other three)
   - `Translation request` (independent — can stay ON when c_t / p_t are off)
   - `Check translation` (forces `Translation request` ON when ON)
   - `Partially translated` (forces `Translation request` ON when ON)
3. Tap **Submit** in the tag popover to start the batch send. Order: DELETE → PUT → POST → tag PATCH (so a temp box that fails to POST doesn't get its tags applied to the wrong post).
4. **Full success** → `✓ Saved` toast → page reloads.
5. **Partial failure** → error modal listing which calls failed and why (Danbooru's actual error response — e.g., "Box overlaps existing note"). Choose **Retry** (re-classify and re-send only what's missing) or **Cancel** (stay in Edit mode with the partial state, server's truth applied locally).

### PC keyboard shortcuts

| Shortcut | Context | Action |
|---|---|---|
| `Ctrl/Cmd+Enter` | Cursor in popover textarea | ✔ Confirm box |
| `Esc` | Popover open | Dismiss (fresh-new = hard-delete; ✔'d = revert) |
| `Shift+N` | No popover, no input focus | Toggle Edit on/off |

`Shift+N` is also disabled while a tag popover or error modal is open, to prevent accidental dismiss.

### Repositioning the floating button

The 📝 button defaults to the bottom-right corner. To move it:

1. Press and hold the button for ~1.5s. A short vibration (if supported) and an `✥ Drag to reposition` toast confirm you're in drag mode. The button turns orange and scales up.
2. Drag in any direction (both axes are free in v3.0). Both clamps stay inside the screen with margin.
3. Release to commit. Position is saved to `localStorage`.

A regular tap (no hold) fires the menu instead.

### Auto-hide while typing

When focus enters any text input on the page (the per-note textarea, the tag editor, comment forms, etc.), the floating button hides itself so it doesn't cover the keyboard's UI. It reappears 100ms after focus leaves, unless focus moved to another text input.

## Usage Examples

### The basic mobile case — translating one bubble

1. Tap **📝** to enter Edit mode (or long-press → ✏️).
2. Tap the speech bubble. A green box drops, popover open, textarea focused.
3. Type the translation. Tap **✔** to commit (box turns blue).
4. Tap (or long-press →) **✓ Confirm**. The tag popover appears.
5. Toggle the appropriate tag switches. Tap **Submit**.
6. Page reloads with the note saved.

### Translating a whole page

1. Enter Edit mode.
2. Drop a box on each bubble (tap each). Type the translation in each. Tap ✔ between bubbles, or just tap the next bubble (auto-commits).
3. Made a mistake on box #3? Tap that box, ↶ reverts last action; or 🗑 to soft-delete (red dashed); or move/resize directly.
4. When all boxes look right, **✓ Confirm** → tag popover → **Submit**.

### Drag-to-create on PC

1. Enter Edit mode.
2. Click and drag on the image to draw a custom-size rectangle. Release to spawn.
3. Type, ✔, repeat. **Submit** when done.

### Re-classifying tags without changing notes

When you only want to update the post's translation tags (e.g., flip from `translation_request` to `translated` after someone else translated):

1. Enter Edit mode. Existing notes load as movable boxes (no need to touch them).
2. Tap **✓ Confirm** directly. Since text/geometry didn't change, the script skips the per-note PUT but still opens the tag popover (the `everConfirmed` heuristic).

   *Edge case:* if you genuinely have no notes to add and don't want PUTs, just toggle Edit off — Confirm with no changes shows `No changes to confirm`.

### Recovering from partial save failure

You created 5 new boxes. Submit. Server accepts 4 but rejects 1 because of an overlap.

1. Error modal appears: "1 POST failed — Box overlaps existing note". Click **Retry**.
2. The 4 successful POSTs are now server notes (re-keyed locally), so re-classify finds only the 1 failed temp.
3. Move that temp to not overlap, ✔, **✓ Confirm**, **Submit**.

## Tips

- **Pinch-zoom freely.** Popovers, menu, and floating button counter-scale, so they stay the same physical size on screen no matter how far you zoom in. Position your zoom on the area of interest before tapping.
- **Hold 👁 when aiming on a small box.** The corner touch zones extend ~30px past the visible box. Holding 👁 shows you exactly where they are.
- **MIN box size is 24px.** v3.0 lowered the minimum from 40px so you can mark small details (eyes, glyphs).
- **Edit-mode round-trip = 0.** Toggling Edit on doesn't fetch or save anything until you actually create / change / delete notes. Existing server notes load on Edit-on but are inert until you touch them.

## Storage & Permissions

The script writes two `localStorage` keys, both scoped to `danbooru.donmai.us`:

| Key | Value | Purpose |
|---|---|---|
| `dmna_btn_margin_x` | integer (px) | Saved horizontal position of the floating button |
| `dmna_btn_margin_y` | integer (px) | Saved vertical position of the floating button |

The legacy v2.x `dmna_enabled` key (script on/off persistence) is removed on first v3.0 launch — Edit mode is now per-page rather than global, so persistence isn't needed.

Nothing else is persisted. No analytics, no remote calls beyond Danbooru itself.

`@grant none` — no GM APIs are required. All requests use the page's existing CSRF token.

## Compatibility

- Tested with Tampermonkey on iOS Safari, desktop Safari, and Chrome.
- Requires `visualViewport` (used for zoom-aware positioning); falls back gracefully on browsers without it.
- Requires `fetch`, Pointer Events, and standard ES2017+ (`async`/`await`, optional chaining, default parameter values).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

- **v3.0.0** (2026-05-05) — Major: paradigm shift from single-note immediate-save to multi-note batched Confirm. Adds arc menu, multi-note state machine, per-note undo, PC drag-to-create + keyboard shortcuts, iOS-style tag pill switches, error modal with Retry, per-type toasts. Removes sidebar link, immediate-save flow, global Undo. See CHANGELOG.md for the full breakdown.
- **v2.6** (2026-05-03) — Issue cleanup: `init()` re-binding fix, submitNote correctness, defensive guards.
- **v2.5** (2026-04-20) — Fix: tap-creates-then-cancels regression on mobile.
- **v2.4** (2026-03-23) — Maintenance: init guard, dead code removal.

## License

MIT. See the repository [LICENSE](https://github.com/AkaringoP/JavaScripts/blob/main/LICENSE) for details.
