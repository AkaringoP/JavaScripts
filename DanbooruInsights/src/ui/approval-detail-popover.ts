/**
 * Shows a paginated popover listing approval post IDs for a given date.
 * @param {any} db The Dexie database instance.
 * @param {string} dateStr YYYY-MM-DD
 * @param {string|number} userId The user's ID.
 * @param {MouseEvent} event The triggering mouse event.
 */
export async function showApprovalsDetail(
  db: any,
  dateStr: string,
  userId: string | number,
  event: MouseEvent
): Promise<void> {
  const popoverId = 'danbooru-approvals-popover';
  let pop = document.getElementById(popoverId);
  if (!pop) {
    pop = document.createElement('div');
    pop.id = popoverId;
    document.body.appendChild(pop);
  }

  const detailId = `${userId}_${dateStr}`;
  const detail = await db.approvals_detail.get(detailId);

  if (!detail) {
    console.warn(`[Danbooru Grass] No entry found in approvals_detail for ID: ${detailId}. Did you clear cache?`);
    return;
  }
  if (!detail.post_list || detail.post_list.length === 0) {
    console.warn(`[Danbooru Grass] Entry found but post_list is empty:`, detail);
    return;
  }

  const posts = detail.post_list;
  const total = posts.length;
  const limit = 100;
  let currentPage = 1;
  const totalPages = Math.ceil(total / limit);

  const renderPage = (page: number): void => {
    currentPage = page;
    const start = (page - 1) * limit;
    const end = Math.min(start + limit, total);
    const pagePosts = posts.slice(start, end);

    pop!.innerHTML = `
          <div class="header">
            <div class="header-title">${dateStr} Approvals (${total})</div>
            <div style="display:flex; align-items:center; gap:8px;">
              <a href="/posts?tags=id:${pagePosts.join(',')}" target="_blank" class="gallery-btn" title="View Current Page as Gallery">
                <svg aria-hidden="true" height="18" viewBox="0 0 16 16" version="1.1" width="18" data-view-component="true" style="fill: currentColor;">
                  <path d="M3.75 2h3.5a.75.75 0 0 1 0 1.5h-3.5a.25.25 0 0 0-.25.25v8.5c0 .138.112.25.25.25h8.5a.25.25 0 0 0 .25-.25v-3.5a.75.75 0 0 1 1.5 0v3.5A1.75 1.75 0 0 1 12.25 14h-8.5A1.75 1.75 0 0 1 2 12.25v-8.5C2 2.784 2.784 2 3.75 2Zm6.75.5a.75.75 0 0 1 .75-.75h3a.75.75 0 0 1 .75.75v3a.75.75 0 0 1-1.5 0v-1.19l-4.22 4.22a.75.75 0 1 1-1.06-1.06L12.44 3.5h-1.19a.75.75 0 0 1-.75-.75Z"></path>
                </svg>
              </a>
              <div class="close-btn">&times;</div>
            </div>
          </div>
          <div class="post-grid">
            ${pagePosts.map((id: number) => `<a href="/posts/${id}" target="_blank" class="post-link">#${id}</a>`).join('')}
          </div>
          <div class="pagination">
            <button class="page-btn" id="popover-prev" ${page === 1 ? 'disabled' : ''}>&lt;</button>
            <span>${page} / ${totalPages}</span>
            <button class="page-btn" id="popover-next" ${page === totalPages ? 'disabled' : ''}>&gt;</button>
          </div>
        `;

    (pop!.querySelector('.close-btn') as HTMLElement).onclick = () => { pop!.style.display = 'none'; };
    (pop!.querySelector('#popover-prev') as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      renderPage(currentPage - 1);
    };
    (pop!.querySelector('#popover-next') as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      renderPage(currentPage + 1);
    };
  };

  renderPage(1);

  // Positioning
  pop.style.setProperty('display', 'block', 'important');
  const rect = pop.getBoundingClientRect();

  let left = event.pageX + 10;
  let top = event.pageY - 20; // Start slightly below mouse

  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const scrollX = window.scrollX || window.pageXOffset;
  const scrollY = window.scrollY || window.pageYOffset;

  // Flip if overflow right
  if (left + rect.width > scrollX + viewportWidth - 20) {
    left = event.pageX - rect.width - 10;
  }
  // Flip if overflow bottom
  if (top + rect.height > scrollY + viewportHeight - 20) {
    top = event.pageY - rect.height - 10;
  }
  // Safety: Don't overflow left or top of document
  if (left < scrollX + 10) left = scrollX + 10;
  if (top < scrollY + 10) top = scrollY + 10;

  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;

  // Close on outside click
  const closeHandler = (e: MouseEvent) => {
    if (!pop!.contains(e.target as Node)) {
      pop!.style.setProperty('display', 'none', 'important');
      document.removeEventListener('mousedown', closeHandler);
    }
  };
  // Delay attachment to avoid immediate close from current click
  setTimeout(() => {
    document.addEventListener('mousedown', closeHandler);
  }, 100);
}
