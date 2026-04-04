import {CONFIG} from '../config';
import {DataManager} from '../core/data-manager';
import type {SettingsManager} from '../core/settings';
import type {Metric} from '../types';

/** Options for constructing the settings popover. */
export interface SettingsPopoverOptions {
  settingsManager: SettingsManager;
  db: any;
  metric: string;
  settingsBtn: HTMLElement;
  /** Called when settings have changed and the graph should re-render. */
  closeSettings: () => void;
  onRefresh: () => void;
}

/** Return value of createSettingsPopover. */
export interface SettingsPopoverResult {
  popover: HTMLElement;
  /** Close the popover, validating thresholds first. */
  close: () => void;
}

/**
 * Creates the settings popover element with theme picker, thresholds editor,
 * and cache info section.
 * @param {SettingsPopoverOptions} options Construction options.
 * @return {SettingsPopoverResult} The popover element and its close function.
 */
export function createSettingsPopover(options: SettingsPopoverOptions): SettingsPopoverResult {
  const {settingsManager, db, metric, settingsBtn, closeSettings, onRefresh} = options;

  let settingsChanged = false;

  const validateThresholds = (): {valid: boolean; msg?: string} => {
    const modes: Metric[] = ['uploads', 'approvals', 'notes'];
    for (const m of modes) {
      const vals = settingsManager.getThresholds(m);
      for (let i = 0; i < vals.length - 1; i++) {
        if (vals[i] >= vals[i + 1]) {
          return {
            valid: false,
            msg: `Invalid in [${m}]: Level ${i + 1} (${vals[i]}) must be smaller than Level ${i + 2} (${vals[i + 1]})`,
          };
        }
      }
    }
    return {valid: true};
  };

  const handleClose = (): void => {
    const check = validateThresholds();
    if (!check.valid) {
      alert(check.msg);
      return;
    }
    popover.style.display = 'none';
    const gf = document.getElementById('danbooru-grass-flyout');
    if (gf) gf.style.display = 'none';
    if (settingsChanged) {
      settingsChanged = false;
      closeSettings();
    }
  };

  // Build popover element
  const popover = document.createElement('div');
  popover.id = 'danbooru-grass-settings-popover';

  // Close on click outside
  document.addEventListener('click', (e) => {
    if (popover && popover.style.display === 'block') {
      if (
        !popover.contains(e.target as Node) &&
        !settingsBtn.contains(e.target as Node) &&
        !grassFlyout.contains(e.target as Node)
      ) {
        handleClose();
      }
    }
  });

  // Reposition popover on page scroll to stay anchored to settings button
  const repositionPopover = () => {
    if (popover.style.display !== 'block') return;
    const btnRect = settingsBtn.getBoundingClientRect();
    popover.style.left = btnRect.left + 'px';
    popover.style.top = (btnRect.bottom + 4) + 'px';
  };
  window.addEventListener('scroll', (e) => {
    if (popover.style.display === 'block' && !popover.contains(e.target as Node)) {
      repositionPopover();
    }
  }, true);

  // --- 1. Color Themes Section ---
  const themeHeader = document.createElement('div');
  themeHeader.className = 'popover-header';
  themeHeader.textContent = 'Color Themes';
  popover.appendChild(themeHeader);

  const grid = document.createElement('div');
  grid.className = 'theme-grid';

  const currentTheme = settingsManager.getTheme();

  Object.entries(CONFIG.THEMES).forEach(([key, theme]) => {
    const icon = document.createElement('div');
    icon.className = 'theme-icon';
    if (key === currentTheme) icon.classList.add('active'); // Highlight active theme
    icon.title = (theme as any).name;
    icon.style.background = (theme as any).bg;

    // Inner Circle (Empty Cell Color)
    const inner = document.createElement('div');
    inner.className = 'theme-icon-inner';
    inner.style.background = (theme as any).empty;
    icon.appendChild(inner);

    icon.onclick = () => {
      const wasActive = icon.classList.contains('active');
      if (!wasActive) {
        // Reset grass to Recommended when switching themes
        settingsManager.setGrassIndex(0);
        settingsManager.applyTheme(key);
        document.querySelectorAll('.theme-icon').forEach((el) => el.classList.remove('active'));
        icon.classList.add('active');
      }
      // Toggle grass flyout (show on click of active theme, or on first apply)
      toggleGrassFlyout(icon, key);
    };
    grid.appendChild(icon);
  });
  popover.appendChild(grid);

  // --- 1b. Grass Color Flyout ---
  const grassFlyout = document.createElement('div');
  grassFlyout.id = 'danbooru-grass-flyout';
  grassFlyout.style.cssText = 'position:fixed;display:none;background:#fff;border:1px solid #ddd;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.15);padding:8px;z-index:10001;flex-direction:column;gap:6px;';
  document.body.appendChild(grassFlyout);

  let currentFlyoutKey = '';

  const toggleGrassFlyout = (_anchorEl: HTMLElement, themeKey: string) => {
    if (grassFlyout.style.display !== 'none' && currentFlyoutKey === themeKey) {
      grassFlyout.style.display = 'none';
      return;
    }
    currentFlyoutKey = themeKey;

    // Position flyout to the right of the popover
    const popoverRect = popover.getBoundingClientRect();
    grassFlyout.style.left = (popoverRect.right + 8) + 'px';
    grassFlyout.style.top = popoverRect.top + 'px';

    renderGrassFlyout(themeKey);
    grassFlyout.style.display = 'flex';
  };

  const renderGrassFlyout = (themeKey: string) => {
    grassFlyout.innerHTML = '';
    const theme = CONFIG.THEMES[themeKey] || CONFIG.THEMES.light;
    const options = (theme as any).grassOptions;
    if (!options || !Array.isArray(options)) {
      grassFlyout.style.display = 'none';
      return;
    }

    const currentIdx = settingsManager.getGrassIndex();

    const title = document.createElement('div');
    title.style.cssText = 'font-size:10px;color:#888;font-weight:600;margin-bottom:2px;';
    title.textContent = 'Grass Color';
    grassFlyout.appendChild(title);

    options.forEach((opt: any, idx: number) => {
      const row = document.createElement('div');
      row.style.cssText = 'cursor:pointer;display:flex;align-items:center;gap:6px;padding:3px 6px;border-radius:4px;border:2px solid transparent;transition:all 0.15s;';
      if (idx === currentIdx) row.style.borderColor = '#007bff';

      // Mini heatmap (4 cells)
      const preview = document.createElement('div');
      preview.style.cssText = 'display:flex;gap:2px;';
      for (let i = 1; i < opt.levels.length; i++) {
        const cell = document.createElement('div');
        cell.style.cssText = `width:12px;height:12px;border-radius:2px;background:${opt.levels[i]};`;
        preview.appendChild(cell);
      }
      row.appendChild(preview);

      const label = document.createElement('div');
      label.style.cssText = 'font-size:10px;color:#555;white-space:nowrap;';
      label.textContent = idx === 0 ? `★ ${opt.name}` : opt.name;
      row.appendChild(label);

      row.onmouseover = () => { if (idx !== currentIdx) row.style.background = '#f6f8fa'; };
      row.onmouseout = () => { row.style.background = ''; };

      row.onclick = (e) => {
        e.stopPropagation();
        settingsManager.setGrassIndex(idx);
        settingsManager.applyTheme(themeKey);
        renderGrassFlyout(themeKey);
      };

      grassFlyout.appendChild(row);
    });
  };

  // Close flyout when clicking outside
  popover.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!grassFlyout.contains(target) && !target.closest('.theme-icon')) {
      grassFlyout.style.display = 'none';
    }
  });

  // --- 2. Thresholds Section ---
  const threshHeader = document.createElement('div');
  threshHeader.className = 'popover-header';
  threshHeader.textContent = 'Set thresholds';
  threshHeader.style.marginTop = '15px';
  popover.appendChild(threshHeader);

  // Mode Selector
  const modeSelect = document.createElement('select');
  modeSelect.className = 'popover-select';
  ['uploads', 'approvals', 'notes'].forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m.charAt(0).toUpperCase() + m.slice(1);
    if (m === metric.toLowerCase() || (m === 'uploads' && !metric)) opt.selected = true;
    modeSelect.appendChild(opt);
  });
  popover.appendChild(modeSelect);

  // Editor Container
  const editor = document.createElement('div');
  popover.appendChild(editor);

  const renderEditor = (mode: string): void => {
    editor.innerHTML = '';
    const vals = settingsManager.getThresholds(mode as Metric);
    const inputColors = ['#9be9a8', '#40c463', '#30a14e', '#216e39'];

    vals.forEach((val, idx) => {
      const row = document.createElement('div');
      row.className = 'threshold-row';

      const label = document.createElement('span');
      label.textContent = `Level ${idx + 1}:`;
      label.style.width = '50px';

      const input = document.createElement('input');
      input.type = 'number';
      input.className = 'threshold-input';
      input.value = String(val);

      // Styling
      input.style.backgroundColor = inputColors[idx];
      input.style.color = '#ffffff';
      input.style.textShadow = '0px 1px 2px rgba(0,0,0,0.8)';
      input.style.fontWeight = 'bold';
      input.style.border = '1px solid #d0d7de';
      input.style.borderRadius = '4px';

      input.onchange = () => {
        const newVals = [...vals];
        newVals[idx] = parseInt(input.value);
        // Update Settings directly (Validation deferred to close)
        settingsManager.setThresholds(mode as Metric, newVals);
        settingsChanged = true;
        vals[idx] = newVals[idx];
      };

      row.appendChild(label);
      row.appendChild(input);
      editor.appendChild(row);
    });
  };

  modeSelect.addEventListener('change', () => renderEditor(modeSelect.value));
  renderEditor(modeSelect.value); // Initial Render

  // --- 3. Cache Info Section ---
  const cacheSection = document.createElement('div');
  cacheSection.style.marginTop = '15px';
  cacheSection.style.borderTop = '1px solid #d0d7de';
  cacheSection.style.paddingTop = '10px';

  // Header with Purge Button
  const cacheHeader = document.createElement('div');
  cacheHeader.style.display = 'flex';
  cacheHeader.style.justifyContent = 'space-between';
  cacheHeader.style.alignItems = 'center';
  cacheHeader.style.marginBottom = '5px';
  cacheHeader.innerHTML = `
          <div style="font-weight:bold; color:#24292f;">Cache Info</div>
          <button id="grass-purge-btn" title="Purge Cache" style="
            padding: 2px 6px;
            background-color: #ffebe9;
            border: 1px solid #ff818266;
            border-radius: 6px;
            cursor: pointer;
            font-size: 14px;
            color: #cf222e;
            line-height: 1;
          ">↺</button>
        `;
  cacheSection.appendChild(cacheHeader);

  // Stats Container (Toggleable)
  const cacheStatsContainer = document.createElement('div');
  cacheStatsContainer.id = 'grass-cache-container';
  cacheStatsContainer.innerHTML = `
          <div style="font-size:12px; margin-bottom:10px;">
            <a href="#" id="grass-cache-trigger" style="color:#0969da; text-decoration:none;">[ Show Stats ]</a>
          </div>
          <div id="grass-cache-content" style="display:none;"></div>
        `;
  cacheSection.appendChild(cacheStatsContainer);
  popover.appendChild(cacheSection);

  // Logic
  const trigger = cacheSection.querySelector('#grass-cache-trigger');
  const contentDiv = cacheSection.querySelector('#grass-cache-content');
  const purgeBtn = cacheSection.querySelector('#grass-purge-btn');

  const formatBytes = (bytes: number, decimals: number = 2): string => {
    if (!+bytes) return '0 B';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
  };

  let isStatsVisible = false;
  let statsInterval: ReturnType<typeof setInterval> | null = null;

  const updateMyStats = async (): Promise<void> => {
    const dataManager = new DataManager(db);
    const stats = await dataManager.getCacheStats();
    (contentDiv as HTMLElement).innerHTML = `
            <table style="width:100%; border-collapse:collapse; font-size:11px;">
              <tr style="border-bottom:1px solid #eee;">
                <th style="text-align:left; padding:2px;">Source</th>
                <th style="text-align:right; padding:2px;">Items</th>
                <th style="text-align:right; padding:2px;">Size</th>
              </tr>
              <tr>
                <td style="padding:2px;">IndexedDB</td>
                <td style="text-align:right; padding:2px;">${stats.indexedDB.count}</td>
                <td style="text-align:right; padding:2px;">${formatBytes(stats.indexedDB.size)}</td>
              </tr>
              <tr>
                <td style="padding:2px;">Settings</td>
                <td style="text-align:right; padding:2px;">${stats.localStorage.count}</td>
                <td style="text-align:right; padding:2px;">${formatBytes(stats.localStorage.size)}</td>
              </tr>
            </table>
          `;
  };

  (trigger as HTMLElement).onclick = async (e) => {
    e.preventDefault();

    if (isStatsVisible) {
      // Hide
      (contentDiv as HTMLElement).style.display = 'none';
      (trigger as HTMLElement).textContent = '[ Show Stats ]';
      isStatsVisible = false;
      if (statsInterval) {
        clearInterval(statsInterval);
        statsInterval = null;
      }
    } else {
      // Show
      (trigger as HTMLElement).textContent = 'Calculating...';
      (contentDiv as HTMLElement).style.display = 'block';
      await updateMyStats(); // Initial load
      (trigger as HTMLElement).textContent = '[ Hide Stats ]';
      isStatsVisible = true;

      // Start Polling (Real-time updates)
      if (statsInterval) clearInterval(statsInterval);
      statsInterval = setInterval(() => {
        if (isStatsVisible && popover.style.display === 'block') {
          updateMyStats();
        } else {
          // Safety clear
          if (statsInterval) clearInterval(statsInterval);
        }
      }, 100);
    }
  };

  (purgeBtn as HTMLElement).onclick = () => {
    if (confirm(
      'Are you sure you want to clear all cached data? This will trigger a full re-fetch.'
    )) {
      onRefresh();
    }
  };

  return {popover, close: handleClose};
}
