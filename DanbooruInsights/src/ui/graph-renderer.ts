import * as d3 from 'd3';
import {CONFIG} from '../config';
import type {DataManager} from '../core/data-manager';
import type {TargetUser, MetricData, CalHeatmapDatum} from '../types';
import {SettingsManager} from '../core/settings';
import {createSettingsPopover} from './settings-popover';
import {showApprovalsDetail} from './approval-detail-popover';

/**
 * GraphRenderer: Handles rendering of the contribution heatmap graph.
 * Creates and manages the CalHeatmap instance, UI controls, and settings popover.
 */
export class GraphRenderer {
  containerId: string;
  cal: any;
  settingsManager: SettingsManager;
  db: any;
  dataManager: DataManager | null;

  /**
   * @param {SettingsManager} settingsManager The settings manager instance.
   */
  constructor(settingsManager: SettingsManager, db: any) {
    this.containerId = 'danbooru-grass-container';
    this.cal = null;
    this.settingsManager = settingsManager;
    this.db = db;
    this.dataManager = null;
  }

  /**
   * Injects the skeleton HTML structure into the page.
   * @param {DataManager} dataManager The data manager for fetching settings.
   * @param {string|number} userId The user's ID for settings.
   * @return {Promise<boolean>} Resolves to true if injection was successful.
   */
  async injectSkeleton(dataManager: DataManager, userId: string | number): Promise<boolean> {
    // Save reference for later use (e.g. approval popover hover preview)
    this.dataManager = dataManager;

    // Check if container already exists
    if (document.getElementById(this.containerId)) {
      return true; // Preservation Logic: Do not destroy!
    }

    // Normal Injection Logic
    let stats = document.querySelector(CONFIG.SELECTORS.STATISTICS_SECTION);
    // Fallbacks...
    if (!stats) {
      const table = document.querySelector(
        '#a-show > div:nth-child(1) > div:nth-child(2) > table'
      );
      if (table) stats = table.parentElement;
    }
    if (!stats) {
      // Text Fallback (H1/H2)
      document.querySelectorAll('h1, h2').forEach((el) => {
        if (el.textContent.trim() === 'Statistics') stats = el.parentElement;
      });
    }

    if (!stats) {
      console.error('[Danbooru Grass] Injection point not found.');
      return false;
    }

    // Wrapper Logic
    let wrapper = document.getElementById('danbooru-grass-wrapper');
    if (!wrapper) {
      if ((stats.parentNode as HTMLElement).id === 'danbooru-grass-wrapper') {
        wrapper = stats.parentNode as HTMLElement;
      } else {
        wrapper = document.createElement('div');
        wrapper.id = 'danbooru-grass-wrapper';
        wrapper.style.display = 'flex';
        wrapper.style.alignItems = 'flex-start';
        wrapper.style.gap = '20px';
        wrapper.style.flexWrap = 'wrap';
        wrapper.style.width = '100%';
        stats.parentNode?.insertBefore(wrapper, stats);
        wrapper.appendChild(stats);
      }
    }

    const container = document.createElement('div');
    container.id = this.containerId;
    container.style.position = 'relative';

    // Fetch Per-User Settings from IndexedDB
    const grassSettings = await dataManager.getGrassSettings(userId);
    let savedWidth = grassSettings ? grassSettings.width : null;
    let savedX = grassSettings ? grassSettings.xOffset : 0;

    // Constraints logic
    const applyConstraints = () => {
      const wrapperWidth = wrapper.offsetWidth;
      const statsWidth = (stats as HTMLElement).offsetWidth;
      const gap = 20;

      // Check if wrapped (Graph is below Stats)
      const isWrapped = container.offsetTop > ((stats as HTMLElement).offsetTop + 10);

      let maxAvailableWidth;
      if (isWrapped) {
        maxAvailableWidth = wrapperWidth;
      } else {
        maxAvailableWidth = Math.max(300, wrapperWidth - statsWidth - gap);
      }

      if (savedWidth) {
        const numericWidth = parseFloat(String(savedWidth));
        const clampedWidth = Math.max(300, Math.min(numericWidth, maxAvailableWidth));
        container.style.flex = '0 0 auto';
        container.style.width = `${clampedWidth}px`;

        // Also clamp X to ensure it doesn't overflow right
        const clampedX = Math.max(0, Math.min(savedX ?? 0, maxAvailableWidth - clampedWidth));
        container.style.transform = `translateX(${clampedX}px)`;
      } else {
        container.style.flex = '1';
        container.style.transform = `translateX(0px)`;
      }
    };

    // Sync Hourly panel position/width with heatmap container
    const syncPanelPosition = () => {
      const panel = document.getElementById('danbooru-grass-panel');
      if (!panel) return;
      const xOffset = parseFloat(container.style.transform?.replace(/translateX\(|px\)/g, '') || '0') || 0;
      panel.style.marginLeft = xOffset > 0 ? `${xOffset}px` : '0';
    };

    // Initial apply (might be 0 if not 100% rendered, so we use a small delay or observer)
    setTimeout(() => { applyConstraints(); syncPanelPosition(); }, 0);

    // Re-apply on layout stabilization. The wrapper's offsetWidth can be 0
    // (or smaller than its final value) on the very first frame, especially
    // when the page is still hydrating. That used to cause savedWidth/xOffset
    // to be clamped against an underestimated maxAvailableWidth and lock the
    // graph at minWidth (300px) on the left. ResizeObserver fires whenever
    // the wrapper's box size changes, so we re-run the constraint pass each
    // time and stop once we've seen a sensible width settle.
    if (typeof ResizeObserver !== 'undefined') {
      let stableTicks = 0;
      let lastWidth = 0;
      const ro = new ResizeObserver(() => {
        const w = wrapper.offsetWidth;
        if (w <= 0) return;
        applyConstraints();
        syncPanelPosition();
        if (w === lastWidth) {
          stableTicks++;
          // Two consecutive identical measurements → layout has settled
          if (stableTicks >= 2) ro.disconnect();
        } else {
          stableTicks = 0;
          lastWidth = w;
        }
      });
      ro.observe(wrapper);
      // Safety: always disconnect after 2s so we never observe forever
      setTimeout(() => ro.disconnect(), 2000);
    }

    container.style.minWidth = '300px';

    // Resize & Move Logic
    const createHandle = (type: 'resize' | 'move', side?: 'left' | 'right'): HTMLDivElement => {
      const handle = document.createElement('div');
      if (type === 'resize') {
        handle.style.cssText = `
            position: absolute;
            top: 0;
            ${side}: -5px;
            width: 10px;
            height: 100%;
            cursor: col-resize;
            z-index: 101;
          `;
      } else if (type === 'move') {
        handle.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 30px;
            height: 30px;
            cursor: move;
            z-index: 102;
            background: rgba(136, 136, 136, 0.1);
            border-bottom-right-radius: 8px;
            border-top-left-radius: 8px;
          `;
      }

      handle.onmousedown = (e) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = container.offsetWidth;
        const startXOffset = parseFloat(container.style.transform.replace(/translateX\(|px\)/g, '')) || 0;

        const onMouseMove = (mE: MouseEvent): void => {
          const delta = mE.clientX - startX;

          // Constraints
          // Constraints
          const wrapperWidth = wrapper.offsetWidth;
          const statsWidth = (stats as HTMLElement).offsetWidth;
          const gap = 20;

          // Check if wrapped (Graph is below Stats)
          const isWrapped = container.offsetTop > ((stats as HTMLElement).offsetTop + 10);

          let maxAvailableWidth;
          if (isWrapped) {
            maxAvailableWidth = wrapperWidth;
          } else {
            maxAvailableWidth = Math.max(300, wrapperWidth - statsWidth - gap);
          }

          if (type === 'move') {
            let newX = startXOffset + delta;
            // Don't go left into stats, don't go right out of wrapper
            newX = Math.max(0, Math.min(newX, maxAvailableWidth - startWidth));
            container.style.transform = `translateX(${newX}px)`;
          } else if (type === 'resize') {
            if (side === 'right') {
              const maxWidth = maxAvailableWidth - startXOffset;
              const newWidth = Math.max(300, Math.min(startWidth + delta, maxWidth));
              container.style.flex = '0 0 auto';
              container.style.width = `${newWidth}px`;
            } else if (side === 'left') {
              // Expansion left is limited by XOffset reaching 0
              const minDelta = -startXOffset;
              const clampedDelta = Math.max(delta, minDelta);
              let newWidth = Math.max(300, startWidth - clampedDelta);

              // If width hits 300, stop moving X
              const finalDelta = startWidth - newWidth;
              const newX = startXOffset + finalDelta;

              container.style.flex = '0 0 auto';
              container.style.width = `${newWidth}px`;
              container.style.transform = `translateX(${newX}px)`;
            }
          }
          syncPanelPosition();
        };

        const onMouseUp = () => {
          document.removeEventListener('mousemove', onMouseMove);
          document.removeEventListener('mouseup', onMouseUp);
          const finalX = parseFloat(container.style.transform.replace(/translateX\(|px\)/g, '')) || 0;
          dataManager.saveGrassSettings(userId, {
            width: container.style.width,
            xOffset: finalX
          });
          syncPanelPosition();
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
      };
      handle.className = 'di-grass-handle';
      return handle;
    };

    container.style.background = 'var(--card-background-color, #222)';
    container.style.padding = '15px';
    container.style.borderRadius = '8px';
    container.style.minHeight = '180px';
    container.style.color = 'var(--text-color, #eee)';
    container.innerHTML = `
        <div style="display:flex; justify-content:space-between; margin-bottom:10px; align-items:center;">
          <h2 style="font-size:1.2em; margin:0;">Contribution Graph</h2>
          <div id="grass-controls" style="gap:10px; display:flex;"></div>
        </div>
        <div id="cal-heatmap" style="overflow-x:auto; padding-bottom:5px;"></div>
        <div id="grass-loading" style="text-align:center; padding:20px; color:#888;">Initializing...</div>
      `;

    // Append handles AFTER innerHTML to prevent them from being overwritten
    container.appendChild(createHandle('resize', 'left'));
    container.appendChild(createHandle('resize', 'right'));
    container.appendChild(createHandle('move'));

    // Apply Initial Theme
    const currentTheme = this.settingsManager.getTheme();
    this.settingsManager.applyTheme(currentTheme);

    wrapper.appendChild(container);
    this.populateSummaryGrid();

    // Create Tooltip Element globally
    if (!document.getElementById('danbooru-grass-tooltip')) {
      const tooltip = document.createElement('div');
      tooltip.id = 'danbooru-grass-tooltip';
      tooltip.style.position = 'absolute';
      tooltip.style.padding = '8px';
      tooltip.style.background = '#222';
      tooltip.style.color = '#fff';
      tooltip.style.borderRadius = '4px';
      tooltip.style.border = '1px solid #444';
      tooltip.style.pointerEvents = 'none';
      tooltip.style.opacity = '0';
      tooltip.style.zIndex = '99999';
      tooltip.style.fontSize = '12px';
      document.body.appendChild(tooltip);
    }

    return true;
  }

  /**
   * Updates the control and filter UI elements.
   * Renders selects for metrics and years, plus management buttons.
   * @param {!Array<number>} availableYears List of available years for selection.
   * @param {number} currentYear The currently active year.
   * @param {string} currentMetric The currently active metric.
   * @param {function(number)} onYearChange Callback invoked when the year changes.
   * @param {function(string)} onMetricChange Callback invoked when the metric changes.
   * @param {function()} onRefresh Callback invoked to refresh data.
   */
  updateControls(_availableYears: number[], _currentYear: number, currentMetric: string, _onYearChange: (year: number) => void, onMetricChange: (metric: string) => void, _onRefresh: () => void): void {
    const controls = document.getElementById('grass-controls');
    if (!controls) return;
    controls.innerHTML = '';

    const metricSel = document.createElement('select');
    metricSel.className = 'ui-select';
    ['uploads', 'approvals', 'notes'].forEach((m) => {
      const opt = document.createElement('option');
      opt.value = m;
      opt.text = m.charAt(0).toUpperCase() + m.slice(1);
      if (m === currentMetric) opt.selected = true;
      metricSel.appendChild(opt);
    });
    metricSel.onchange = (e) => onMetricChange((e.target as HTMLSelectElement).value);
    controls.appendChild(metricSel);
  }

  /**
   * Populates the summary grid with 24 empty large grass cells inside the collapsible panel,
   * including AM/PM and hourly labels.
   */
  populateSummaryGrid(): void {
    const panel = document.getElementById('danbooru-grass-panel');
    if (!panel) return;

    panel.innerHTML = '';

    const wrapper = document.createElement('div');
    wrapper.id = 'danbooru-grass-summary-grid-wrapper';

    // 0. Header (Added per user request)
    const header = document.createElement('div');
    header.id = 'danbooru-grass-summary-header';
    header.style.cssText = `
        font-size: 14px;
        font-weight: 500;
        margin-bottom: 2px;
        color: var(--grass-text, #24292f);
      `;
    header.textContent = 'Hourly Distribution'; // Initial text
    wrapper.appendChild(header);

    // 1. Top Labels Row (0/12, 6/18)
    const topLabels = document.createElement('div');
    topLabels.className = 'summary-top-labels';

    const label0 = document.createElement('div');
    label0.className = 'summary-label top-label-item';
    label0.textContent = '0 / 12';
    label0.style.left = '11px'; // Center of first cell (22px/2)

    const label6 = document.createElement('div');
    label6.className = 'summary-label top-label-item';
    label6.textContent = '6 / 18';
    label6.style.left = `${11 + (22 + 4) * 6}px`; // Center of 7th cell

    topLabels.appendChild(label0);
    topLabels.appendChild(label6);
    wrapper.appendChild(topLabels);

    // 2. Middle Row (Side Labels + Grid)
    const midRow = document.createElement('div');
    midRow.className = 'summary-row-container';

    const sideLabels = document.createElement('div');
    sideLabels.className = 'summary-side-labels';

    const labelAM = document.createElement('div');
    labelAM.className = 'summary-label';
    labelAM.textContent = 'AM';

    const labelPM = document.createElement('div');
    labelPM.className = 'summary-label';
    labelPM.textContent = 'PM';

    sideLabels.appendChild(labelAM);
    sideLabels.appendChild(labelPM);

    const grid = document.createElement('div');
    grid.id = 'danbooru-grass-summary-grid';
    for (let i = 0; i < 24; i++) {
      const cell = document.createElement('div');
      cell.className = 'large-grass-cell';
      grid.appendChild(cell);
    }

    midRow.appendChild(sideLabels);
    midRow.appendChild(grid);
    wrapper.appendChild(midRow);

    // 3. Legend Row (Added per user request)
    const legendRow = document.createElement('div');
    legendRow.id = 'danbooru-grass-summary-legend';
    legendRow.style.cssText = `
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 4px;
        margin-top: 6px;
        font-size: 10px;
        color: var(--grass-text, #57606a);
      `;
    // Initial Placeholder
    legendRow.innerHTML = '<span style="margin-right:2px">Less</span>' +
      [0, 1, 2, 3, 4].map(l => `<div class="legend-rect" data-level="${l}" style="width:10px; height:10px; border-radius:2px; background:var(--grass-level-${l})"></div>`).join('') +
      '<span style="margin-left:2px">More</span>';

    wrapper.appendChild(legendRow);

    panel.appendChild(wrapper);
  }

  /**
   * Updates the summary grid cells with heatmap colors based on hourly data.
   * @param {Array<number>} hourlyCounts Array of 24 integers (0-23).
   * @param {string} metric Current metric for thresholds.
   */
  updateSummaryGrid(hourlyCounts: number[] | null, metric: string): void {
    const grid = document.getElementById('danbooru-grass-summary-grid');
    if (!grid) return;

    const cells = grid.querySelectorAll('.large-grass-cell');
    if (cells.length !== 24) return;

    // If no data, reset to empty
    if (!hourlyCounts) {
      cells.forEach(cell => {
        (cell as HTMLElement).style.background = 'var(--grass-empty-cell, #ebedf0)';
        // Add empty state tooltip events? No, just clear
        (cell as HTMLElement).onmouseenter = null;
        (cell as HTMLElement).onmouseleave = null;
        cell.removeAttribute('title');
      });
      // Update header if exists
      const header = document.getElementById('danbooru-grass-summary-header');
      if (header) header.textContent = `Hourly ${metric} Distribution`;
      return;
    }

    // Update Header
    const header = document.getElementById('danbooru-grass-summary-header');
    if (header) header.textContent = `Hourly ${metric} Distribution`;

    // Dynamic Relative Scale (User Request: 5 Segments from 0 to Max)
    // Range is divided into 5 equal parts (0-20%, 20-40%, 40-60%, 60-80%, 80-100%)
    // This maps to Levels 0, 1, 2, 3, 4.
    // Small counts in the bottom 20% will appear as Level 0 (Empty/Gray).
    const max = Math.max(...hourlyCounts, 1);

    cells.forEach((cell, i) => {
      const count = hourlyCounts[i] || 0;
      let level = 0;

      if (count > 0) {
        // Calculate level: 0 to 4
        level = Math.floor((count / max) * 5);
        // Clamp to max level 4 (for the top 100% case which results in 5)
        if (level > 4) level = 4;
      }

      // Apply color
      (cell as HTMLElement).style.background = `var(--grass-level-${level})`;
      // Remove native tooltip
      cell.removeAttribute('title');

      // Add custom tooltip events
      (cell as HTMLElement).onmouseenter = (_e) => {
        const tooltip = document.getElementById('danbooru-grass-tooltip');
        if (!tooltip) return;

        tooltip.style.opacity = '1';
        tooltip.innerHTML = `<strong>${i.toString().padStart(2, '0')}:00</strong>, ${count} ${metric}`;

        const rect = cell.getBoundingClientRect();
        const tooltipRect = tooltip.getBoundingClientRect();

        // Center above the cell (Add window.scrollX/Y for absolute position)
        let left = rect.left + window.scrollX + (rect.width / 2) - (tooltipRect.width / 2);
        let top = rect.top + window.scrollY - tooltipRect.height - 8;

        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
      };

      (cell as HTMLElement).onmouseleave = () => {
        const tooltip = document.getElementById('danbooru-grass-tooltip');
        if (tooltip) tooltip.style.opacity = '0';
      };
    });

    // Update Legend Tooltips with Dynamic Ranges
    const legend = document.getElementById('danbooru-grass-summary-legend');
    if (legend) {
      const step = max / 5;
      const rects = legend.querySelectorAll('.legend-rect');
      rects.forEach(r => {
        const l = parseInt(r.getAttribute('data-level') ?? '0');
        let minRange, maxRange;

        if (l === 0) {
          minRange = 0;
          maxRange = Math.floor(step);
        } else {
          minRange = Math.floor(step * l) + 1;
          maxRange = Math.floor(step * (l + 1));
        }

        if (l === 4) maxRange = max; // Clamp max

        // Remove native tooltip
        r.removeAttribute('title');

        // Add custom dark tooltip
        (r as HTMLElement).onmouseenter = (_e) => {
          const tooltip = document.getElementById('danbooru-grass-tooltip');
          if (!tooltip) return;

          tooltip.style.opacity = '1';
          tooltip.innerHTML = `${minRange} - ${maxRange}`;

          const rect = r.getBoundingClientRect();
          const tooltipRect = tooltip.getBoundingClientRect();

          let left = rect.left + window.scrollX + (rect.width / 2) - (tooltipRect.width / 2);
          let top = rect.top + window.scrollY - tooltipRect.height - 8;

          tooltip.style.left = `${left}px`;
          tooltip.style.top = `${top}px`;
        };

        (r as HTMLElement).onmouseleave = () => {
          const tooltip = document.getElementById('danbooru-grass-tooltip');
          if (tooltip) tooltip.style.opacity = '0';
        };
      });
    }
  }

  /**
   * Toggles the loading state UI.
   * @param {boolean} isLoading True to show loading state.
   * @param {string} [message] Optional message to display.
   */
  setLoading(isLoading: boolean, message: string = 'Initializing...'): void {
    const el = document.getElementById('grass-loading');
    if (el) {
      el.style.display = isLoading ? 'block' : 'none';
      el.textContent = message;
    }
    const cal = document.getElementById('cal-heatmap');
    if (cal) cal.style.opacity = isLoading ? '0.5' : '1';
  }

  /**
   * Renders the contribution graph.
   * @param {Object} dataMap Map of date strings to counts.
   * @param {number} year The year to render.
   * @param {string} metric The metric being displayed.
   * @param {Object} userInfo User info object.
   * @param {Array<number>} availableYears List of available years.
   * @param {Function} onYearChange Callback for year change.
   * @param {Function} onRefresh Callback for refresh.
   */
  async renderGraph(
    dataMap: MetricData | Record<string, number>,
    year: number,
    metric: string,
    userInfo: TargetUser | string,
    availableYears: number[],
    onYearChange: (year: number) => void,
    onRefresh: () => void,
    skipScroll = false
  ): Promise<void> {
    // Handle new data format { daily, hourly } or legacy map
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let dailyData: any = dataMap;
    let hourlyData = null;

    if (dataMap && (dataMap as MetricData).daily) {
      dailyData = (dataMap as MetricData).daily;
      hourlyData = (dataMap as MetricData).hourly;
    }

    // Update Header with Total Count and Embedded Year Selector
    const total = Object.values(dailyData || {}).reduce((acc: number, v) => acc + (v as number), 0);
    const header = document.querySelector('#danbooru-grass-container h2');

    if (header) {
      header.innerHTML = ''; // Clear existing text

      // 1. Text Part
      const textSpan = document.createElement('span');
      textSpan.textContent = `${total.toLocaleString()} contributions in `;
      header.appendChild(textSpan);

      // 2. Year Selector Part
      if (availableYears && onYearChange) {
        const yearSelect = document.createElement('select');
        yearSelect.style.cssText = `
            font-family: inherit;
            font-size: inherit;
            font-weight: normal;
            color: #24292f;
            background-color: #f6f8fa;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            padding: 2px 4px;
            margin-left: 6px;
            cursor: pointer;
            vertical-align: baseline;
          `;

        availableYears.forEach((y) => {
          const opt = document.createElement('option');
          opt.value = String(y);
          opt.textContent = String(y);
          if (y === year) opt.selected = true;
          yearSelect.appendChild(opt);
        });

        yearSelect.onchange = (e) => onYearChange(parseInt((e.target as HTMLSelectElement).value, 10));
        header.appendChild(yearSelect);
      } else {
        // Fallback if no controls passed (e.g. init)
        header.appendChild(document.createTextNode(String(year)));
      }
    }

    if ((window as any).cal && typeof (window as any).cal.destroy === 'function') {
      try {
        (window as any).cal.destroy();
      } catch (e) {
        console.warn('[Danbooru Grass] Failed to destroy previous instance:', e);
      }
    }
    (window as any).cal = new (window as any).CalHeatmap();

    const userName = (userInfo as any).name || userInfo;

    // Ensure our container structure supports the side-label + scrollable graph
    const container = document.getElementById('cal-heatmap');
    if (!container) return;

    const source = Object.entries(dailyData || {}).map(([k, v]) => ({
      date: k,
      value: v
    }));

    const sanitizedName = (userInfo as any).normalizedName || (userName as string).replace(/ /g, '_');
    const userIdVal = (userInfo as any).id || (userInfo as any).name;

    const getUrl = (date: string, _count: number): string | null => {
      if (!date) return null;

      switch (metric) {
        case 'uploads':
          return `/posts?tags=user:${sanitizedName}+date:${date}`;
        case 'approvals':
          return '#'; // Enable click for approvals (Handled by JS)
        case 'notes':
          return `/posts?tags=noteupdater:${sanitizedName}+date:${date}`;
        default:
          return null;
      }
    };


    // Inject Custom CSS
    const styleId = 'danbooru-grass-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = `
          /* Container & Header Styling */
          #danbooru-grass-container {
            background: var(--grass-bg, #fff) !important;
            color: var(--grass-text, #24292f) !important;
            border-radius: 6px;
          }
          #danbooru-grass-container h2 {
            color: var(--grass-text, #24292f) !important;
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
            font-weight: normal !important;
          }
          /* Controls */
          #grass-controls select {
            background-color: #f6f8fa !important;
            color: #24292f !important;
            border: 1px solid #d0d7de !important;
            border-radius: 6px;
            padding: 2px 2px;
          }
          /* Empty Cells & Domain Backgrounds */
          .ch-subdomain-bg { fill: var(--grass-empty-cell, #ebedf0); }
          .ch-domain-bg { fill: transparent !important; } /* Fix black bars */

          /* All SVG Text (Months & Days) */
          #cal-heatmap text,
          #gh-day-labels text {
            fill: var(--grass-text, #24292f) !important;
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
            font-size: 10px;
          }

          /* Scrollable Area */
          #cal-heatmap-scroll {
            overflow-x: auto;
            overflow-y: hidden;
            flex: 1;
            white-space: nowrap;
          }
          #cal-heatmap-scroll::-webkit-scrollbar { height: 8px; }
          #cal-heatmap-scroll::-webkit-scrollbar-thumb {
            background: var(--grass-scrollbar-thumb, #d0d7de);
            border-radius: 4px;
          }

          /* Settings Popover */
          #danbooru-grass-settings-popover {
            position: fixed;
            max-height: 70vh;
            overflow-y: auto;
            background: #fff;
            color: #24292f;
            border: 1px solid #d0d7de;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            border-radius: 8px;
            padding: 12px;
            z-index: 10000;
            display: none;
            width: 290px;
            transform-origin: top left;
          }
          .theme-grid {
            display: grid;
            grid-template-columns: repeat(6, 1fr);
            gap: 8px;
          }
          .theme-icon {
            width: 36px;
            height: 36px;
            border-radius: 8px;
            position: relative;
            cursor: pointer;
            border: 2px solid transparent;
            box-sizing: border-box;
          }
          .theme-icon:hover { transform: scale(1.1); }
          .theme-icon.active { border-color: #0969da; }
          .theme-icon-inner {
            position: absolute;
            top: 50%; left: 50%;
            transform: translate(-50%, -50%);
            width: 16px; height: 16px;
            border-radius: 4px;
          }
          .popover-header {
            font-weight: 600;
            font-size: 12px;
            color: #24292f;
            margin-bottom: 8px;
          }
          .popover-select {
            width: 100%;
            margin-bottom: 10px;
            padding: 4px;
            border-radius: 4px;
            border: 1px solid #d0d7de;
            background-color: #f6f8fa;
            font-size: 12px;
          }
          .threshold-row {
            display: flex;
            align-items: center;
            margin-bottom: 6px;
            font-size: 12px;
          }
          .threshold-input {
            width: 60px;
            margin-left: auto;
            padding: 2px 4px;
            border: 1px solid #d0d7de;
            border-radius: 4px;
          }

          /* Approvals Detail Popover */
          #danbooru-approvals-popover {
            position: absolute;
            background: #fff;
            color: #24292f;
            border: 1px solid #d0d7de;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            border-radius: 10px;
            padding: 16px;
            z-index: 100005;
            display: none;
            width: 320px;
            font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
          }
          #danbooru-approvals-popover .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
            padding-bottom: 8px;
            border-bottom: 1px solid #eee;
          }
          #danbooru-approvals-popover .header-title {
            font-weight: 600;
            font-size: 14px;
          }
          #danbooru-approvals-popover .close-btn {
            cursor: pointer;
            color: #888;
            font-size: 18px;
            line-height: 1;
          }
          /* Summary Grid Layout */
          #danbooru-grass-summary-grid-wrapper {
            display: flex;
            flex-direction: column;
            gap: 4px;
            width: fit-content;
            margin: 0 auto;
            padding: 10px;
            background: var(--grass-bg, rgba(128, 128, 128, 0.05));
            border-radius: 8px;
            border: 1px solid rgba(0,0,0,0.05);
          }
          #danbooru-grass-summary-grid {
            display: grid;
            grid-template-columns: repeat(12, 1fr);
            gap: 4px;
            width: fit-content;
          }
          .summary-row-container {
            display: flex;
            gap: 8px;
            align-items: center;
          }
          .summary-side-labels {
            display: flex;
            flex-direction: column;
            justify-content: space-around;
            height: 48px; /* 22px * 2 + 4px gap */
            padding-top: 2px;
          }
          .summary-top-labels {
            display: flex;
            margin-left: 28px; /* Match width of side labels + gap */
            position: relative;
            height: 14px;
          }
          .summary-label {
             fill: var(--grass-text, #24292f);
             color: var(--grass-text, #24292f);
             font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif;
             font-size: 10px;
             white-space: nowrap;
          }
          .top-label-item {
            position: absolute;
            transform: translateX(-50%);
          }
          .large-grass-cell {
            width: 22px;
            height: 22px;
            background-color: var(--grass-empty-cell, #ebedf0);
            border-radius: 4px;
            transition: background-color 0.2s, transform 0.1s, box-shadow 0.2s;
          }
          .large-grass-cell:hover {
            transform: scale(1.1);
            background-color: var(--grass-text, #30363d);
            opacity: 0.15;
            box-shadow: 0 2px 6px rgba(0,0,0,0.1);
          }
          #danbooru-approvals-popover .gallery-btn {
            cursor: pointer;
            color: #0969da;
            display: flex;
            align-items: center;
            padding: 2px;
            border-radius: 4px;
            transition: background 0.2s;
            text-decoration: none;
          }
          #danbooru-approvals-popover .gallery-btn:hover {
            background: #f0f7ff;
            color: #054ada;
          }
          #danbooru-approvals-popover .post-grid {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 6px;
            margin-bottom: 12px;
            max-height: 300px;
            overflow-y: auto;
          }
          #danbooru-approvals-popover .post-link {
            display: block;
            text-align: center;
            padding: 4px;
            background: #f6f8fa;
            border: 1px solid #d0d7de;
            border-radius: 4px;
            font-size: 11px;
            color: #0969da;
            text-decoration: none;
          }
          #danbooru-approvals-popover .post-link:hover {
            background: #0969da;
            color: #fff;
          }
          #danbooru-approvals-popover .pagination {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 10px;
            font-size: 12px;
          }
          #danbooru-approvals-popover .page-btn {
            padding: 2px 8px;
            border: 1px solid #d0d7de;
            background: #fff;
            border-radius: 4px;
            cursor: pointer;
          }
          #danbooru-approvals-popover .page-btn:disabled {
            opacity: 0.5;
            cursor: default;
          }
        `;
      document.head.appendChild(style);
    }

    // Ensure our container structure supports the side-label + scrollable graph

    container.innerHTML = ''; // Reset
    container.style.display = 'flex';
    container.style.flexDirection = 'row';
    container.style.alignItems = 'flex-start'; // Align Top to avoid Scrollbar offset
    container.style.overflow = 'hidden';

    // 1. Label Column
    const labels = document.createElement('div');
    labels.id = 'gh-day-labels';
    labels.style.display = 'flex';
    labels.style.flexDirection = 'column';
    // Align padding-top: Month Header (20px)
    labels.style.paddingTop = '20px';
    labels.style.paddingRight = '5px';
    labels.style.marginRight = '5px';
    labels.style.textAlign = 'right';
    labels.style.flexShrink = '0';
    labels.style.color = 'var(--grass-text, #24292f)';
    labels.style.fontSize = '9px';

    // Align "Mon, Wed, Fri" to rows 1, 3, 5 (Sunday is Row 0)
    // Grid Stride = Cell Height (11) + Gutter (2).
    // To match perfectly, we use divs of Height 11px and Margin-Bottom 2px.
    const rowStyle = 'height:11px; line-height:11px; margin-bottom:2px;';
    const hiddenStyle = 'height:11px; visibility:hidden; margin-bottom:2px;';
    const lastHiddenStyle = 'height:11px; visibility:hidden; margin-bottom:0;';

    labels.innerHTML = `
        <div style="${hiddenStyle}"></div> <!-- Sun (0) -->
        <div style="${rowStyle}">Mon</div> <!-- Mon (1) -->
        <div style="${hiddenStyle}"></div> <!-- Tue (2) -->
        <div style="${rowStyle}">Wed</div> <!-- Wed (3) -->
        <div style="${hiddenStyle}"></div> <!-- Thu (4) -->
        <div style="${rowStyle}">Fri</div> <!-- Fri (5) -->
        <div style="${lastHiddenStyle}"></div> <!-- Sat (6) -->
      `;
    container.appendChild(labels);

    // 2. Scrollable Graph Wrapper
    const scrollWrapper = document.createElement('div');
    scrollWrapper.id = 'cal-heatmap-scroll';
    scrollWrapper.style.minHeight = '140px'; // Ensure height for graph
    container.appendChild(scrollWrapper);

    // 3. Footer (Settings & Legend)
    const mainContainer = document.getElementById('danbooru-grass-container');
    if (!mainContainer) return;
    if (!document.getElementById('danbooru-grass-footer')) {
      const footer = document.createElement('div');
      footer.id = 'danbooru-grass-footer';
      footer.style.display = 'flex';
      footer.style.justifyContent = 'space-between';
      footer.style.alignItems = 'center';
      footer.style.padding = '5px 20px 10px 0px'; // Added left padding
      footer.style.marginTop = '10px';
      mainContainer.appendChild(footer);

      // Container for Left Controls (Settings + Toggle)
      const footerLeft = document.createElement('div');
      footerLeft.style.display = 'flex';
      footerLeft.style.alignItems = 'center';
      footerLeft.style.gap = '8px'; // Spacing between buttons
      footer.appendChild(footerLeft);

      // 3.1 Settings Button (Left)
      const settingsBtn = document.createElement('div');
      settingsBtn.id = 'danbooru-grass-settings';
      settingsBtn.title = 'Settings';
      settingsBtn.style.cssText = `
          padding: 2px 8px;
          border: 1px solid #d0d7de;
          border-radius: 6px;
          background-color: #f6f8fa;
          cursor: pointer;
          display: flex;
          align-items: center;
          color: #57606a;
        `;
      settingsBtn.innerHTML = `
          <svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" style="fill: currentColor;">
            <path d="M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212.224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.292.028 1.555.563l.566 1.142c.27.547.106 1.181-.394 1.524l-.904.621c-.056.038-.076.104-.076.17a8.7 8.7 0 0 0 0 1.018c0 .066.02.132.076.17l.904.62c.5.344.664.978.394 1.524l-.566 1.142c-.263.535-.91.74-1.555.563l-1.103-.303c-.066-.019-.176-.011-.299.071a6.8 6.8 0 0 1-.668.386c-.133.066-.194.158-.212.224l-.288 1.107c-.17.646-.716 1.196-1.461 1.26a8.2 8.2 0 0 1-.701.031 8.2 8.2 0 0 1-.701-.031c-.745-.064-1.29-.614-1.461-1.26l-.288-1.106c-.018-.066-.079-.158-.212-.224a6.8 6.8 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.176-1.292-.028-1.555-.563l-.566-1.142c-.27-.547-.106-1.181.394-1.524l.904-.621c.056-.038.076-.104.076-.17a8.7 8.7 0 0 0 0-1.018c0-.066-.02-.132-.076-.17l-.904-.62c-.5-.344-.664-.978-.394-1.524l.566-1.142c.263-.535.91-.74 1.555-.563l1.103.303c.066.019.176.011.299-.071.214-.143.437-.272.668-.386.133-.066.194-.158.212-.224l.288-1.107C6.71.645 7.256.095 8.001.031A8.2 8.2 0 0 1 8 0Zm-.571 1.525c-.036.003-.108.036-.123.098l-.289 1.106c-.17.643-.64 1.103-1.246 1.218a5.2 5.2 0 0 0-1.157.669c-.53.411-1.192.427-1.748.046l-.904-.621c-.055-.038-.135-.04-.158.006l-.566 1.142c-.023.047.013.109.055.137l.904.621a1.9 1.9 0 0 1 0 3.23l-.904.621c-.042.029-.078.09-.055.137l.566 1.142c.023.047.103.044.158.006l.904-.621c.556-.38 1.218-.365 1.748.046.348.27.753.496 1.157.669.606.115 1.076.575 1.246 1.218l.289 1.106c.015.062.087.095.123.098.36.031.725.031 1.082 0 .036-.003.108-.036.123-.098l.289-1.106c.17-.643.64-1.103 1.246-1.218.404-.173.809-.399 1.157-.669.53-.411 1.192-.427 1.748-.046l.904.621c.055.038.135.04.158-.006l.566-1.142c.023-.047-.013-.109-.055-.137l-.904-.621a1.9 1.9 0 0 1 0-3.23l.904-.621c.042-.029.078-.09.055-.137l-.566-1.142c-.023-.047-.103-.044-.158-.006l-.904.621c-.556.38-1.218.365-1.748-.046a5.2 5.2 0 0 0-1.157-.669c-.606-.115-1.076-.575-1.246-1.218l-.289-1.106c-.015-.062-.087-.095-.123-.098a6.5 6.5 0 0 0-1.082 0ZM8 5.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Z"></path>
          </svg>
        `;
      const onSettingsClose = (): void => {
        if (typeof onYearChange === 'function') {
          onYearChange(year);
        }
      };

      settingsBtn.onmouseover = () => {
        settingsBtn.style.backgroundColor = '#eaeef2';
      };
      settingsBtn.onmouseout = () => {
        settingsBtn.style.backgroundColor = '#f6f8fa';
      };
      footerLeft.appendChild(settingsBtn);

      // 3.1.2 Toggle Button (Chevron)
      const toggleBtn = document.createElement('div');
      toggleBtn.id = 'danbooru-grass-toggle-panel';
      toggleBtn.title = 'Show Details';
      toggleBtn.style.cssText = `
          padding: 2px 8px;
          border: 1px solid #d0d7de;
          border-radius: 6px;
          background-color: #f6f8fa;
          cursor: pointer;
          display: flex;
          align-items: center;
          color: #57606a;
        `;
      // Chevron Down SVG
      const chevronDown = `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" style="fill: currentColor;"><path d="M12.78 6.22a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L3.22 7.28a.75.75 0 0 1 1.06-1.06L8 9.94l3.72-3.72a.75.75 0 0 1 1.06 0Z"></path></svg>`;
      const chevronUp = `<svg aria-hidden="true" height="16" viewBox="0 0 16 16" version="1.1" width="16" data-view-component="true" style="fill: currentColor;"><path d="M3.22 9.78a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1-1.06 1.06L8 6.06 4.28 9.78a.75.75 0 0 1-1.06 0Z"></path></svg>`;

      toggleBtn.innerHTML = chevronDown;

      toggleBtn.onmouseover = () => { toggleBtn.style.backgroundColor = '#eaeef2'; };
      toggleBtn.onmouseout = () => { toggleBtn.style.backgroundColor = '#f6f8fa'; };

      footerLeft.appendChild(toggleBtn);

      // 3.1.3 Panel Container - Restructure for correct alignment
      // Check if we already have the column wrapper
      let columnWrapper = document.getElementById('danbooru-grass-column');
      if (!columnWrapper) {
        // If mainContainer is attached to the wrapper (or elsewhere), we need to wrap it.
        if (mainContainer.parentNode) {
          columnWrapper = document.createElement('div');
          columnWrapper.id = 'danbooru-grass-column';
          columnWrapper.style.display = 'flex';
          columnWrapper.style.flexDirection = 'column';
          columnWrapper.style.flex = '1';
          columnWrapper.style.minWidth = '300px';

          // Insert wrapper where mainContainer is
          mainContainer.parentNode.insertBefore(columnWrapper, mainContainer);
          // Move mainContainer inside wrapper
          columnWrapper.appendChild(mainContainer);

          // Note: do NOT force `mainContainer.style.width = '100%'` here.
          // The user's saved width/xOffset (applied earlier by
          // applyConstraints) must be preserved. The column flex wrapper
          // already gives mainContainer a sensible default through its own
          // flex: 1 + minWidth: 300px, so an explicit override is unnecessary
          // and would clobber the px value the user picked via the resize
          // handle.
        }
      }

      let panel = document.getElementById('danbooru-grass-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'danbooru-grass-panel';
        panel.style.cssText = `
                width: fit-content;
                min-width: 310px;
                background: var(--grass-bg, #fff);
                border: 1px solid #d0d7de;
                border-radius: 8px;
                margin-top: 10px;
                box-shadow: 0 1px 3px rgba(0,0,0,0.1);

                /* Animation Styles */
                height: 0;
                opacity: 0;
                padding: 0 10px;
                overflow: hidden;
                transition: height 0.3s ease, opacity 0.3s ease, padding 0.3s ease;
                display: block;
            `;
        // Append panel to the new column wrapper
        if (columnWrapper) {
          columnWrapper.appendChild(panel);
        } else {
          // Fallback (shouldn't happen if wrapper logic works)
          mainContainer.parentNode?.appendChild(panel);
        }
      }

      if (panel) {
        // Always ensure the grid structure exists so updateSummaryGrid works
        this.populateSummaryGrid();
      }

      // Toggle Logic
      let isExpanded = false;
      toggleBtn.onclick = () => {
        isExpanded = !isExpanded;
        if (isExpanded) {
          panel.style.height = '150px'; // Increased to fit Header + Grid + Legend
          panel.style.opacity = '1';
          panel.style.padding = '10px';
          toggleBtn.innerHTML = chevronUp;
          toggleBtn.title = 'Hide Details';
        } else {
          panel.style.height = '0';
          panel.style.opacity = '0';
          panel.style.padding = '0 10px';
          toggleBtn.innerHTML = chevronDown;
          toggleBtn.title = 'Show Details';
        }
      };

      // 3.1.5 Settings Popover
      const {popover, close: closeSettings} = createSettingsPopover({
        settingsManager: this.settingsManager,
        db: this.db,
        metric,
        settingsBtn,
        closeSettings: onSettingsClose,
        onRefresh,
      });

      settingsBtn.onclick = (e) => {
        const current = popover.style.display;
        if (current === 'block') {
          closeSettings();
        } else {
          // Position popover near the settings button
          const btnRect = settingsBtn.getBoundingClientRect();
          popover.style.left = btnRect.left + 'px';
          popover.style.top = (btnRect.bottom + 4) + 'px';
          popover.style.display = 'block';
        }
        e.stopPropagation();
      };

      document.body.appendChild(popover); // Append to body for correct stacking

      // 3.2 Legend (Right)
      const legend = document.createElement('div');
      legend.id = 'danbooru-grass-legend';
      legend.style.display = 'flex';
      legend.style.justifyContent = 'flex-end';
      legend.style.alignItems = 'center';
      legend.style.fontSize = '10px';
      legend.style.color = 'var(--grass-text, #57606a)';
      legend.style.gap = '4px';

      // Custom Thresholds Logic (Empty + 4 Levels)
      const colors = [
        'var(--grass-level-0)', 'var(--grass-level-1)', 'var(--grass-level-2)', 'var(--grass-level-3)', 'var(--grass-level-4)'
      ];
      // const thresholds = this.settingsManager.getThresholds(metric); // Unused local var

      // Create Legend Rects
      // Colors[0] is Empty (< T1).
      // Colors[1] is L1 (>= T1).
      // ...
      // Colors[4] is L4 (>= T4).
      const rects = colors.map((c) =>
        `<div style="width:10px; height:10px; background:${c}; border-radius:2px;"></div>`
      ).join('');

      legend.innerHTML = `
          <span style="margin-right:4px;">Less</span>
          ${rects}
          <span style="margin-left:4px;">More</span>
        `;
      footer.appendChild(legend);
    }



    // --- GUARD: Empty Data Guard ---
    // Removed to allow empty graph rendering
    /*
    if (source.length === 0) {
      ...
      return;
    }
    */

    const currentThresholds = this.settingsManager.getThresholds(metric as import('../types').Metric);

    // Reusable paint config (for theme-change re-paints)
    const buildPaintConfig = () => ({
      itemSelector: scrollWrapper,
      range: 12,
      domain: {
        type: 'month',
        gutter: 3,
        label: { position: 'top', text: 'MMM', height: 20, textAlign: 'start' },
      },
      subDomain: { type: 'day', radius: 2, width: 11, height: 11, gutter: 2 },
      date: {
        start: new Date(
          new Date(year, 0, 1).getTime() - (new Date().getTimezoneOffset() * 60000)
        )
      },
      data: { source: source, x: 'date', y: 'value' },
      scale: {
        color: {
          range: this.settingsManager.resolveLevels(
            this.settingsManager.getTheme(),
            CONFIG.THEMES[this.settingsManager.getTheme()] || CONFIG.THEMES.light
          ),
          domain: currentThresholds,
          type: 'threshold',
        },
      },
      theme: 'light',
    });

    (window as any).cal.paint(buildPaintConfig())
      .then(() => {

        // Listen for theme/grass changes — destroy + re-paint CalHeatmap
        const onThemeChange = () => {
          try {
            // Preserve scroll position
            const sw = document.getElementById('cal-heatmap-scroll');
            const savedScroll = sw ? sw.scrollLeft : 0;

            (window as any).cal.destroy();
            (window as any).cal.paint(buildPaintConfig()).then(() => {
              // Restore scroll position after paint
              if (sw) sw.scrollLeft = savedScroll;
            });
          } catch (e) { console.debug('[DI] CalHeatmap re-paint failed', e); }
          this.updateSummaryGrid(hourlyData, metric);
        };
        window.addEventListener('DanbooruInsights:ThemeChanged', onThemeChange);

        // Render Summary Grid Heatmap
        this.updateSummaryGrid(hourlyData, metric);

        // Re-apply Styles and Interaction
        setTimeout(() => {
          const tooltip = d3.select('#danbooru-grass-tooltip');

          // Helper: Smart Tooltip Positioning
          const updateTooltip = (event: MouseEvent, content: string): void => {
            tooltip.style('opacity', 1).html(content);

            const node = tooltip.node();
            if (!node) return;

            const rect = (node as HTMLElement).getBoundingClientRect();
            const viewportWidth = window.innerWidth;

            // Default Position: Right (+10), Top (-28)
            let left = event.pageX + 10;
            let top = event.pageY - 28;

            // Check for Right Overflow
            if (left + rect.width > viewportWidth - 20) {
              // Overflow detected: Switch to "Top-Centered"
              // Position above the cursor, centered horizontally
              left = event.pageX - (rect.width / 2);
              top = event.pageY - rect.height - 15; // Move appropriately above

              // Safety: Don't overflow left
              if (left < 5) left = 5;
            }

            tooltip
              .style('left', left + 'px')
              .style('top', top + 'px');
          };

          // Helper: Touch-compatible tooltip positioning
          const updateTooltipTouch = (touch: Touch, content: string): void => {
            tooltip.style('opacity', 1).html(content);

            const node = tooltip.node();
            if (!node) return;

            const rect = (node as HTMLElement).getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const scrollY = window.scrollY || window.pageYOffset;

            // Default Position: Right (+10), Top (-28) — mirror updateTooltip
            let left = touch.pageX + 10;
            let top = touch.pageY - 28;

            // Check for Right Overflow
            if (left + rect.width > viewportWidth - 20) {
              left = touch.pageX - (rect.width / 2);
              top = touch.pageY - rect.height - 15;
              if (left < 5) left = 5;
            }

            // Keep tooltip above viewport top
            if (top < scrollY + 5) top = scrollY + 5;

            tooltip
              .style('left', left + 'px')
              .style('top', top + 'px');
          };

          const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

          // --- Auto-Scroll to Current Date (Refined) ---
          const scrollContainer = document.getElementById('cal-heatmap-scroll');
          if (scrollContainer && !skipScroll) {
            if (year === new Date().getFullYear()) {
              const currentMonth = new Date().getMonth() + 1; // 1-12
              // Find the Nth .ch-domain (Month) element
              // We look for 'svg.ch-domain' or just '.ch-domain' that are direct children if possible
              // Based on user feedback, it seems to be 'svg.ch-domain'
              const targetMonth = scrollContainer.querySelector(`.ch-domain:nth-of-type(${currentMonth})`);

              if (targetMonth) {
                const containerRect = scrollContainer.getBoundingClientRect();
                const elementRect = targetMonth.getBoundingClientRect();
                // Scroll to the element with a slight padding
                scrollContainer.scrollLeft += (elementRect.left - containerRect.left - 10);
              } else {
                // Fallback: Scroll to end
                scrollContainer.scrollLeft = scrollContainer.scrollWidth;
              }
            } else {
              scrollContainer.scrollLeft = 0;
            }
          }

          // 1. Tooltips for Graph Cells
          if (isTouchDevice) {
            tooltip.style('pointer-events', 'auto').style('cursor', 'pointer');
          }

          let lastTouchedDatum: CalHeatmapDatum | null = null;

          d3.selectAll('#cal-heatmap-scroll rect')
            .attr('rx', 2).attr('ry', 2) // Apply border radius
            .on('mouseover', function (event, d) {
              // Fallback for datum if D3 binding is tricky
              const datum = d || d3.select(this).datum();
              if (!datum || !(datum as CalHeatmapDatum).t) return;

              const count = ((datum as CalHeatmapDatum).v ?? 0);
              const dateStr = new Date((datum as CalHeatmapDatum).t).toISOString().split('T')[0];

              updateTooltip(event, `<strong>${dateStr}</strong>, ${count} ${metric}`);
            })
            .on('mouseout', () => tooltip.style('opacity', 0))
            .on('click', (event, d) => {
              if (isTouchDevice) return; // Mobile: click disabled, navigation via tooltip
              const datum = d;
              if (!datum || !(datum as CalHeatmapDatum).t) {
                return;
              }

              const count = ((datum as CalHeatmapDatum).v ?? 0);
              const dateStr = new Date((datum as CalHeatmapDatum).t).toISOString().split('T')[0];

              if (metric === 'approvals' && count > 0) {
                this.showApprovalsDetail(dateStr, userIdVal, event);
              } else {
                const link = getUrl(dateStr, count);
                if (link) window.open(link, '_blank');
              }
            });

          if (isTouchDevice) {
            d3.selectAll('#cal-heatmap-scroll rect')
              .on('touchstart', function(event: TouchEvent) {
                const touch = event.touches[0];
                const target = document.elementFromPoint(touch.clientX, touch.clientY);
                if (!target) return;
                const datum = d3.select(target).datum() as CalHeatmapDatum;
                if (!datum || !datum.t) return;

                lastTouchedDatum = datum;
                const count = datum.v ?? 0;
                const dateStr = new Date(datum.t).toISOString().split('T')[0];
                updateTooltipTouch(touch, `<strong>${dateStr}</strong>, ${count} ${metric}`);
              })
              .on('touchmove', function(event: TouchEvent) {
                const touch = event.touches[0];
                const target = document.elementFromPoint(touch.clientX, touch.clientY);
                if (!target) return;
                const datum = d3.select(target).datum() as CalHeatmapDatum;
                if (!datum || !datum.t) return;

                lastTouchedDatum = datum;
                const count = datum.v ?? 0;
                const dateStr = new Date(datum.t).toISOString().split('T')[0];
                updateTooltipTouch(touch, `<strong>${dateStr}</strong>, ${count} ${metric}`);
              });

            // Tooltip tap → navigate
            tooltip.on('click', () => {
              if (!lastTouchedDatum) return;
              const count = lastTouchedDatum.v ?? 0;
              const dateStr = new Date(lastTouchedDatum.t).toISOString().split('T')[0];
              const link = getUrl(dateStr, count);
              if (link && link !== '#') window.open(link, '_blank');
              tooltip.style('opacity', 0);
              lastTouchedDatum = null;
            });

            // Tap outside tooltip and cells → close it
            document.addEventListener('touchstart', (e: TouchEvent) => {
              const tooltipEl = tooltip.node() as HTMLElement | null;
              const target = e.target as Node;
              const heatmapEl = document.getElementById('cal-heatmap-scroll');
              if (tooltipEl && !tooltipEl.contains(target) && !heatmapEl?.contains(target)) {
                tooltip.style('opacity', 0);
                lastTouchedDatum = null;
              }
            }, {passive: true});
          }

          // 2. Tooltips for Legend Cells
          // Calculate ranges based on thresholds [t1, t2, t3, t4]
          const t = this.settingsManager.getThresholds(metric as import('../types').Metric);
          const legendThresholds = [
            `${t[0] > 1 ? `0-${t[0] - 1}` : '0'} (Less)`,
            `${t[0]}-${t[1] - 1}`,
            `${t[1]}-${t[2] - 1}`,
            `${t[2]}-${t[3] - 1}`,
            `${t[3]}+ (More)`,
          ];

          // Select the 6 manual colored divs in the legend
          const legendDivs = d3.selectAll('#danbooru-grass-legend > div');

          legendDivs.each(function (_d, i) {
            if (i >= 0 && i < legendThresholds.length) {
              d3.select(this)
                .on('mouseover', function (event) {
                  updateTooltip(event, legendThresholds[i]);
                })
                .on('mouseout', () => tooltip.style('opacity', 0));
            }
          });
        }, 300); // Increased timeout significantly to ensure render is done
      })
      .catch((err: unknown) => {
        console.error('[Danbooru Grass] Render failed:', err);
        // Still update summary grid on failure
        this.updateSummaryGrid(hourlyData, metric);
      });
  }

  /**
   * Renders an error message in the container.
   * @param {string} message The error message.
   * @param {Function} onRetry Retry callback.
   */
  renderError(message: string, onRetry: () => void): void {
    const container = document.getElementById(this.containerId);
    if (!container) return;
    container.innerHTML = `
        <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:140px; color:#cf222e; text-align:center;">
          <div style="font-weight:bold; margin-bottom:8px;">Unable to load contribution data</div>
          <div style="font-size:0.9em; margin-bottom:12px; color: var(--grass-text, #57606a);">${message}</div>
          <button id="grass-retry-btn" style="
            padding: 5px 16px;
            background-color: #f6f8fa;
            border: 1px solid #d0d7de;
            border-radius: 6px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            color: #24292f;
          ">Retry</button>
        </div>
      `;
    const btn = document.getElementById('grass-retry-btn');
    if (btn) btn.onclick = onRetry;
  }

  /**
   * Shows a paginated popover list of post IDs for approval metric.
   * @param {string} dateStr YYYY-MM-DD
   * @param {string|number} userId The user's ID.
   * @param {MouseEvent} event The triggering mouse event.
   */
  async showApprovalsDetail(dateStr: string, userId: string | number, event: MouseEvent): Promise<void> {
    const fetcher = this.dataManager
      ? (postId: number) => this.dataManager!.fetchPostDetails(postId)
      : undefined;
    return showApprovalsDetail(this.db, dateStr, userId, event, fetcher);
  }
}
