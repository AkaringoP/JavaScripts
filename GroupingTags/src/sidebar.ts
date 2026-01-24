
import { getPostTagData, savePostTagData } from './db';
import { getPostId, stringToColor, detectDarkTheme } from './utils';

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
            this.allGroups = (data && data.groups) ? data.groups : {};
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
        const listItems = document.querySelectorAll('#tag-list ul li, #sidebar ul li');
        // Fallback selectors just in case. 
        // Usually: .character-tag-list li, .general-tag-list li...
        // But they all are under #tag-list or similar.
        // Better: querySelectorAll('li[data-tag-name]')

        const tags = document.querySelectorAll('li[data-tag-name]');

        tags.forEach(li => {
            const tagName = li.getAttribute('data-tag-name');
            if (!tagName) return;

            // Restrict Sidebar Indicators for Artist, Copyright, Meta
            // Danbooru classes: tag-type-1 (Artist), tag-type-3 (Copyright), tag-type-5 (Meta)
            // Allowed: tag-type-0 (General), tag-type-4 (Character)
            if (li.classList.contains('tag-type-1') ||
                li.classList.contains('tag-type-3') ||
                li.classList.contains('tag-type-5')) {
                return;
            }

            const myGroups = tagToGroups[tagName] || [];

            // Ensure LI is positioned for absolute child
            const liEl = li as HTMLElement;
            liEl.style.position = 'relative';
            // Add padding to make room for indicator (12px + 6px gap)
            // Check if we already added it to avoid double padding if re-run?
            // Actually, we replace button, so re-run is fine.
            // But padding usually shouldn't be accumulated. 
            // Let's assume standard LI padding is 0 or small. 
            // We set a min-padding-left. 
            // Safer: Add a class to LI to mark it processed, or check padding.
            if (!liEl.style.paddingLeft || parseInt(liEl.style.paddingLeft) < 20) {
                liEl.style.paddingLeft = '20px';
            }

            this.createButton(liEl, myGroups);
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
            if (searchTag && searchTag.previousElementSibling && searchTag.previousElementSibling.tagName === 'A') {
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
        }
        else if (isMulti) {
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
        btn.addEventListener('click', (e) => {
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
                    this.allGroups[gName] = this.allGroups[gName].filter(t => t !== tagName);
                    changed = true;
                }
            });

            if (changed) {
                // Save DB
                const postId = getPostId();
                if (postId) {
                    await savePostTagData({
                        postId: postId,
                        updatedAt: Date.now(),
                        isImported: false,
                        groups: this.allGroups
                    });
                }
                // Refresh UI
                this.injectIndicators(this.allGroups);

                // Dispatch Event to notify Main Script
                window.dispatchEvent(new CustomEvent('grouping-tags-db-update'));
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
            if (!menu.contains(e.target as Node) && e.target !== btn && !btn.contains(e.target as Node)) {
                // Clicked outside menu AND the trigger button
                saveAndClose();
            }
        };
        // Delay adding listener to prevent immediate triggering by the current click
        setTimeout(() => document.addEventListener('click', outsideClickListener), 0);


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
            transition: 'opacity 0.3s ease, transform 0.3s cubic-bezier(0.4, 0.0, 0.2, 1)'
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
            width: '100%'
        });
        collapseBtn.onclick = (e) => {
            e.stopPropagation();
            saveAndClose(); // Trigger Batch Save
        };
        menu.appendChild(collapseBtn);

        // 2. Group List
        const allGroupNames = Object.keys(this.allGroups).sort();

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
                    transform: isActive ? 'scale(1.1)' : 'scale(1)'
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
                border: `1px solid ${isDark ? '#555' : '#ddd'}`
            });

            // Hover Events
            circle.onmouseenter = () => { label.style.opacity = '1'; };
            circle.onmouseleave = () => { label.style.opacity = '0'; };

            // CLICK HANDLER: Local toggle only
            circle.onclick = (e) => {
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
            menu.appendChild(wrapper);
        });

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
            transition: 'background-color 0.2s, color 0.2s'
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
            border: `1px solid ${isDark ? '#555' : '#ddd'}`
        });

        addBtn.onmouseenter = () => { if (addLabel.tagName === 'DIV') addLabel.style.opacity = '1'; };
        addBtn.onmouseleave = () => { if (addLabel.tagName === 'DIV') addLabel.style.opacity = '0'; };

        addBtn.onclick = (e) => {
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
                zIndex: '1002'
            });

            // Show a preview circle that changes color as you type
            addBtn.style.display = 'block';
            addBtn.textContent = ''; // Clear '+'
            addBtn.style.border = '2px solid transparent'; // Reset border for color preview?

            // Function to update preview color
            const updatePreview = () => {
                const val = input.value.trim();
                const color = val ? stringToColor(val, isDark) : (isDark ? '#555' : '#aaa');
                addBtn.style.backgroundColor = val ? color : 'transparent';
                addBtn.style.border = `2px solid ${val ? color : (isDark ? '#555' : '#aaa')}`;
            };

            input.oninput = updatePreview;

            input.onkeydown = async (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    const newName = input.value.trim();
                    if (newName) {
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
            input.onclick = (ev) => ev.stopPropagation();

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
}
