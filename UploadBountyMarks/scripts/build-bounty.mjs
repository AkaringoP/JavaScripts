#!/usr/bin/env node
// UploadBountyMarks — bounty.json builder
// Node 20+, ES module, zero npm dependencies (uses built-in fetch).
// Usage: node build-bounty.mjs <output_path>
// See PLAN.md D1 pipeline (5 steps) and Resolved Decisions 14–19.

import { writeFile, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';

const TOPIC_ID = 24186;
const APPROVER_LEVEL_THRESHOLD = 37;
const FORUM_LIMIT = 1000;
const USERS_LIMIT = 1000;
const ALIAS_LIMIT = 1000;
const ARTISTS_LIMIT = 1000;
const ALIAS_CHUNK_SIZE = 100;
const SCHEMA_VERSION = 1;
const SOURCE_URL = `https://danbooru.donmai.us/forum_topics/${TOPIC_ID}`;
const API_BASE = 'https://danbooru.donmai.us';
const USER_AGENT = 'UploadBountyMarks-build/0.1 (github.com/AkaringoP/JavaScripts)';

const PIXIV_USER_RE = /pixiv\.net\/(?:en\/)?users\/(\d+)/i;
const PIXIV_USER_RE_G = /pixiv\.net\/(?:en\/)?users\/(\d+)/gi;
// Match `x.com/<handle>` / `twitter.com/<handle>` but not subdomains. The
// boundary `[^.\w]` excludes letters and dots (avoids `hellox.com` and
// `sub.x.com`) while allowing `/` and `:` (the typical scheme separators).
const X_HANDLE_RE = /(?:^|[^.\w])(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/i;
const X_HANDLE_RE_G = /(?:^|[^.\w])(?:x\.com|twitter\.com)\/([A-Za-z0-9_]{1,15})(?:[/?#]|$)/gi;
// `x.com/i/user/<numeric>` is an internal redirect form, not a real handle.
const X_INTERNAL_HANDLE = 'i';
const WIKILINK_RE = /\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g;
const QUOTE_BLOCK_RE = /\[quote\][\s\S]*?\[\/quote\]/gi;
const STRIKE_BLOCK_RE = /\[s\][\s\S]*?\[\/s\]/gi;

/**
 * Emit a structured single-line JSON log record to stderr.
 * @param {string} level
 * @param {string} msg
 * @param {Object} [meta]
 */
function log(level, msg, meta = {}) {
  process.stderr.write(JSON.stringify({ level, msg, ...meta }) + '\n');
}

/**
 * Single-shot HTTPS GET via system `curl`. Node's built-in fetch (undici) and
 * node:https both get rejected by Danbooru's Cloudflare edge on long query
 * strings (~500+ chars), likely a TLS fingerprint heuristic. curl avoids this
 * and is guaranteed on both `ubuntu-latest` runners and macOS.
 * @param {string} url
 * @return {Promise<{status: number, body: string}>}
 */
function curlGetOnce(url) {
  return new Promise((resolve, reject) => {
    const args = [
      '-sS',
      '-A', USER_AGENT,
      '-H', 'Accept: application/json',
      '-w', '\n%{http_code}',
      '--max-time', '30',
      url,
    ];
    const proc = spawn('curl', args);
    const stdout = [];
    const stderr = [];
    proc.stdout.on('data', c => stdout.push(c));
    proc.stderr.on('data', c => stderr.push(c));
    proc.on('error', reject);
    proc.on('close', code => {
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        reject(new Error(`curl exit ${code}: ${err || '(no stderr)'}`));
        return;
      }
      const out = Buffer.concat(stdout).toString('utf8');
      const lastNl = out.lastIndexOf('\n');
      const body = lastNl >= 0 ? out.slice(0, lastNl) : '';
      const status = parseInt(lastNl >= 0 ? out.slice(lastNl + 1) : out, 10);
      resolve({ status, body });
    });
  });
}

/**
 * Fetch a JSON resource with 1s/2s/4s exponential backoff on 5xx/429/network
 * errors. 4xx (other than 429) fails fast.
 * @param {string} url
 * @param {{attempt?: number}} [opts]
 * @return {Promise<*>}
 */
async function fetchJson(url, { attempt = 0 } = {}) {
  const MAX_ATTEMPTS = 3;
  const BACKOFF_MS = [1000, 2000, 4000];
  try {
    const { status, body } = await curlGetOnce(url);
    if (status >= 200 && status < 300) return JSON.parse(body);
    if (status >= 400 && status < 500 && status !== 429) {
      throw new Error(`HTTP ${status} (fail-fast) for ${url}`);
    }
    throw new Error(`HTTP ${status} for ${url}`);
  } catch (err) {
    if (attempt >= MAX_ATTEMPTS - 1 || err.message.includes('fail-fast')) {
      throw err;
    }
    const wait = BACKOFF_MS[attempt];
    log('warn', 'retry', {
      url,
      attempt: attempt + 1,
      wait_ms: wait,
      error: err.message,
    });
    await new Promise(r => setTimeout(r, wait));
    return fetchJson(url, { attempt: attempt + 1 });
  }
}

/**
 * Step 1 — Paginate `forum_posts.json` for `topicId`. Stops when a page is
 * empty or shorter than `FORUM_LIMIT`.
 * @param {number} topicId
 * @return {Promise<!Array<!Object>>}
 */
async function fetchForumPosts(topicId) {
  const posts = [];
  for (let page = 1; ; page += 1) {
    const url = `${API_BASE}/forum_posts.json?search%5Btopic_id%5D=${topicId}` +
        `&limit=${FORUM_LIMIT}&page=${page}`;
    const batch = await fetchJson(url);
    if (!Array.isArray(batch) || batch.length === 0) break;
    posts.push(...batch);
    if (batch.length < FORUM_LIMIT) break;
  }
  return posts;
}

/**
 * Step 2 helper — batch lookup users by id (comma-separated, exact match).
 * @param {!Array<number>} ids
 * @return {Promise<!Map<number, !Object>>}
 */
async function fetchUsers(ids) {
  if (ids.length === 0) return new Map();
  const url = `${API_BASE}/users.json?search%5Bid%5D=${ids.join(',')}` +
      `&only=id,name,level&limit=${USERS_LIMIT}`;
  const users = await fetchJson(url);
  return new Map(users.map(u => [u.id, u]));
}

/**
 * Step 2 — Keep posts whose creator level >= threshold (Approver+, see
 * Resolved 14).
 * @param {!Array<!Object>} posts
 * @param {!Map<number, !Object>} userMap
 * @param {number} threshold
 * @return {!Array<!Object>}
 */
function filterApproverPlus(posts, userMap, threshold) {
  return posts.filter(p => {
    const u = userMap.get(p.creator_id);
    return u && u.level >= threshold;
  });
}

/** Normalize a wikilink target to Danbooru tag form. */
function normalizeName(raw) {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Strip `[quote]`/`[s]` blocks before extraction (Resolved 15).
 * @param {string|null|undefined} body
 * @return {string}
 */
function preprocessBody(body) {
  if (!body) return '';
  return body.replace(QUOTE_BLOCK_RE, '').replace(STRIKE_BLOCK_RE, '');
}

/**
 * Step 3 (extract) — Return normalized wikilink targets in source order.
 * @param {string} cleanedBody
 * @return {!Array<string>}
 */
function extractWikilinks(cleanedBody) {
  const out = [];
  for (const m of cleanedBody.matchAll(WIKILINK_RE)) {
    const name = normalizeName(m[1]);
    if (name) out.push(name);
  }
  return out;
}

/**
 * Step 3 fallback — Return canonical-form ext URLs (Pixiv user, X handle)
 * mentioned in plain text. Internal `x.com/i/user/<id>` redirects are
 * skipped (they have no usable handle).
 * @param {string} cleanedBody
 * @return {!Array<string>}
 */
function extractExtUrls(cleanedBody) {
  const urls = new Set();
  for (const m of cleanedBody.matchAll(PIXIV_USER_RE_G)) {
    urls.add(`https://www.pixiv.net/users/${m[1]}`);
  }
  for (const m of cleanedBody.matchAll(X_HANDLE_RE_G)) {
    const handle = m[1].toLowerCase();
    if (handle !== X_INTERNAL_HANDLE) urls.add(`https://x.com/${handle}`);
  }
  return [...urls];
}

/**
 * Step 3 fallback (cont.) — Reverse-lookup an artist by Pixiv/X URL.
 * Used only for Approver+ posts that have no wikilinks at all (~7% of
 * sampled posts). Returns normalized canonical names, possibly empty.
 * @param {string} url
 * @return {Promise<!Array<string>>}
 */
async function lookupArtistsByUrl(url) {
  const apiUrl = `${API_BASE}/artists.json?search%5Burl_matches%5D=` +
      `${encodeURIComponent(url)}&only=name&limit=5`;
  try {
    const recs = await fetchJson(apiUrl);
    if (!Array.isArray(recs)) return [];
    return recs.map(r => r.name).filter(Boolean).map(normalizeName);
  } catch (err) {
    log('warn', 'url_matches lookup failed', { url, error: err.message });
    return [];
  }
}

/**
 * Step 3 (combined) — For each Approver+ post, gather artist names. Wikilinks
 * are preferred when present; ext-URL fallback runs only when wikilinks are
 * absent (post-level OR not per-mention, so wikilink+URL posts trust the
 * wikilink alone — Approver intent).
 * @param {!Array<!Object>} approverPosts
 * @return {Promise<!Array<{post: !Object, names: !Array<string>}>>}
 */
async function extractArtistMentions(approverPosts) {
  const result = [];
  let fallbackPosts = 0;
  let fallbackHits = 0;
  for (const post of approverPosts) {
    const cleaned = preprocessBody(post.body);
    let names = extractWikilinks(cleaned);
    if (names.length === 0) {
      const urls = extractExtUrls(cleaned);
      if (urls.length > 0) {
        fallbackPosts += 1;
        const collected = [];
        for (const url of urls) {
          const matched = await lookupArtistsByUrl(url);
          collected.push(...matched);
        }
        names = [...new Set(collected)];
        if (names.length > 0) fallbackHits += 1;
      }
    }
    result.push({ post, names });
  }
  log('info', 'ext-url fallback summary', {
    fallback_posts: fallbackPosts,
    fallback_hits: fallbackHits,
  });
  return result;
}

/**
 * Step 3 (resolve) — Batch-resolve active aliases using `antecedent_name_array[]`
 * repetition (Resolved 16). Returns Map<antecedent, consequent>.
 * @param {!Array<string>} names
 * @return {Promise<!Map<string, string>>}
 */
async function resolveAliases(names) {
  const aliasMap = new Map();
  for (let i = 0; i < names.length; i += ALIAS_CHUNK_SIZE) {
    const chunk = names.slice(i, i + ALIAS_CHUNK_SIZE);
    const params = chunk
        .map(n => `search%5Bantecedent_name_array%5D%5B%5D=${encodeURIComponent(n)}`)
        .join('&');
    const url = `${API_BASE}/tag_aliases.json?${params}` +
        `&search%5Bstatus%5D=active&only=antecedent_name,consequent_name` +
        `&limit=${ALIAS_LIMIT}`;
    const aliases = await fetchJson(url);
    for (const a of aliases) {
      aliasMap.set(a.antecedent_name, a.consequent_name);
    }
  }
  return aliasMap;
}

/**
 * Step 3 (merge) — Map (post, extracted names) × alias resolution into
 * canonical-keyed entries.
 * @param {!Array<{post: !Object, names: !Array<string>}>} postsWithNames
 * @param {!Map<number, !Object>} userMap
 * @param {!Map<string, string>} aliasMap
 * @return {!Map<string, {post_ids: !Set<number>, approvers: !Map<number, string>, aliased_from: !Set<string>}>}
 */
function buildArtistMap(postsWithNames, userMap, aliasMap) {
  const artistMap = new Map();
  for (const { post, names } of postsWithNames) {
    const u = userMap.get(post.creator_id);
    if (!u) continue;
    for (const rawName of names) {
      const canonical = aliasMap.get(rawName) ?? rawName;
      if (!artistMap.has(canonical)) {
        artistMap.set(canonical, {
          post_ids: new Set(),
          approvers: new Map(),
          aliased_from: new Set(),
        });
      }
      const entry = artistMap.get(canonical);
      entry.post_ids.add(post.id);
      entry.approvers.set(u.id, u.name);
      if (rawName !== canonical) entry.aliased_from.add(rawName);
    }
  }
  return artistMap;
}

/**
 * Resolve a single collision by picking the alphabetically smaller canonical
 * tag — deterministic and stable across runs.
 */
function pickCanonicalWinner(prev, current) {
  return prev < current ? prev : current;
}

/**
 * Step 4 — For each canonical tag, fetch `artists.json` to (a) confirm it is
 * an artist tag (non-artist wikilinks like copyright/general tags return
 * empty and are silently dropped per PLAN D1 step 4) and (b) extract Pixiv
 * user IDs and X handles for reverse-index publishing.
 * @param {!Map<string, !Object>} artistMap
 * @return {Promise<{enriched: !Map, byPixiv: !Map, byX: !Map}>}
 */
async function enrichWithUrls(artistMap) {
  const enriched = new Map();
  const byPixiv = new Map();
  const byX = new Map();
  const tags = [...artistMap.keys()].sort();
  for (const tag of tags) {
    let artistRecords;
    try {
      const url = `${API_BASE}/artists.json?search%5Bname%5D=${encodeURIComponent(tag)}` +
          `&only=name,urls&limit=${ARTISTS_LIMIT}`;
      artistRecords = await fetchJson(url);
    } catch (err) {
      log('warn', 'artists.json fetch failed, dropping tag', {
        tag,
        error: err.message,
      });
      continue;
    }
    if (!Array.isArray(artistRecords) || artistRecords.length === 0) {
      // Silent drop: non-artist wikilink (e.g. copyright, general tag).
      continue;
    }
    const pixivIds = new Set();
    const xHandles = new Set();
    for (const rec of artistRecords) {
      for (const urlObj of rec.urls ?? []) {
        const u = typeof urlObj === 'string' ? urlObj : urlObj.url;
        if (!u) continue;
        const pm = u.match(PIXIV_USER_RE);
        if (pm) pixivIds.add(pm[1]);
        const xm = u.match(X_HANDLE_RE);
        if (xm) {
          const handle = xm[1].toLowerCase();
          if (handle !== X_INTERNAL_HANDLE) xHandles.add(handle);
        }
      }
    }
    const entry = artistMap.get(tag);
    enriched.set(tag, {
      post_ids: [...entry.post_ids].sort((a, b) => a - b),
      approvers: [...entry.approvers.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([, name]) => name),
      aliased_from: [...entry.aliased_from].sort(),
      pixiv_user_ids: [...pixivIds].sort(),
      x_handles: [...xHandles].sort(),
    });
    for (const id of pixivIds) {
      const prev = byPixiv.get(id);
      if (prev && prev !== tag) {
        const winner = pickCanonicalWinner(prev, tag);
        log('warn', 'by_pixiv collision', { pixiv_id: id, prev, current: tag, winner });
        byPixiv.set(id, winner);
      } else {
        byPixiv.set(id, tag);
      }
    }
    for (const h of xHandles) {
      const prev = byX.get(h);
      if (prev && prev !== tag) {
        const winner = pickCanonicalWinner(prev, tag);
        log('warn', 'by_x collision', { handle: h, prev, current: tag, winner });
        byX.set(h, winner);
      } else {
        byX.set(h, tag);
      }
    }
  }
  return { enriched, byPixiv, byX };
}

/**
 * Step 5 — Serialize to a deterministic schema_version=1 object: every map
 * is sorted by key, lists by content. Output is byte-stable across runs
 * when inputs are unchanged (C7).
 * @param {{enriched: !Map, byPixiv: !Map, byX: !Map}} input
 * @return {!Object}
 */
function serialize({ enriched, byPixiv, byX }) {
  const artists = {};
  for (const tag of [...enriched.keys()].sort()) {
    artists[tag] = enriched.get(tag);
  }
  const by_pixiv = {};
  for (const k of [...byPixiv.keys()].sort()) by_pixiv[k] = byPixiv.get(k);
  const by_x = {};
  for (const k of [...byX.keys()].sort()) by_x[k] = byX.get(k);
  return {
    schema_version: SCHEMA_VERSION,
    source: SOURCE_URL,
    approver_level_threshold: APPROVER_LEVEL_THRESHOLD,
    artists,
    by_pixiv,
    by_x,
  };
}

async function main() {
  const outputPath = process.argv[2];
  if (!outputPath) {
    log('error', 'usage: node build-bounty.mjs <output_path>');
    process.exit(2);
  }

  log('info', 'step 1: fetch forum posts', { topic_id: TOPIC_ID });
  const posts = await fetchForumPosts(TOPIC_ID);
  log('info', 'forum posts fetched', { count: posts.length });

  log('info', 'step 2: filter Approver+');
  const creatorIds = [...new Set(posts.map(p => p.creator_id))].sort((a, b) => a - b);
  const userMap = await fetchUsers(creatorIds);
  const approverPosts = filterApproverPlus(posts, userMap, APPROVER_LEVEL_THRESHOLD);
  log('info', 'approver+ posts', {
    total_posts: posts.length,
    approver_posts: approverPosts.length,
    unique_creators: creatorIds.length,
    approver_creators: [...userMap.values()].filter(u => u.level >= APPROVER_LEVEL_THRESHOLD).length,
  });

  log('info', 'step 3: extract mentions (wikilink + ext-URL fallback)');
  const postsWithNames = await extractArtistMentions(approverPosts);
  const rawNames = new Set();
  for (const { names } of postsWithNames) {
    for (const n of names) rawNames.add(n);
  }
  const sortedNames = [...rawNames].sort();
  log('info', 'raw mentions extracted', { unique_names: sortedNames.length });
  const aliasMap = await resolveAliases(sortedNames);
  log('info', 'aliases resolved', { alias_count: aliasMap.size });
  const artistMap = buildArtistMap(postsWithNames, userMap, aliasMap);
  log('info', 'artist map built', { canonical_tags: artistMap.size });

  log('info', 'step 4: enrich with URLs');
  const { enriched, byPixiv, byX } = await enrichWithUrls(artistMap);
  log('info', 'enrichment complete', {
    enriched_tags: enriched.size,
    dropped_non_artist: artistMap.size - enriched.size,
    by_pixiv_count: byPixiv.size,
    by_x_count: byX.size,
  });

  log('info', 'step 5: serialize + write', { output: outputPath });
  const obj = serialize({ enriched, byPixiv, byX });
  const json = JSON.stringify(obj, null, 2) + '\n';

  let prevHash = null;
  try {
    const prev = await readFile(outputPath, 'utf8');
    prevHash = prev === json ? 'identical' : 'changed';
  } catch {
    prevHash = 'new';
  }
  await writeFile(outputPath, json, 'utf8');
  log('info', 'done', { state: prevHash, bytes: json.length });
}

main().catch(err => {
  log('error', 'fatal', { error: err.message, stack: err.stack });
  process.exit(1);
});
