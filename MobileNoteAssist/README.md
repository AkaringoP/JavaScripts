# Danbooru Mobile Note Assist

A UserScript for [Danbooru](https://danbooru.donmai.us/) that turns note-creation into a one-thumb operation on mobile while keeping mouse/PC behavior intact.

> **The gap this fills.** Danbooru's built-in note tool was designed for a mouse on a wide screen. On a phone, dragging out a precise rectangle, then a second drag to resize, then a tag edit, then a save — all on a zoomed-in canvas — is a mess. This script collapses that into: tap to drop a box, drag the corner to size it, type the note, hit ✔.

## At a Glance

- **Tap to create.** A single tap on the image drops a correctly-sized note box. Tap empty space again to dismiss.
- **PC drag-to-create still works.** On desktop, click-and-drag draws a custom-size box just like Danbooru's native tool.
- **Touch-friendly handles.** Resize and move handles have generous invisible touch zones beyond the visible 6px corner triangle, so you don't need pixel-perfect aim.
- **Popover with translation tag toggles.** Below the box, a popover shows a note input plus four mutually-aware toggles: `translated`, `translation_request`, `check_translation`, `partially_translated`.
- **Zoom-aware UI.** The popover, floating button, and toast all counter-scale via `visualViewport` so they stay readable while pinch-zooming.
- **Movable floating button.** A 📝 button toggles the script on/off with a tap; long-press it to enter Reposition Mode and drag it vertically. Position is remembered across pages.
- **Single save round-trip.** ✔ submits the note and any tag changes in parallel. If `translated` was toggled on at save time, the script auto-disables itself afterward (cue to move on).
- Works on `/posts/{id}` — same URL the native note tool uses.

## Install

1. Install a UserScript manager:
   - **[Tampermonkey](https://www.tampermonkey.net/)** (recommended — Chrome / Edge / Firefox / Safari, including iOS Safari)
   - **[Violentmonkey](https://violentmonkey.github.io/)**
2. **[Click here to install](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/MobileNoteAssist/MobileNoteAssist.user.js)**
3. Confirm the installation in your manager.

No login or extra permissions required (`@grant none`). All API calls are same-origin to Danbooru.

## How It Works

### Turning the script on

The script is **off by default** on a fresh install (and after every page where you saved a `translated` note — see "Save flow" below). Two ways to switch it on:

- **📝 floating button** (bottom-right of the screen). Tap to toggle. Active = blue with a glow; inactive = translucent black.
- **`Note Assist: ON/OFF`** link in the post sidebar (`#post-options`). Same toggle, just a text version for desktop layouts.

When ON, the image cursor becomes a crosshair and `body.dmna-active` is set so you can spot the active state at a glance.

### Creating a box

| Input | Result |
|---|---|
| **Tap on the image** (mobile) | Drops a default-sized box centered on the tap point, clamped inside the image bounds. Default size = 10% of the image's shorter dimension, clamped to 30–150px. |
| **Tap on the image when a box already exists** | Closes the existing box (toast: `Cancelled`). |
| **Click-and-drag on the image** (PC) | Draws a custom rectangle from the drag start point. A drag is only registered if the pointer moves more than 5px — anything below that threshold is treated as a tap. |
| **Tap the box** | Reopens the popover (no-op if already open). |

### Manipulating the box

The box has four invisible handle zones at its corners with generous touch padding. The visible 6px blue triangle in the bottom-right hints at the resize affordance.

```
   ↖ ─────────────── ✥
   │                 │
   │   note box      │
   │                 │
   ✥ ─────────────── ↘
```

- **↖ / ↘ (NW / SE corners)** — Resize. NW grows up-left, SE grows down-right. Each is constrained to stay inside the image and respects a 15px minimum size.
- **✥ (NE / SW corners)** — Move. Drag from either to translate the whole box. Tapping the box body itself also enters drag mode.

While you're interacting, the popover dims to 20% opacity and the corner triangle fades out, keeping your view of the underlying art clear. The popover snaps back to full opacity on release.

The 👁️ button on the popover **temporarily reveals** the invisible touch zones (red squares with the handle icon) for as long as you hold it — useful when you're aiming on a small image and can't tell where exactly the corners are.

### The popover

```
              ┌───────────────────────────────┐
              │  ┌─────────────────┐  ┌─────┐ │
              │  │ Enter note...   │  │ 👁️  │ │  ← input + debug-zone hold button
              │  └─────────────────┘  └─────┘ │
              │                               │
              │  Translated              [ ◯] │  ← mutually exclusive
              │  Translation request    [◯ ] │     with the three below
              │  Check translation      [◯ ] │
              │  Partially translated   [◯ ] │
              │                               │
              │       [  ✔  ]   [  ✖  ]      │
              └───────────────────────────────┘
                              ▲
                          (anchored under box)
```

- **Anchored to the box.** The popover sits 10px below the box and points up with a triangular arrow. If the box is near a screen edge, the popover stays centered horizontally on screen and the arrow slides to keep pointing at the box.
- **Mutual exclusion.** Toggling `Translated` ON forces the other three OFF. Toggling any of the other three ON forces `Translated` OFF. This mirrors Danbooru's own tag conventions — a translated post isn't simultaneously requesting a translation.
- **Toggle state is initial-aware.** When the popover opens, the current toggle state is captured. On save, only changes from that snapshot are sent. If you didn't touch the toggles, no tag PUT request is made at all.

### Save flow

When you tap **✔**:

1. The box's pixel coordinates are converted from screen-space to original-image-space using the post's `image_width` / `image_height` (fetched from `/posts/{id}.json` if not already cached).
2. A `POST /notes` is issued with the rectangle and note body.
3. **In parallel**, if any toggle changed, the latest tag string is fetched, the four tag flags are added/removed, and a `PUT /posts/{id}.json` is sent with the merged result. Fetching the latest tag string first means concurrent tag edits by other users are preserved.
4. On success, a `✅ Saved! Reloading...` toast shows for 800ms, then the page reloads.
5. **Auto-off on `translated`.** If `translated` was toggled on at save time, the script flips its enabled flag off in `localStorage` before the reload. Rationale: when you mark a post as translated, you're done — re-enabling on the next post is one tap away anyway.

If the input is empty, the body defaults to `Translation requested`.

If the box's top-left ends up at negative coordinates (out-of-bounds), submission is aborted with an `⚠️ Out of bounds` toast.

### Repositioning the floating button

The 📝 button defaults to 80px above the bottom-right corner. To move it:

1. Press and hold the button for ~1.5s. A short vibration (if supported) and an `↕️ Reposition Mode` toast confirm you're in drag mode. The button turns orange and scales up.
2. Drag vertically. Horizontal position is fixed; vertical clamps to `[20px, screenHeight − 100px]`.
3. Release to commit. Position is saved to `localStorage` as `dmna_btn_margin_y`.

A regular tap (no hold) is consumed as a toggle — you'll never accidentally enter Reposition Mode by tapping.

### Auto-hide while typing

When focus enters any text input on the page (the note input, the tag editor, comment forms, etc.), the floating button hides itself so it doesn't cover the keyboard's UI. It reappears 100ms after focus leaves, unless focus moved to another text input.

## Usage Examples

### The basic mobile case

You're reading a post on your phone and spot an untranslated speech bubble.

1. Tap **📝** in the bottom-right to enable Note Assist.
2. Tap the speech bubble. A blue box drops.
3. Drag **↘** to size it to the bubble.
4. Type the translation. Toggle **Translated** ON if you're confident, or leave **Translation request** ON if you want a check.
5. Tap **✔**. Page reloads with the note saved.

### Drag-to-create on desktop

The original Danbooru workflow still works.

1. Click **Note Assist: ON** in the sidebar.
2. Click and drag on the image to draw a custom rectangle.
3. Type, toggle, save.

### Re-tag without a new note

You realized a previously-saved post is now actually fully translated.

1. Enable Note Assist.
2. Tap anywhere on the image to drop a (throwaway) box.
3. Toggle **Translated** ON. The other three toggles go OFF automatically.
4. Tap **✔**. The note still gets saved (with the default body `Translation requested`), and the tags update.
   - If you only want to update tags without leaving a stray note, this script isn't the right tool — use Danbooru's tag editor.

### Mark a translation request

You want to flag a post for someone else to translate.

1. Enable Note Assist.
2. Tap on the bubble.
3. Leave the input empty (or write a hint like "name on jersey").
4. Toggle **Translation request** ON.
5. Tap **✔**. Note body defaults to `Translation requested` if empty.

## Tips

- **Pinch-zoom freely.** The popover and floating button counter-scale, so they stay the same physical size on screen no matter how far you zoom in. Position your zoom on the area of interest before tapping.
- **Hold 👁️ when aiming on a small box.** The corner touch zones extend ~30px past the visible box. Holding 👁️ shows you exactly where they are.
- **Cancel = ✖ or tap empty image.** Both close the box and discard your input.

## Storage & Permissions

The script writes two `localStorage` keys, both scoped to `danbooru.donmai.us`:

| Key | Value | Purpose |
|---|---|---|
| `dmna_enabled` | `"true"` / `"false"` | Whether Note Assist is currently active |
| `dmna_btn_margin_y` | integer (px) | Saved vertical position of the floating button |

Nothing else is persisted. No analytics, no remote calls beyond Danbooru itself.

`@grant none` — no GM APIs are required. All requests use the page's existing CSRF token.

## Compatibility

- Tested with Tampermonkey on iOS Safari, desktop Safari, and Chrome.
- Requires `visualViewport` (used for zoom-aware positioning); falls back gracefully on browsers without it.
- Requires `fetch` and standard ES2017+ (`async`/`await`, optional chaining).

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

- **v2.5** (2026-04-20) — Fix: tap-creates-then-cancels regression on mobile (introduced in v2.3's PC drag support). Restore the simple invariant: click owns tap-to-create, mouseup handles drag-to-create only.
- **v2.4** (2026-03-23) — Maintenance: init guard, dead code removal, GJS style cleanup. No user-visible behavior change.

## License

MIT. See the repository [LICENSE](https://github.com/AkaringoP/JavaScripts/blob/main/LICENSE) for details.
