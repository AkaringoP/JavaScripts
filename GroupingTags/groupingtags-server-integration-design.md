# GroupingTags — Server Integration Design

> This document captures the complete design for migrating GroupingTags from a client-side userscript with Gist sync to a native Danbooru server feature. It is intended as a reference for Claude Code implementation.

## Table of Contents

1. [Overview & Key Decisions](#1-overview--key-decisions)
2. [Data Model](#2-data-model)
3. [Server Implementation](#3-server-implementation)
4. [Sidebar UI — Native Danbooru Integration](#4-sidebar-ui--native-danbooru-integration)
5. [Search Query Syntax](#5-search-query-syntax)
6. [Autocomplete Compatibility](#6-autocomplete-compatibility)
7. [Userscript-Side Changes](#7-userscript-side-changes)
8. [Phantom Mode Highlighter Improvements](#8-phantom-mode-highlighter-improvements)
9. [User Experience Comparison](#9-user-experience-comparison)
10. [Implementation Checklist](#10-implementation-checklist)

---

## 1. Overview & Key Decisions

GroupingTags allows users to visually group related tags on a Danbooru post (e.g., grouping `shirt` and `pants` under "Outfit"). Currently it runs entirely client-side with IndexedDB storage and GitHub Gist synchronization. This design migrates it to a native server feature.

### Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Data ownership | **Shared model** (Pool/Note pattern) | All users see and edit the same groups. Toggle is client-side only (show/hide). |
| Concurrency | **Pessimistic locking** (`post.with_lock`) | Danbooru standard. PostgreSQL `SELECT FOR UPDATE`. Last-Write-Wins. |
| Save strategy | **Bulk API** (`PUT bulk_update`) | Atomic save on submit. All-or-nothing transaction, no partial state. |
| Empty group handling | **Auto soft delete** | Last tag removed → auto `is_deleted = true`. Same name re-creation → undelete existing record. |
| Search syntax | **Square brackets** `[tag1 tag2]` | AND/OR/NOT group search with `-`/`~` prefixes. |
| `[` conflict resolution | **Preceding-character rule** (updated) | `[` preceded by whitespace/start/`-`/`~` → group syntax. Preceded by tag character → part of tag name. |
| Single-tag group search | **Allowed** | `[shirt]` means "posts where shirt belongs to any group". |
| UI rendering | **ViewComponent + Stimulus** | Server-rendered HTML, no client-side DOM manipulation. |

---

## 2. Data Model

### Tables

Two tables, global across the server:

**`post_tag_groups`**

```
id              bigint       PK
post_id         bigint       FK → posts, NOT NULL, indexed
updater_id      bigint       FK → users, NOT NULL
name            string       NOT NULL
tag_names       text[]       NOT NULL, GIN indexed
is_deleted      boolean      NOT NULL, DEFAULT false
created_at      timestamp
updated_at      timestamp
```

- Unique constraint: `[post_id, name]` WHERE `is_deleted = false`
- GIN index on `tag_names` for array containment queries

**`post_tag_group_versions`**

```
id                   bigint    PK
post_tag_group_id    bigint    FK → post_tag_groups, NOT NULL, indexed
post_id              bigint    FK → posts, NOT NULL, indexed
updater_id           bigint    FK → users, NOT NULL
name                 string    NOT NULL
tag_names            text[]    NOT NULL
is_deleted           boolean   NOT NULL
created_at           timestamp
```

### Migration

```ruby
class CreatePostTagGroups < ActiveRecord::Migration[7.1]
  def change
    create_table :post_tag_groups do |t|
      t.references :post, null: false, foreign_key: true
      t.references :updater, null: false, foreign_key: { to_table: :users }
      t.string :name, null: false
      t.text :tag_names, array: true, null: false, default: []
      t.boolean :is_deleted, null: false, default: false
      t.timestamps
    end

    add_index :post_tag_groups, [:post_id, :name], unique: true, where: "is_deleted = false"
    add_index :post_tag_groups, :tag_names, using: :gin

    create_table :post_tag_group_versions do |t|
      t.references :post_tag_group, null: false, foreign_key: true
      t.references :post, null: false, foreign_key: true
      t.references :updater, null: false, foreign_key: { to_table: :users }
      t.string :name, null: false
      t.text :tag_names, array: true, null: false, default: []
      t.boolean :is_deleted, null: false, default: false
      t.datetime :created_at, null: false
    end

    add_index :post_tag_group_versions, :post_tag_group_id
    add_index :post_tag_group_versions, :post_id
  end
end
```

---

## 3. Server Implementation

### 3.1 PostTagGroup Model

```ruby
# app/models/post_tag_group.rb
class PostTagGroup < ApplicationRecord
  belongs_to :post
  belongs_to_updater

  array_attribute :tag_names

  validates :name, presence: true, length: { maximum: 50 }
  validates :tag_names, presence: true, unless: :is_deleted?

  before_save :sort_tags
  after_save :create_version, if: :saved_change_to_watched_attributes?

  scope :active, -> { where(is_deleted: false) }

  deletable  # Danbooru standard soft-delete mixin

  def sort_tags
    # Character tags first, then alphabetical within each category
    self.tag_names = tag_names.sort_by do |name|
      tag = Tag.find_by(name: name)
      category = tag&.category || Tag.categories.general
      [category == Tag.categories.character ? 0 : 1, name]
    end
  end

  def revert_to!(version)
    update!(
      name: version.name,
      tag_names: version.tag_names,
      is_deleted: version.is_deleted
    )
  end

  private

  def watched_attributes
    %w[name tag_names is_deleted]
  end

  def saved_change_to_watched_attributes?
    watched_attributes.any? { |attr| saved_change_to_attribute?(attr) }
  end

  def create_version
    # Merge edits by same user within 1 hour
    last_version = PostTagGroupVersion
      .where(post_tag_group: self, updater: CurrentUser.user)
      .where("created_at > ?", 1.hour.ago)
      .last

    if last_version
      last_version.update!(
        name: name,
        tag_names: tag_names,
        is_deleted: is_deleted
      )
    else
      PostTagGroupVersion.create!(
        post_tag_group: self,
        post: post,
        updater: CurrentUser.user,
        name: name,
        tag_names: tag_names,
        is_deleted: is_deleted
      )
    end
  end
end
```

### 3.2 PostTagGroupVersion Model

```ruby
# app/models/post_tag_group_version.rb
class PostTagGroupVersion < ApplicationRecord
  belongs_to :post_tag_group
  belongs_to :post
  belongs_to_updater

  def previous
    PostTagGroupVersion
      .where(post_tag_group_id: post_tag_group_id)
      .where("id < ?", id)
      .order(id: :desc)
      .first
  end

  def added_tags
    previous ? tag_names - previous.tag_names : tag_names
  end

  def removed_tags
    previous ? previous.tag_names - tag_names : []
  end

  def unchanged_tags
    previous ? tag_names & previous.tag_names : []
  end

  def status_fields
    fields = []
    fields << "Tags" if previous && tag_names != previous.tag_names
    fields << "Renamed" if previous && name != previous.name
    fields << "Deleted" if is_deleted && (!previous || !previous.is_deleted)
    fields << "Undeleted" if !is_deleted && previous&.is_deleted
    fields
  end
end
```

### 3.3 bulk_update! — Core Save Logic

The `bulk_update!` method handles 5 cases atomically within `post.with_lock`:

```ruby
# app/models/post_tag_group.rb (class method)
def self.bulk_update!(post_id:, groups_data:, updater:)
  post = Post.find(post_id)
  post.with_lock do
    all_groups = PostTagGroup.where(post: post).index_by(&:name)

    groups_data.each do |name, tag_names|
      next if tag_names.blank?

      existing = all_groups[name]

      if existing&.is_deleted?
        # Case 2: Undelete + update (same name re-creation)
        existing.update!(tag_names: tag_names, is_deleted: false, updater: updater)
      elsif existing
        # Case 3: Update existing active group
        # Case 4: Skip if no changes
        existing.update!(tag_names: tag_names, updater: updater) if existing.tag_names != tag_names
      else
        # Case 1: Brand new group
        PostTagGroup.create!(post: post, name: name, tag_names: tag_names, updater: updater)
      end
    end

    # Case 5: Active groups not in parse result → soft delete
    active_group_names = groups_data.select { |_, tags| tags.present? }.keys
    PostTagGroup.active.where(post: post)
      .where.not(name: active_group_names)
      .find_each do |group|
        group.update!(tag_names: [], is_deleted: true, updater: updater)
      end
  end
end
```

### 3.4 Controller

```ruby
# app/controllers/post_tag_groups_controller.rb
class PostTagGroupsController < ApplicationController
  respond_to :html, :json

  def index
    @post_tag_groups = authorize PostTagGroup.paginated_search(params)
    respond_with(@post_tag_groups)
  end

  def show
    @post_tag_group = authorize PostTagGroup.find(params[:id])
    respond_with(@post_tag_group)
  end

  def create
    @post_tag_group = authorize PostTagGroup.new(permitted_attributes(PostTagGroup))
    Post.find(@post_tag_group.post_id).with_lock do
      @post_tag_group.save
    end
    respond_with(@post_tag_group)
  end

  def update
    @post_tag_group = authorize PostTagGroup.find(params[:id])
    @post_tag_group.post.with_lock do
      @post_tag_group.update(permitted_attributes(@post_tag_group))
    end
    respond_with(@post_tag_group)
  end

  def destroy
    @post_tag_group = authorize PostTagGroup.find(params[:id])
    @post_tag_group.post.with_lock do
      @post_tag_group.update!(is_deleted: true)
    end
    respond_with(@post_tag_group)
  end

  def revert
    @post_tag_group = authorize PostTagGroup.find(params[:id])
    @version = PostTagGroupVersion.find(params[:version_id])
    @post_tag_group.revert_to!(@version)
    respond_with(@post_tag_group)
  end

  def bulk_update
    post = Post.find(params[:post_id])
    authorize PostTagGroup.new(post: post)
    PostTagGroup.bulk_update!(
      post_id: post.id,
      groups_data: params[:groups].to_h,
      updater: CurrentUser.user
    )
    respond_with(post.tag_groups.active)
  end

  # Server-rendered tag list for Group View
  def tag_list
    @post = Post.find(params[:post_id])
    @tag_groups = @post.tag_groups.active
    @view = params[:view] || "category"
    render partial: "tag_list", locals: { post: @post, tag_groups: @tag_groups, view: @view }
  end
end
```

### 3.5 PostTagGroupVersionsController

```ruby
# app/controllers/post_tag_group_versions_controller.rb
class PostTagGroupVersionsController < ApplicationController
  respond_to :html, :json

  def index
    @versions = authorize PostTagGroupVersion.paginated_search(params)
    respond_with(@versions)
  end

  def show
    @version = authorize PostTagGroupVersion.find(params[:id])
    respond_with(@version)
  end
end
```

### 3.6 Policy

Follows Pool pattern:

```ruby
# app/policies/post_tag_group_policy.rb
class PostTagGroupPolicy < ApplicationPolicy
  def create?
    unbanned?
  end

  def update?
    unbanned? && (!record.is_deleted? || user.is_builder?)
  end

  def destroy?
    user.is_builder?
  end

  def revert?
    unbanned?
  end

  def bulk_update?
    unbanned?
  end

  def permitted_attributes
    [:post_id, :name, { tag_names: [] }]
  end
end
```

Rate limit: Builder 8/min, normal user 2/min.

### 3.7 Routes

```ruby
# config/routes.rb
resources :post_tag_groups do
  collection do
    put :bulk_update
    get :tag_list
  end
  member do
    put :revert
  end
end

resources :post_tag_group_versions, only: [:index, :show]
```

### 3.8 Post Model Integration

```ruby
# app/models/post.rb
has_many :tag_groups, class_name: "PostTagGroup"

# Add to available_includes
def self.available_includes
  # ... existing includes ...
  [:tag_groups]
end
```

API usage: `GET /posts/12345.json?only=id,tag_string,tag_groups` (not included in default response for performance).

### 3.9 User Setting

Add `show_tag_groups` boolean to User model (default: false). Exposed in Settings page as a checkbox. Controls whether tag group UI is rendered on post pages.

### 3.10 History Tab Integration

Post sidebar History section gets a "Groups" link → `/post_tag_group_versions?search[post_id]=12345`. Same pattern as Tags/Pools/Notes/Moderation/Commentary. Version diff display: added tags in green, removed tags in red.

---

## 4. Sidebar UI — Native Danbooru Integration

Migrated from userscript DOM manipulation to server-rendered ViewComponent + Stimulus JS.

### 4.1 ViewComponents

- **`PostTagGroupIndicatorComponent`** — Renders color circle indicators (ghost/single/multi) next to tag list section header
- **`TagListViewSwitchComponent`** — Dropdown to switch between Category View and Groups View
- **`TagListGroupViewComponent`** — Server-rendered Groups View (tags organized by group)
- **`TagListItemComponent`** — Individual tag item within a group

### 4.2 Stimulus Controllers

- **`tag_group_menu_controller`** — Pill Menu: toggle tags into groups, create new groups
- **`tag_group_view_controller`** — View switching: requests HTML from server (`GET /post_tag_groups/tag_list?post_id=12345&view=groups`), replaces `#tag-list-content` region via Turbo Frame

### 4.3 Styling

SCSS using Danbooru CSS variables (`--card-bg-color`, `--muted-text-color`, etc.). No `detectDarkTheme()` JS branching needed — CSS variables handle both themes automatically.

---

## 5. Search Query Syntax

### 5.1 Grammar

```
[tag1 tag2]                  AND: tag1 and tag2 are in the same group
[tag1]                       Posts where tag1 belongs to any group
[tag1 tag2] [tag3 tag4]      Both conditions must be satisfied
~[tag1 tag2] ~[tag3 tag4]    Either condition must be satisfied
-[tag1]                      Posts where tag1 does NOT belong to any group
-[tag1 tag2]                 Posts where tag1 and tag2 are NOT in the same group
```

Can be freely combined with regular tags: `1girl [shirt pants] rating:s`

### 5.2 Parser — Distinguishing Group Syntax vs Tag Names

**Rule:** `[` is group syntax only when preceded by whitespace, string start, `-`, or `~`. When preceded by a tag character (letter, digit, `_`, `:`, `(`, etc.), it is part of a tag name.

Real Danbooru tags with `[` in names (all have tag characters before `[`):

```
00_qan[t]                    → [ preceded by "n" → tag name
project_[i]                  → [ preceded by "_" → tag name
exe:late[st]                 → [ preceded by "e" → tag name
:[]                          → [ preceded by ":" → tag name
(doki_doki[dive!])           → [ preceded by "i" → tag name
```

### 5.3 Parser Implementation

```ruby
# app/logical/post_query.rb

# Regex: [ preceded by whitespace/start, optional -/~ prefix, content, ]
GROUP_PATTERN = /(?:(?<=\s)|(?<=\A))([-~])?\[\s*([^\]]+?)\s*\]/

def extract_group_clauses(query_string)
  clauses = { and: [], or: [], not: [] }

  query_string.scan(GROUP_PATTERN) do |prefix, content|
    tags = content.split.map { |t| Tag.normalize_name(t) }
    next if tags.empty?

    case prefix
    when '-' then clauses[:not] << tags
    when '~' then clauses[:or] << tags
    else clauses[:and] << tags
    end
  end

  clauses
end

def remove_group_clauses(query_string)
  remaining = query_string.gsub(/(?:(?<=\s)|(?<=\A))[-~]?\[\s*[^\]]+?\s*\]/, ' ')
  remaining.squish
end
```

Two-stage parsing: extract group clauses first → remove them → pass remainder to existing tag parser.

### 5.4 SQL Generation

```sql
-- [shirt] → shirt belongs to any group
WHERE EXISTS (
  SELECT 1 FROM post_tag_groups
  WHERE post_id = posts.id AND is_deleted = false
    AND tag_names @> ARRAY['shirt']
)

-- [shirt pants] → same group
WHERE EXISTS (
  SELECT 1 FROM post_tag_groups
  WHERE post_id = posts.id AND is_deleted = false
    AND tag_names @> ARRAY['shirt', 'pants']
)

-- -[shirt] → shirt in no group
WHERE NOT EXISTS (
  SELECT 1 FROM post_tag_groups
  WHERE post_id = posts.id AND is_deleted = false
    AND tag_names @> ARRAY['shirt']
)
```

The `@>` (array containment) operator works identically for 1 or N tags. GIN index on `tag_names` is used.

### 5.5 Limits

- `MAX_GROUP_CLAUSES = 4`
- `MAX_TAGS_PER_GROUP = 10`
- Group clause tags count toward user's overall tag query limit

### 5.6 Escape Hatch

`\[` produces a literal `[` in search. Rarely needed in practice.

---

## 6. Autocomplete Compatibility

### 6.1 Problem

Adding `[` and `]` globally to `TAG_SEPARATORS` would break tags like `00_qan[t]`. Instead, brackets are treated as separators **only when inside a group bracket**.

### 6.2 `isInsideGroupBracket()` Detection

```javascript
function isInsideGroupBracket(text, cursor) {
  let depth = 0;
  let lastOpenBracket = -1;

  for (let i = 0; i < cursor; i++) {
    if (text[i] === '[' && (i === 0 || text[i-1] !== '\\')) {
      // Only count as group bracket if preceded by whitespace/start/-/~
      const charBefore = i > 0 ? text[i-1] : null;
      const isGroupBracket = !charBefore || charBefore === ' ' ||
                              charBefore === '\t' || charBefore === '-' ||
                              charBefore === '~';
      if (isGroupBracket) {
        depth++;
        lastOpenBracket = i;
      }
    }
    if (text[i] === ']' && depth > 0 && (i === 0 || text[i-1] !== '\\')) {
      depth--;
    }
  }

  return depth > 0;
}
```

### 6.3 Autocomplete `current_term` Modification

```javascript
Autocomplete.current_term = function($input, caret) {
  let query = $input.get(0).value;
  let insideBracket = isInsideGroupBracket(query, caret);

  if (insideBracket) {
    // Inside group: space and [ are separators
    let term = query.substring(0, caret).match(/[^\s\[]*$/)[0];
    let regexp = new RegExp(`^[-~(]*(${Autocomplete.tag_prefixes().join("|")})?`);
    return term.replace(regexp, "").toLowerCase();
  } else {
    // Outside group: existing logic (space-only separator)
    // ... original code unchanged ...
  }
};
```

### 6.4 Auto-bracket Completion

When `[` is typed with whitespace or start before it → auto-insert `[]` with cursor inside. `]` overtyping and Tab escape also handled. IME-safe (`isComposing` guard).

```javascript
onKeyDown(e) {
  if (this.isComposing) return;
  const input = this.inputTarget;
  const cursor = input.selectionStart;
  const text = input.value;

  if (e.key === "[") {
    if (cursor > 0 && text[cursor - 1] === "\\") return;
    if (isInsideGroupBracket(text, cursor)) return;

    const charBefore = text[cursor - 1];
    const isGroupContext = !charBefore || charBefore === ' ' ||
                            charBefore === '\t' || charBefore === '-' ||
                            charBefore === '~';
    if (!isGroupContext) return; // Part of tag name, normal input

    e.preventDefault();
    this.insertText(input, "[]", 1);

  } else if (e.key === "]") {
    if (isInsideGroupBracket(text, cursor) && text[cursor] === "]") {
      e.preventDefault();
      input.setSelectionRange(cursor + 1, cursor + 1);
    }

  } else if (e.key === "Tab") {
    if (isInsideGroupBracket(text, cursor)) {
      const remaining = text.slice(cursor);
      const match = remaining.match(/^(\s*\]\s*)/);
      if (match) {
        e.preventDefault();
        input.setSelectionRange(cursor + match[1].length, cursor + match[1].length);
      }
    }
  }
}
```

---

## 7. Userscript-Side Changes

### 7.1 New File: `src/api.ts`

```typescript
export class TagGroupAPI {
  private static getCsrfToken(): string {
    return document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? '';
  }

  static async getForPost(postId: number): Promise<TagGroup[]> {
    const resp = await fetch(`/post_tag_groups.json?search[post_id]=${postId}&search[is_deleted]=false`);
    return resp.json();
  }

  static async create(postId: number, name: string, tagNames: string[]): Promise<TagGroup> {
    const resp = await fetch('/post_tag_groups.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.getCsrfToken() },
      body: JSON.stringify({ post_tag_group: { post_id: postId, name, tag_names: tagNames } }),
    });
    return resp.json();
  }

  static async update(id: number, tagNames: string[]): Promise<TagGroup> {
    const resp = await fetch(`/post_tag_groups/${id}.json`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.getCsrfToken() },
      body: JSON.stringify({ post_tag_group: { tag_names: tagNames } }),
    });
    return resp.json();
  }

  static async delete(id: number): Promise<void> {
    await fetch(`/post_tag_groups/${id}.json`, {
      method: 'DELETE',
      headers: { 'X-CSRF-Token': this.getCsrfToken() },
    });
  }

  static async bulkUpdate(postId: number, groups: Record<string, string[]>): Promise<TagGroup[]> {
    const resp = await fetch('/post_tag_groups/bulk_update.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': this.getCsrfToken() },
      body: JSON.stringify({ post_id: postId, groups }),
    });
    if (!resp.ok) {
      const err = await resp.json();
      throw new Error(err.errors?.join(', ') || `API error: ${resp.status}`);
    }
    return resp.json();
  }
}
```

### 7.2 Files to Delete (13 files)

All Gist/IndexedDB/GitHub-related code:

- `db.ts` — IndexedDB layer
- `types.ts` — local data types
- `core/auth.ts` — GitHub authentication
- `core/auto-sync.ts` — auto-sync timer
- `core/gist-init.ts` — Gist initialization
- `core/import-manager.ts` — Gist import
- `core/network.ts` — GitHub API wrapper
- `core/security.ts` — PAT encryption
- `core/sync-manager.ts` — sync state machine
- `ui/settings-panel.ts` — ☁️ settings UI
- `ui/components/conflict-modal.ts` — merge conflict dialog
- `ui/components/login-modal.ts` — GitHub login dialog

### 7.3 Files to Keep (Modified)

- `main.ts` — submit handler calls `TagGroupAPI.bulkUpdate()` instead of IndexedDB
- `parser.ts` — unchanged
- `highlighter.ts` — improved (see §8)
- `input_handler.ts` — unchanged
- `sidebar.ts` — simplified, calls API instead of IndexedDB; modular split recommended
- `utils.ts` — unchanged
- `tag-sorter.ts` — optional (server `sort_tags` handles this)

### 7.4 Build Changes

```javascript
// vite.config.ts — Tampermonkey metadata
grant: [],          // No GM_* APIs needed
connect: [],        // No external connections
// Remove lz-string dependency
```

---

## 8. Phantom Mode Highlighter Improvements

### 8.1 Recommended Approach: Hybrid Mode

Always-On highlighting by default, with automatic fallback to Phantom Mode if initial render exceeds 16ms.

### 8.2 Current Issues to Fix

| Issue | Fix |
|---|---|
| Caret disappears in Phantom Mode | `caret-color: inherit` — always visible |
| 0.8s transition flicker | Reduce to 0.3s transition |
| Selection invisible | Ensure `::selection` styles are always active |
| Fixed 2s idle timer | Dynamic debounce based on text length |

### 8.3 Dynamic Debounce

```typescript
function getDebounceMs(textLength: number): number {
  if (textLength < 500) return 300;
  if (textLength < 2000) return 600;
  return 1000;
}
```

---

## 9. User Experience Comparison

### Unchanged

Toggle switch, group syntax, Phantom UI, auto-bracket, Tab escape, Smart Merge, IME support, character-first sort, sidebar indicators/menu/Group View, submit flattening.

### Changed

| Aspect | Before (Userscript) | After (Server) |
|---|---|---|
| Storage | Browser IndexedDB | Danbooru server DB |
| Sync | GitHub Gist (manual/auto) | Unnecessary (server is SSOT) |
| Setup | GitHub PAT required | None (Danbooru login only) |
| Cross-device | Gist sync config needed | Automatic (same account) |
| Cross-user | Gist ID sharing + Import | Automatic (shared data) |
| Conflict | Conflict Modal (Merge/Overwrite/Keep) | Server Last-Write-Wins |

### Removed UI

☁️ button, settings panel, GitHub login modal, Import feature, Conflict modal.

### Added UI

History → Groups link in post sidebar.

---

## 10. Implementation Checklist

### Server-Side

- [ ] PostTagGroup model + migration + GIN index
- [ ] PostTagGroupVersion model
- [ ] PostTagGroupsController (index/show/create/update/destroy/revert/bulk_update/tag_list)
- [ ] PostTagGroupVersionsController (index/show)
- [ ] PostTagGroupPolicy (Pool pattern permissions)
- [ ] Routes
- [ ] Post model integration (`has_many :tag_groups`, `available_includes`)
- [ ] User model `show_tag_groups` setting
- [ ] History tab: sidebar "Groups" link + version index page
- [ ] ViewComponents (indicator, view switch, group view, tag item)
- [ ] Stimulus Controllers (pill menu, view switching)
- [ ] SCSS stylesheet (CSS variables, dark theme compatible)
- [ ] autocomplete.js modification (group bracket compatibility)
- [ ] PostQuery/PostQueryBuilder: group search syntax (`[tag1 tag2]` with AND/OR/NOT)

### Userscript-Side

- [ ] `src/api.ts` — TagGroupAPI class
- [ ] `main.ts` — submit handler → `TagGroupAPI.bulkUpdate()`
- [ ] `sidebar.ts` — modular split + API integration
- [ ] Delete 13 Gist/IndexedDB/GitHub files
- [ ] Remove `lz-string` dependency, clear `grant`/`connect`
- [ ] Highlighter hybrid mode implementation

### Migration & Testing

- [ ] Data migration script: existing IndexedDB/Gist data → new API bulk import
- [ ] Server tests: model, controller, policy, search query
- [ ] Userscript tests: API integration
