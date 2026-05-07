# BottomUpTagRemoval - Claude Instructions

## Overview
A userscript that, on tag-edit submit, detects tags the user removed and offers — via a confirmation popover — to also remove the parent tags those children used to imply.
Single file (`BottomUpTagRemoval.user.js`). `@grant none`.

Danbooru auto-applies implications upward when a tag is *added*, but does not propagate *removal*. Deleting `pinafore_dress` leaves its implied parents (`sleeveless_dress`, `sleeveless`) behind. This script fills that gap with an explicit user-confirmation layer — never automatic deletion.

## Working Principles (extends root [/CLAUDE.md])

Root CLAUDE.md covers the universal principles (search before reading, report before changing behavior, report changed files, one task at a time, preserve UserScript headers). Additions specific to this project:

- **Self-verify after editing** (left-shifted feedback): Run `node --check BottomUpTagRemoval.user.js` immediately after each edit, not only at task end. Catches syntax regressions before they compound. For semantic regressions, manual smoke against [PLAN.md](PLAN.md) / archive Verification scenarios.
- **Trust the harness, not self-judgment**: Do not declare "looks good" without running the Evaluator Rubric below. Mechanical checks override LLM intuition — never send an LLM to do a `node --check`'s job.
- **Mandatory manual verification before commit / merge / push**: Before ANY `git commit` / merge / push, run **G2 + G3 manually** (Tampermonkey reinstall + V scenario sampling per the active cycle's [PLAN.md](PLAN.md) §Phasing list). G1 (`node --check`) alone is NOT sufficient grounds to commit. Non-negotiable even for "trivial" edits — the v1.0.2 incident proved one-line cleanups can break Submit lifecycle in non-obvious ways that pass syntax checks. Pair this with the explicit-approval gate (memory `feedback_commit_approval`): verify first, then ask user for approval. If V sampling cannot be performed in the current environment, **state that explicitly and pause for instructions** rather than committing on assumption.

## Critical Rules (not mechanically enforced — agent must self-apply)

- **Fragile zone — DO NOT touch casually** (memory `project_butr_submit_lifecycle_fragile`): `submitFormViaNativeFlow`, `handleSubmit`, `showDialog`, `hideDialog`, `applyAndSubmit`, `disableAnchorButton`/`restoreAnchorButton`. Even one-line "harmless" cleanups have caused Submit to stick (v1.0.2 incident). Validate any change in this zone with manual Safari + Tampermonkey before merging.
- **`@version` bump on functional changes** (memory `feedback_version_bump`). Patch for fix, minor for feature, major for breaking. Tampermonkey's update fetcher relies on this line.
- **CSS prefix `--butr-*`** — isolated from DanbooruInsights' `--di-*`. Container-scoped variable pattern (theme overrides via `[data-butr-theme="dark"]`).
- **`@grant none` constraint** — no GM_* APIs, no external domains. Same-origin requests only.
- **JSDoc on top-level functions** — match existing convention (`@param`, `@return`, `@type`). Especially document the *why* on fragile-zone helpers.

## Multi-Model Workflow (extends root [/CLAUDE.md])

**Default**: main session runs on **Opus**. Opus orchestrates, decides, reviews, and handles small-to-medium implementation directly. **Sonnet** is invoked as a subagent only for work that fits the delegation criteria below.

### When Opus (main) handles directly
- Architecture, algorithm, and design decisions
- Debugging (hypothesis → verify → revise loop)
- Code review after any change
- Edits affecting fewer than ~5 files or requiring ongoing judgment
- **Anything in or adjacent to the Fragile zone** (Critical Rules) — judgment cost too high to delegate
- Edits to meta-docs (`CLAUDE.md`, `TASK.md`, `PLAN.md`)

### When to delegate to a Sonnet subagent
Delegate only if **all** of the following hold — otherwise just do it in Opus:
- The task is **mechanical** (bulk find/replace, applying a known pattern, dead-code removal, scaffolding from a clear spec)
- The specification is **unambiguous** enough that no further judgment from main is needed mid-task
- The work is **outside the Fragile zone**
- The result is a **diff or summary** that Opus can review in one pass

When delegating, write a **self-contained prompt**: the subagent does not see this conversation. Include the decision/spec, target files, constraints, and what to report back.

### Process per task
1. Opus reads the task entry and decides **direct** vs **delegate** using criteria above.
2. **Direct path**: Opus implements → self-runs Evaluator Rubric → reports changed files.
3. **Delegate path**: Opus drafts prompt → calls `Agent(model="sonnet", ...)` → reviews returned diff → runs Evaluator Rubric → reports changed files.
4. Move to next task once review passes.

### Task-document rule
Whenever `TASK.md` / `PLAN.md` is authored or updated, **every task entry MUST mark its execution path** as one of:
- `Direct (Opus)` — Opus main session implements directly
- `Delegate (Sonnet)` — Opus dispatches to Sonnet subagent, then reviews

Record the rationale briefly when the choice is non-obvious. This keeps the pipeline reproducible across sessions.

### Rate-limit fallback
If Opus quota is at risk mid-session, switch main to Sonnet via `/model sonnet` and continue under the inverted pattern (Sonnet main, no delegation). Treat as recovery, not default.

## How It Works

1. On `init()` (post show / post edit), snapshot the tag textarea into `originalTags`.
2. On submit (capture phase): compute `removed = originalTags - currentTokens`, also detecting `-tag` subtraction syntax.
3. Run an upward-closure BFS over `/tag_implications.json` to collect every transitive parent reachable from the removed tags.
4. Apply Policy B+ filtering (phantom seed/candidate exclusion) — drop candidates that other still-present tags would force the server to re-add.
5. Render a floating popover anchored under the Edit-tags Submit button, grouped by seed (the removed child) with BottomUp visual ordering (more general parents on top).
6. User picks which parents to also remove; the script splices them out of the tag string and calls `form.submit()`.

### Bypass cases (popover not shown)
- 0 removed tags
- 0 candidate parents
- All candidates filtered out by Policy B+ (still-implied)

## Code Structure

| Section (line) | Responsibility |
|---|---|
| `CONSTANTS` (~18) | `GLOBAL_CSS`, selectors, BFS limits, retry policy, prefetch debounce |
| `STATE` (~203) | `originalTags`, form/input refs, `abortCtrl`, `isProcessing`, `initGeneration` |
| `PREFETCH STATE` (~340) | Cache slot, in-flight controller, debounce timer |
| `STYLE INJECTION` (~416) | `<style>` tag insert (idempotent) |
| `TAG TOKEN UTILITIES` (~432) | `tokenize`, `finalTokens`, `computeRemoved` (implicit + `-tag` syntax) |
| `IMPLICATION QUERIES` (~494) | `fetchImplicationsChunk`, `fetchAllImplications`, `upwardClosure`, `findStillImpliedTargets` |
| `DIALOG` (~888) | Popover DOM build, positioning, theme, keyboard shortcuts, master toggle, cascade uncheck, restore-on-cancel checkbox |
| `INIT / CLEANUP` (~1745) | Turbo lifecycle, listener wiring |
| `PREFETCH` (~1821) | `runPrefetch`, `onTextareaInput`, length-delta trigger detection |
| `SUBMIT HANDLER` (~2001) | `handleSubmit`, plan computation, dialog flow, cache consumption, autocomplete dismissal, `restoreSeedsToInput` |
| `ENTRY POINTS` (~2503) | `turbo:load` / `turbo:before-visit` / initial `init()` |

## Key Design Decisions

- **Confirmation model only** — no auto-delete. The "delete child but keep franchise/series parent" case (e.g. `..._u149` only) is a normal scenario and would conflict with batch automation.
- **Pattern B + B1 default / B2 opt-in** — Cancel closes the popover and stays on the edit page; user input untouched. A "Restore removed tags on Cancel" checkbox (persisted to `localStorage` as `butr_restore_on_cancel`) opt-in restores the seed tags on Cancel. Restore covers four input states (no-op / `-tag`-only / `tag` + `-tag` mixed / implicit deletion) via two independent conditions in `restoreSeedsToInput` — drop any `-seed` directive present, append `seed` if no literal `seed` token is present.
- **Policy B+ smart default** — All candidates start checked; phantom seeds/candidates (those the server would re-add because some remaining tag still implies them) are removed in-memory via fixed-point iteration before render. Adds 0 RTT (one batch query reused for both seeds and candidates).
- **BFS data shape** — `Map<consequent, {antecedents: Set<string>, seedRootDepths: Map<seedRoot, depth>}>`. Multi-parent and multi-seed paths are all preserved so a candidate reachable from multiple seeds renders in every relevant section with section-relative depth.
- **Cascade uncheck (asymmetric)** — Unchecking a candidate also unchecks all transitive parents in the closure. Re-checking is local only (user's explicit intent).
- **Cross-section sync** — A candidate reachable from multiple seeds appears in multiple sections; toggling one toggles all clones (via `change` event dispatch).
- **Anchored floating popover** — `position: fixed`, anchored under the Edit-tags Submit button with viewport-edge clamping. No backdrop. Auto-cancel if anchor is removed from DOM.
- **Edit-time prefetch** — Length-delta detection on `input` event (>1 immediate, ≤1 debounced 300ms). Plan cached and consumed by `handleSubmit` if input key matches; spinner phase elided. Submit-time fresh fetch falls back on cache miss. Cache-hit bypass (no candidates after Policy B+) lets `handleSubmit` call the native submit path on the first press — no two-press penalty (v1.0.3).
- **Retry policy** — 5xx/429/network → 3 retries with 1s/2s/4s backoff. 4xx → fast-fail. AbortError → propagate. All retries exhausted → in-context fallback dialog ("Submit anyway" / "Cancel"), not a toast.
- **Keyboard shortcuts** — `0` (master), `1`–`9`, `a`–`z` (case-insensitive, rows 10–35), `Esc` (cancel), `Ctrl+Enter` (submit, including macOS — Danbooru's own convention). Guarded against active textarea/input/contentEditable focus and modifier keys (`Ctrl/Cmd/Alt+letter`). When `Ctrl+Enter` is pressed with autocomplete still open, the submit handler dismisses the dropdown first so submit goes through in a single press (v1.0.2).
- **Theme** — Container-scoped CSS variables. Dark detection via `body[data-current-user-theme="dark"]`; popover gets `data-butr-theme="dark"`. Prefix `--butr-*` for isolation from DanbooruInsights' `--di-*`.

## Turbo Lifecycle
- `turbo:load` + initial direct `init()` call (PostTimeline pattern)
- `turbo:before-visit` → `cleanup()`: aborts BFS/prefetch, force-hides popover, removes listeners, clears state
- `init()` calls `cleanup()` first for re-entry safety
- `initGeneration` counter discards stale prefetch results after cleanup
- `isProcessing` flag guards against rapid double-submit

## Evaluator Rubric (use for self-evaluation before declaring done)

All gates must pass before reporting a task complete. Run them yourself — do not assume.

| # | Gate | Command | Notes |
|---|---|---|---|
| G1 | Syntax | `node --check BottomUpTagRemoval.user.js` | JS syntax + bracket balance |
| G2 | Userscript metadata | Manual: reinstall in Tampermonkey, verify `@version` / `@match` recognized | Header health |
| G3 | V scenarios | Manual: Safari + Tampermonkey, run sampling per [PLAN.md](PLAN.md) §Verification (cycle-specific) + archive §Verification (V1~V49 baseline) | Behavior regression |

When a gate fails, fix the root cause — do not whitelist, suppress, or work around. The whole point of mechanical gates is that LLM judgment cannot be trusted for these checks.

For BUTR specifically, **regression sampling on fragile-zone-adjacent changes** is mandatory at G3. Whole-V-suite (V1~V50) is overkill for most edits — see [PLAN.md](PLAN.md) §Phasing for cycle-specific sampling lists.

## Testing Notes
- No automated test framework. Manual verification via Tampermonkey on real Danbooru pages — V1~V49 baseline at [`.archive/BottomUpTagRemoval-PLAN-v1.0.md`](../.archive/BottomUpTagRemoval-PLAN-v1.0.md) §Verification, plus cycle-specific additions (V50+) in [PLAN.md](PLAN.md).
- `node --check BottomUpTagRemoval.user.js` for syntax (G1).
- Implicit smoke fixtures live in PLAN/archive decision rationale; rerun by copy-pasting into a Node REPL when changing `tokenize` / `computeRemoved` / `chunked` / BFS shape.
