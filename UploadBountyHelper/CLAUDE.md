# UploadBountyHelper - Claude Instructions

## Overview

A two-piece system that surfaces Danbooru's [Upload Bounty Thread](https://danbooru.donmai.us/forum_topics/24186) on the pages where users would act on it.

- **`scripts/build-bounty.mjs`** — Node 20+ ES module, runs on GitHub Actions (8h cron). Walks `forum_posts.json` → filters to Approver+ (level ≥ 37) → extracts `[[wikilinks]]` and Pixiv/X URL fallbacks → resolves aliases → enriches with artist URLs and post-count signals → writes deterministic `data/bounty.json`.
- **`UploadBountyHelper.user.js`** — Single-file Tampermonkey userscript. `@grant GM_xmlhttpRequest` + `@connect raw.githubusercontent.com` (needed for X's strict CSP). Fetches `bounty.json` once per 2h cache window and decorates DOM on Danbooru upload pages, Pixiv, X (Twitter), and the bounty thread itself.

There is **one bounty.json file** consumed by all userscript modules. The cron is the single source of truth; users never query Danbooru's API.

## Architecture (key diagram from PLAN.md)

```
GitHub Actions (cron 0 */8 * * *)
    │
    ▼ build-bounty.mjs (curl via system curl — undici/node:https get
    │  blocked by Cloudflare on long query strings, see fetchJson)
    │
    │ Step 1: paginate forum_posts.json (limit=1000)
    │ Step 2: users.json batch → filter level ≥ 37
    │ Step 3: extract wikilinks + URL fallback + alias resolve
    │ Step 4: enrich with artists.json (concurrent 5, deterministic process)
    │ Step 4b: tags.json batch (post_count)
    │ Step 4c: counts/posts.json per-tag (30d delta, concurrent 5)
    │ Step 5: serialize → byte-stable JSON
    ▼
data/bounty.json (committed if changed)
    │
    ▼ raw.githubusercontent.com (CORS: *)
    │
UploadBountyHelper.user.js
    │
    ├── initDanbooru()  → upload-page bounty label + dup/PPD signals
    ├── initPixiv()     → profile/artwork marks via SPA nav hooks
    ├── initX()         → profile/timeline marks via SPA nav hooks +
    │                    role=main MutationObserver (250ms throttle)
    └── initForum()     → /forum_topics/24186 popover (sort/page/filter)
```

## Code Structure (UploadBountyHelper.user.js)

| Section (line) | Responsibility |
|---|---|
| UserScript header (1-18) | `@version`, `@match`, `@grant GM_xmlhttpRequest`, `@connect` |
| Shared constants (~30) | `BOUNTY_DATA_URL`, `CACHE_KEY` (versioned), `CACHE_TTL_MS`, fetch timeout/backoff |
| Cache layer (~50) | `loadCache` / `saveCache` (localStorage, corrupt-tolerant) |
| Fetcher (~100) | `fetchRemote` (GM_xmlhttpRequest, timeout 30s), `refreshBountyData` (inFlight + negative cache 5min), `getBountyData` |
| Style injection (~150) | `injectStyles(id, css)` — shared idempotent helper |
| Mark assets (~165) | `BOUNTY_MARK_SVG`, `SCROLL_ICON_SVG`, `POSTS_ICON_SVG` (inline, synced from `assets/`) |
| Permalink/aria helpers (~200) | `forumPermalink(postIds)`, `buildAriaLabel(approvers)` |
| SPA nav hooks (~230) | `installSpaNavHooks(schedule)` — pushState/replaceState/popstate patches, shared by Pixiv + X |
| Mark DOM (~280) | `MARK_*` constants, `buildMark(tag, entry, variant, opts)` |
| Danbooru module (~320) | upload-page label + dup toast + PPD callout, MutationObserver-based mount |
| Pixiv module (~970) | profile + artwork marks, SPA debounce 300ms |
| X module (~1100) | profile + timeline marks, role=main observer throttle 250ms, recycled-card handle stale check |
| Forum module (~1310) | bounty thread popover — sort/page/filter, prefs persistence, anchor-preserving toggle |
| Top-level dispatch (~2470) | `location.hostname` routing + Turbo (Danbooru) / SPA (Pixiv/X) lifecycle |

## Key Design Decisions

### Data architecture (cron vs client)

- **All Danbooru API work happens in cron**, never in the userscript. The userscript fetches one static JSON. This means: zero Danbooru rate-limit exposure on the user side, no auth needed, no CORS issues, no cookies sent.
- **bounty.json is byte-stable** when inputs are unchanged. The cron uses sorted keys / sorted arrays everywhere and commits only when `git diff` would produce changes. No `generated_at` field — it would force a commit every run.
- **schema_version = 1** with additive field evolution (v0.3 added `registered_at_utc`, `completed`, `post_count_at_build`, `post_count_30d_delta`). The userscript gracefully degrades pre-v0.3 cached responses to `—` placeholders in the popover.
- **Cache key is versioned** (`ubm_bounty_artists_v2`) so a schema change can force one refresh on upgrade.

### Cron build pipeline (build-bounty.mjs)

- **System `curl` instead of node fetch/https** — Cloudflare's TLS-fingerprint heuristic on `danbooru.donmai.us` rejects undici's User-Agent on long query strings (~500+ chars). curl is guaranteed on both `ubuntu-latest` and macOS dev machines.
- **Approver+ threshold = level 37** (Approver, Moderator, Admin). Note: the common wisdom "Approver = 35" is wrong — 35 is Contributor.
- **Wikilinks first, URL fallback only if wikilink count is zero** — When an Approver post has wikilinks, the wikilinks are the authoritative intent; ignore extracted URLs even if present. The URL fallback (~7% of approver posts) saves the otherwise-untaggable cases.
- **`[s]...[/s]` strike content goes to `completed` bucket**, not dropped. Drives the popover's "✓ Completed" badge + strikethrough row. Quote blocks (`[quote]...[/quote]`) are still discarded entirely.
- **Concurrent fetch with deterministic processing** — `enrichWithUrls` and `fetchPostCount30dDeltas` use `Promise.all` over 5-tag chunks for wall-time, but processing iterates `[...tags].sort()` so collision resolution (`by_pixiv` / `by_x` first-wins by alphabetical canonical) is stable across runs.
- **Input safety caps** — `MAX_TAG_NAME_LENGTH = 170`, `MAX_USER_NAME_LENGTH = 50`. Adversarial forum posts can't inflate bounty.json with garbage. Response shape validation on users/aliases/artists endpoints drops malformed rows instead of crashing.

### Fetcher (userscript)

- **`GM_xmlhttpRequest`, not plain fetch** — Driven by X's strict CSP (`connect-src` whitelist excludes `raw.githubusercontent.com`). Tampermonkey runs the call in userscript context where CSP doesn't apply. Pixiv/Danbooru would work with plain fetch, but unifying through GM_xmlhttpRequest keeps the cache layer simple.
- **Stale-while-revalidate, 2h TTL** — Cache hit serves immediately, background-refreshes if stale. Negative cache (5min) suppresses retry storms after origin failures.
- **Single in-flight promise** — `refreshBountyData()` dedupes concurrent callers; the first-fetch path goes through the same guard (v0.3.6 fix — earlier versions could fire two parallel fetches on Turbo nav races).
- **30s timeout** on the GM_xmlhttpRequest itself so `ontimeout` actually fires.

### Per-site mount

- **Danbooru upload (`/uploads/*`)** — Turbo lifecycle (`turbo:load` / `turbo:before-visit`). Tag list is mounted by Alpine.js after `turbo:load`, so a MutationObserver retries until either the label lands or a 5s safety timeout cuts off. PPD check runs synchronously before the bounty data fetch completes (block the Post button as early as possible).
- **Pixiv** — SPA, no Turbo. `installSpaNavHooks` patches `history.pushState` / `replaceState` and listens for `popstate`. 300ms debounce after each nav (Phase v2.0.4 measured ~1s of mutation burst after pushState). Cleanup is idempotent-only: React unmounts marks naturally when mount roots are replaced.
- **X / Twitter** — Same SPA hooks, plus a separate `[role="main"]` `MutationObserver` with 250ms leading-edge throttle. Throttle (not debounce) because the timeline emits 15–30 mutations/sec continuously — a debounce would never fire. Timeline cards recycle on virtual scroll, so each mark carries `data-ubm-handle` and gets dropped + re-evaluated if the card's current author handle no longer matches.
- **Forum popover (`/forum_topics/24186`)** — Mounts a scroll-icon button next to the heading `<h1>`, with a 5s observer-and-timeout retry. The popover is `position: absolute`, anchored under the trigger. Clicks inside `stopPropagation()` to avoid the document-level outside-click handler tripping on detached re-rendered DOM.

### Forum popover (Resolved 41-46)

- **Sortable, paginated, persistable** — Sort mode + direction + Hide-completed are persisted to `localStorage[ubm_bt_prefs_v1]`. Current page is intentionally **not** persisted (resets to 0 on each open) since filter changes shift the meaningful position anyway.
- **Persistent anchor for Hide-completed** — Toggling Hide-completed twice would otherwise drift one page per cycle. A `forumAnchorTag` captures the first artist visible at toggle time and re-anchors on each subsequent toggle until the user does an explicit nav (sort / page / popover close).
- **CSS specificity hardening (v1.0.0)** — All `.ubm-bt-sort-btn` rules are prefixed with `.ubm-bt-popover` (specificity 0,3,0) so Danbooru's `form button:focus` (0,2,1) and similar can't out-cascade. `:focus` is explicitly defined alongside `:hover` and `:active`.

## Critical Rules

- **`@version` bump on functional changes** (memory `feedback_version_bump`). Patch for fix, minor for feature, major for breaking. Tampermonkey's update fetcher relies on this line.
- **`bounty.json` is cron-only** — Never hand-edit. The cron's no-op-skip will misbehave (or worse, manual changes get blown away on the next run). If you need to test a new shape, modify the cron output deterministically and let the next run commit it.
- **SVG asset sync** — `BOUNTY_MARK_SVG` / `SCROLL_ICON_SVG` constants in user.js are manually kept in sync with `assets/*.svg`. Update both together when the design changes (Resolved 31, 35).
- **SPA hooks survive cleanup intentionally** — `installSpaNavHooks` patches `history.pushState` once per page lifetime; cleanup does NOT restore the original. Pixiv/X SPAs only leave the userscript scope on full page unload, so leaving the patch installed avoids restore-order bugs with other extensions.
- **CSS prefix `--ubm-*` / `--ubm-bt-*`** — Isolated from BUTR's `--butr-*` and DanbooruInsights' `--di-*`. Container-scoped variable pattern, dark mode override on `body[data-current-user-theme="dark"] .ubm-bt-popover`.
- **JSDoc on shared-layer + per-site mount functions** — Especially document the *why* (Resolved decision id when applicable). PLAN.md `Resolved 14~46` is the design source-of-truth.

## Working Principles (extends root [/CLAUDE.md])

Root CLAUDE.md covers the universal principles (search before reading, report before changing behavior, report changed files, one task at a time, preserve UserScript headers). Additions specific to this project:

- **Self-verify after editing**: `node --check scripts/build-bounty.mjs` for the cron module; for `UploadBountyHelper.user.js` use `node -e "new Function(require('fs').readFileSync('UploadBountyHelper.user.js','utf8'))"` since it's an IIFE userscript. Catches syntax regressions immediately — note that the `node --check` approach won't work for the userscript without wrapping.
- **CSS-in-JS template literal trap**: Backticks inside CSS comments or `content: '...'` strings inside the `GLOBAL_CSS` / `MARK_CSS` / `DANBOORU_CSS` / `FORUM_CSS` template literals will silently terminate the string. Use single quotes inside CSS comments, not backticks. (Discovered during v1.0.0 contrast fix — wasted ~3 minutes on a TypeScript-style parser warning.)
- **Manual smoke against four sites**: Any change that touches mount logic or CSS needs a Tampermonkey reinstall + visit to (a) Danbooru upload page, (b) Pixiv profile/artwork, (c) X profile/timeline, (d) forum_topics/24186. Don't trust `node --check` for behavioural correctness.

## Multi-Model Workflow (extends root [/CLAUDE.md])

**Default**: main session runs on **Opus**. Opus orchestrates, decides, reviews, and handles small-to-medium implementation directly. **Sonnet** is invoked as a subagent only for mechanical work outside the fragile zones.

### Fragile zones for this project
- **The fetcher** (`fetchRemote` / `refreshBountyData` / `getBountyData`) — concurrency invariants matter (in-flight guard, negative cache). Touch with judgment.
- **Mount lifecycle** per site — Turbo on Danbooru, SPA hooks + observer on Pixiv/X, mount observer on forum. Each has subtle timing assumptions.
- **`build-bounty.mjs` enrichWithUrls** — fetch and process phases are deliberately separated to keep collision resolution deterministic. Re-merging the loops would re-introduce non-determinism.

### Task-document rule
Every TASK.md entry MUST mark its execution path as `Direct (Opus)` or `Delegate (Sonnet)`. PLAN.md captures the design decisions and the Resolved-N entries; TASK.md captures phases and individual task status.

## Evaluator Rubric (run before declaring done)

| # | Gate | Command | Notes |
|---|---|---|---|
| G1a | userscript syntax | `node -e "new Function(require('fs').readFileSync('UploadBountyHelper.user.js','utf8'))"` | Parses the IIFE body — catches CSS-in-JS backtick traps too |
| G1b | build script syntax | `node --check scripts/build-bounty.mjs` | Standard Node ESM check |
| G2 | UserScript metadata | Manual: reinstall in Tampermonkey, verify `@version` / `@match` recognised | Header health |
| G3a | Bounty label (Danbooru upload) | Manual smoke at `/uploads/<id>` for a known bounty artist | V1, V2 baseline |
| G3b | External marks (Pixiv/X) | Manual smoke at one Pixiv profile + one X profile / timeline | V_pixiv_1, V_x_1 |
| G3c | Forum popover | Manual smoke at `/forum_topics/24186` — open popover, sort, paginate, hide-completed | V_bt_1, V_bt_3, V_bt_7 |
| G4 | Cron round-trip | After PR merge, observe the first cron slot (8h cadence) produces a fresh build or skips deterministically | C2, C7 |

When G1 fails, fix the root cause — do not whitelist or `eslint-disable`. CSS template literal traps especially warrant a regex sweep (`grep -n '`' UploadBountyHelper.user.js`) to confirm no other CSS comment contains stray backticks.

## Testing Notes

- No automated test framework. Manual verification via Tampermonkey on real pages.
- Verification scenario IDs (`V1`~`V14`, `V_pixiv_*`, `V_x_*`, `V_bt_*`, `C1`~`C7`) live in [PLAN.md](PLAN.md) §Verification per cycle. Phase-specific sampling lists are in [TASK.md](TASK.md) — TASK.md is gitignored, treat it as a local working scratchpad.
- For semantic regressions in mount logic, the four-site smoke (G3a + G3b + G3c) is the minimum. Cron round-trip (G4) is observed post-merge, not gated pre-merge.

## File Layout

```
UploadBountyHelper/
├── README.md                          # User-facing
├── CLAUDE.md                          # This file
├── PLAN.md                            # Design source-of-truth, Resolved decisions log
├── TASK.md                            # Phased checklist (gitignored — local scratchpad)
├── UploadBountyHelper.user.js         # The userscript
├── scripts/
│   └── build-bounty.mjs               # GitHub Actions cron build script
├── data/
│   └── bounty.json                    # Cron output (auto-committed, never hand-edit)
└── assets/
    ├── bounty-mark.svg                # Design reference for the green box+check mark
    └── scroll-icon.svg                # Design reference for the forum popover trigger
```

Sibling files outside the project directory:
- `../.archive/UploadBountyHelper-v1.0.md` — development narrative (blog-style retrospective)
- `../.github/workflows/update-bounty.yml` — the GitHub Actions cron workflow
