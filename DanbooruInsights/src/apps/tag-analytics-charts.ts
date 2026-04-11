import * as d3 from 'd3';
import {escapeHtml, getLevelClass, getBestThumbnailUrl} from '../utils';

/**
 * Chart renderer for TagAnalyticsApp.
 * Handles D3 chart rendering, milestone gallery, and ranking tables.
 */
export class TagAnalyticsChartRenderer {
  currentData: any;
  currentMilestones: any;
  resizeObserver: ResizeObserver | null;
  resizeTimeout: ReturnType<typeof setTimeout> | null;
  isMilestoneExpanded: boolean;

  constructor() {
    this.currentData = null;
    this.currentMilestones = null;
    this.resizeObserver = null;
    this.resizeTimeout = null;
    this.isMilestoneExpanded = false;
  }

  /**
   * Disconnects resize observer and clears timeout.
   * Called when the modal is closed.
   */
  cleanup(): void {
    if (this.resizeTimeout) {
      clearTimeout(this.resizeTimeout);
      this.resizeTimeout = null;
    }
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /**
   * Renders a D3.js pie chart for the specified data type.
   * Handles data preparation, SVG rendering, tooltips, legend generation, and click interactions.
   *
   * @param {string} type - The type of data to render ('status', 'rating', 'copyright', 'character', 'commentary').
   * @param {Object} tagData - The full tag data object containing counts and other metadata.
   */
  renderPieChart(type: string, tagData: any): void {
    const container = document.getElementById('status-pie-chart');
    const legendContainer = document.getElementById('status-pie-legend');
    const loading = document.getElementById('status-pie-loading');
    const wrapper = document.getElementById('status-pie-chart-wrapper');

    if (!container || !tagData) return;

    let counts = null;
    if (type === 'status') counts = tagData.statusCounts;
    else if (type === 'rating') counts = tagData.ratingCounts;
    else if (type === 'copyright') counts = tagData.copyrightCounts;
    else if (type === 'character') counts = tagData.characterCounts;
    else if (type === 'commentary') {
      // Transform Commentary Counts
      const c = tagData.commentaryCounts;
      const translated = c.translated || 0;
      const requested = c.requested || 0;
      const total = c.total || 0;
      const untagged = Math.max(0, total - (translated + requested)); // Avoid negative

      counts = {
        'commentary': translated,
        'commentary_request': requested,
        'has:commentary -commentary -commentary_request': untagged
      };
    }
    if (!counts) return;

    const ratingLabels: Record<string, string> = { 'g': 'General', 's': 'Sensitive', 'q': 'Questionable', 'e': 'Explicit' };

    // Safe Data Mapping
    const data = Object.entries(counts).map(([key, count]) => {
      let name = key;
      if (type === 'status') name = key.charAt(0).toUpperCase() + key.slice(1);
      else if (type === 'rating') name = ratingLabels[key] || key;
      else if (type === 'commentary') {
        if (key === 'commentary') name = 'Commentary';
        else if (key === 'commentary_request') name = 'Requested';
        else if (key === 'has:commentary -commentary -commentary_request') name = 'Untagged';
      }
      else name = key.replace(/_/g, ' ');

      if (key === 'others') name = 'Others';

      // Ensure count is a number and valid
      const validCount = Number(count);
      return {
        name: name,
        count: isNaN(validCount) ? 0 : validCount,
        key: key
      };
    }).filter(d => d.count > 0)
      .sort((a, b) => {
        if (a.key === 'others') return 1;
        if (b.key === 'others') return -1;
        return b.count - a.count;
      }); // Sort by count desc, but others last

    if (data.length === 0) {
      if (loading) {
        loading.style.display = 'block';
        loading.textContent = `No ${type} data available.`;
      }
      if (wrapper) wrapper.style.opacity = '0';
      return;
    }

    if (loading) loading.style.display = 'none';
    if (wrapper) wrapper.style.opacity = '1';

    const width = 120;
    const height = 120;
    const radius = (Math.min(width, height) / 2) - 8; // Reduced for hover space

    // Colors
    const statusColors: Record<string, string> = {
      'active': '#28a745', 'deleted': '#dc3545', 'pending': '#ffc107',
      'flagged': '#fd7e14', 'banned': '#6c757d', 'appealed': '#007bff'
    };
    const ratingColors: Record<string, string> = {
      'g': '#28a745', 's': '#fd7e14', 'q': '#6f42c1', 'e': '#dc3545'
    };
    // Dynamic colors for tags
    const ordinalColor = d3.scaleOrdinal(d3.schemeCategory10);

    const getColor = (key: string) => {
      if (type === 'status') return statusColors[key] || '#999';
      if (type === 'rating') return ratingColors[key] || '#999';
      if (type === 'commentary') {
        if (key === 'commentary') return '#007bff'; // Blue
        if (key === 'commentary_request') return '#ffc107';    // Yellow/Orange
        if (key === 'has:commentary -commentary -commentary_request') return '#6c757d';   // Grey
      }
      if (key === 'others') return '#888'; // Grey for Others
      return ordinalColor(key);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pie = (d3.pie() as any).value((d: any) => d.count).sort(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arc = (d3.arc() as any).innerRadius(radius * 0.4).outerRadius(radius);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const arcHover = (d3.arc() as any).innerRadius(radius * 0.4).outerRadius(radius * 1.1);

    // Select existing SVG or create new one
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let svg: any = d3.select(container).select('svg');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let g: any;

    if (svg.empty()) {
      svg = d3.select(container)
        .append('svg')
        .attr('width', width)
        .attr('height', height);
      g = svg.append('g')
        .attr('transform', `translate(${width / 2},${height / 2})`);
    } else {
      g = svg.select('g');
    }

    // Tooltip (Global)
    const tooltip = d3.select("body").selectAll(".tag-pie-tooltip").data([0]).join("div")
      .attr("class", "tag-pie-tooltip")
      .style("position", "absolute")
      .style("background", "rgba(30, 30, 30, 0.9)")
      .style("color", "#fff")
      .style("padding", "5px 10px")
      .style("border-radius", "4px")
      .style("font-size", "11px")
      .style("pointer-events", "none")
      .style("z-index", "2147483647")
      .style("opacity", "0")
      .style("box-shadow", "0 2px 5px rgba(0,0,0,0.2)");

    const totalValue = d3.sum(data, (d: any) => d.count);
    const arcs = pie(data);

    // JOIN
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const path = g.selectAll('path')
      .data(arcs, (d: any) => d.data.key); // Use key for stable updates

    // EXIT
    path.exit()
      .transition().duration(500)
      .attrTween('d', function (this: any, d: any) {
        const start = d.startAngle;
        const end = d.endAngle;
        const i = d3.interpolate(start, end);
        return function (t: number) {
          // Create a temp object for arc, do NOT modify d in place
          return arc({ ...d, startAngle: i(t) }) || "";
        };
      })
      .remove();

    // UPDATE
    path.transition().duration(500)
      .attrTween('d', function (this: any, d: any) {
        const prev = this._current || { startAngle: 0, endAngle: 0, padAngle: 0 };
        const i = d3.interpolate(prev, d);
        const self = this;
        return function (t: number) {
          const val = i(t);
          self._current = val;
          return arc(val) || "";
        };
      })
      .attr('fill', (d: any) => getColor(d.data.key));

    // ENTER
    path.enter()
      .append('path')
      .attr('fill', (d: any) => getColor(d.data.key))
      .attr('stroke', '#fff')
      .style('stroke-width', '1px')
      .style('opacity', 0.8)
      .style('cursor', 'pointer')
      .transition().duration(500)
      .attrTween('d', function (this: any, d: any) {
        const i = d3.interpolate({ startAngle: 0, endAngle: 0, padAngle: 0 }, d);
        const self = this;
        return function (t: number) {
          const val = i(t);
          self._current = val;
          return arc(val) || "";
        };
      });

    // RE-ATTACH EVENTS (Merge Enter + Update)
    g.selectAll('path')
      .on('mouseover', function (this: any, event: any, d: any) {
        d3.select(this).transition().duration(200).attr('d', arcHover).style('opacity', 1);
        const percent = Math.round((d.data.count / totalValue) * 100);
        tooltip.transition().duration(200).style('opacity', 1);
        tooltip.html(`<strong>${escapeHtml(d.data.name)}</strong>: ${d.data.count.toLocaleString()} (${percent}%)`)
          .style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 20) + 'px');
      })
      .on('mousemove', function (this: any, event: any) {
        tooltip.style('left', (event.pageX + 10) + 'px')
          .style('top', (event.pageY - 20) + 'px');
      })
      .on('mouseout', function (this: any) {
        d3.select(this).transition().duration(200).attr('d', arc).style('opacity', 0.8);
        tooltip.transition().duration(200).style('opacity', 0);
      })
      .on('click', (_event: any, d: any) => {
        if (d.data.key === 'others') return;

        let query = '';
        if (type === 'status') {
          query = `${tagData.name} status:${d.data.key}`;
        } else if (type === 'rating') {
          query = `${tagData.name} rating:${d.data.key}`;
        } else {
          // Copyright/Character/Commentary
          query = `${tagData.name} ${d.data.key}`;
        }
        const url = `/posts?tags=${encodeURIComponent(query)}`;
        window.open(url, '_blank');
      });

    // Legend
    if (legendContainer) {
      legendContainer.innerHTML = '';
      data.forEach(d => {
        const item = document.createElement('div');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.marginBottom = '2px';
        item.style.whiteSpace = 'nowrap';

        const colorBox = document.createElement('div');
        colorBox.style.width = '10px';
        colorBox.style.height = '10px';
        colorBox.style.backgroundColor = getColor(d.key);
        colorBox.style.marginRight = '5px';
        colorBox.style.borderRadius = '2px';

        const label = document.createElement('a');
        let query = '';

        if (type === 'status') {
          query = `${tagData.name} status:${d.key}`;
        } else if (type === 'rating') {
          query = `${tagData.name} rating:${d.key}`;
        } else {
          // Copyright/Character: Just the tag name? Or AND logic?
          // "tagName relatedTag"
          if (d.key === 'others') {
            // Others not clickable or what?
            // Maybe disable link.
          } else {
            query = `${tagData.name} ${d.key}`;
          }
        }

        if (d.key !== 'others') {
          label.href = `/posts?tags=${encodeURIComponent(query)}`;
          label.target = '_blank';
          label.style.cursor = 'pointer';
          label.classList.add('di-hover-text-primary');
        } else {
          label.style.cursor = 'default';
        }

        label.textContent = `${d.name} (${d.count.toLocaleString()})`;
        label.style.textDecoration = 'none';
        label.style.color = '#555';
        label.style.transition = 'color 0.2s';

        item.appendChild(colorBox);
        item.appendChild(label);
        legendContainer.appendChild(item);
      });
    }
  }


  /**
   * Renders the milestones grid.
   * @param {!Array<{milestone: number, post: ?Object}>} milestonePosts The list of milestone data.
   * @param {function(): void} onNsfwUpdate Callback to apply NSFW visibility after rendering.
   */
  renderMilestones(
    milestonePosts: any[],
    onNsfwUpdate: () => void,
    nextMilestone?: {totalPosts: number; nextTarget: number}
  ): void {
    const grid = document.querySelector('#tag-analytics-milestones .milestones-grid');
    const toggleBtn = document.getElementById('tag-milestones-toggle');
    const loading = document.querySelector('#milestones-loading');
    if (loading) (loading as HTMLElement).style.display = 'none';
    if (!grid) return;

    grid.innerHTML = '';

    if (milestonePosts.length === 0) {
      grid.innerHTML = '<div style="color:#888; grid-column:1/-1; text-align:center;">No milestones found.</div>';
      if (toggleBtn) toggleBtn.style.display = 'none';
      return;
    }

    // Show toggle if many items
    if (toggleBtn && milestonePosts.length > 6) {
      toggleBtn.style.display = 'block';
      toggleBtn.textContent = this.isMilestoneExpanded ? 'Show Less' : 'Show More';
      (grid as HTMLElement).style.maxHeight = this.isMilestoneExpanded ? '2000px' : '120px';

      toggleBtn.onclick = () => {
        this.isMilestoneExpanded = !this.isMilestoneExpanded;
        (grid as HTMLElement).style.maxHeight = this.isMilestoneExpanded ? '2000px' : '120px';
        toggleBtn.textContent = this.isMilestoneExpanded ? 'Show Less' : 'Show More';
      };
    } else if (toggleBtn) {
      toggleBtn.style.display = 'none';
      (grid as HTMLElement).style.maxHeight = 'none';
    }

    milestonePosts.forEach(item => {
      const m = item.milestone;
      const p = item.post;

      let label = `#${m}`;
      if (m === 1) label = 'First';
      else if (m >= 1000000) {
        const val = m / 1000000;
        label = `${Number.isInteger(val) ? val : val.toFixed(1).replace(/\.0$/, '')} M`;
      } else if (m >= 1000) {
        const val = m / 1000;
        label = `${val} k`;
      }

      const dateStr = new Date(p.created_at).toISOString().slice(0, 10);
      const thumbUrl = getBestThumbnailUrl(p);
      const uploaderName = p.uploader_name || `User ${p.uploader_id}`;

      const card = document.createElement('div');
      card.className = 'di-milestone-card di-nsfw-monitor';
      card.setAttribute('data-rating', p.rating);
      card.style.background = '#fff';
      card.style.border = '1px solid #e1e4e8';
      card.style.borderRadius = '6px';
      card.style.padding = '10px 80px 10px 10px';
      card.style.position = 'relative';
      card.style.minHeight = '80px';
      card.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
      card.classList.add('di-hover-translate-up');

      card.innerHTML = `
            <div style="font-size: 0.8em; color: #888; letter-spacing: 0.3px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">#${p.id}</div>
            <a href="/posts/${p.id}" target="_blank" class="di-milestone-link" style="font-weight: bold; font-size: 1.1em; color: #0969da; text-decoration: none; display: block; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${label}</a>
            <div style="font-size: 0.8em; color: #555; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${dateStr}</div>
            <div style="font-size: 0.75em; color: #888; margin-top: 4px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                <a href="/users/${p.uploader_id}" target="_blank" class="${getLevelClass(p.uploader_level)}" style="text-decoration: none;">${escapeHtml(uploaderName)}</a>
            </div>
            <a href="/posts/${p.id}" target="_blank" style="position: absolute; top: 10px; right: 10px; width: 60px; height: 60px; border-radius: 4px; overflow: hidden; background: #f0f0f0; display: block;">
                <img src="${thumbUrl}" style="width: 100%; height: 100%; object-fit: cover;" onerror="this.onerror=null;this.src='/favicon.ico';this.style.objectFit='contain';this.style.padding='4px';">
            </a>
        `;

      const link = card.querySelector('.di-milestone-link');
      if (link) link.classList.add('di-hover-underline');

      grid.appendChild(card);
    });

    // Append the "next milestone" placeholder card (always last in the grid).
    //
    // Progress calculation uses **option A**: lastReached = the milestone
    // value of the last entry in the fetched `milestonePosts` array. This
    // is the simplest and matches what the user sees in the grid.
    //
    // **Option C** (alternative, not used): compute lastReached as "the
    // milestone immediately before next in the theoretical sequence" via a
    // pure helper. The two options produce identical results in every
    // realistic case — they only diverge in pathological cases where a
    // milestone post failed to fetch. Switch to option C only if we ever
    // decouple the progress card from the fetched post list.
    if (nextMilestone && nextMilestone.nextTarget > nextMilestone.totalPosts) {
      const total = nextMilestone.totalPosts;
      const next = nextMilestone.nextTarget;
      const remaining = next - total;
      const lastReached = milestonePosts.length > 0
        ? milestonePosts[milestonePosts.length - 1].milestone
        : 0;
      const span = next - lastReached;
      const progressPct = span > 0
        ? Math.max(0, Math.min(100, ((total - lastReached) / span) * 100))
        : 0;

      let nextLabel = `#${next.toLocaleString()}`;
      if (next === 1) nextLabel = 'First';
      else if (next >= 1000000) {
        const val = next / 1000000;
        nextLabel = `${Number.isInteger(val) ? val : val.toFixed(1).replace(/\.0$/, '')} M`;
      } else if (next >= 1000) {
        const val = next / 1000;
        nextLabel = `${val} k`;
      }

      const nextCard = document.createElement('div');
      nextCard.className = 'di-next-milestone-card';
      nextCard.style.background = '#f6f8fa';
      nextCard.style.border = '1px dashed #d0d7de';
      nextCard.style.borderRadius = '6px';
      nextCard.style.padding = '10px';
      nextCard.style.minHeight = '80px';
      nextCard.style.display = 'flex';
      nextCard.style.flexDirection = 'column';
      nextCard.style.justifyContent = 'space-between';
      nextCard.style.color = '#57606a';
      nextCard.innerHTML = `
        <div>
          <div style="font-size: 0.7em; color: #888; letter-spacing: 0.3px; text-transform: uppercase;">Next</div>
          <div style="font-weight: bold; font-size: 1.1em; color: #57606a; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${nextLabel}</div>
          <div style="font-size: 0.8em; color: #666; margin-top: 4px;">${remaining.toLocaleString()} remaining</div>
        </div>
        <div style="margin-top: 6px;">
          <div style="height: 6px; background: #e1e4e8; border-radius: 3px; overflow: hidden;">
            <div style="width: ${progressPct.toFixed(1)}%; height: 100%; background: #0969da;"></div>
          </div>
          <div style="font-size: 0.7em; color: #888; margin-top: 3px; text-align: right;">${progressPct.toFixed(0)}%</div>
        </div>
      `;
      grid.appendChild(nextCard);
    }

    // Apply NSFW Settings
    onNsfwUpdate();
  }


  /**
   * Renders both the monthly bar chart and cumulative area chart.
   * @param {!Array<{date: string, count: number, cumulative: number}>} data The history data.
   * @param {string} tagName The tag name used for search URL construction.
   * @param {!Array<Object>=} milestones Optional pre-calculated milestones for display.
   */
  renderHistoryCharts(data: any[], tagName: string, milestones?: any[]): void {
    if (!(window as any).d3) {
      console.error("D3.js not loaded");
      return;
    }

    this.currentMilestones = milestones;

    // Sanitize Data: Ensure all dates are strings YYYY-MM-DD
    const chartData = data.map(d => {
      let dateStr = d.date;
      if (d.date instanceof Date) {
        dateStr = d.date.toISOString().slice(0, 10);
      }
      return {
        ...d,
        date: dateStr
      };
    });

    this.currentData = chartData;

    // 1. Monthly Bar Chart (Scrollable)
    this.renderBarChart(chartData, "#history-chart-monthly", "Monthly Posts", tagName, milestones);

    // 2. Cumulative Line/Area Chart (Fit to width, usually readable as line)
    this.renderAreaChart(chartData, "#history-chart-cumulative", "Cumulative Posts");

    // Responsive Resize Handling
    if (!this.resizeObserver) {
      const modalContent = document.querySelector("#tag-analytics-content")?.parentElement;
      if (modalContent) {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.resizeTimeout) clearTimeout(this.resizeTimeout);
          this.resizeTimeout = setTimeout(() => {
            if (this.currentData && document.getElementById("history-chart-monthly")) {
              // Re-render using stored sanitized data
              this.renderBarChart(this.currentData, "#history-chart-monthly", "Monthly Posts", tagName, this.currentMilestones);
              this.renderAreaChart(this.currentData, "#history-chart-cumulative", "Cumulative Posts");
            }
          }, 100);
        });
        this.resizeObserver.observe(modalContent);
      }
    }
  }

  /**
   * Renders a bar chart using D3.js.
   * @param {!Array<{date: string, count: number}>} data The data to render.
   * @param {string} selector The CSS selector for the container.
   * @param {string} title The title of the chart.
   * @param {string} tagName The tag name used for search URL construction.
   * @param {!Array<Object>=} milestones Optional milestones to overlay.
   */
  renderBarChart(data: any[], selector: string, title: string, tagName: string, milestones?: any[]): void {
    const container = document.querySelector(selector) as HTMLElement;
    if (!container) return;
    container.innerHTML = ""; // Clear

    // Structure:
    // Container (Flex Column)
    //  -> Title (Static)
    //  -> ScrollWrapper (Overflow Auto)
    //      -> SVG

    container.style.display = 'flex';
    container.style.flexDirection = 'column';
    container.style.height = '100%';

    // 1. Static Title
    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    titleEl.style.fontSize = "14px";
    titleEl.style.fontWeight = "bold";
    titleEl.style.color = "#444";
    titleEl.style.marginBottom = "5px";
    titleEl.style.textAlign = "left"; // Left aligned
    titleEl.style.borderLeft = "4px solid #007bff";
    titleEl.style.paddingLeft = "10px";
    container.appendChild(titleEl);

    // 2. Main Wrapper (Flexbox to separate Fixed Y and Scrollable Content)
    const mainWrapper = document.createElement("div");
    mainWrapper.className = "chart-flex-wrapper";
    mainWrapper.style.display = "flex";
    mainWrapper.style.width = "100%";
    mainWrapper.style.position = "relative";
    container.appendChild(mainWrapper);

    // Dedicated space for fixed Y-Axis
    const yAxisContainer = document.createElement("div");
    yAxisContainer.className = "y-axis-container";
    yAxisContainer.style.width = "45px"; // Fixed width
    yAxisContainer.style.flexShrink = "0";
    yAxisContainer.style.background = "#fff";
    yAxisContainer.style.zIndex = "5";
    mainWrapper.appendChild(yAxisContainer);

    // Scrollable Content
    const scrollWrapper = document.createElement("div");
    scrollWrapper.className = "scroll-wrapper";
    scrollWrapper.style.flex = "1";
    scrollWrapper.style.overflowX = 'auto'; // Horizontal scroll
    scrollWrapper.style.overflowY = 'hidden';
    mainWrapper.appendChild(scrollWrapper);

    // Calculate flexible width
    const barWidth = 20; // px
    const margin = { top: 20, right: 30, bottom: 40, left: 10 }; // Small left margin for scrollable part
    const yAxisMargin = { top: 20, right: 0, bottom: 40, left: 40 };

    // visible container width
    const containerWidth = mainWrapper.clientWidth - 45;
    // required width for all bars
    const calculatedWidth = data.length * barWidth;

    // Final SVG width
    const width = Math.max(containerWidth, calculatedWidth + margin.left + margin.right);
    const height = 300;

    // Render Y-Axis SVG (Fixed)
    const yAxisSvg = d3.select(yAxisContainer)
      .append("svg")
      .attr("width", 45)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${yAxisMargin.left},${yAxisMargin.top})`);

    // Render Content SVG (Scrollable)
    const svg = d3.select(scrollWrapper)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleBand()
      // Handle both Date objects (old cache/calc) and strings (new fetch). Use Local Time YYYY-MM-DD
      .domain(data.map(d => {
        if (d.date instanceof Date) return d.date.toLocaleDateString('en-CA');
        return d.date; // already YYYY-MM-DD string
      }))
      .range([0, width - margin.left - margin.right])
      .padding(0.2);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, d => d.count)])
      .nice()
      .range([height - margin.top - margin.bottom, 0]);

    // Render Y Axis into Fixed SVG
    yAxisSvg.call(d3.axisLeft(y).ticks(8));

    // 3. Grid Lines (Horizontal) - Render in scrollable area for context
    svg.append("g")
      .attr("class", "grid")
      .attr("stroke-opacity", 0.05)
      .call(d3.axisLeft(y)
        .ticks(8)
        .tickSize(-(width - margin.left - margin.right))
        .tickFormat(() => "")
      )
      .call(g => g.select(".domain").remove());

    // 4. Clickable Monthly Overlays (Full height clickable area)
    const overlayGroups = svg.append("g").attr("class", "monthly-overlays");
    data.forEach(d => {
      // d.date can be "YYYY-MM-DD" string or Date object
      const dateStr = (d.date instanceof Date) ? d.date.toLocaleDateString('en-CA') : d.date;
      const dateObj = (d.date instanceof Date) ? d.date : new Date(dateStr);

      const nextDate = new Date(dateObj);
      nextDate.setMonth(nextDate.getMonth() + 1);
      const nextDateStr = nextDate.toLocaleDateString('en-CA');

      const dateRange = `${dateStr}...${nextDateStr}`;
      const searchUrl = `/posts?tags=${encodeURIComponent(tagName)}+date:${dateRange}`;

      const colWidth = x.step();
      // Use the string date key for x-scale lookup
      const colX = (x(dateStr) ?? 0) - (x.step() - x.bandwidth()) / 2;

      overlayGroups.append("rect")
        .attr("x", colX)
        .attr("y", 0)
        .attr("width", colWidth)
        .attr("height", height - margin.top - margin.bottom)
        .attr("fill", "transparent")
        .style("cursor", "pointer")
        .style("pointer-events", "all") // Ensure it captures events
        .on("mouseover", function () {
          d3.select(this).attr("fill", "rgba(0, 123, 255, 0.05)");
          // Highlight Bar
          const bar = svg.select(`.monthly-bar-${dateStr}`); // Use string date for class
          if (bar.node()) bar.attr("fill", "#2e7d32"); // Darker/Vivid Green (Matches screenshot)
        })
        .on("mouseout", function () {
          d3.select(this).attr("fill", "transparent");
          // Reset Bar
          const bar = svg.select(`.monthly-bar-${dateStr}`); // Use string date for class
          if (bar.node()) bar.attr("fill", "#69b3a2"); // Original Green
        })
        .on("click", () => {
          window.open(searchUrl, '_blank');
        })
        .append("title")
        .text(`${dateStr}\nCount: ${d.count.toLocaleString()}`);
    });

    // 4. Bars
    svg.selectAll("rect.monthly-bar")
      .data(data)
      .enter()
      .append("rect")
      // d.date might be Date or String. Use safe conversion.
      .attr("class", (d: any) => `monthly-bar monthly-bar-${(d.date instanceof Date) ? d.date.toLocaleDateString('en-CA') : d.date}`)
      .attr("x", (d: any) => x((d.date instanceof Date) ? d.date.toLocaleDateString('en-CA') : d.date) ?? 0)
      .attr("y", (d: any) => y(d.count))
      .attr("width", x.bandwidth())
      .attr("height", (d: any) => height - margin.top - margin.bottom - y(d.count))
      .attr("fill", "#69b3a2")
      .style("pointer-events", "none") // Let clicks pass through to overlays
      .append("title")
      .text((d: any) => `${(d.date instanceof Date) ? d.date.toLocaleDateString('en-CA') : d.date}: ${d.count} posts`);

    // 5. Render Stars (Milestones) - Render AFTER bars and overlays
    if (milestones && milestones.length > 0) {
      // Group milestones by month for stacking
      const milestonesByMonth: Record<string, any[]> = {};
      milestones.forEach((m: any) => {
        // Filter milestones: show only #1 and multiples of 1000
        if (!m.post) return;
        if (m.milestone !== 1 && m.milestone % 1000 !== 0) return;

        const pDate = new Date(m.post.created_at);
        // Use local date methods to match fetchMonthlyCounts buckets
        const mKey = `${pDate.getFullYear()}-${String(pDate.getMonth() + 1).padStart(2, '0')}-01`; // Match string format
        if (!milestonesByMonth[mKey]) milestonesByMonth[mKey] = [];
        milestonesByMonth[mKey].push(m);
      });

      const starGroups = svg.append("g").attr("class", "di-milestone-stars");

      data.forEach((d) => {
        // Use local date methods for consistent matching
        const mKey = (d.date instanceof Date) ? d.date.toISOString().slice(0, 10) : d.date;
        const monthMilestones = milestonesByMonth[mKey];

        if (monthMilestones) {
          const bx = (x(d.date) ?? 0) + x.bandwidth() / 2;

          monthMilestones.forEach((m: any, si: number) => {
            // Position stars inside the plot area, stacking downwards
            const starY = 12 + (si * 14);

            let fill = '#ffd700';
            let stroke = '#b8860b';
            let animClass = '';
            let fontSize = '12px';

            // m.milestone is the target number (1, 1000, 2000...)
            if (m.milestone === 1) {
              fill = '#00e676'; // Green for #1
              stroke = '#00a050';
            } else if (m.milestone % 10000 === 0) {
              fill = '#ffb300'; // Deep Gold
              animClass = 'star-shiny';
              fontSize = '15px';
            }

            const star = starGroups.append("a")
              .attr("href", `${window.location.origin}/posts/${m.post.id}`)
              .attr("target", "_blank")
              .style("text-decoration", "none")
              .append("text")
              .attr("class", animClass)
              .attr("x", bx)
              .attr("y", starY)
              .attr("text-anchor", "middle")
              .attr("dominant-baseline", "central")
              .attr("font-size", fontSize)
              .attr("fill", fill)
              .attr("stroke", stroke)
              .attr("stroke-width", "0.5")
              .style("cursor", "pointer")
              .style("filter", "drop-shadow(0px 1px 1px rgba(0,0,0,0.3))")
              .style("pointer-events", "all")
              .text("★");

            star.append("title")
              .text(`Milestone #${m.milestone} (${new Date(m.post.created_at).toLocaleDateString()})`);
          });
        }
      });
    }

    // X Axis
    const xAxis = d3.axisBottom(x)
      .tickValues(x.domain().filter(d => new Date(d).getMonth() === 0)) // Parse string to Date for month check
      .tickFormat(d => d3.timeFormat("%Y")(new Date(d))); // Parse string to Date for formatting

    svg.append("g")
      .attr("transform", `translate(0,${height - margin.top - margin.bottom})`)
      .call(xAxis);

    // Scroll to end (Present) logic - do after render
    setTimeout(() => {
      if (scrollWrapper) scrollWrapper.scrollLeft = scrollWrapper.scrollWidth;
    }, 50);
  }

  /**
   * Renders a cumulative area chart using D3.js.
   * @param {!Array<{date: string, count: number, cumulative: number}>} data The data to render.
   * @param {string} selector The CSS selector for the container.
   * @param {string} title The title of the chart.
   */
  renderAreaChart(data: any[], selector: string, title: string) {
    const container = document.querySelector(selector) as HTMLElement | null;
    if (!container) return;
    container.innerHTML = "";

    // Ensure container is positioned for absolute tooltip logic if used relative
    // But we will use body for tooltip to avoid clipping
    container.style.position = 'relative';

    // 1. Static Title
    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    titleEl.style.fontSize = "14px";
    titleEl.style.fontWeight = "bold";
    titleEl.style.color = "#444";
    titleEl.style.marginBottom = "5px";
    titleEl.style.textAlign = "left"; // Left aligned
    titleEl.style.borderLeft = "4px solid #007bff";
    titleEl.style.paddingLeft = "10px";
    container.appendChild(titleEl);

    const width = container.getBoundingClientRect().width;
    const margin = { top: 30, right: 30, bottom: 40, left: 50 };

    if (width <= margin.left + margin.right) {
      console.warn("[TagAnalyticsApp] Container too narrow for chart, skipping render.");
      return;
    }

    const height = 300;

    const svg = d3.select(selector)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3.scaleTime()
      .domain(d3.extent(data, (d: any) => new Date(d.date)) as [Date, Date])
      .range([0, width - margin.left - margin.right]);

    const y = d3.scaleLinear()
      .domain([0, d3.max(data, (d: any) => d.cumulative) ?? 0])
      .nice()
      .range([height - margin.top - margin.bottom, 0]);

    // Area
    svg.append("path")
      .datum(data)
      .attr("fill", "#cce5df")
      .attr("stroke", "#69b3a2")
      .attr("stroke-width", 1.5)
      .attr("d", (d3.area() as any)
        .x((d: any) => x(new Date(d.date)))
        .y0(y(0))
        .y1((d: any) => y(d.cumulative))
      );

    // X Axis
    const tickCount = width < 400 ? 3 : width < 600 ? 5 : undefined;
    svg.append("g")
      .attr("transform", `translate(0,${height - margin.top - margin.bottom})`)
      .call(d3.axisBottom(x)
        .ticks(tickCount)
        .tickFormat(d => {
          // D3 time scale uses Date objects for ticks.
          // We want YYYY-MM-DD local string if possible, or just YYYY if not enough space?
          // Actually user asked for YYYY-MM-DD.
          // But for Axis labels, YYYY is usually better for long history.
          // Let's stick to YYYY for Axis as per original code, but Tooltip MUST be YYYY-MM-DD.
          return d3.timeFormat("%Y")(d as Date);
        }));

    // Y Axis
    svg.append("g").call(d3.axisLeft(y));

    // Title - MOVED TO HTML ABOVE

    // --- Interactive Tooltip ---

    // Focus indicator (Circle + Line)
    const focus = svg.append("g")
      .attr("class", "focus")
      .style("display", "none");

    focus.append("circle")
      .attr("r", 5)
      .attr("fill", "#69b3a2")
      .attr("stroke", "#fff")
      .attr("stroke-width", 2);

    // Detailed Tooltip - Append to BODY to avoid clipping
    // Remove existing if any
    d3.select("body").selectAll(".tag-analytics-tooltip").remove();

    const tooltip = d3.select("body")
      .append("div")
      .attr("class", "tag-analytics-tooltip")
      .style("position", "absolute")
      .style("z-index", "11000") // Corrected Z-Index (Higher than modal)
      .style("background", "rgba(0, 0, 0, 0.8)")
      .style("color", "#fff")
      .style("padding", "8px")
      .style("border-radius", "4px")
      .style("font-size", "12px")
      .style("pointer-events", "none")
      .style("opacity", 0)
      .style("transition", "opacity 0.2s");

    // Overlay recto to capture events
    svg.append("rect")
      .attr("class", "overlay")
      .attr("width", width - margin.left - margin.right)
      .attr("height", height - margin.top - margin.bottom)
      .style("fill", "none")
      .style("pointer-events", "all")
      .on("mouseover", () => {
        focus.style("display", null);
        tooltip.style("opacity", 1);
      })
      .on("mouseout", () => {
        focus.style("display", "none");
        tooltip.style("opacity", 0);
      })
      .on("mousemove", (event) => {
        try {
          const bisectDate = d3.bisector((d: any) => new Date(d.date)).left;
          // Use pointer relative to SVG g element (which has margins)
          // But event is relative to page or viewport?
          // d3.pointer(event) returns [x, y] relative to current element
          const [mx] = d3.pointer(event);
          const x0 = x.invert(mx);

          const i = bisectDate(data, x0, 1);
          const d0 = data[i - 1];
          const d1 = data[i];

          let d = d0;
          if (d1 && d0) {
            const date0 = new Date(d0.date);
            const date1 = new Date(d1.date);
            d = ((x0 as any) - date0.getTime() > date1.getTime() - (x0 as any)) ? d1 : d0;
          } else if (d1) {
            d = d1;
          }

          if (!d) return;

          const dateObj = new Date(d.date);
          const dateStr = dateObj.toLocaleDateString('en-CA');

          focus.attr("transform", `translate(${x(dateObj)},${y(d.cumulative)})`);

          // Smart layout for tooltip
          let left = event.pageX + 15;
          let top = event.pageY - 28;

          if (left + 150 > document.documentElement.clientWidth) {
            left = event.pageX - 160;
          }

          tooltip
            .html(`<strong>${dateStr}</strong><br>Cumulative: ${d.cumulative.toLocaleString()}`)
            .style("left", left + "px")
            .style("top", top + "px");
        } catch (e) {
          // console.warn(e);
        }
      });
  }


  renderRankingColumn(title: string, data: any[], role: string, tagName: string, userNames: Record<string, any>, limitId: string | number | null = null): string {
    if (!data || data.length === 0) {
      return `
          <div class="di-card-sm">
              <h4 style="margin: 0 0 10px 0; font-size: 0.9em; color: #555; text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 5px;">${title}</h4>
              <div style="text-align: center; color: #999; font-size: 0.8em; padding: 20px 0;">No Data</div>
          </div>`;
    }

    const maxCount = Math.max(...data.map((u: any) => u.count || u.post_count || 0));

    const list = data.slice(0, 10).map((u: any, i: number) => {
      let nameHtml = 'Unknown';
      const name = u.name || `user_${u.id} `;
      // Normalize name: replace spaces with underscores for search query
      const normalizedName = name.replace(/ /g, '_');

      // Level Lookup: Check object first, then instance cache (ID -> Object), then instance cache (Name -> Object)
      const userCached = userNames[String(u.id)] || userNames[name];
      const level = u.level || (userCached && typeof userCached === 'object' ? userCached.level : null);
      const userClass = getLevelClass(level);

      let query = '';
      if (role && tagName) {
        // user:name+tag or approver:name+tag
        // "uploader" -> "user", "approver" -> "approver"
        const queryRole = role === 'uploader' ? 'user' : role;
        query = `${queryRole}:${normalizedName} ${tagName} `;
        if (limitId) {
          query += `id:..${limitId} `;
        }
      }

      const safeName = escapeHtml(name);
      if (query) {
        nameHtml = `<a href="/posts?tags=${encodeURIComponent(query)}" target="_blank" class="di-ranking-username ${userClass}" style="text-decoration: none;">${safeName}</a>`;
      } else if (u.id) {
        // Fallback
        nameHtml = `<a href="/users/${u.id}" target="_blank" class="di-ranking-username ${userClass}" style="text-decoration: none;">${safeName}</a>`;
      } else {
        nameHtml = `<span class="di-ranking-username ${userClass}" style="cursor: default;">${safeName}</span>`;
      }

      const count = u.count || u.post_count || 0;
      const percentage = maxCount > 0 ? (count / maxCount) * 100 : 0;

      return `
          <div style="display: flex; justify-content: space-between; font-size: 0.85em; padding: 3px 5px; border-bottom: 1px solid #f5f5f5; background: linear-gradient(90deg, rgba(0,0,0,0.06) ${percentage}%, transparent ${percentage}%);">
              <span style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 140px;" title="${safeName}">${i + 1}. ${nameHtml}</span>
              <span style="color: #666; font-weight: bold;">${count}</span>
          </div>`;
    }).join('');

    return `
      <div class="di-card-sm">
          <h4 style="margin: 0 0 10px 0; font-size: 0.9em; color: #555; text-align: center; border-bottom: 1px solid #ddd; padding-bottom: 5px;">${title}</h4>
          <div>${list}</div>
      </div>`;
  }

  updateRankingTabs(role: string, tagData: any, userNames: Record<string, any>): void {
    const container = document.getElementById('ranking-container');
    if (!container || !tagData.rankings || !tagData.rankings[role]) return;

    const rData = tagData.rankings[role];
    console.log('[TagAnalytics] updateRankingTabs - hundredthPost:', tagData.hundredthPost);
    const limitId = tagData.hundredthPost ? tagData.hundredthPost.id : null;

    container.innerHTML = `
          ${this.renderRankingColumn('All-time', rData.allTime, role, tagData.name, userNames)}
          ${this.renderRankingColumn('Last 1 Year', rData.year, role, tagData.name, userNames)}
          ${this.renderRankingColumn('First 100 Post', rData.first100, role, tagData.name, userNames, limitId)}
`;
  }
}
