/**
 * @fileoverview GroupingTags UserScript
 * @license MIT
 */

import { unsafeWindow, GM_getValue, GM_setValue } from '$';

console.log('GroupingTags script started');

const STORAGE_KEY_ENABLED = 'grouping_tags_enabled';

function isScriptEnabled(): boolean {
  // Priority: Checkbox UI state -> Saved State -> Default False
  const checkbox = document.querySelector('.grouping-tags-switch input') as HTMLInputElement;
  if (checkbox) {
    return checkbox.checked;
  }
  return GM_getValue(STORAGE_KEY_ENABLED, false);
}

function setScriptEnabled(enabled: boolean): void {
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

import { SmartInputHandler } from './input_handler';
import { parseGroupedTags, reconstructTags, flattenTags, removeMissingTagsFromGroups } from './parser';
import { savePostTagData, getPostTagData, deletePostTagData } from './db';

// Helper to get Post ID
function getPostId(): number | null {
  // Option 1: URL (e.g., /posts/12345)
  const match = window.location.pathname.match(/\/posts\/(\d+)/);
  if (match) {
    return parseInt(match[1], 10);
  }

  // Option 2: Form action
  const form = document.querySelector('form#form') as HTMLFormElement;
  if (form) {
    const action = form.getAttribute('action');
    const actionMatch = action?.match(/\/posts\/(\d+)/);
    if (actionMatch) {
      return parseInt(actionMatch[1], 10);
    }
  }

  return null;
}

// RESTORE LOGIC
async function loadAndRestoreTags() {
  if (!isScriptEnabled()) return;

  const postId = getPostId();
  if (!postId) return;

  // Find input
  const input = document.querySelector('#post_tag_string, #upload_tag_string') as HTMLTextAreaElement;
  if (!input) return;

  try {
    const data = await getPostTagData(postId);
    if (data && data.groups) {
      console.log('GroupingTags: Found saved groups', data.groups);
      const currentText = input.value;
      const newText = reconstructTags(currentText, data.groups);

      if (currentText !== newText) {
        input.value = newText;
        console.log('GroupingTags: Restored groups in textarea.');
      }
    }
  } catch (e) {
    console.error('GroupingTags: Failed to load/restore tags', e);
  }
}

function createToggleSwitch(): HTMLElement {
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
  } else {
    checkbox.checked = GM_getValue(STORAGE_KEY_ENABLED, false);
  }

  checkbox.addEventListener('change', () => {
    setScriptEnabled(checkbox.checked);
    console.log(`GroupingTags enabled: ${checkbox.checked}`);

    // If turned ON, try to restore immediately
    if (checkbox.checked) {
      loadAndRestoreTags();
    } else {
      // Turned OFF: Flatten tags immediately
      const input = document.querySelector('#post_tag_string, #upload_tag_string') as HTMLTextAreaElement;
      if (input) {
        const currentText = input.value;
        // Only flatten if syntax is detected to avoid unnecessary updates
        if (/([^\s\[]+)\[\s*(.+?)\s*\]/.test(currentText)) {
          input.value = flattenTags(currentText);
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
  } else {
    console.warn('GroupingTags: Could not find Rating container to insert toggle button.');
  }
}

// Duplicate imports and getPostId removed from here.


function setupFormInterception() {
  // Use document-level listener to catch all submits, just in case the form selector was early/wrong.
  document.addEventListener('submit', async (e) => {
    const target = e.target as HTMLElement;
    if (!target) return;

    // Check if it's the right form (id="form" or contains our inputs)
    // We check if it contains the tag input we care about.
    const input = target.querySelector('#post_tag_string, #upload_tag_string') as HTMLTextAreaElement;
    if (!input) return;

    const text = input.value;
    console.log('GroupingTags: Submit detected. Content:', text);

    // Stop immediate submit to process data logic (both ON and OFF)
    e.preventDefault();
    e.stopImmediatePropagation();

    const postId = getPostId();
    const enabled = isScriptEnabled();

    // === TOGGLE ON: Grouping Active ===
    if (enabled) {
      console.log('GroupingTags: Toggle ON. Processing groups...');

      // Even if regex doesn't match/exist, we parse. 
      // If user deleted groups, parsed.groups will be empty.
      const parsed = parseGroupedTags(text);

      if (postId) {
        try {
          if (Object.keys(parsed.groups).length > 0) {
            await savePostTagData({
              postId: postId,
              updated_at: Date.now(),
              is_imported: false,
              groups: parsed.groups
            });
            console.log('GroupingTags: Saved to DB (Overwrite)', parsed);
          } else {
            // Only delete if a record actually exists
            const existing = await getPostTagData(postId);
            if (existing) {
              await deletePostTagData(postId);
              console.log('GroupingTags: Groups removed. Deleted DB record.');
            } else {
              console.log('GroupingTags: No groups and no DB record. Skipping.');
            }
          }
        } catch (err) {
          console.error('GroupingTags: DB Operation Failed', err);
        }
      } else {
        console.warn('GroupingTags: Could not determine Post ID. Skipping DB save.');
      }

      // Flatten tags for submission
      const allTags = [
        ...Object.values(parsed.groups).flat(),
        ...parsed.originalTags
      ];
      input.value = allTags.join(' ');
      console.log('GroupingTags: Input updated for submit:', input.value);
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
                  updated_at: Date.now(),
                  is_imported: false,
                  groups: updatedGroups
                });
                console.log('GroupingTags: Synced removals to DB.', updatedGroups);
              } else {
                // All groups became empty -> Delete record
                await deletePostTagData(postId);
                console.log('GroupingTags: All groups removed. Deleted DB record.');
              }
            } else {
              console.log('GroupingTags: No changes in groups detected.');
            }
          }
        } catch (err) {
          console.error('GroupingTags: DB Sync Failed', err);
        }
      }
      // Input remains as is (flattened)
    }

    // Re-submit
    const form = target as HTMLFormElement;

    if (e.submitter && (e.submitter as HTMLInputElement).name) {
      const hiddenInput = document.createElement('input');
      hiddenInput.type = 'hidden';
      hiddenInput.name = (e.submitter as HTMLInputElement).name;
      hiddenInput.value = (e.submitter as HTMLInputElement).value;
      form.appendChild(hiddenInput);
    }

    form.submit();
  }, { capture: true });

  console.log('GroupingTags: Document-level submit listener attached.');
}

function main() {
  insertToggleButton();
  setupFormInterception();
  loadAndRestoreTags();

  // Initialize Smart Input Handler
  // Targets both upload and post pages
  new SmartInputHandler('#post_tag_string, #upload_tag_string', isScriptEnabled);
}

main();
