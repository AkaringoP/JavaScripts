import * as d3 from 'd3';
import type {TagCloudItem} from '../types';

/** Category configuration for a tag cloud tab. */
export interface TagCloudCategory {
  /** Danbooru category ID (0=General, 1=Artist, 3=Copyright, 4=Character). */
  id: number;
  /** Display label for the tab button. */
  label: string;
  /** CSS color for the tag text. */
  color: string;
}

/** Options for rendering the tag cloud widget. */
export interface TagCloudOptions {
  /** Pre-fetched data for the initial tab (General). */
  initialData: TagCloudItem[];
  /** Callback to fetch data for a given category ID. */
  fetchData: (categoryId: number) => Promise<TagCloudItem[]>;
  /** Normalized username for building search URLs. */
  userName: string;
  /** Available category tabs. */
  categories: TagCloudCategory[];
}

const CLOUD_HEIGHT = 320;
const TOP_WEIGHT_PERCENTILE = 0.20;
const TRANSITION_MS = 350;

/**
 * Computes font sizes for tag cloud items using log-scale relative mapping.
 */
export function computeFontSizes(
  items: TagCloudItem[],
  minFont = 11,
  maxFont = 38,
): {text: string; tagName: string; frequency: number; count: number; size: number; bold: boolean}[] {
  if (items.length === 0) return [];

  const freqs = items.map(d => d.frequency);
  const minFreq = Math.min(...freqs);
  const maxFreq = Math.max(...freqs);
  const logMin = Math.log(minFreq);
  const logMax = Math.log(maxFreq);
  const logRange = logMax - logMin;
  const boldThreshold = Math.ceil(items.length * TOP_WEIGHT_PERCENTILE);

  return items.map((item, i) => ({
    text: item.name,
    tagName: item.tagName,
    frequency: item.frequency,
    count: item.count,
    size: logRange > 0
      ? minFont + ((Math.log(item.frequency) - logMin) / logRange) * (maxFont - minFont)
      : (minFont + maxFont) / 2,
    bold: i < boldThreshold,
  }));
}

/**
 * Renders a tag cloud widget with category tabs and crossfade transitions.
 */
export function renderTagCloudWidget(
  container: HTMLElement,
  options: TagCloudOptions,
): void {
  const {initialData, fetchData, userName, categories} = options;
  const isMobile = window.innerWidth <= 768;
  const MIN_FONT = isMobile ? 10 : 11;
  const MAX_FONT = isMobile ? 26 : 38;
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;

  // Closure state
  const cloudData: Record<number, TagCloudItem[]> = {};
  const layoutCache: Record<number, any[]> = {};
  let currentTab = categories[0]?.id ?? 0;
  let activeTag: string | null = null;

  // Seed initial data
  cloudData[currentTab] = initialData;

  // Build DOM structure
  container.style.background = '#fff';
  container.style.border = '1px solid #e1e4e8';
  container.style.borderRadius = '8px';
  container.style.padding = '15px';

  const header = document.createElement('div');
  header.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:0.9em;color:#666;font-weight:bold;';
  title.textContent = '🏷️ Tag Cloud';

  const tabsDiv = document.createElement('div');
  tabsDiv.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';

  for (const cat of categories) {
    const btn = document.createElement('button');
    btn.className = 'di-pie-tab';
    btn.dataset.catId = String(cat.id);
    btn.textContent = cat.label;
    if (cat.id === currentTab) btn.classList.add('active');
    tabsDiv.appendChild(btn);
  }

  header.appendChild(title);
  header.appendChild(tabsDiv);
  container.appendChild(header);

  // Cloud container: position relative so SVGs can stack for crossfade
  const cloudContainer = document.createElement('div');
  cloudContainer.className = 'di-tag-cloud-container';
  cloudContainer.style.position = 'relative';
  cloudContainer.style.minHeight = `${CLOUD_HEIGHT}px`;
  container.appendChild(cloudContainer);


  // Mobile tap tooltip (created once; separate from desktop hover tooltip)
  const cloudTooltip = document.createElement('div');
  cloudTooltip.className = 'di-tag-cloud-mobile-tooltip';
  cloudTooltip.style.cssText = 'position:absolute;background:rgba(30,30,30,0.95);color:#fff;padding:8px 12px;border-radius:6px;font-size:12px;pointer-events:none;opacity:0;z-index:99999;transition:opacity 0.15s;white-space:nowrap;';
  document.body.appendChild(cloudTooltip);

  // Desktop hover tooltip
  const tooltip = d3.select('body')
    .selectAll<HTMLDivElement, unknown>('.di-tag-cloud-tooltip')
    .data([0])
    .join('div')
    .attr('class', 'di-tag-cloud-tooltip')
    .style('position', 'absolute')
    .style('background', 'rgba(30, 30, 30, 0.95)')
    .style('color', '#fff')
    .style('padding', '5px 10px')
    .style('border-radius', '6px')
    .style('font-size', '12px')
    .style('pointer-events', 'none')
    .style('z-index', '2147483647')
    .style('opacity', '0')
    .style('white-space', 'nowrap');

  // Reset mobile highlight + tooltip
  const resetCloudHighlight = () => {
    activeTag = null;
    cloudTooltip.style.opacity = '0';
    d3.select(cloudContainer).selectAll('text').style('opacity', 1);
  };

  // Close mobile tooltip on tap outside the cloud SVG
  if (isTouchDevice) {
    document.addEventListener('click', (e) => {
      const svgEl = cloudContainer.querySelector('svg');
      if (svgEl && !svgEl.contains(e.target as Node) && !cloudTooltip.contains(e.target as Node)) {
        resetCloudHighlight();
      }
    });
    window.addEventListener('scroll', () => {
      resetCloudHighlight();
    }, {passive: true});
  }

  const getCurrentColor = (): string => {
    return categories.find(c => c.id === currentTab)?.color ?? '#0075f8';
  };



  /**
   * Creates an SVG with placed words and returns the wrapper div.
   */
  const createCloudSvg = (placedWords: any[], width: number, color: string, startOpacity: string): HTMLDivElement => {
    const wrapper = document.createElement('div');
    wrapper.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;opacity:${startOpacity};transition:opacity ${TRANSITION_MS}ms ease;`;

    const svg = d3.select(wrapper)
      .append('svg')
      .attr('width', width)
      .attr('height', CLOUD_HEIGHT)
      .style('overflow', 'hidden');

    const g = svg.append('g')
      .attr('transform', `translate(${width / 2},${CLOUD_HEIGHT / 2})`);

    g.selectAll('text')
      .data(placedWords)
      .join('text')
      .attr('class', 'di-tag-cloud-word')
      .style('font-size', (d: any) => `${d.size}px`)
      .style('font-weight', (d: any) => d.bold ? '700' : '500')
      .style('font-family', 'sans-serif')
      .style('fill', color)
      .attr('text-anchor', 'middle')
      .attr('transform', (d: any) => `translate(${d.x},${d.y})rotate(${d.rotate || 0})`)
      .text((d: any) => d.text)
      .style('pointer-events', 'all')
      .style('paint-order', 'stroke')
      .style('stroke', 'transparent')
      .style('stroke-width', isTouchDevice ? '8px' : '0px')
      .on('mouseover', function (event: MouseEvent, d: any) {
        if (isTouchDevice) return;
        g.selectAll('text').style('opacity', 0.25);
        d3.select(this)
          .style('opacity', 1)
          .style('font-size', `${d.size * 1.08}px`);
        tooltip
          .html(`<strong>${d.text}</strong> — ${(d.frequency * 100).toFixed(2)}% · ${d.count.toLocaleString()} posts`)
          .style('left', `${event.pageX + 15}px`)
          .style('top', `${event.pageY + 15}px`)
          .style('opacity', '1');
      })
      .on('mousemove', (event: MouseEvent) => {
        if (isTouchDevice) return;
        tooltip
          .style('left', `${event.pageX + 15}px`)
          .style('top', `${event.pageY + 15}px`);
      })
      .on('mouseout', function (_event: MouseEvent, d: any) {
        if (isTouchDevice) return;
        g.selectAll('text').style('opacity', 1);
        d3.select(this).style('font-size', `${d.size}px`);
        tooltip.style('opacity', '0');
      })
      .on('click', function(_event: MouseEvent, d: any) {
        if (isTouchDevice) {
          if (activeTag === d.tagName) {
            // 2nd tap on same tag → navigate
            const query = `user:${userName} ${d.tagName}`;
            window.open(`/posts?tags=${encodeURIComponent(query)}`, '_blank');
            activeTag = null;
            cloudTooltip.style.opacity = '0';
            g.selectAll('text').style('opacity', 1);
            d3.select(this).style('font-size', `${d.size}px`);
          } else {
            // 1st tap → show tooltip + highlight
            activeTag = d.tagName;
            g.selectAll('text').style('opacity', 0.2);
            d3.select(this).style('opacity', 1).style('font-size', `${d.size * 1.08}px`);
            cloudTooltip.innerHTML = `<strong>${d.text}</strong> — ${(d.frequency * 100).toFixed(2)}% · ${d.count.toLocaleString()} posts`;
            cloudTooltip.style.opacity = '1';
            const rect = (this as Element).getBoundingClientRect();
            cloudTooltip.style.left = `${rect.left + window.scrollX + rect.width / 2 - cloudTooltip.offsetWidth / 2}px`;
            cloudTooltip.style.top = `${rect.top + window.scrollY - cloudTooltip.offsetHeight - 8}px`;
          }
          return;
        }
        // Desktop: navigate directly
        const query = `user:${userName} ${d.tagName}`;
        window.open(`/posts?tags=${encodeURIComponent(query)}`, '_blank');
      });

    return wrapper;
  };

  /**
   * Crossfade transition: fade out old content, fade in new SVG simultaneously.
   */
  const crossfadeTo = (placedWords: any[], width: number, color: string) => {
    const oldChildren = Array.from(cloudContainer.children) as HTMLElement[];

    const newWrapper = createCloudSvg(placedWords, width, color, '0');
    cloudContainer.appendChild(newWrapper);

    requestAnimationFrame(() => {
      for (const el of oldChildren) {
        el.style.transition = `opacity ${TRANSITION_MS}ms ease`;
        el.style.opacity = '0';
      }
      newWrapper.style.opacity = '1';

      setTimeout(() => {
        for (const el of oldChildren) {
          if (el.parentNode === cloudContainer) cloudContainer.removeChild(el);
        }
      }, TRANSITION_MS);
    });


  };

  /**
   * Ensures layout is computed and renders with the given transition mode.
   */
  const computeAndRender = (data: TagCloudItem[], crossfade: boolean) => {
    const width = Math.max(container.clientWidth - 30, 300);
    const color = getCurrentColor();

    // Use cached layout
    if (layoutCache[currentTab]) {
      if (crossfade) {
        crossfadeTo(layoutCache[currentTab], width, color);
      } else {
        cloudContainer.innerHTML = '';
        const wrapper = createCloudSvg(layoutCache[currentTab], width, color, '1');
        cloudContainer.appendChild(wrapper);

      }
      return;
    }

    // Compute layout
    const words = computeFontSizes(data, MIN_FONT, MAX_FONT);
    const cloud = (d3 as any).layout.cloud;
    if (!cloud) {
      cloudContainer.innerHTML = '<div style="color:#c00;">d3-cloud library not loaded</div>';
      return;
    }

    cloud()
      .size([width, CLOUD_HEIGHT])
      .words(words.map(w => ({...w})))
      .padding(4)
      .rotate(() => 0)
      .font('sans-serif')
      .fontSize((d: any) => d.size)
      .on('end', (placedWords: any[]) => {
        layoutCache[currentTab] = placedWords;
        if (crossfade) {
          crossfadeTo(placedWords, width, color);
        } else {
          cloudContainer.innerHTML = '';
          const wrapper = createCloudSvg(placedWords, width, color, '1');
          cloudContainer.appendChild(wrapper);
      
        }
      })
      .start();
  };

  /**
   * Loads data for a tab and renders.
   */
  const loadTab = async (categoryId: number, crossfade: boolean) => {
    if (cloudData[categoryId]) {
      computeAndRender(cloudData[categoryId], crossfade);
      return;
    }

    // Show loading with crossfade
    const oldChildren = Array.from(cloudContainer.children) as HTMLElement[];
    const loadingDiv = document.createElement('div');
    loadingDiv.style.cssText = `position:absolute;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity ${TRANSITION_MS}ms ease;`;
    loadingDiv.innerHTML = '<span style="color:#888;font-size:0.9em;">Loading...</span>';
    cloudContainer.appendChild(loadingDiv);

    requestAnimationFrame(() => {
      for (const el of oldChildren) {
        el.style.transition = `opacity ${TRANSITION_MS}ms ease`;
        el.style.opacity = '0';
      }
      loadingDiv.style.opacity = '1';
      setTimeout(() => {
        for (const el of oldChildren) {
          if (el.parentNode === cloudContainer) cloudContainer.removeChild(el);
        }
      }, TRANSITION_MS);
    });

    try {
      const data = await fetchData(categoryId);
      cloudData[categoryId] = data;
      if (currentTab === categoryId) {
        computeAndRender(data, true);
      }
    } catch (e) {
      console.debug('[DI] Tag cloud tab load failed', e);
      if (currentTab === categoryId) {
        cloudContainer.innerHTML = '<div style="color:#c00;font-size:0.9em;">Failed to load data</div>';
      }
    }
  };

  // Tab click handler
  tabsDiv.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('.di-pie-tab') as HTMLElement | null;
    if (!btn || !btn.dataset.catId) return;

    const catId = parseInt(btn.dataset.catId);
    if (catId === currentTab) return;

    currentTab = catId;

    // Reset mobile tooltip state on tab switch
    resetCloudHighlight();

    tabsDiv.querySelectorAll('.di-pie-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');

    loadTab(catId, true);
  });

  // Initial render (no animation)
  loadTab(currentTab, false);
}
