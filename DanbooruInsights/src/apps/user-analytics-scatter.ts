import type {ScatterDataPoint} from '../types';
import type {ChartContext} from './user-analytics-charts';

// ============================================================
// SCATTER PLOT WIDGET
// ============================================================

/**
 * Renders the scatter plot widget (canvas-based, with popover).
 * @param container The dashboard div to append the widget into.
 * @param scatterData Pre-fetched scatter plot data points.
 * @param context The chart context providing user information.
 * @param levelChanges Pre-fetched level change events.
 */
export function renderScatterPlot(
  container: HTMLElement,
  scatterData: ScatterDataPoint[],
  context: ChartContext,
  levelChanges: any[],
): void {
  // Wrapper for Header + Widget
  const scatterWrapper = document.createElement('div');
  scatterWrapper.style.marginTop = '24px';
  scatterWrapper.style.marginBottom = '20px';

  // Header Container
  const headerContainer = document.createElement('div');
  headerContainer.style.display = 'flex';
  headerContainer.style.alignItems = 'center';
  headerContainer.style.borderBottom = '1px solid #eee';
  headerContainer.style.paddingBottom = '10px';
  headerContainer.style.marginBottom = '15px';

  const headerEl = document.createElement('h3');
  headerEl.textContent = '📊 Post Performance';
  headerEl.style.color = '#333';
  headerEl.style.margin = '0';
  headerContainer.appendChild(headerEl);

  scatterWrapper.appendChild(headerContainer);

  // Widget Box
  const scatterDiv = document.createElement('div');
  scatterDiv.className = 'dashboard-widget';
  scatterDiv.style.background = '#fff';
  scatterDiv.style.border = '1px solid #e1e4e8';
  scatterDiv.style.borderRadius = '6px';
  scatterDiv.style.padding = '15px';
  scatterDiv.style.position = 'relative';

  scatterWrapper.appendChild(scatterDiv);

  // Metric Toggle (Top Left inside Widget)
  const toggleContainer = document.createElement('div');
  toggleContainer.style.position = 'absolute';
  toggleContainer.style.top = '15px';
  toggleContainer.style.left = '15px';
  toggleContainer.style.zIndex = '5';
  toggleContainer.style.display = 'flex';
  toggleContainer.style.gap = '10px';
  toggleContainer.style.fontSize = '0.9em';

  let currentScatterMode = 'score';
  let selectedYear: number | null = null;

  const makeToggleBtn = (id: string, label: string, active: boolean, tooltip: string | null = null) => {
    const btn = document.createElement('button');
    btn.style.border = '1px solid #d0d7de';
    btn.style.borderRadius = '20px';
    btn.style.padding = '2px 10px';
    btn.style.background = active ? '#0969da' : '#fff';
    btn.style.color = active ? '#fff' : '#333';
    btn.style.cursor = 'pointer';
    btn.style.transition = 'all 0.2s';
    btn.style.fontSize = '12px';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '5px';

    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);

    if (tooltip) {
      const help = document.createElement('span');
      help.textContent = '❔';
      help.style.cursor = 'help';
      help.title = tooltip;
      help.style.fontSize = '0.9em';
      help.style.opacity = '0.8';
      btn.appendChild(help);
    }

    btn.onclick = () => {
      if (currentScatterMode === id) return;
      currentScatterMode = id;
      Array.from(toggleContainer.children).forEach(b => {
        const bEl = b as HTMLElement;
        const isMe = bEl.textContent.includes(label);
        bEl.style.background = '#fff';
        bEl.style.color = '#333';
        if (isMe) {
          bEl.style.background = '#0969da';
          bEl.style.color = '#fff';
        }
      });
      renderScatter();
    };
    return btn;
  };

  toggleContainer.appendChild(makeToggleBtn('score', 'Score', true));
  toggleContainer.appendChild(makeToggleBtn('tags', 'Tag Count', false, 'General Tags Only'));

  scatterDiv.appendChild(toggleContainer);

  // Reset Scale Button
  const resetBtn = document.createElement('button');
  resetBtn.textContent = '<';
  resetBtn.style.position = 'absolute';
  resetBtn.style.bottom = '10px';
  resetBtn.style.left = '15px';
  resetBtn.style.zIndex = '5';
  resetBtn.style.border = '1px solid #d0d7de';
  resetBtn.style.background = '#fff';
  resetBtn.style.borderRadius = '4px';
  resetBtn.style.padding = '2px 8px';
  resetBtn.style.cursor = 'pointer';
  resetBtn.style.fontSize = '11px';
  resetBtn.style.display = 'none';

  resetBtn.onclick = () => {
    selectedYear = null;
    resetBtn.style.display = 'none';
    yearLabel.style.display = 'none';
    renderScatter();
  };
  scatterDiv.appendChild(resetBtn);

  // Year Indicator
  const yearLabel = document.createElement('div');
  yearLabel.style.position = 'absolute';
  yearLabel.style.bottom = '40px';
  yearLabel.style.left = '15px';
  yearLabel.style.zIndex = '4';
  yearLabel.style.fontSize = '16px';
  yearLabel.style.fontWeight = 'bold';
  yearLabel.style.color = '#000000';
  yearLabel.style.pointerEvents = 'none';
  yearLabel.style.display = 'none';
  scatterDiv.appendChild(yearLabel);

  // Filters UI (Top Right)
  const filterContainer = document.createElement('div');
  filterContainer.style.position = 'absolute';
  filterContainer.style.top = '15px';
  filterContainer.style.right = '15px';
  filterContainer.style.zIndex = '5';
  filterContainer.style.background = 'rgba(255,255,255,0.9)';
  filterContainer.style.padding = '2px 8px';
  filterContainer.style.borderRadius = '12px';
  filterContainer.style.border = '1px solid #eee';
  filterContainer.style.display = 'flex';
  filterContainer.style.alignItems = 'center';
  filterContainer.style.gap = '15px';

  const countLabel = document.createElement('span');
  countLabel.textContent = '...';
  countLabel.style.fontSize = '12px';
  countLabel.style.fontWeight = 'bold';
  countLabel.style.color = '#333';
  countLabel.style.marginRight = '5px';
  filterContainer.appendChild(countLabel);

  const ratings: Record<string, {label: string; color: string}> = {
    g: {label: 'G', color: '#4caf50'},
    s: {label: 'S', color: '#ffb74d'},
    q: {label: 'Q', color: '#ab47bc'},
    e: {label: 'E', color: '#f44336'},
  };
  const activeFilters: Record<string, boolean> = {g: true, s: true, q: true, e: true};

  Object.keys(ratings).forEach(key => {
    const btn = document.createElement('div');
    const conf = ratings[key];

    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.cursor = 'pointer';
    btn.style.userSelect = 'none';
    btn.style.gap = '4px';

    const label = document.createElement('span');
    label.textContent = conf.label;
    label.style.fontWeight = 'normal';
    label.style.color = '#000000';
    label.style.fontSize = '12px';

    const circle = document.createElement('div');
    circle.style.width = '16px';
    circle.style.height = '16px';
    circle.style.borderRadius = '50%';
    circle.style.background = conf.color;
    circle.style.boxShadow = '0 1px 3px rgba(0,0,0,0.2)';
    circle.style.transition = 'background 0.3s, transform 0.3s';

    btn.appendChild(label);
    btn.appendChild(circle);

    btn.onclick = () => {
      activeFilters[key] = !activeFilters[key];
      if (activeFilters[key]) {
        circle.style.background = conf.color;
        circle.style.opacity = '1';
      } else {
        circle.style.background = '#e0e0e0';
        circle.style.opacity = '0.7';
      }
      renderScatter();
    };

    filterContainer.appendChild(btn);
  });

  // Canvas Container
  const canvasContainer = document.createElement('div');
  canvasContainer.style.width = '100%';
  canvasContainer.style.height = '300px';
  canvasContainer.style.position = 'relative';
  scatterDiv.appendChild(canvasContainer);

  const canvas = document.createElement('canvas');
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvasContainer.appendChild(canvas);
  scatterDiv.appendChild(filterContainer);

  const ctx = canvas.getContext('2d', {alpha: false});

  // Overlay Container for Lines
  const overlayDiv = document.createElement('div');
  overlayDiv.style.position = 'absolute';
  overlayDiv.style.top = '0';
  overlayDiv.style.left = '0';
  overlayDiv.style.width = '100%';
  overlayDiv.style.height = '100%';
  overlayDiv.style.pointerEvents = 'none';
  canvasContainer.appendChild(overlayDiv);

  // Drag Selection UI
  const selectionDiv = document.createElement('div');
  selectionDiv.style.position = 'absolute';
  selectionDiv.style.border = '1px dashed #007bff';
  selectionDiv.style.backgroundColor = 'rgba(0, 123, 255, 0.2)';
  selectionDiv.style.display = 'none';
  selectionDiv.style.pointerEvents = 'none';
  canvasContainer.appendChild(selectionDiv);

  // Range label shown during drag
  const rangeLabel = document.createElement('div');
  rangeLabel.style.cssText = 'position:absolute;top:-38px;left:0;right:0;text-align:center;font-size:11px;color:#fff;background:rgba(0,0,0,0.75);padding:3px 10px;border-radius:4px;pointer-events:none;white-space:nowrap;display:none;width:fit-content;margin:0 auto;line-height:1.5;';
  selectionDiv.appendChild(rangeLabel);

  // Crosshair cursor for canvas
  canvas.style.cursor = 'crosshair';

  // Popover UI
  const popover = document.createElement('div');
  popover.id = 'scatter-popover-ui';
  popover.style.cssText = 'position: fixed; z-index: 10000; background: #fff; border: 1px solid #ccc; border-radius: 4px; box-shadow: 0 4px 12px rgba(0,0,0,0.15); display: none; max-height: 300px; width: 320px; flex-direction: column; font-family: sans-serif;';
  document.body.appendChild(popover);

  document.addEventListener('mousedown', (e) => {
    if (popover.style.display !== 'none' && !popover.contains(e.target as Node)) {
      popover.style.display = 'none';
    }
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const currentScale: any = {};

  const renderScatter = () => {
    if (!scatterDiv.isConnected || !ctx) return;

    const rect = canvasContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
    }
    const w = rect.width;
    const h = rect.height;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);

    overlayDiv.innerHTML = '';

    const padL = 40, padR = 20, padT = 60, padB = 50;
    const drawW = w - padL - padR;
    const drawH = h - padT - padB;

    let minDateVal = Infinity;
    let maxDateVal = -Infinity;
    let maxVal = 0;

    if (selectedYear) {
      minDateVal = new Date(selectedYear, 0, 1).getTime();
      maxDateVal = new Date(selectedYear, 11, 31, 23, 59, 59).getTime();

      resetBtn.style.display = 'block';
      yearLabel.textContent = String(selectedYear);
      yearLabel.style.display = 'block';
    } else {
      resetBtn.style.display = 'none';
      yearLabel.style.display = 'none';

      for (const d of scatterData) {
        if (d.d < minDateVal) minDateVal = d.d;
        if (d.d > maxDateVal) maxDateVal = d.d;
      }
      if (minDateVal === Infinity) {
        minDateVal = Date.now();
        maxDateVal = minDateVal + 86400000;
      } else {
        const startY = new Date(minDateVal).getFullYear();
        minDateVal = new Date(startY, 0, 1).getTime();
      }
    }

    const timeRange = maxDateVal - minDateVal || 1;

    for (const d of scatterData) {
      if (d.d >= minDateVal && d.d <= maxDateVal) {
        const val = currentScatterMode === 'tags' ? (d.t || 0) : d.s;
        if (val > maxVal) maxVal = val;
      }
    }
    if (maxVal === 0) maxVal = 100;

    let stepY = 100;
    if (currentScatterMode === 'tags') {
      if (maxVal < 50) stepY = 10;
      else if (maxVal < 200) stepY = 25;
      else stepY = 50;
    } else {
      if (maxVal < 200) stepY = 50;
      else if (maxVal < 1000) stepY = 100;
      else stepY = 500;
    }

    maxVal = Math.ceil(maxVal / stepY) * stepY;
    if (maxVal < stepY) maxVal = stepY;

    Object.assign(currentScale, {minDate: minDateVal, maxDate: maxDateVal, maxVal, timeRange, padL, padT, drawW, drawH, mode: currentScatterMode});

    const visiblePoints = scatterData.filter(d => {
      if (d.d < minDateVal || d.d > maxDateVal) return false;
      return activeFilters[d.r];
    });

    countLabel.textContent = `${visiblePoints.length} items`;

    // Draw Grid/Axes
    ctx.beginPath();
    ctx.strokeStyle = '#eee';
    ctx.lineWidth = 1;

    for (let val = 0; val <= maxVal; val += stepY) {
      const y = padT + drawH - (val / maxVal) * drawH;
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);

      ctx.fillStyle = '#888';
      ctx.font = '10px Arial';
      ctx.textAlign = 'right';
      ctx.fillText(String(val), padL - 5, y + 3);
    }
    ctx.stroke();

    ctx.beginPath();
    ctx.strokeStyle = '#ccc';
    ctx.moveTo(padL, padT + drawH);
    ctx.lineTo(w - padR, padT + drawH);
    ctx.stroke();

    ctx.fillStyle = '#666';
    ctx.textAlign = 'center';

    if (selectedYear) {
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      months.forEach((m, i) => {
        const stepW = drawW / 12;
        const x = padL + (stepW * i) + (stepW / 2);
        ctx.fillText(m, x, padT + drawH + 15);

        if (i > 0) {
          const tickX = padL + (stepW * i);
          ctx.beginPath();
          ctx.moveTo(tickX, padT + drawH);
          ctx.lineTo(tickX, padT + drawH + 5);
          ctx.stroke();
        }
      });
    } else {
      const startYear = new Date(minDateVal).getFullYear();
      const endYear = new Date(maxDateVal).getFullYear();

      for (let y = startYear; y <= endYear; y++) {
        const d = new Date(y, 0, 1).getTime();
        const x = padL + ((d - minDateVal) / timeRange) * drawW;

        if (x >= padL - 5 && x <= w - padR + 5) {
          const nextD = new Date(y + 1, 0, 1).getTime();
          const xNext = padL + ((nextD - minDateVal) / timeRange) * drawW;
          const xCenter = (x + xNext) / 2;

          if (xCenter > padL - 10 && xCenter < w - padR + 10) {
            ctx.fillText(String(y), xCenter, padT + drawH + 15);
          }

          ctx.beginPath();
          ctx.moveTo(x, padT + drawH);
          ctx.lineTo(x, padT + drawH + 5);
          ctx.stroke();
        }
      }
    }

    // Draw Points
    visiblePoints.forEach(pt => {
      if (pt.d < minDateVal || pt.d > maxDateVal) return;

      const val = currentScatterMode === 'tags' ? (pt.t || 0) : pt.s;
      const x = padL + ((pt.d - minDateVal) / timeRange) * drawW;
      const y = padT + drawH - (val / maxVal) * drawH;

      let color = '#ccc';
      if (pt.r === 'g') color = '#4caf50';
      else if (pt.r === 's') color = '#ffb74d';
      else if (pt.r === 'q') color = '#ab47bc';
      else if (pt.r === 'e') color = '#f44336';

      ctx.fillStyle = color;
      ctx.fillRect(x - 1, y - 1, 2, 2);
    });

    // Render Overlays
    const addOverlayLine = (dateObjOrStr: Date | string, color: string, title: string, isDashed: boolean, thickness: string = '2px') => {
      const d = new Date(dateObjOrStr).getTime();
      if (d < minDateVal || d > maxDateVal) return;

      const x = padL + ((d - minDateVal) / timeRange) * drawW;

      const line = document.createElement('div');
      line.style.position = 'absolute';
      line.style.left = x + 'px';
      line.style.top = padT + 'px';
      line.style.height = drawH + 'px';
      line.style.borderLeft = `${thickness} ${isDashed ? 'dashed' : 'solid'} ${color}`;
      line.style.width = '4px';
      line.style.cursor = 'help';
      line.style.pointerEvents = 'auto';
      line.title = title;

      overlayDiv.appendChild(line);
    };

    if (context.targetUser && context.targetUser.joinDate) {
      const jd = new Date(context.targetUser.joinDate);
      addOverlayLine(jd, '#00E676', `${jd.toLocaleDateString()}: Joined Danbooru`, true, '2px');
    }

    if (levelChanges) {
      levelChanges.forEach((lc: any) => {
        addOverlayLine(lc.date, '#ff5722', `${lc.date.toLocaleDateString()}: ${lc.fromLevel} → ${lc.toLevel}`, true);
      });
    }

    if (currentScatterMode === 'score') {
      addOverlayLine('2021-11-24', '#bbb', 'All users could vote since this day.', true, '1px');
    }
  };

  container.appendChild(scatterWrapper);

  requestAnimationFrame(renderScatter);
  window.addEventListener('resize', renderScatter);

  let lastDragEndTime = 0;

  // Click Listener for Year Zoom
  canvas.addEventListener('click', (e) => {
    if (Date.now() - lastDragEndTime < 100) return;

    const rect = canvasContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const axisY = currentScale.padT + currentScale.drawH;
    if (y > axisY && y < axisY + 40 && !selectedYear) {
      const t = ((x - currentScale.padL) / currentScale.drawW) * currentScale.timeRange + currentScale.minDate;
      const clickedDate = new Date(t);
      const clickedYear = clickedDate.getFullYear();

      if (clickedYear >= new Date(currentScale.minDate).getFullYear() && clickedYear <= new Date(currentScale.maxDate).getFullYear()) {
        selectedYear = clickedYear;
        renderScatter();
      }
    }
  });

  // Hover Effect for Year Labels
  canvas.addEventListener('mousemove', (e) => {
    if (dragStart) return;

    const rect = canvasContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    let isHand = false;
    const axisY = currentScale.padT + currentScale.drawH;
    if (y > axisY && y < axisY + 40 && !selectedYear) {
      const t = ((x - currentScale.padL) / currentScale.drawW) * currentScale.timeRange + currentScale.minDate;
      const hoveredYear = new Date(t).getFullYear();
      if (hoveredYear >= new Date(currentScale.minDate).getFullYear() && hoveredYear <= new Date(currentScale.maxDate).getFullYear()) {
        isHand = true;
      }
    }

    canvas.style.cursor = isHand ? 'pointer' : 'crosshair';
  });

  // Drag Event Listeners
  let dragStart: {x: number; y: number} | null = null;
  let ignoreNextClick = false;
  void ignoreNextClick;

  canvas.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    ignoreNextClick = false;

    const rect = canvasContainer.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (x < currentScale.padL || x > currentScale.padL + currentScale.drawW ||
      y < currentScale.padT || y > currentScale.padT + currentScale.drawH) return;

    dragStart = {x, y};
    selectionDiv.style.left = x + 'px';
    selectionDiv.style.top = y + 'px';
    selectionDiv.style.width = '0px';
    selectionDiv.style.height = '0px';
    selectionDiv.style.display = 'block';
  });

  // Debounced range label updater
  let rangeLabelTimer: ReturnType<typeof setTimeout> | null = null;
  const updateRangeLabel = (x1: number, x2: number, y1: number, y2: number) => {
    if (rangeLabelTimer) clearTimeout(rangeLabelTimer);
    rangeLabelTimer = setTimeout(() => {
      const dateMin = ((Math.min(x1, x2) - currentScale.padL) / currentScale.drawW) * currentScale.timeRange + currentScale.minDate;
      const dateMax = ((Math.max(x1, x2) - currentScale.padL) / currentScale.drawW) * currentScale.timeRange + currentScale.minDate;
      const valMin = ((currentScale.padT + currentScale.drawH - Math.max(y1, y2)) / currentScale.drawH) * currentScale.maxVal;
      const valMax = ((currentScale.padT + currentScale.drawH - Math.min(y1, y2)) / currentScale.drawH) * currentScale.maxVal;

      const d1 = new Date(dateMin).toISOString().slice(0, 10);
      const d2 = new Date(dateMax).toISOString().slice(0, 10);
      const valLabel = currentScale.mode === 'tags' ? 'Tags' : 'Score';

      // Count posts in selection
      const count = scatterData.filter(d => {
        if (!activeFilters[d.r]) return false;
        const val = currentScale.mode === 'tags' ? (d.t || 0) : d.s;
        return d.d >= dateMin && d.d <= dateMax && val >= valMin && val <= valMax;
      }).length;

      rangeLabel.innerHTML = `${d1} ~ ${d2}<br>${valLabel}: ${Math.round(valMin)} ~ ${Math.round(valMax)} · ${count.toLocaleString()} posts`;
      rangeLabel.style.display = 'block';
    }, 50);
  };

  window.addEventListener('mousemove', (e) => {
    if (!dragStart) return;
    const rect = canvasContainer.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;

    const rL = currentScale.padL;
    const rT = currentScale.padT;
    const rW = currentScale.drawW;

    const currentX = Math.max(rL, Math.min(rL + rW, mx));
    const currentY = Math.max(rT, Math.min(rect.height, my));

    const x = Math.min(dragStart.x, currentX);
    const y = Math.min(dragStart.y, currentY);
    const w = Math.abs(currentX - dragStart.x);
    const h = Math.abs(currentY - dragStart.y);

    selectionDiv.style.left = x + 'px';
    selectionDiv.style.top = y + 'px';
    selectionDiv.style.width = w + 'px';
    selectionDiv.style.height = h + 'px';

    updateRangeLabel(dragStart.x, currentX, dragStart.y, currentY);
  });

  window.addEventListener('mouseup', (e) => {
    if (!dragStart) return;
    const ds = dragStart;
    dragStart = null;
    selectionDiv.style.display = 'none';
    rangeLabel.style.display = 'none';
    if (rangeLabelTimer) { clearTimeout(rangeLabelTimer); rangeLabelTimer = null; }

    const rect = canvasContainer.getBoundingClientRect();
    const endX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const endY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    if (Math.abs(endX - ds.x) >= 5 || Math.abs(endY - ds.y) >= 5) {
      ignoreNextClick = true;
      lastDragEndTime = Date.now();
    }

    if (Math.abs(endX - ds.x) < 5 && Math.abs(endY - ds.y) < 5) return;

    const x1 = Math.min(ds.x, endX);
    const x2 = Math.max(ds.x, endX);
    const y1 = Math.min(ds.y, endY);
    const y2 = Math.max(ds.y, endY);

    const dateMin = ((x1 - currentScale.padL) / currentScale.drawW) * currentScale.timeRange + currentScale.minDate;
    const dateMax = ((x2 - currentScale.padL) / currentScale.drawW) * currentScale.timeRange + currentScale.minDate;

    const valMin = ((currentScale.padT + currentScale.drawH - y2) / currentScale.drawH) * currentScale.maxVal;
    const valMax = ((currentScale.padT + currentScale.drawH - y1) / currentScale.drawH) * currentScale.maxVal;

    const result = scatterData.filter(d => {
      if (!activeFilters[d.r]) return false;
      const val = currentScale.mode === 'tags' ? (d.t || 0) : d.s;
      return d.d >= dateMin && d.d <= dateMax && val >= valMin && val <= valMax;
    });

    if (result.length === 0) return;

    const sortedList = result.sort((a, b) => {
      const vA = currentScale.mode === 'tags' ? (a.t || 0) : a.s;
      const vB = currentScale.mode === 'tags' ? (b.t || 0) : b.s;
      return vB - vA;
    });

    let aDMin = Infinity, aDMax = -Infinity;
    let aVMin = Infinity, aVMax = -Infinity;

    sortedList.forEach(d => {
      if (d.d < aDMin) aDMin = d.d;
      if (d.d > aDMax) aDMax = d.d;

      const v = currentScale.mode === 'tags' ? (d.t || 0) : d.s;
      if (v < aVMin) aVMin = v;
      if (v > aVMax) aVMax = v;
    });

    showPopover(e.clientX, e.clientY, sortedList, aDMin, aDMax, aVMin, aVMax);
  });

  const showPopover = (mx: number, my: number, items: ScatterDataPoint[], dMin: number, dMax: number, sMin: number, sMax: number) => {
    const d1 = new Date(dMin).toLocaleDateString();
    const d2 = new Date(dMax).toLocaleDateString();
    const sm1 = Math.floor(sMin);
    const sm2 = Math.ceil(sMax);
    const totalCount = items.length;
    const isTags = currentScale.mode === 'tags';
    let visibleLimit = 50;

    const renderItems = (start: number, limit: number) => {
      let chunkHtml = '';
      const slice = items.slice(start, start + limit);

      slice.forEach((it: ScatterDataPoint) => {
        const itDate = new Date(it.d).toLocaleDateString();
        const val = isTags ? (it.t || 0) : it.s;
        let color = '#ccc';
        if (it.r === 'g') color = '#4caf50';
        else if (it.r === 's') color = '#ffb74d';
        else if (it.r === 'q') color = '#ab47bc';
        else if (it.r === 'e') color = '#f44336';

        chunkHtml += `
         <div class="pop-item" data-id="${it.id}" style="padding: 8px 15px; border-bottom: 1px solid #f0f0f0; display: flex; align-items: center; cursor: pointer; transition: bg 0.2s;">
           <div style="width: 10px; height: 10px; border-radius: 50%; background: ${color}; margin-right: 10px;"></div>
           <span style="width: 60px; color: #007bff; font-weight: 500; font-size: 13px; margin-right: 10px;">#${it.id}</span>
           <span style="flex: 1; color: #666; font-size: 12px;">${itDate}</span>
           <span style="font-weight: bold; color: #333; font-size: 13px;">${val}</span>
         </div>
       `;
      });
      return chunkHtml;
    };

    const headerHtml = `
     <div style="padding: 10px 15px; background: #fafafa; border-bottom: 1px solid #eee; display: flex; justify-content: space-between; align-items: start;">
       <div style="display:flex; flex-direction:column;">
          <span style="font-weight: 600; font-size: 13px; color: #333;">${d1} ~ ${d2}</span>
          <span style="font-size: 11px; color: #666; margin-top:2px;">${isTags ? 'Tag Count' : 'Score'}: ${sm1} ~ ${sm2}</span>
       </div>
       <div style="display:flex; align-items:center; gap: 10px; margin-top:2px;">
         <span id="pop-count-label" style="font-size: 12px; color: #888;">${Math.min(visibleLimit, totalCount)} / ${totalCount} items</span>
         <button id="scatter-pop-close" style="background:none; border:none; color:#999; font-size:16px; cursor:pointer; line-height:1; padding:0;">&times;</button>
       </div>
     </div>
     <div id="pop-list-container" style="flex: 1; overflow-y: auto;">
       ${renderItems(0, visibleLimit)}
     </div>
     <div id="pop-load-more" style="display: ${totalCount > visibleLimit ? 'block' : 'none'}; padding: 10px; text-align: center; border-top: 1px solid #eee; background: #fff;">
        <button id="btn-load-more" style="width: 100%; padding: 6px; background: #f0f0f0; border: none; border-radius: 4px; color: #555; cursor: pointer; font-size: 12px;">Load More (+50)</button>
     </div>
   `;

    popover.innerHTML = headerHtml;

    const attachEvents = (parent: Element | null) => {
      if (!parent) return;
      parent.querySelectorAll('.pop-item').forEach((el) => {
        const htmlEl = el as HTMLElement;
        htmlEl.onmouseover = () => htmlEl.style.backgroundColor = '#f5f9ff';
        htmlEl.onmouseout = () => htmlEl.style.backgroundColor = 'transparent';
        htmlEl.onclick = () => window.open(`/posts/${htmlEl.dataset.id}`, '_blank');
      });
    };

    attachEvents(popover.querySelector('#pop-list-container'));

    const closeBtn = popover.querySelector('#scatter-pop-close') as HTMLElement;
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        popover.style.display = 'none';
      };
    }

    const loadMoreContainer = popover.querySelector('#pop-load-more') as HTMLElement;
    const loadMoreBtn = popover.querySelector('#btn-load-more') as HTMLElement;
    const listContainer = popover.querySelector('#pop-list-container') as HTMLElement;
    const popCountLabel = popover.querySelector('#pop-count-label') as HTMLElement;

    if (loadMoreBtn) {
      loadMoreBtn.onclick = () => {
        const start = visibleLimit;
        visibleLimit += 50;
        const newHtml = renderItems(start, 50);

        listContainer.insertAdjacentHTML('beforeend', newHtml);
        attachEvents(listContainer);

        popCountLabel.textContent = `${Math.min(visibleLimit, totalCount)} / ${totalCount} items`;

        if (visibleLimit >= totalCount) {
          loadMoreContainer.style.display = 'none';
        }
      };
    }

    popover.style.display = 'flex';
    const pH = popover.offsetHeight || 300;

    let posX = mx + 15;
    let posY = my + 15;

    if (posX + 320 > window.innerWidth) posX = window.innerWidth - 320 - 10;
    if (posX < 10) posX = 10;

    if (posY + pH > window.innerHeight) posY = window.innerHeight - pH - 10;
    if (posY < 10) posY = 10;

    popover.style.left = posX + 'px';
    popover.style.top = posY + 'px';
  };
}
