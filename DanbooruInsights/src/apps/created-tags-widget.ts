import type {CreatedTagItem} from '../types';
import type {AnalyticsDataManager} from '../core/analytics-data-manager';
import type {TargetUser} from '../types';

/** Sort mode for the created tags table. */
type SortMode = 'posts' | 'name' | 'date';

const PAGE_SIZE = 20;

/**
 * Renders the Created Tags widget with lazy loading.
 * Shows general tags created by the user, parsed from NNTBot forum reports.
 */
export function renderCreatedTagsWidget(
  container: HTMLElement,
  dataManager: AnalyticsDataManager,
  targetUser: TargetUser,
): void {
  // Closure state
  let items: CreatedTagItem[] = [];
  let sortMode: SortMode = 'posts';
  let currentPage = 0;

  // Build DOM
  container.style.background = '#fff';
  container.style.border = '1px solid #e1e4e8';
  container.style.borderRadius = '8px';
  container.style.padding = '15px';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';

  const titleDiv = document.createElement('div');
  titleDiv.style.cssText = 'font-size:0.9em;color:#666;font-weight:bold;';
  titleDiv.textContent = `🏷️ Tags created by ${targetUser.name}`;

  const controlsDiv = document.createElement('div');
  controlsDiv.style.cssText = 'display:flex;align-items:center;gap:8px;';
  controlsDiv.style.display = 'none'; // Hidden until loaded

  const sortSelect = document.createElement('select');
  sortSelect.style.cssText = 'font-size:11px;padding:2px 6px;border:1px solid #ddd;border-radius:4px;background:#fff;color:#555;';
  sortSelect.innerHTML = `
    <option value="posts">Posts ▼</option>
    <option value="name">Name</option>
    <option value="date">Date ▼</option>
  `;

  controlsDiv.appendChild(sortSelect);
  header.appendChild(titleDiv);
  header.appendChild(controlsDiv);
  container.appendChild(header);

  const contentDiv = document.createElement('div');
  contentDiv.className = 'di-created-tags-wrap';
  container.appendChild(contentDiv);

  const getStatusHtml = (item: CreatedTagItem): string => {
    if (item.aliasedTo) {
      const aliasDisplay = item.aliasedTo.replace(/_/g, ' ');
      return `<span class="di-created-tags-status" style="color:#8250df;background:#f3e8ff;">🔀 <a href="/wiki_pages/${item.aliasedTo}" target="_blank" style="color:#8250df;">${aliasDisplay}</a></span>`;
    }
    if (item.isDeprecated) {
      return '<span class="di-created-tags-status" style="color:#cf222e;background:#ffebe9;">⚠️ Deprecated</span>';
    }
    if (item.postCount === 0) {
      return '<span class="di-created-tags-status" style="color:#888;background:#f0f0f0;">➖ Empty</span>';
    }
    return '<span class="di-created-tags-status" style="color:#1a7f37;background:#dafbe1;">✅ Active</span>';
  };

  const sortItems = () => {
    if (sortMode === 'posts') {
      items.sort((a, b) => b.postCount - a.postCount);
    } else if (sortMode === 'name') {
      items.sort((a, b) => a.displayName.localeCompare(b.displayName));
    } else if (sortMode === 'date') {
      items.sort((a, b) => b.reportDate.localeCompare(a.reportDate));
    }
  };

  const renderTable = () => {
    const totalPages = Math.ceil(items.length / PAGE_SIZE);
    const start = currentPage * PAGE_SIZE;
    const pageItems = items.slice(start, start + PAGE_SIZE);

    let html = `<table class="di-created-tags-table">
      <thead><tr>
        <th>Tag Name</th>
        <th style="text-align:right;">Posts</th>
        <th>Status</th>
        <th>Date</th>
      </tr></thead>
      <tbody>`;

    for (const item of pageItems) {
      html += `<tr class="di-created-tags-row">
        <td><a href="/wiki_pages/${item.tagName}" target="_blank" style="color:#0075f8;">${item.displayName}</a></td>
        <td style="text-align:right;font-variant-numeric:tabular-nums;">${item.postCount.toLocaleString()}</td>
        <td>${getStatusHtml(item)}</td>
        <td style="color:#888;font-size:0.85em;">${item.reportDate}</td>
      </tr>`;
    }

    html += '</tbody></table>';

    // Pagination
    if (totalPages > 1) {
      html += '<div style="display:flex;justify-content:center;gap:4px;margin-top:10px;">';
      for (let i = 0; i < totalPages; i++) {
        const active = i === currentPage;
        html += `<button class="di-pie-tab${active ? ' active' : ''}" data-page="${i}" style="min-width:28px;">${i + 1}</button>`;
      }
      html += '</div>';
    }

    contentDiv.innerHTML = html;

    // Pagination click handlers
    contentDiv.querySelectorAll('[data-page]').forEach(btn => {
      (btn as HTMLElement).onclick = () => {
        currentPage = parseInt((btn as HTMLElement).dataset.page || '0');
        renderTable();
      };
    });
  };

  const loadData = async () => {
    const progressId = 'di-created-tags-progress';
    contentDiv.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:center;padding:30px;color:#888;">
        <div class="di-spinner" style="width:24px;height:24px;border-width:3px;margin-right:10px;"></div>
        <span id="${progressId}">Initializing...</span>
      </div>`;

    const progressEl = document.getElementById(progressId);
    const onProgress = (msg: string) => {
      if (progressEl) progressEl.textContent = msg;
    };

    try {
      items = await dataManager.getCreatedTags(targetUser, onProgress);
      if (items.length === 0) {
        contentDiv.innerHTML = '<div style="color:#888;text-align:center;padding:20px;font-size:0.9em;">No created tags found in NNTBot reports.</div>';
        return;
      }

      titleDiv.textContent = `🏷️ Tags created by ${targetUser.name} (${items.length})`;
      controlsDiv.style.display = 'flex';
      sortItems();
      renderTable();
    } catch (e) {
      console.debug('[DI] Created tags load failed', e);
      contentDiv.innerHTML = '<div style="color:#c00;text-align:center;padding:20px;font-size:0.9em;">Failed to load created tags.</div>';
    }
  };

  // Sort change handler
  sortSelect.onchange = () => {
    sortMode = sortSelect.value as SortMode;
    currentPage = 0;
    sortItems();
    renderTable();
  };

  // Initial state: load button
  contentDiv.innerHTML = `
    <div style="text-align:center;padding:20px;">
      <button id="di-load-created-tags" style="
        background:#f6f8fa;border:1px solid #d0d7de;border-radius:6px;
        padding:8px 16px;cursor:pointer;color:#24292f;font-size:13px;
        transition:background 0.2s;
      ">Load Created Tags</button>
      <div style="font-size:0.8em;color:#888;margin-top:6px;">Searches NNTBot tag reports for tags created by this user</div>
    </div>`;

  const loadBtn = contentDiv.querySelector('#di-load-created-tags') as HTMLElement;
  if (loadBtn) {
    loadBtn.onmouseover = () => { loadBtn.style.background = '#eaeef2'; };
    loadBtn.onmouseout = () => { loadBtn.style.background = '#f6f8fa'; };
    loadBtn.onclick = () => loadData();
  }
}
