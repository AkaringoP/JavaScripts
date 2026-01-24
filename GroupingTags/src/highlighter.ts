import { stringToColor, detectDarkTheme } from './utils';

/**
 * SyntaxHighlighter
 * 
 * Provides syntax highlighting for the `Group[ ... ]` syntax by overlaying a
 * customized "Backdrop" element behind the transparent Textarea.
 * 
 * **Mechanism**:
 * 1. Creates a container wrapping the textarea.
 * 2. Inserts a backdrop div behind the textarea.
 * 3. Syncs font, size, padding, and scroll position perfectly.
 * 4. Parses the text and injects colored HTML spans into the backdrop.
 * 
 * **Features**:
 * - **Phantom Mode**: Fades out the text and shows the backdrop when idle to provide beautiful highlighting without affecting typing performance.
 * - **Active Mode**: Shows the raw text while typing for maximum responsiveness.
 */
export class SyntaxHighlighter {
  private textarea!: HTMLTextAreaElement;
  private container!: HTMLElement;
  private backdrop!: HTMLElement;
  private debounceTimer: number | null = null;
  private idleTimer: number | null = null;
  private readonly IDLE_DELAY = 2000; // 2 seconds

  constructor(selector: string) {
    const input = document.querySelector(selector) as HTMLTextAreaElement;
    if (!input) return;

    this.textarea = input;
    this.init();
  }

  private init() {
    if (this.textarea.parentElement?.classList.contains('gh-container')) return;

    // 1. Create DOM Structure
    this.container = document.createElement('div');
    this.container.className = 'gh-container';

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'gh-backdrop';

    const parent = this.textarea.parentElement;
    if (parent) {
      parent.insertBefore(this.container, this.textarea);
      this.container.appendChild(this.backdrop);
      this.container.appendChild(this.textarea);
    }

    // 2. Inject and Sync Styles
    this.injectStyles();
    this.syncStyles();

    // 3. Event Listeners
    // Input: Update content and Reset Idle Timer
    this.textarea.addEventListener('input', () => {
      this.onInputDebounced();
      this.resetIdleTimer();
    });

    // Keyup: Detect missed updates, but ignore modifiers
    this.textarea.addEventListener('keyup', (e) => {
      this.onInputDebounced();
      this.resetIdleTimer(e);
    });

    // Change
    this.textarea.addEventListener('change', () => {
      this.onInputDebounced();
      this.resetIdleTimer();
    });

    // Scroll: Sync immediately
    this.textarea.addEventListener('scroll', () => this.syncScroll());

    // Resize: Resync styles
    new ResizeObserver(() => this.syncStyles()).observe(this.textarea);

    // Focus: Wake up immediately
    this.textarea.addEventListener('focus', () => {
      console.log('GroupingTags: Focus -> Wake Up');
      this.resetIdleTimer();
    });

    // Click/Mousedown: Wake up immediately (even if already focused)
    this.textarea.addEventListener('mousedown', () => {
      console.log('GroupingTags: Mousedown -> Wake Up');
      this.resetIdleTimer();
    });

    // Blur: Phantom Mode immediately (if valid)
    this.textarea.addEventListener('blur', () => {
      console.log('GroupingTags: Blur -> Phantom Mode');
      this.activatePhantomMode();
    });

    // Initial Render
    this.update();
    this.resetIdleTimer(); // Start in Active mode
    console.log('GroupingTags: Highlighter Initialized (Phantom Mode)');
  }

  private injectStyles() {
    const computed = window.getComputedStyle(this.textarea);

    const style = document.createElement('style');
    style.textContent = `
            .gh-container {
                position: relative;
                width: 100%;
                margin: 0; padding: 0;
                background-color: ${computed.backgroundColor};
                border-radius: ${computed.borderRadius};
                overflow: hidden;
            }

            .gh-backdrop {
                position: absolute;
                top: 0; left: 0;
                width: 100%; height: 100%;
                z-index: 1;
                pointer-events: none;
                overflow: hidden; 
                white-space: pre-wrap;
                word-wrap: break-word;
                box-sizing: border-box;
                color: #333;
                opacity: 0; /* Hidden by default (Active Mode) */
                transition: none; /* Instant hide when value changes to 0 */
            }

            /* Phantom Mode: Backdrop Visible */
            .gh-backdrop.gh-visible {
                opacity: 1;
                transition: opacity 0.8s ease-in-out; /* Gradual fade-in */
            }

            textarea.gh-input {
                position: relative;
                z-index: 2;
                background-color: transparent !important;
                /* Default: Text Visible (Active Mode) */
                color: inherit; 
                /* Removed base transition to ensure instant Wake Up */
            }

            /* Phantom Mode: Text Transparent */
            textarea.gh-input.gh-ghost {
                color: transparent !important;
                caret-color: transparent !important; /* Hide cursor in Idle */
                transition: color 0.8s ease-in-out; /* Gradual fade-out to ghost */
            }

            textarea.gh-input.gh-ghost::selection {
                background-color: rgba(0, 117, 255, 0.3);
                color: transparent;
            }
        `;
    document.head.appendChild(style);
    this.textarea.classList.add('gh-input');
  }

  private syncStyles() {
    const computed = window.getComputedStyle(this.textarea);
    const props = [
      'font-family', 'font-size', 'font-weight', 'font-style',
      'font-stretch', 'font-kerning', 'font-variant-ligatures',
      'line-height', 'letter-spacing', 'text-transform', 'text-indent',
      'text-rendering', 'tab-size',
      'word-spacing',
      'padding-top', 'padding-bottom', 'padding-left',
      'border-width', 'box-sizing'
    ];

    props.forEach(prop => {
      this.backdrop.style.setProperty(prop, computed.getPropertyValue(prop));
    });

    // Margin Handling
    this.container.style.marginTop = computed.marginTop;
    this.container.style.marginBottom = computed.marginBottom;
    this.container.style.marginLeft = computed.marginLeft;
    this.container.style.marginRight = computed.marginRight;

    this.textarea.style.margin = '0';
    this.backdrop.style.margin = '0';

    this.backdrop.style.textAlign = computed.textAlign;
    this.backdrop.style.whiteSpace = 'pre-wrap';
    this.backdrop.style.wordBreak = 'break-word';
    this.container.style.backgroundColor = computed.backgroundColor;

    // Scrollbar Compensation
    const borderLeft = parseFloat(computed.borderLeftWidth) || 0;
    const borderRight = parseFloat(computed.borderRightWidth) || 0;
    const padRight = parseFloat(computed.paddingRight) || 0;

    const scrollbarWidth = this.textarea.offsetWidth - this.textarea.clientWidth - borderLeft - borderRight;

    if (scrollbarWidth > 0) {
      this.backdrop.style.paddingRight = `${padRight + scrollbarWidth}px`;
    } else {
      this.backdrop.style.paddingRight = `${padRight}px`;
    }

    // Theme Handling
    const isDark = detectDarkTheme();
    const textColor = isDark ? '#eee' : '#333';
    const caretColor = isDark ? '#fff' : '#000';

    this.backdrop.style.color = textColor;

    // Ensure textarea text color matches theme in Active Mode
    this.textarea.style.color = textColor;
    this.textarea.style.caretColor = caretColor;
  }

  private syncScroll() {
    this.backdrop.scrollTop = this.textarea.scrollTop;
    this.backdrop.scrollLeft = this.textarea.scrollLeft;
  }

  private onInputDebounced() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = window.setTimeout(() => {
      this.update();
      this.debounceTimer = null;
    }, 30);
  }

  // --- PHANTOM MODE LOGIC ---

  private resetIdleTimer(e?: KeyboardEvent) {
    // Prevent flicker on modifier keys (Ctrl, Alt, Shift, Meta)
    // If user is just holding Ctrl+C, we don't want to wake up.
    // Wake up only on actual content changes or navigation.
    if (e) {
      // Ignore modifier keys themselves
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return;
      // Ignore combinations (e.g. Ctrl+C)
      // Note: Ctrl+V will trigger 'input' event, which calls this without event, so it WILL wake up.
      if (e.ctrlKey || e.altKey || e.metaKey) return;
    }

    // 1. Switch to Active Mode immediately
    this.textarea.classList.remove('gh-ghost');
    this.backdrop.classList.remove('gh-visible');

    // 2. Reset Timer
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => {
      this.activatePhantomMode();
    }, this.IDLE_DELAY);
  }

  private activatePhantomMode() {
    console.log('GroupingTags: Activating Phantom Mode (Idle)');
    this.update();
    this.textarea.classList.add('gh-ghost');
    this.backdrop.classList.add('gh-visible');
  }

  // --------------------------

  /**
   * Parsing Logic: Recursive / Stack-based for proper nesting
   */
  private update() {
    const text = this.textarea.value;
    const html = this.parseText(text);

    this.backdrop.innerHTML = text.endsWith('\n') ? html + ' <br>' : html;
    this.syncScroll();
  }

  private parseText(text: string): string {
    const isDarkTheme = detectDarkTheme();
    let html = '';
    let i = 0;
    const len = text.length;

    // Escape helper
    const escapeHtml = (str: string) => str
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    while (i < len) {
      // Find start of a potential group: "Name["
      const openIdx = text.indexOf('[', i);

      if (openIdx === -1) {
        html += escapeHtml(text.slice(i));
        break;
      }

      // Check if there is a name before '['
      let nameStart = openIdx - 1;
      while (nameStart >= i && /\S/.test(text[nameStart]) && text[nameStart] !== '[') {
        nameStart--;
      }
      nameStart++;

      if (nameStart < openIdx && nameStart >= i) {
        // Append text before the group
        html += escapeHtml(text.slice(i, nameStart));

        const name = text.slice(nameStart, openIdx);

        // Find matching closing bracket with nesting support
        let depth = 1;
        let closeIdx = openIdx + 1;
        while (depth > 0 && closeIdx < len) {
          if (text[closeIdx] === '[') depth++;
          else if (text[closeIdx] === ']') depth--;
          if (depth > 0) closeIdx++;
        }

        if (depth === 0) {
          // Valid Group Found
          const contentValues = text.slice(openIdx + 1, closeIdx);

          const color = stringToColor(name, isDarkTheme);
          const style = `style="color: ${color}; font-weight: bold;"`;

          html += `<span ${style}>${escapeHtml(name)}</span>`;
          html += `<span ${style}>[</span>`;
          // NO RECURSION: Treat inner content as plain text (other tags)
          html += escapeHtml(contentValues);
          html += `<span ${style}>]</span>`;

          i = closeIdx + 1;
          continue;
        }
      }

      html += escapeHtml(text.slice(i, openIdx + 1));
      i = openIdx + 1;
    }

    return html;
  }
}