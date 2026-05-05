# Danbooru Mobile Note Assist

A user manual for **Mobile Note Assist** — a UserScript that adds a touch-friendly note editor to [Danbooru](https://danbooru.donmai.us/) post pages. It lets you draw, edit, and submit translation notes on a phone with one thumb, and adds keyboard + drag-to-create on PC.

> Danbooru's built-in note tool was designed for a mouse on a wide screen, and it saves each note to the server the moment you press ✔. On a phone — drawing a precise rectangle, picking tags, then waiting for the page to round-trip for every speech bubble — that flow falls apart. This script collapses translating a whole page into: enter Edit mode, drop boxes for every bubble at once, type each translation, then commit them all in a single ✓ Confirm.

---

## Install

1. Install a UserScript manager:
   - **[Tampermonkey](https://www.tampermonkey.net/)** — recommended. Works on Chrome, Edge, Firefox, and Safari (including iOS Safari).
   - **[Violentmonkey](https://violentmonkey.github.io/)** — also supported.
2. **[Click here to install the script](https://github.com/AkaringoP/JavaScripts/raw/refs/heads/main/MobileNoteAssist/MobileNoteAssist.user.js)**.
3. Confirm the installation in your manager when prompted.
4. Open any post page (`https://danbooru.donmai.us/posts/{id}`). You should see a 📝 floating button in the bottom-right corner.

No login or extra permissions required. The script makes no remote calls outside Danbooru itself.

---

## Quick Start — translate one speech bubble

The fastest way to learn the workflow. Open any post you want to translate and follow along:

1. Tap the **📝** floating button. Its icon flips to **✏️** — you're now in **Edit mode**.
2. Tap directly on the speech bubble. A green box drops onto the bubble and a popover opens with the textarea focused.
3. Type your translation.
4. Tap **✔** in the popover. The popover closes and the box turns blue (committed locally — not sent to the server yet).
5. Tap (or long-press) the floating button to bring up the arc menu, then tap **✓ Confirm**.
6. The tag popover appears. Toggle the appropriate translation tags (most often `Translated`).
7. Tap **Submit**. The page reloads with the note saved.

That's the full loop. Everything below is detail on how each piece works.

---

## The Interface

### The floating button

The 📝 button in the bottom-right is the script's only entry point. It has three behaviors:

- **Tap (short press)** — toggles Edit mode on/off. Icon flips between 📝 (idle) and ✏️ (active).
- **Long-press (~0.5s, with the menu animating in)** — opens the **arc menu** (see below).
- **Long-hold (~1.5s)** — enters drag-to-reposition mode. The button turns orange; drag to move it, release to save its new position. (See [Customization](#customization).)

When a per-note popover is open, the floating button **hides** so it doesn't get in the way of the popover's ✔ / ✖ / 🗑 buttons (which sit in the same screen region on mobile).

### The arc menu

Long-press the floating button to open a 2-item arc:

```
        ✓ Confirm
            \
             \
              ✏️ Edit
              /
             /
        📝 (floating button)
```

- **✏️ Edit** — toggle Edit mode on/off (same as a short tap on the button).
- **✓ Confirm** — send all your local changes to the server (covered in [Sending your work to the server](#sending-your-work-to-the-server)).

### Idle vs Edit mode

The script lives in two states:

| State | What you see | What's interactive |
|---|---|---|
| **Idle** | 📝 floating button only | Nothing else; the script is invisible to the page. |
| **Edit mode** | ✏️ button + every existing note appears as a colored box | Tap a box to edit it. Tap empty image space to drop a new box. |

Entering Edit mode triggers two background fetches: image dimensions and existing notes. Existing notes appear as boxes you can move, edit, or delete.

---

## Working with notes

### Creating a note

Once Edit mode is on:

| Input | Result |
|---|---|
| **Tap on the image** (mobile or PC) | Drops a default-sized box at your tap point, clamped inside the image bounds. The box auto-opens its popover with the textarea focused. |
| **Click and drag on the image** (PC mouse only) | Draws a custom-size rectangle from your drag start point. A dashed yellow ghost rectangle previews the size as you drag. Release to spawn. |
| **Tap an existing box** | Opens that note's popover so you can edit it. |

The default box size is 10% of the image's shorter dimension, clamped to 30–150px. The smallest box you can draw is 24px on each side — small enough to mark single eyes or glyphs.

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

| Button | What it does |
|---|---|
| **Textarea** | Type or edit the note text. |
| **✔ Commit** | Save the current text + geometry as the note's local checkpoint. The popover closes and the box turns blue. **Does not** send to the server yet — that happens at ✓ Confirm time. |
| **✖ Cancel** | Discard uncommitted changes. On a brand-new box that was never ✔'d, this hard-deletes it. On a ✔'d or server-loaded box, this reverts text and geometry to the last checkpoint. |
| **🗑 Delete** | Mark this note for deletion. New boxes are deleted immediately. Already-✔'d or server-loaded notes turn into a red dashed box (soft-deleted) — they aren't gone until ✓ Confirm runs, so you can ↶ to bring them back. |
| **↶ Undo** | Step back through this note's history. Each box has its own undo stack — independent from every other box. Reverts ✔ commits, drag/resize moves, and 🗑 deletes one at a time. |
| **👁 Peek** | Hold this button to temporarily reveal the box's invisible touch zones (red squares, see below). Useful for aiming on small boxes. |

> The four translation tags (`Translated`, `Translation request`, `Check translation`, `Partially translated`) **don't appear in the per-note popover.** They're handled once per ✓ Confirm, in a separate tag popover.

### Moving and resizing

Each box has four invisible handle zones at its corners with generous touch padding:

```
   ↖ ─────────────── ✥
   │                 │
   │   note box      │
   │                 │
   ✥ ─────────────── ↘
```

- **↖ / ↘ (top-left and bottom-right)** — Resize. ↖ grows up-left, ↘ grows down-right. Both stay clamped inside the image.
- **✥ (top-right and bottom-left)** — Move. Drag from either corner to translate the whole box.
- **The box body itself** — Also drag-to-move. Moves the same way as the ✥ corners.

Each drag and each resize is a single entry on the per-note undo stack, so a misjudged drag can be reverted with ↶ without losing the text.

If you can't tell where the touch zones are on a small box, **hold 👁** in the popover to highlight them.

### Box colors at a glance

```
┌─────────────┐  ┌─────────────┐  ┌╴╴╴╴╴╴╴╴╴╴╴╴╴┐  ┌─────────────┐
│   Default   │  │    Dirty    │  ╵   Deleted   ╵  │    Active   │
│  (saved)    │  │  (changed)  │  ╵  (soft del) ╵  │ (popover    │
│   blue      │  │    green    │  ╵     red     ╵  │   open)     │
└─────────────┘  └─────────────┘  └╴╴╴╴╴╴╴╴╴╴╴╴╴┘  └─orange──────┘
```

| State | Color | Meaning |
|---|---|---|
| **Default** | solid blue | Loaded from the server, no local changes yet. |
| **Dirty** | solid green | Has local edits (text or geometry) not yet sent to the server. |
| **Deleted** | red, dashed | Soft-deleted via 🗑 — restorable with ↶ until ✓ Confirm runs. |
| **Active** | solid orange | The box whose popover is currently open. |

If a box has multiple states at once (e.g. a deleted box you've tapped to reveal its undo affordance), the higher-priority color wins: `active > deleted > dirty > default`. The one exception is `deleted + active` — it stays red dashed, so you can still see what you're being asked to undo.

---

## Sending your work to the server

When you're done editing all the boxes, tap (or long-press → arc menu) **✓ Confirm**.

1. The script collects your pending changes — new notes, edits, deletes — and decides what to send.
2. If you've added notes or changed any text, a **tag popover** appears anchored to the Confirm button. Toggle the four translation tags as iOS-style pill switches:

   | Tag | Behavior |
   |---|---|
   | **Translated** | When ON, automatically forces the other three OFF. (You can't be both translated and partially translated.) |
   | **Translation request** | Independent — can stay ON on its own. |
   | **Check translation** | When ON, forces `Translation request` ON too. |
   | **Partially translated** | When ON, forces `Translation request` ON too. |

3. Tap **Submit** in the tag popover. The script sends your changes in batch.
4. **On full success**: a `✓ Saved` toast flashes, and the page reloads with everything applied.
5. **On partial failure**: an error modal lists which calls failed and Danbooru's actual error message (e.g. `Box overlaps existing note`). You can choose:
   - **Retry** — re-classify what's left and try again.
   - **Cancel** — stay in Edit mode with the partial state. Successful changes are kept locally; failed ones still show as pending so you can fix them.

> Tip: if you want to update **only** the translation tags on a post (e.g. flip from `translation_request` to `translated` because someone else translated already), just enter Edit mode and tap ✓ Confirm directly without touching any boxes. The tag popover still opens.

---

## PC users

### Keyboard shortcuts

| Shortcut | Context | Action |
|---|---|---|
| `Ctrl/Cmd + Enter` | Cursor in the popover textarea | ✔ Confirm box (same as clicking ✔) |
| `Esc` | Popover open | Dismiss the popover. Behaves like ✖: hard-deletes brand-new boxes, reverts ✔'d ones. |
| `Shift + N` | No popover open, no input focused | Toggle Edit mode on/off. A toast confirms the new state. |

`Shift + N` is intentionally disabled while the tag popover or error modal is open, so you don't accidentally lose your in-progress submission.

### Drag-to-create

In addition to tap-to-create, on PC you can **click and drag** on the image to draw a rectangle of any size. A dashed yellow ghost previews the result; release to spawn. Touch users always get tap-to-create plus drag-the-handles to resize, since drag-to-create on touch would conflict with pinch and pan gestures.

A drag is registered when the pointer moves more than 5px during the press; below that threshold it's treated as a tap.

---

## Mobile tips

- **Pinch-zoom freely.** The popover, arc menu, floating button, and toasts all counter-scale, so they stay the same physical size on screen no matter how far you zoom in. Position your zoom on the bubble before tapping, and the box will land precisely.
- **Hold 👁 when aiming on a small box.** The corner touch zones extend ~30px past the visible box edge, which is invisible by default. Holding 👁 shows you exactly where they are.
- **Tap any box to switch focus.** No need to ✔ before moving on — tapping a different box will close the current popover. If the current note has a useful checkpoint (text was changed), it stays as `dirty` (green) and waits for ✓ Confirm.

---

## Customization

### Moving the floating button

The 📝 button defaults to the bottom-right corner. To reposition it:

1. Press and hold the button for ~1.5 seconds. A short vibration (if your device supports it) and an `✥ Drag to reposition` toast confirm you're in drag mode. The button turns orange and scales up.
2. Drag in any direction. Both axes are free; the button stays clamped inside the screen with margin.
3. Release. The new position is saved to your browser and persists across pages and reloads.

A regular short tap (no hold) opens the menu instead, so you won't accidentally trigger drag mode.

### Auto-hide while typing

When focus enters any text input on the page (the per-note textarea, the tag editor, comment forms, contenteditable fields, etc.), the floating button auto-hides so it doesn't cover the keyboard's UI on mobile. It reappears 100ms after focus leaves, unless focus moved straight to another text input.

---

## Troubleshooting

**The 📝 button isn't appearing.**
Check that you're on a `/posts/{id}` page (the only place this script runs), and that your UserScript manager shows it as enabled for `danbooru.donmai.us`.

**`No changes to confirm` when I tap ✓.**
You haven't ✔'d any local changes. Either tap ✔ on at least one box, or — if you only meant to update tags — make sure you're triggering the tag-only path (enter Edit mode, then tap ✓ Confirm without changing any boxes).

**`Image dimensions unknown` toast.**
The post's image hadn't finished loading when you tried to drop a box. Wait a moment for the image to settle, or scroll to make sure the `<img>` is in view, and try again.

**`HTTP 422` or `Box overlaps existing note` after Submit.**
This is Danbooru's server response — the script just surfaces it. Move or resize your overlapping box and Retry. Successful boxes from the same submit are already saved; only the rejected ones come back for editing.

**A misclick deleted a box I needed.**
If the popover is still open, tap **↶**. If you've already closed it, tap the box (now red dashed) and tap **↶** to undo the delete. Hard-deleted brand-new boxes can't be recovered — but their undo stack lives until you leave Edit mode entirely.

---

## Storage & Privacy

The script writes two `localStorage` keys, scoped to `danbooru.donmai.us`:

| Key | Value | Purpose |
|---|---|---|
| `dmna_btn_margin_x` | integer (px) | Saved horizontal position of the floating button |
| `dmna_btn_margin_y` | integer (px) | Saved vertical position of the floating button |

Nothing else is persisted. The script makes no remote calls beyond Danbooru's own API, sends no analytics, and does not require any GM_* APIs (`@grant none`).

---

## Compatibility

- Tested with Tampermonkey on iOS Safari, desktop Safari, and Chrome.
- Requires `visualViewport` (used for zoom-aware UI sizing). Falls back gracefully on older browsers.
- Requires `fetch`, Pointer Events, and standard ES2017+ (`async`/`await`, optional chaining, default parameter values).

---

## Changelog

See [CHANGELOG.md](./CHANGELOG.md) for the full version history.

The current release is **v3.0.1** (2026-05-05). v3.0 introduced the multi-note batched workflow that this manual describes; v3.0.1 was a same-day hotfix for the floating button hiding behind open popovers.

## License

MIT. See the repository [LICENSE](https://github.com/AkaringoP/JavaScripts/blob/main/LICENSE) for details.
