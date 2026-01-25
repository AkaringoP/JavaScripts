import { getPostTagData, savePostTagData } from './db';
import { getPostId, stringToColor, detectDarkTheme, showToast } from './utils';

/**
 * SidebarInjector
 *
 * Injects "Bottle Cap" style visual indicators into the sidebar tag list.
 * Allows users to quickly view and manage groups without entering the "Edit" mode.
 *
 * **Features**:
 * - **Caps**: Shows a colored circle for single groups, or a stacked indicator for multiple groups.
 * - **Ghost Buttons**: Shows a transparent button on hover for ungrouped tags to allow quick creation.
 * - **Pill Menu**: Clicking a cap opens a floating menu to toggle groups or create new ones.
 * - **Animations**: Smooth expand/collapse effects for the menu.
 */
export class SidebarInjector {
  private checkEnabled: () => boolean;

  constructor(checkEnabled: () => boolean) {
    this.checkEnabled = checkEnabled;
    this.injectStyles();
    this.init();
  }

  private injectStyles() {
    const style = document.createElement('style');
    style.textContent = `
            .grouping-tags-indicator {
                display: block;
                width: 12px;
                height: 12px;
                border-radius: 50%;
                /* Absolute Positioning */
                position: absolute;
                left: 0;
                top: 50%;
                transform: translateY(-50%);
                margin: 0;
                
                box-sizing: border-box;
                border: 1px solid rgba(0,0,0,0.2);
                cursor: pointer;
            }

            /* Stacked Loop for Multi-Group - Simplified to Single Circle with Diagonal Shadow */
            .grouping-tags-indicator.gt-multi {
                /* Color handled by JS (White/Black) */
                box-shadow: 2px -2px 0 rgba(0,0,0,0.2);
                /* Inherit default margins/sizing */
                z-index: 10;
            }

            /* Ghost Mode for Ungrouped Tags - Invisible default */
            .grouping-tags-indicator.gt-ghost {
                background-color: transparent;
                border: 1px solid transparent; /* Hidden border */
                box-shadow: none; /* No shadow */
                opacity: 0;
                transition: opacity 0.2s ease-in-out, border-color 0.2s;
            }
            
            /* Show on hover of the list item */
            li:hover .grouping-tags-indicator.gt-ghost {
                opacity: 1;
                border-color: rgba(150, 150, 150, 0.5);
                box-shadow: inset 0 0 4px rgba(0,0,0,0.1);
            }
        `;
    document.head.appendChild(style);
  }

  private allGroups: { [key: string]: string[] } = {};

  private async init() {
    if (!this.checkEnabled()) return;

    const postId = getPostId();
    if (!postId) return;

    try {
      const data = await getPostTagData(postId);
      this.allGroups = data && data.groups ? data.groups : {};
      // Always inject indicators, even if empty (to show Ghost buttons for creation)
      this.injectIndicators(this.allGroups);
    } catch (e) {
      console.error('GroupingTags: Failed to load sidebar data', e);
    }
  }

  private injectIndicators(groups: { [key: string]: string[] }) {
    // Reverse map: tag -> group[]
    const tagToGroups: { [tag: string]: string[] } = {};
    for (const [groupName, tags] of Object.entries(groups)) {
      tags.forEach(tag => {
        if (!tagToGroups[tag]) tagToGroups[tag] = [];
        tagToGroups[tag].push(groupName);
      });
    }

    // Select all tag list items
    // Danbooru Sidebar Selector: #tag-list ul li
    const listItems = document.querySelectorAll(
      '#tag-list ul li, #sidebar ul li',
    );

    // Select all potential lists (Character, General, Copyright, etc.)
    const tagLists = document.querySelectorAll('#tag-list ul, #sidebar ul');

    // --- VIEW SWITCHER UI ---
    // Insert at the very top of #tag-list to ensure visibility
    const tagListContainer = document.querySelector('#tag-list');

    if (
      tagListContainer &&
      !document.querySelector('.grouping-tags-view-switch')
    ) {
      const switchContainer = document.createElement('div');
      switchContainer.className = 'grouping-tags-view-switch';
      Object.assign(switchContainer.style, {
        marginBottom: '10px',
        marginTop: '5px',
        display: 'flex',
        alignItems: 'center',
        gap: '5px',
      });

      // Create Dropdown
      const select = document.createElement('select');
      Object.assign(select.style, {
        width: 'auto', // Compact width
        minWidth: '80px',
        padding: '2px 4px',
        borderRadius: '4px',
        border: '1px solid #ccc',
        backgroundColor: detectDarkTheme() ? '#333' : '#fff',
        color: detectDarkTheme() ? '#fff' : '#000',
        fontSize: '14px', // Smaller font
        height: '24px', // Fixed compact height
      });

      const optDefault = document.createElement('option');
      optDefault.value = 'default';
      optDefault.textContent = 'View: Default';

      const optGroups = document.createElement('option');
      optGroups.value = 'groups';
      optGroups.textContent = 'View: Groups';

      select.appendChild(optDefault);
      select.appendChild(optGroups);

      select.addEventListener('change', () => {
        const mode = select.value;
        if (mode === 'groups') {
          this.renderGroupView(groups);
        } else {
          this.renderDefaultView();
        }
      });

      switchContainer.appendChild(select);

      // Settings Button (Cloud Sync)
      const settingsBtn = document.createElement('div');
      settingsBtn.innerHTML = '☁️';
      Object.assign(settingsBtn.style, {
        cursor: 'pointer',
        fontSize: '16px',
        padding: '2px 4px',
        marginLeft: '4px',
        userSelect: 'none',
      });
      settingsBtn.title = 'Data Sync & Import';

      settingsBtn.onclick = async () => {
        const { AuthManager } = await import('./core/auth');
        const token = await AuthManager.getToken(true);

        const openSettings = async () => {
          // Initialize Gist (Checks for Gist ID or creates one)
          const { initializeGist } = await import('./core/gist-init');
          await initializeGist();

          // Open Panel
          const { SettingsPanel } = await import('./ui/settings-panel');
          SettingsPanel.show();
        };

        if (!token) {
          // Show Rich Login UI
          const { LoginModal } = await import('./ui/components/login-modal');
          LoginModal.show(async () => {
            // On Success
            await openSettings();
          });
        } else {
          await openSettings();
        }
      };

      switchContainer.appendChild(settingsBtn);

      // Prepend to top
      if (tagListContainer.firstChild) {
        tagListContainer.insertBefore(
          switchContainer,
          tagListContainer.firstChild,
        );
      } else {
        tagListContainer.appendChild(switchContainer);
      }
    }
    // -----------------------

    // Default View Injection (Indicators)
    const tags = document.querySelectorAll('li[data-tag-name]');

    tags.forEach(li => {
      const tagName = li.getAttribute('data-tag-name');
      if (!tagName) return;

      // Restrict Sidebar Indicators for Artist, Copyright, Meta
      // Danbooru classes: tag-type-1 (Artist), tag-type-3 (Copyright), tag-type-5 (Meta)
      // Allowed: tag-type-0 (General), tag-type-4 (Character)
      if (
        li.classList.contains('tag-type-1') ||
        li.classList.contains('tag-type-3') ||
        li.classList.contains('tag-type-5')
      ) {
        return;
      }

      const myGroups = tagToGroups[tagName] || [];

      // Ensure LI is positioned for absolute child
      const liEl = li as HTMLElement;
      liEl.style.position = 'relative';
      if (!liEl.style.paddingLeft || parseInt(liEl.style.paddingLeft) < 20) {
        liEl.style.paddingLeft = '20px';
      }

      this.createButton(liEl, myGroups);
    });

    // Store active groups for Group View refreshing
    // @ts-ignore
    window._groupingTagsLastGroups = groups;

    // If we are currently in Group View, re-render it to update changes
    const currentSelect = document.querySelector(
      '.grouping-tags-view-switch select',
    ) as HTMLSelectElement;
    if (currentSelect && currentSelect.value === 'groups') {
      this.renderGroupView(groups);
    }
  }

  private originalParents: Map<
    HTMLElement,
    { parent: HTMLElement; nextSibling: Node | null }
  > = new Map();

  /**
   * Restores the default Danbooru sidebar view by moving list items back to their original locations.
   * Also restores visibility of hidden lists and headers.
   */
  private renderDefaultView() {
    const customContainer = document.getElementById(
      'grouping-tags-custom-list',
    );
    if (customContainer) customContainer.style.display = 'none';

    this.originalParents.forEach((info, li) => {
      if (info.parent) {
        info.parent.insertBefore(li, info.nextSibling);
      }
    });
    this.originalParents.clear();

    const listsToRestore = document.querySelectorAll(
      '.character-tag-list, .general-tag-list',
    );
    listsToRestore.forEach(el => ((el as HTMLElement).style.display = ''));

    const allHeaders = document.querySelectorAll(
      '#tag-list h1, #tag-list h2, #tag-list h3',
    );
    allHeaders.forEach(el => ((el as HTMLElement).style.display = ''));
  }

  private renderGroupView(groups: { [key: string]: string[] }) {
    // SAFETY: Always restore default view first to ensure all LIs are back in their original places
    // before we try to move them again.
    this.renderDefaultView();

    // Reset visibility first to ensure clean slate
    const customContainer = document.getElementById(
      'grouping-tags-custom-list',
    );
    if (customContainer) {
      customContainer.innerHTML = '';
      customContainer.style.display = 'block';
    } else {
      const c = document.createElement('div');
      c.id = 'grouping-tags-custom-list';

      // Insert Position: Replace "Characters" or "General" section
      // Find the first target section to insert *before*
      const targets = document.querySelectorAll(
        '.character-tag-list, .general-tag-list',
      );
      let insertRef: Node | null = null;

      if (targets.length > 0) {
        // Try to find the header preceding the first list
        const firstList = targets[0];
        const header = firstList.previousElementSibling;
        if (
          header &&
          (header.tagName === 'H1' ||
            header.tagName === 'H2' ||
            header.tagName === 'H3')
        ) {
          insertRef = header;
        } else {
          insertRef = firstList;
        }
      }

      const tagList = document.querySelector('#tag-list');

      if (insertRef && insertRef.parentNode) {
        // Safe Insertion: Insert into the ACTUAL parent of the reference node
        insertRef.parentNode.insertBefore(c, insertRef);
      } else if (tagList) {
        // Fallback: Append to #tag-list
        tagList.appendChild(c);
      }
    }

    const container = document.getElementById('grouping-tags-custom-list');

    const isDark = detectDarkTheme();
    const allTags = new Set<string>(); // Tracks distinct tags processed (for Ungrouped check)
    const processedTagsInRender = new Set<string>(); // Tracks tags processed in THIS render loop to detect duplicates

    // Helper to safe-move OR clone LI
    const moveOrCloneLi = (
      tag: string,
      targetUl: HTMLElement,
      groupNames: string[],
    ) => {
      // Find the ORIGINAL element (the one with the data attribute)
      // Note: If we already moved it, querySelector might find the moved one. That's fine.
      // If we cloned it, querySelector might find the original or the clone.
      // We want the 'real' one to check reference.
      // Better strategy: rely on 'processedTagsInRender'.

      // Should we look for the element in the DOM?
      // If it was moved to a custom UL, it is still in the DOM.
      const originalLi = document.querySelector(
        `li[data-tag-name="${CSS.escape(tag)}"]`,
      ) as HTMLElement;

      if (originalLi) {
        // Ensure it is a valid tag type before doing anything
        if (
          !originalLi.classList.contains('tag-type-0') &&
          !originalLi.classList.contains('tag-type-4')
        ) {
          return false;
        }

        if (!processedTagsInRender.has(tag)) {
          // FIRST TIME: Move the original
          if (!this.originalParents.has(originalLi)) {
            this.originalParents.set(originalLi, {
              parent: originalLi.parentElement as HTMLElement,
              nextSibling: originalLi.nextSibling,
            });
          }
          targetUl.appendChild(originalLi);
          processedTagsInRender.add(tag);
          return true;
        } else {
          // SECOND TIME (Duplicate): Clone it
          // We clone the 'originalLi' (which might be in another Group UL now)
          // cloneNode(true) deep copies.
          // Note: Event listeners on the element itself are NOT copied (except inline).
          // Our 'createButton' listeners will be lost on the clone.
          // We must re-create the button on the clone.

          const clone = originalLi.cloneNode(true) as HTMLElement;

          // Remove the old indicator from the clone if it exists (it was copied)
          const oldBtn = clone.querySelector('.grouping-tags-indicator');
          if (oldBtn) oldBtn.remove();

          // Re-inject the button so it works
          // We need to know ALL groups this tag belongs to, to color/label correctly?
          // Actually, 'createButton' uses the 'groups' map.
          // But wait, 'createButton' uses a static 'myGroups' passed to it?
          // In 'injectIndicators', we calculated 'myGroups'.
          // Here we can re-calculate or pass it.
          // Let's pass the subset or full set?
          // Usually we want to show the SAME indicator (showing all groups).

          // Recalculate groups for this tag
          const myGroups: string[] = [];
          for (const [g, tList] of Object.entries(groups)) {
            if (tList.includes(tag)) myGroups.push(g);
          }
          this.createButton(clone, myGroups); // Add distinct listener to clone

          targetUl.appendChild(clone);
          return true;
        }
      }
      return false;
    };

    // 1. Render Grouped Tags
    const sortedGroups = Object.keys(groups).sort();
    sortedGroups.forEach(gName => {
      const tags = groups[gName];

      // Create Section Header
      const header = document.createElement('h3');
      header.textContent = gName;
      header.style.color = stringToColor(gName, isDark);
      header.style.marginBottom = '2px';
      header.style.marginTop = '10px';
      header.style.borderBottom = `1px solid ${stringToColor(gName, isDark)}`;

      const ul = document.createElement('ul');
      ul.className = 'general-tag-list'; // Styling

      let count = 0;
      tags.forEach(tag => {
        allTags.add(tag);
        // Pass all groups just in case we need to re-calc for clone
        if (moveOrCloneLi(tag, ul, Object.keys(groups))) count++;
      });

      // Only append if group has visible tags (Character/General)
      if (count > 0) {
        container!.appendChild(header);
        container!.appendChild(ul);
      }
    });

    // 2. Render Ungrouped Tags
    const ungroupedHeader = document.createElement('h3');
    ungroupedHeader.textContent = 'Ungrouped';
    ungroupedHeader.style.color = isDark ? '#aaa' : '#555';
    ungroupedHeader.style.marginBottom = '2px';
    ungroupedHeader.style.marginTop = '10px';
    ungroupedHeader.style.borderBottom = '1px solid #777';

    const ulUngrouped = document.createElement('ul');
    ulUngrouped.className = 'general-tag-list';

    let ungroupedCount = 0;
    const allLis = document.querySelectorAll('li[data-tag-name]');
    allLis.forEach(li => {
      const tagName = li.getAttribute('data-tag-name');
      if (tagName && !allTags.has(tagName)) {
        // Try moving (will only move if 0 or 4)
        // For ungrouped, it should never be a clone (since !allTags.has check), but function is shared.
        // We pass empty groups list or correct one? Doesn't matter for original move.
        if (moveOrCloneLi(tagName, ulUngrouped, [])) ungroupedCount++;
      }
    });

    if (ungroupedCount > 0) {
      container!.appendChild(ungroupedHeader);
      container!.appendChild(ulUngrouped);
    }

    // 3. Hide Original General/Character Lists & Headers
    // We only hide specific lists that we emptied or intend to replace
    // STRICT SELECTOR: Only target direct children of #tag-list to avoid hiding our own custom lists
    const specificLists = document.querySelectorAll(
      '#tag-list > .character-tag-list, #tag-list > .general-tag-list',
    );
    specificLists.forEach(ul => {
      // Hide the UL
      (ul as HTMLElement).style.display = 'none';
      // Hide the preceding Header (usually h2 or h3)
      const prev = ul.previousElementSibling;
      if (
        prev &&
        (prev.tagName === 'H1' ||
          prev.tagName === 'H2' ||
          prev.tagName === 'H3')
      ) {
        // Ensure it's not our own header/switch
        if (!prev.classList.contains('grouping-tags-view-switch')) {
          (prev as HTMLElement).style.display = 'none';
        }
      }
    });

    // Extra Safety: Explicitly hide headers by text content if they were missed
    // Remove '>' to find nested headers. Exclude our own custom list headers.
    const allHeaders = document.querySelectorAll(
      '#tag-list h1, #tag-list h2, #tag-list h3',
    );
    allHeaders.forEach(h => {
      // Skip headers inside our own container
      if (container && container.contains(h)) return;

      const text = h.textContent?.trim().toLowerCase();
      if (text === 'characters' || text === 'general') {
        (h as HTMLElement).style.display = 'none';
      }
    });
  }

  private createButton(li: HTMLElement, groupNames: string[]) {
    const existing = li.querySelector('.grouping-tags-indicator');
    if (existing) {
      existing.remove();
    }

    // Find the insertion point (The '?' link)
    // Usually .wiki-link, or the first 'a' that is NOT .search-tag
    let targetLink = li.querySelector('a.wiki-link') as HTMLElement;

    // Fallback: search-tag is the tag name, we want the one BEFORE it.
    if (!targetLink) {
      const searchTag = li.querySelector('a.search-tag');
      if (
        searchTag &&
        searchTag.previousElementSibling &&
        searchTag.previousElementSibling.tagName === 'A'
      ) {
        targetLink = searchTag.previousElementSibling as HTMLElement;
      }
    }

    // If still not found, fallback to search-tag (but user requested left of ?)
    if (!targetLink) {
      targetLink = li.querySelector('a.search-tag') as HTMLElement;
    }

    if (!targetLink) return;

    const btn = document.createElement('span');
    btn.className = 'grouping-tags-indicator';

    const count = groupNames.length;
    const isMulti = count > 1;
    const isDark = detectDarkTheme();

    if (count === 0) {
      // No Group -> Ghost Button
      btn.classList.add('gt-ghost');
      btn.title = 'No Group (Click to add?)'; // Potential future feature
      // No color needed, handled by CSS
    } else if (isMulti) {
      // White (Dark) or Black (Light)
      btn.classList.add('gt-multi');
      btn.title = `Groups: ${groupNames.join(', ')}`;
      btn.style.backgroundColor = isDark ? '#fff' : '#000';
    } else {
      // Single Cap
      const color = stringToColor(groupNames[0], isDark);
      btn.style.backgroundColor = color;
      btn.title = `Group: ${groupNames[0]}`;
      btn.classList.add('gt-single');
    }

    // Since we are using absolute positioning on the LI, we just append content.
    // But for accessibility/DOM order, appending at start is fine.
    // Actually, just append it. Position takes care of visual.
    li.insertBefore(btn, li.firstChild);

    // Add Click Listener for Grouping UI
    btn.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      // We need the tag name to know what we are modifying
      // "data-tag-name" is on the li element
      const tagName = li.getAttribute('data-tag-name');
      if (tagName) {
        this.toggleGroupMenu(btn, tagName);
      }
    });
  }

  private toggleGroupMenu(btn: HTMLElement, tagName: string) {
    // Check if menu already exists
    const existingMenu = document.querySelector('.grouping-tags-menu');
    if (existingMenu) {
      existingMenu.remove();
      // If clicking the same button, just toggle off
      // @ts-ignore
      if (existingMenu._triggerBtn === btn) return;
    }

    const isDark = detectDarkTheme();
    const menu = document.createElement('div');
    menu.className = 'grouping-tags-menu';
    // @ts-ignore
    menu._triggerBtn = btn; // Tag for toggle check

    // Local State for Batch Operations
    const selectedGroups = new Set<string>();
    Object.keys(this.allGroups).forEach(gName => {
      if (this.allGroups[gName].includes(tagName)) {
        selectedGroups.add(gName);
      }
    });

    // Function: Save & Close
    const saveAndClose = async () => {
      // Remove listener to prevent double fire
      document.removeEventListener('click', outsideClickListener);

      // Compare & Apply Changes
      let changed = false;
      Object.keys(this.allGroups).forEach(gName => {
        const isSelected = selectedGroups.has(gName);
        const wasSelected = this.allGroups[gName].includes(tagName);

        if (isSelected && !wasSelected) {
          this.allGroups[gName].push(tagName);
          changed = true;
        } else if (!isSelected && wasSelected) {
          this.allGroups[gName] = this.allGroups[gName].filter(
            t => t !== tagName,
          );
          changed = true;
        }
      });

      if (changed) {
        // Sort before saving
        const postId = getPostId();
        if (postId) {
          // Import Sorter dynamically or statically?
          // Since sidebar.ts is main logic, static import is fine unless circular dep.
          // Dynamic import is safer for code splitting if desired, but we need it now.
          const { sortGroupTags } = await import('./core/tag-sorter');
          await sortGroupTags(this.allGroups, postId);

          await savePostTagData({
            postId: postId,
            updatedAt: Date.now(),
            isImported: false,
            groups: this.allGroups,
          });
        }
        // Refresh UI
        this.injectIndicators(this.allGroups);

        // Dispatch Event to notify Main Script
        window.dispatchEvent(new CustomEvent('grouping-tags-db-update'));

        // Auto-Sync is now handled globally in db.ts via AutoSyncManager.notifyChange
      }

      // Exit Animation
      menu.style.opacity = '0';
      menu.style.transform = 'scaleY(0)';

      // Wait for transition to end before removing
      setTimeout(() => {
        menu.remove();
      }, 300); // Matches CSS transition duration (0.3s)
    };

    // Click Outside Listener
    const outsideClickListener = (e: MouseEvent) => {
      if (
        !menu.contains(e.target as Node) &&
        e.target !== btn &&
        !btn.contains(e.target as Node)
      ) {
        // Clicked outside menu AND the trigger button
        saveAndClose();
      }
    };
    // Delay adding listener to prevent immediate triggering by the current click
    setTimeout(
      () => document.addEventListener('click', outsideClickListener),
      0,
    );

    // Style: Floating Pill
    Object.assign(menu.style, {
      position: 'absolute',
      zIndex: '1000',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      backgroundColor: isDark ? '#222' : '#eee',
      borderRadius: '10px',
      padding: '4px',
      boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
      border: `1px solid ${isDark ? '#444' : '#ccc'}`, // Added Border
      // Ensure tooltips can show outside
      overflow: 'visible',

      // Animation Initial State
      opacity: '0',
      transform: 'scaleY(0)',
      transformOrigin: 'top center',
      // Smoother easing and slightly longer duration
      transition:
        'opacity 0.3s ease, transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)',
    });

    // Trigger Entry Animation (Next Frame)
    requestAnimationFrame(() => {
      menu.style.opacity = '1';
      menu.style.transform = 'scaleY(1)';
    });

    // 1. Collapse Button (Top) - Acts as "Done/Save"
    const collapseBtn = document.createElement('div');
    collapseBtn.textContent = '⌃'; // Up Arrow
    collapseBtn.title = 'Save & Close';
    Object.assign(collapseBtn.style, {
      cursor: 'pointer',
      fontSize: '12px',
      marginBottom: '4px',
      color: isDark ? '#ccc' : '#555',
      userSelect: 'none',
      lineHeight: '1',
      textAlign: 'center',
      width: '100%',
    });
    collapseBtn.onclick = e => {
      e.stopPropagation();
      saveAndClose(); // Trigger Batch Save
    };
    menu.appendChild(collapseBtn);

    // 2. Group List
    const allGroupNames = Object.keys(this.allGroups).sort();
    const shouldScroll = allGroupNames.length > 5;

    // Container for groups (Scrollable if needed)
    const listContainer = document.createElement('div');
    Object.assign(listContainer.style, {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      width: '100%',
    });

    if (shouldScroll) {
      Object.assign(listContainer.style, {
        // Height calculation: (16px circle + 4px margin) * 5 + roughly 4px padding wiggle room = ~104px
        maxHeight: '104px',
        overflowY: 'auto',
        overflowX: 'hidden',
        // Custom Scrollbar Styling (Webkit)
        scrollbarWidth: 'none', // Firefox
        msOverflowStyle: 'none', // IE/Edge
      });

      // Hide ScrollBar for Webkit (Chrome/Safari) - Inject style if possible, or assume user style handles it.
      // Since we use inline styles, we can't easily do pseudo-elements ::-webkit-scrollbar.
      // However, typical userscripts prefer clean UIs. 'scrollbarWidth: none' works for FF.
      // For Chrome, we can rely on standard scroll behavior or inject a quick class.
      listContainer.classList.add('grouping-tags-scroll-container');

      // Inject scrollbar hiding style once if not already there
      if (!document.querySelector('#grouping-tags-scroll-style')) {
        const s = document.createElement('style');
        s.id = 'grouping-tags-scroll-style';
        s.textContent = `
                    .grouping-tags-scroll-container::-webkit-scrollbar {
                        width: 0px;
                        background: transparent;
                    }
                `;
        document.head.appendChild(s);
      }
    }

    allGroupNames.forEach(gName => {
      const wrapper = document.createElement('div');
      wrapper.style.position = 'relative'; // For absolute tooltip positioning

      const circle = document.createElement('div');
      const color = stringToColor(gName, isDark);

      // Helper to update circle style based on state
      const updateCircleStyle = () => {
        const isActive = selectedGroups.has(gName);
        Object.assign(circle.style, {
          width: '16px',
          height: '16px',
          borderRadius: '50%',
          marginBottom: '4px',
          cursor: 'pointer',
          backgroundColor: isActive ? color : 'transparent',
          border: `2px solid ${color}`, // Explicit color
          boxSizing: 'border-box',
          transition: 'transform 0.1s, background-color 0.2s',
          transform: isActive ? 'scale(1.1)' : 'scale(1)',
          flexShrink: '0', // Prevent shrinking in flex container
        });
      };

      updateCircleStyle();

      // Custom Tooltip Label
      const label = document.createElement('div');
      label.textContent = gName;
      Object.assign(label.style, {
        position: 'absolute',
        left: '24px', // Right of the circle (16px + gap)
        top: '50%',
        transform: 'translateY(-50%)',
        backgroundColor: isDark ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)',
        color: isDark ? '#fff' : '#000',
        padding: '2px 6px',
        borderRadius: '4px',
        fontSize: '11px',
        whiteSpace: 'nowrap',
        pointerEvents: 'none', // Don't block clicks underneath
        opacity: '0',
        transition: 'opacity 0.1s',
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
        zIndex: '1001',
        border: `1px solid ${isDark ? '#555' : '#ddd'}`,
      });

      // Hover Events
      circle.onmouseenter = () => {
        label.style.opacity = '1';
      };
      circle.onmouseleave = () => {
        label.style.opacity = '0';
      };

      // CLICK HANDLER: Local toggle only
      circle.onclick = e => {
        e.preventDefault();
        e.stopPropagation();
        // Toggle Local State
        if (selectedGroups.has(gName)) {
          selectedGroups.delete(gName);
        } else {
          selectedGroups.add(gName);
        }
        updateCircleStyle();
      };

      wrapper.appendChild(circle);
      wrapper.appendChild(label);
      listContainer.appendChild(wrapper);
    });

    menu.appendChild(listContainer);

    // 3. Add Group Button (+)
    const addWrapper = document.createElement('div');
    addWrapper.style.position = 'relative';

    const addBtn = document.createElement('div');
    addBtn.textContent = '+';
    Object.assign(addBtn.style, {
      width: '16px',
      height: '16px',
      borderRadius: '50%',
      // marginBottom: '4px', // Removed margin for last item
      cursor: 'pointer',
      backgroundColor: 'transparent',
      border: `2px solid ${isDark ? '#555' : '#aaa'}`,
      color: isDark ? '#ccc' : '#555',
      boxSizing: 'border-box',
      // Flex Center
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      // textAlign: 'center', // Removed in favor of flex
      // lineHeight: '13px', // Removed in favor of flex
      fontSize: '14px',
      fontWeight: 'bold',
      transition: 'background-color 0.2s, color 0.2s',
    });

    // Tooltip / Input Area
    const addLabel = document.createElement('div');
    addLabel.textContent = 'New Group';
    Object.assign(addLabel.style, {
      position: 'absolute',
      left: '24px',
      top: '50%',
      transform: 'translateY(-50%)',
      backgroundColor: isDark ? 'rgba(0,0,0,0.9)' : 'rgba(255,255,255,0.9)',
      color: isDark ? '#fff' : '#000',
      padding: '2px 6px',
      borderRadius: '4px',
      fontSize: '11px',
      whiteSpace: 'nowrap',
      pointerEvents: 'none',
      opacity: '0',
      transition: 'opacity 0.1s',
      boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      zIndex: '1001',
      border: `1px solid ${isDark ? '#555' : '#ddd'}`,
    });

    addBtn.onmouseenter = () => {
      if (addLabel.tagName === 'DIV') addLabel.style.opacity = '1';
    };
    addBtn.onmouseleave = () => {
      if (addLabel.tagName === 'DIV') addLabel.style.opacity = '0';
    };

    addBtn.onclick = e => {
      e.stopPropagation();

      // Switch to Input Mode
      addBtn.style.display = 'none';

      const input = document.createElement('input');
      Object.assign(input.style, {
        position: 'absolute',
        // Input replaces the label position
        left: '24px',
        top: '50%',
        transform: 'translateY(-50%)',
        width: '100px',
        fontSize: '11px',
        padding: '2px',
        borderRadius: '4px',
        border: `1px solid ${isDark ? '#888' : '#ccc'}`,
        backgroundColor: isDark ? '#333' : '#fff',
        color: isDark ? '#fff' : '#000',
        zIndex: '1002',
      });

      // Show a preview circle that changes color as you type
      addBtn.style.display = 'block';
      addBtn.textContent = ''; // Clear '+'
      addBtn.style.border = '2px solid transparent'; // Reset border for color preview?

      // Function to update preview color
      const updatePreview = () => {
        const val = input.value.trim();
        const color = val
          ? stringToColor(val, isDark)
          : isDark
            ? '#555'
            : '#aaa';
        addBtn.style.backgroundColor = val ? color : 'transparent';
        addBtn.style.border = `2px solid ${val ? color : isDark ? '#555' : '#aaa'}`;
      };

      input.oninput = updatePreview;

      input.onkeydown = async ev => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          ev.stopPropagation();
          const newName = input.value.trim();
          if (newName) {
            // STRICT VALIDATION: Same as parser regex
            // Only allow letters, numbers, underscores, and hyphens.
            if (!/^[a-zA-Z0-9_\-]+$/.test(newName)) {
              showToast(
                "Invalid Name: Spaces are not allowed. Use '_' instead.",
                'error',
              );
              // Shake effect?
              input.style.borderColor = '#d32f2f';
              setTimeout(() => {
                input.style.borderColor = isDark ? '#888' : '#ccc';
              }, 500);
              return;
            }

            // Create & Select
            if (!this.allGroups[newName]) {
              this.allGroups[newName] = [];
            }

            // DO NOT push tagName here. Let saveAndClose detect the change.
            // if (!this.allGroups[newName].includes(tagName)) {
            //    this.allGroups[newName].push(tagName);
            // }

            // Add to local selection just in case we continue editing
            selectedGroups.add(newName);

            // Save immediately (User expectation: Enter -> Save)
            // Trigger batch save logic
            await saveAndClose();
          }
        } else if (ev.key === 'Escape') {
          ev.preventDefault();
          ev.stopPropagation();
          // Just revert child
          if (input.parentNode === addWrapper) {
            addWrapper.replaceChild(addLabel, input);
          }
          // Reset Button Style
          addBtn.textContent = '+';
          addBtn.style.backgroundColor = 'transparent';
          addBtn.style.border = `2px solid ${isDark ? '#555' : '#aaa'}`;
          addBtn.style.display = 'flex'; // Restore Flex centering
        }
      };

      // Prevent menu closing on click inside input
      input.onclick = ev => ev.stopPropagation();

      addWrapper.replaceChild(input, addLabel);
      input.focus();
    };

    addWrapper.appendChild(addBtn);
    addWrapper.appendChild(addLabel);
    menu.appendChild(addWrapper);

    // Positioning Logic
    const rect = btn.getBoundingClientRect();
    // We want it to cover the button and expand downwards.
    // It's safest to append to body for absolute positioning to work reliably across sites.
    document.body.appendChild(menu);

    const scrollX = window.pageXOffset;
    const scrollY = window.pageYOffset;

    menu.style.left = `${rect.left + scrollX - 2}px`; // Align slightly left to cover border
    menu.style.top = `${rect.top + scrollY - 2}px`; // Align slightly Top
    // Width adjustment?
    menu.style.width = '20px'; // Slightly wider than button (12px + padding)
  }

  // --- Auto-Sync Logic ---
  private syncTimeout: any = null;
  private async triggerAutoSync(postId: string) {
    // Debounce: Wait 3 seconds to avoid spamming Gist
    if (this.syncTimeout) clearTimeout(this.syncTimeout);

    this.syncTimeout = setTimeout(async () => {
      // Dynamic Import to avoid circular deps or heavy load
      const { SyncManager } = await import('./core/sync-manager');
      const { getLocalDataByShard } = await import('./db');

      try {
        const shardIdx = SyncManager.getShardIndex(postId);
        // We need ALL data for that shard to sync properly (full replace)
        const localData = await getLocalDataByShard(shardIdx);
        await SyncManager.syncShard(shardIdx, localData);
      } catch (e) {
        console.error('❌ Auto-Sync Failed:', e);
      }
    }, 3000);
  }
}
