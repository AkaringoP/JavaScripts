/**
 * @fileoverview Main entry point for the GroupingTags UserScript.
 * Handles initialization, UI injection, document observation, and core logic integration.
 * @license MIT
 */
import { GM_getValue, GM_setValue } from '$';
import { AutoSyncManager } from './core/auto-sync';
import { SyntaxHighlighter } from './highlighter';
import { SmartInputHandler } from './input_handler';
import { parseGroupedTags, reconstructTags, flattenTags, removeMissingTagsFromGroups } from './parser';
import { savePostTagData, getPostTagData, deletePostTagData } from './db';
import { getPostId } from './utils';
import { SidebarInjector } from './sidebar';
const STORAGE_KEY_ENABLED = 'grouping_tags_enabled';
/**
 * Checks if the script's functionality is currently enabled.
 * Prioritizes the UI checkbox state if present, otherwise falls back to stored preference.
 * @returns {boolean} True if enabled.
 */
function isScriptEnabled() {
    const checkbox = document.querySelector('.grouping-tags-switch input');
    if (checkbox) {
        return checkbox.checked;
    }
    return GM_getValue(STORAGE_KEY_ENABLED, false);
}
/**
 * Persists the script's enabled state.
 * @param {boolean} enabled - The state to save.
 */
function setScriptEnabled(enabled) {
    GM_setValue(STORAGE_KEY_ENABLED, enabled);
}
/**
 * Injects the CSS styles for the toggle switch UI.
 */
function parseToggleStyle() {
    const style = document.createElement('style');
    style.textContent = `
    .grouping-tags-toggle-container {
      margin-left: 20px;
      display: inline-flex;
      align-items: center;
      vertical-align: middle;
    }
    .grouping-tags-label {
      margin-right: 8px;
      font-weight: bold;
    }
    .grouping-tags-switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 20px;
    }
    .grouping-tags-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .grouping-tags-slider {
      position: absolute;
      cursor: pointer;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background-color: #ccc;
      transition: .4s;
      border-radius: 20px;
    }
    .grouping-tags-slider:before {
      position: absolute;
      content: "";
      height: 16px;
      width: 16px;
      left: 2px;
      bottom: 2px;
      background-color: white;
      transition: .4s;
      border-radius: 50%;
    }
    input:checked + .grouping-tags-slider {
      background-color: #0075ff;
    }
    input:focus + .grouping-tags-slider {
      box-shadow: 0 0 1px #2196F3;
    }
    input:checked + .grouping-tags-slider:before {
      transform: translateX(20px);
    }
  `;
    document.head.appendChild(style);
}
/**
 * Displays a temporary toast message to the user.
 * @param {string} message - Message to display.
 * @param {number} [duration=3000] - Duration in milliseconds.
 */
function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.textContent = message;
    Object.assign(toast.style, {
        position: 'fixed',
        bottom: '20px',
        left: '50%',
        transform: 'translateX(-50%)',
        backgroundColor: 'rgba(255, 0, 0, 0.8)',
        color: 'white',
        padding: '10px 20px',
        borderRadius: '5px',
        zIndex: '10000',
        fontSize: '14px',
        boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
        transition: 'opacity 0.3s'
    });
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}
/**
 * Loads grouped tag data from IndexedDB and reconstructs the grouping syntax in the textarea.
 * Triggered on page load, toggle ON, or external updates.
 */
async function loadAndRestoreTags() {
    if (!isScriptEnabled())
        return;
    const postId = getPostId();
    if (!postId)
        return;
    const input = document.querySelector('#post_tag_string, #upload_tag_string');
    if (!input)
        return;
    try {
        const data = await getPostTagData(postId);
        if (data && data.groups) {
            const currentText = input.value;
            const newText = reconstructTags(currentText, data.groups);
            if (currentText !== newText) {
                input.value = newText;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
        }
    }
    catch (e) {
        console.error('GroupingTags: Failed to load/restore tags', e);
    }
}
/**
 * Initializes the MutationObserver to detect dynamic appearance of the tag editor form.
 * Useful for "Edit" actions that load content via AJAX.
 */
function setupDynamicFormObserver() {
    const observer = new MutationObserver((mutations) => {
        let shouldRestore = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (node instanceof HTMLElement) {
                        if (node.matches && (node.matches('#post_tag_string, #upload_tag_string') || node.querySelector('#post_tag_string, #upload_tag_string'))) {
                            shouldRestore = true;
                            break;
                        }
                    }
                }
            }
            if (shouldRestore)
                break;
        }
        if (shouldRestore) {
            setTimeout(() => {
                loadAndRestoreTags();
            }, 100);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
/**
 * Creates the toggle switch element.
 * @returns {HTMLElement} The constructed toggle switch container.
 */
function createToggleSwitch() {
    const container = document.createElement('span');
    container.className = 'grouping-tags-toggle-container';
    const label = document.createElement('label');
    label.className = 'grouping-tags-label';
    label.textContent = 'Grouping Tags:';
    const switchLabel = document.createElement('label');
    switchLabel.className = 'grouping-tags-switch';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    const isUploadPage = window.location.pathname.startsWith('/uploads');
    if (isUploadPage) {
        checkbox.checked = false;
    }
    else {
        checkbox.checked = GM_getValue(STORAGE_KEY_ENABLED, false);
    }
    checkbox.addEventListener('change', () => {
        setScriptEnabled(checkbox.checked);
        if (checkbox.checked) {
            loadAndRestoreTags();
        }
        else {
            const input = document.querySelector('#post_tag_string, #upload_tag_string');
            if (input) {
                const currentText = input.value;
                if (/([^\s\[]+)\[\s*(.+?)\s*\]/.test(currentText)) {
                    input.value = flattenTags(currentText);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
        }
    });
    const slider = document.createElement('span');
    slider.className = 'grouping-tags-slider';
    switchLabel.appendChild(checkbox);
    switchLabel.appendChild(slider);
    container.appendChild(label);
    container.appendChild(switchLabel);
    return container;
}
/**
 * Inserts the toggle switch into the DOM, adjacent to the "Rating" section options.
 */
function insertToggleButton() {
    parseToggleStyle();
    const labels = Array.from(document.querySelectorAll('label'));
    const ratingLabel = labels.find(l => l.innerText.includes('Rating'));
    if (ratingLabel && ratingLabel.parentElement) {
        const parent = ratingLabel.parentElement;
        parent.appendChild(createToggleSwitch());
    }
}
/**
 * Sets up the submit event interception logic.
 * Handles validation of restricted tags and data persistence before form submission.
 */
function setupFormInterception() {
    let isSubmitting = false;
    document.addEventListener('submit', async (e) => {
        if (isSubmitting)
            return;
        const target = e.target;
        if (!target)
            return;
        const input = target.querySelector('#post_tag_string, #upload_tag_string');
        if (!input)
            return;
        const form = target;
        const text = input.value;
        e.preventDefault();
        e.stopImmediatePropagation();
        isSubmitting = true;
        if (e.submitter && e.submitter instanceof HTMLInputElement) {
            e.submitter.disabled = true;
        }
        else {
            const submitBtn = form.querySelector('input[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
            }
        }
        try {
            const postId = getPostId();
            const enabled = isScriptEnabled();
            if (enabled) {
                const parsed = parseGroupedTags(text);
                // Validation: Artist/Copyright/Meta checks
                if (postId && Object.keys(parsed.groups).length > 0) {
                    try {
                        const resp = await fetch(`/posts/${postId}.json`);
                        if (resp.ok) {
                            const data = await resp.json();
                            const postData = data.post || data;
                            const restrictedTags = new Set([
                                ...(postData.tag_string_artist?.split(' ') || []),
                                ...(postData.tag_string_copyright?.split(' ') || []),
                                ...(postData.tag_string_meta?.split(' ') || [])
                            ]);
                            const invalidTags = [];
                            Object.values(parsed.groups).forEach(tags => {
                                tags.forEach(tag => {
                                    if (restrictedTags.has(tag)) {
                                        invalidTags.push(tag);
                                    }
                                });
                            });
                            if (invalidTags.length > 0) {
                                const msg = `Error: Cannot group Artist/Copyright/Meta tags: ${invalidTags.slice(0, 3).join(', ')}${invalidTags.length > 3 ? '...' : ''}`;
                                showToast(msg, 5000);
                                // Reset state
                                isSubmitting = false;
                                if (e.submitter && e.submitter instanceof HTMLInputElement) {
                                    e.submitter.disabled = false;
                                }
                                else {
                                    const submitBtn = form.querySelector('input[type="submit"]');
                                    if (submitBtn)
                                        submitBtn.disabled = false;
                                }
                                return;
                            }
                        }
                    }
                    catch (validationErr) {
                        console.warn('GroupingTags: Validation fetch failed, skipping check.', validationErr);
                    }
                }
                if (postId) {
                    try {
                        if (Object.keys(parsed.groups).length > 0) {
                            await savePostTagData({
                                postId: postId,
                                updatedAt: Date.now(),
                                isImported: false,
                                groups: parsed.groups
                            });
                        }
                        else {
                            const existing = await getPostTagData(postId);
                            if (existing) {
                                await deletePostTagData(postId);
                            }
                        }
                    }
                    catch (err) {
                        console.error('GroupingTags: DB Operation Failed', err);
                    }
                }
                // Flatten tags for actual submission
                const allTags = [
                    ...Object.values(parsed.groups).flat(),
                    ...parsed.originalTags
                ];
                input.value = allTags.join(' ');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            else {
                // Disabled State: Sync removals only
                if (postId) {
                    try {
                        const dbData = await getPostTagData(postId);
                        if (dbData && dbData.groups) {
                            const currentTags = text.split(/\s+/).filter(t => t.length > 0);
                            const { updatedGroups, changed } = removeMissingTagsFromGroups(dbData.groups, currentTags);
                            if (changed) {
                                if (Object.keys(updatedGroups).length > 0) {
                                    await savePostTagData({
                                        postId: postId,
                                        updatedAt: Date.now(),
                                        isImported: false,
                                        groups: updatedGroups
                                    });
                                }
                                else {
                                    await deletePostTagData(postId);
                                }
                            }
                        }
                    }
                    catch (err) {
                        console.error('GroupingTags: DB Sync Failed', err);
                    }
                }
            }
            if (e.submitter && e.submitter.name) {
                const hiddenInput = document.createElement('input');
                hiddenInput.type = 'hidden';
                hiddenInput.name = e.submitter.name;
                hiddenInput.value = e.submitter.value;
                form.appendChild(hiddenInput);
            }
            form.submit();
        }
        catch (error) {
            console.error("GroupingTags: Error during submit handling", error);
            isSubmitting = false;
        }
        finally {
            setTimeout(() => { isSubmitting = false; }, 1000);
        }
    }, { capture: true });
    window.addEventListener('grouping-tags-db-update', () => {
        loadAndRestoreTags();
    });
}
/**
 * Main initialization function.
 */
function main() {
    AutoSyncManager.init();
    insertToggleButton();
    setupFormInterception();
    loadAndRestoreTags();
    setupDynamicFormObserver();
    if (isScriptEnabled()) {
        new SyntaxHighlighter('#post_tag_string, #upload_tag_string');
    }
    new SmartInputHandler('#post_tag_string, #upload_tag_string', isScriptEnabled);
    if (window.location.pathname.startsWith('/posts/')) {
        new SidebarInjector(isScriptEnabled);
    }
}
main();
//# sourceMappingURL=main.js.map