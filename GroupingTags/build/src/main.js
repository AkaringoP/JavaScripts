/**
 * @fileoverview GroupingTags UserScript
 * @license MIT
 */
import { GM_getValue, GM_setValue } from '$';
console.log('GroupingTags script started');
const STORAGE_KEY_ENABLED = 'grouping_tags_enabled';
function isScriptEnabled() {
    // Priority: Checkbox UI state -> Saved State -> Default False
    const checkbox = document.querySelector('.grouping-tags-switch input');
    if (checkbox) {
        return checkbox.checked;
    }
    return GM_getValue(STORAGE_KEY_ENABLED, false);
}
function setScriptEnabled(enabled) {
    GM_setValue(STORAGE_KEY_ENABLED, enabled);
}
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
    /* The switch - the box around the slider */
    .grouping-tags-switch {
      position: relative;
      display: inline-block;
      width: 40px;
      height: 20px;
    }

    /* Hide default HTML checkbox */
    .grouping-tags-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }

    /* The slider */
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
      background-color: #0075ff; /* Danbooru blue-ish or standard active color */
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
import { SyntaxHighlighter } from './highlighter';
import { SmartInputHandler } from './input_handler';
import { parseGroupedTags, reconstructTags, flattenTags, removeMissingTagsFromGroups } from './parser';
import { savePostTagData, getPostTagData, deletePostTagData } from './db';
import { getPostId } from './utils';
import { SidebarInjector } from './sidebar';
// Helper to get Post ID removed (moved to utils)
// Toast Helper
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
// RESTORE LOGIC
async function loadAndRestoreTags() {
    if (!isScriptEnabled())
        return;
    const postId = getPostId();
    if (!postId)
        return;
    // Find input
    const input = document.querySelector('#post_tag_string, #upload_tag_string');
    if (!input)
        return;
    try {
        const data = await getPostTagData(postId);
        if (data && data.groups) {
            console.log('GroupingTags: Found saved groups', data.groups);
            const currentText = input.value;
            const newText = reconstructTags(currentText, data.groups);
            if (currentText !== newText) {
                input.value = newText;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
                console.log('GroupingTags: Restored groups in textarea.');
            }
        }
    }
    catch (e) {
        console.error('GroupingTags: Failed to load/restore tags', e);
    }
}
// Function to handle dynamic form appearance (e.g. clicking "Edit" on post page)
function setupDynamicFormObserver() {
    const observer = new MutationObserver((mutations) => {
        let shouldRestore = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                for (const node of Array.from(mutation.addedNodes)) {
                    if (node instanceof HTMLElement) {
                        // Check if the added node IS the input or CONTAINS the input
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
            // Input found! Run restoration.
            // Add a small delay to ensure value is populated by Danbooru's scripts
            setTimeout(() => {
                loadAndRestoreTags();
            }, 100);
        }
    });
    observer.observe(document.body, { childList: true, subtree: true });
}
function createToggleSwitch() {
    const container = document.createElement('span');
    container.className = 'grouping-tags-toggle-container';
    const label = document.createElement('label'); // strong or label? Labels are better for forms
    label.className = 'grouping-tags-label';
    label.textContent = 'Grouping Tags:';
    // Create toggle switch structure
    const switchLabel = document.createElement('label');
    switchLabel.className = 'grouping-tags-switch';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    // Initialization Logic:
    // Upload Page (/uploads/*): Always Default OFF
    // Post Page (/posts/*): Remember Saved State
    const isUploadPage = window.location.pathname.startsWith('/uploads');
    if (isUploadPage) {
        checkbox.checked = false;
    }
    else {
        checkbox.checked = GM_getValue(STORAGE_KEY_ENABLED, false);
    }
    checkbox.addEventListener('change', () => {
        setScriptEnabled(checkbox.checked);
        console.log(`GroupingTags enabled: ${checkbox.checked}`);
        // If turned ON, try to restore immediately
        if (checkbox.checked) {
            loadAndRestoreTags();
        }
        else {
            // Turned OFF: Flatten tags immediately
            const input = document.querySelector('#post_tag_string, #upload_tag_string');
            if (input) {
                const currentText = input.value;
                // Only flatten if syntax is detected to avoid unnecessary updates
                if (/([^\s\[]+)\[\s*(.+?)\s*\]/.test(currentText)) {
                    input.value = flattenTags(currentText);
                    input.dispatchEvent(new Event('input', { bubbles: true }));
                    input.dispatchEvent(new Event('change', { bubbles: true }));
                    console.log('GroupingTags: Flattened tags in textarea.');
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
function insertToggleButton() {
    // Inject CSS first
    parseToggleStyle();
    const labels = Array.from(document.querySelectorAll('label'));
    const ratingLabel = labels.find(l => l.innerText.includes('Rating'));
    if (ratingLabel && ratingLabel.parentElement) {
        const parent = ratingLabel.parentElement;
        parent.appendChild(createToggleSwitch());
    }
    else {
        console.warn('GroupingTags: Could not find Rating container to insert toggle button.');
    }
}
// Duplicate imports and getPostId removed from here.
function setupFormInterception() {
    let isSubmitting = false;
    // Use document-level listener to catch all submits, just in case the form selector was early/wrong.
    document.addEventListener('submit', async (e) => {
        // Prevent recursive submission loops
        if (isSubmitting)
            return;
        const target = e.target;
        if (!target)
            return;
        // Check if it's the right form (id="form" or contains our inputs)
        const input = target.querySelector('#post_tag_string, #upload_tag_string');
        if (!input)
            return;
        // Cast to Form once for use throughout
        const form = target;
        const text = input.value;
        console.log('GroupingTags: Submit detected. Content:', text);
        // Stop immediate submit to process data logic (both ON and OFF)
        e.preventDefault();
        e.stopImmediatePropagation();
        isSubmitting = true;
        // Visual Feedback: Disable Submit Button
        if (e.submitter && e.submitter instanceof HTMLInputElement) {
            e.submitter.disabled = true;
        }
        else {
            // Fallback if submitter is not captured or not an input
            const submitBtn = form.querySelector('input[type="submit"]');
            if (submitBtn) {
                submitBtn.disabled = true;
            }
        }
        try {
            const postId = getPostId();
            const enabled = isScriptEnabled();
            // === TOGGLE ON: Grouping Active ===
            if (enabled) {
                console.log('GroupingTags: Toggle ON. Processing groups...');
                const parsed = parseGroupedTags(text);
                // --- VALIDATION START ---
                if (postId && Object.keys(parsed.groups).length > 0) {
                    try {
                        // Fetch Post Data to check tag types
                        const resp = await fetch(`/posts/${postId}.json`);
                        if (resp.ok) {
                            const data = await resp.json();
                            // Danbooru API often returns the object directly or wrapped in 'post'
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
                                console.error("GroupingTags: Validation Failed", invalidTags);
                                // Re-enable button and Stop
                                isSubmitting = false;
                                if (e.submitter && e.submitter instanceof HTMLInputElement) {
                                    e.submitter.disabled = false;
                                }
                                else {
                                    const submitBtn = form.querySelector('input[type="submit"]');
                                    if (submitBtn)
                                        submitBtn.disabled = false;
                                }
                                return; // BLOCK SUBMIT
                            }
                        }
                    }
                    catch (validationErr) {
                        console.warn('GroupingTags: Validation fetch failed, skipping check.', validationErr);
                    }
                }
                // --- VALIDATION END ---
                if (postId) {
                    try {
                        if (Object.keys(parsed.groups).length > 0) {
                            await savePostTagData({
                                postId: postId,
                                updatedAt: Date.now(),
                                isImported: false,
                                groups: parsed.groups
                            });
                            console.log('GroupingTags: Saved to DB (Overwrite)', parsed);
                        }
                        else {
                            const existing = await getPostTagData(postId);
                            if (existing) {
                                await deletePostTagData(postId);
                                console.log('GroupingTags: Groups removed. Deleted DB record.');
                            }
                        }
                    }
                    catch (err) {
                        console.error('GroupingTags: DB Operation Failed', err);
                    }
                }
                // Flatten tags for submission
                const allTags = [
                    ...Object.values(parsed.groups).flat(),
                    ...parsed.originalTags
                ];
                input.value = allTags.join(' ');
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            // === TOGGLE OFF: Grouping Inactive (Sync Removals) ===
            else {
                console.log('GroupingTags: Toggle OFF. Syncing removals...');
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
            // Re-submit
            // Create hidden input for submitter if it exists, to preserve button action
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
            // Ensure we don't block submit on error
            isSubmitting = false;
        }
        finally {
            // We don't reset isSubmitting to false if we successfully called form.submit()
            // because the page should reload/navigate.
            // However, if form.submit() doesn't reload (e.g. AJAX form), we might need to reset.
            // But standard form submission will reload.
            // If it was an SPA or handled via AJAX, we might need a timeout to reset.
            setTimeout(() => { isSubmitting = false; }, 1000);
        }
    }, { capture: true });
    console.log('GroupingTags: Document-level submit listener attached.');
    // Listen for Sidebar Updates
    window.addEventListener('grouping-tags-db-update', () => {
        console.log('GroupingTags: DB Update detected. Refreshing tags...');
        loadAndRestoreTags();
    });
}
function main() {
    insertToggleButton();
    setupFormInterception();
    loadAndRestoreTags();
    setupDynamicFormObserver(); // Monitor for dynamic "Edit" window
    // Initialize Syntax Highlighter if enabled
    if (isScriptEnabled()) {
        new SyntaxHighlighter('#post_tag_string, #upload_tag_string');
    }
    // Initialize Smart Input Handler
    // Targets both upload and post pages
    new SmartInputHandler('#post_tag_string, #upload_tag_string', isScriptEnabled);
    // Initialize Sidebar Indicators (Post Page only)
    if (window.location.pathname.startsWith('/posts/')) {
        new SidebarInjector(isScriptEnabled);
    }
}
main();
//# sourceMappingURL=main.js.map