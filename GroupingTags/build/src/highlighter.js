export class SyntaxHighlighter {
    input;
    container;
    backdrop;
    highlights;
    isBound = false;
    constructor(selector) {
        this.input = document.querySelector(selector);
        if (this.input) {
            this.init();
        }
        else {
            console.warn(`SyntaxHighlighter: Element not found for selector "${selector}"`);
        }
    }
    init() {
        if (this.isBound)
            return;
        // 1. Create Wrapper (Container)
        this.container = document.createElement('div');
        this.container.className = 'grouping-tags-highlighter-container';
        // Insert container before input, then move input inside
        if (this.input.parentNode) {
            this.input.parentNode.insertBefore(this.container, this.input);
        }
        this.container.appendChild(this.input);
        // 2. Create Backdrop & Highlights
        this.backdrop = document.createElement('div');
        this.backdrop.className = 'grouping-tags-backdrop';
        this.highlights = document.createElement('div');
        this.highlights.className = 'grouping-tags-highlights';
        this.backdrop.appendChild(this.highlights);
        this.container.insertBefore(this.backdrop, this.input);
        // 3. Inject CSS
        this.injectStyles();
        // 4. Sync Styles & Scroll
        this.syncStyles();
        // 5. Bind Events
        this.input.addEventListener('input', () => this.update());
        this.input.addEventListener('scroll', () => this.syncScroll());
        // Handle resize if possible (ResizeObserver is best)
        new ResizeObserver(() => {
            this.syncStyles();
            this.syncScroll();
        }).observe(this.input);
        this.update();
        this.isBound = true;
        console.log('SyntaxHighlighter: Initialized.');
    }
    injectStyles() {
        const style = document.createElement('style');
        style.textContent = `
            .grouping-tags-highlighter-container {
                position: relative;
                width: 100%;
            }

            .grouping-tags-backdrop {
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                pointer-events: none;
                z-index: 0;
                overflow: hidden;
                background-color: transparent; 
                white-space: pre-wrap;
                word-wrap: break-word;
            }

            .grouping-tags-highlights {
                color: inherit; /* Allow inheriting color from backdrop */
                white-space: pre-wrap;
                word-wrap: break-word;
            }

            /* Make textarea text transparent? 
               Standard technique: Input has color: transparent, caret-color: black.
               But we need to ensure the Input is ON TOP.
            */
            textarea.transparent-text {
                color: transparent !important;
                caret-color: white; /* Will be overridden by syncStyles hopefully */
                background-color: transparent !important;
                z-index: 1;
                position: relative;
            }
        `;
        document.head.appendChild(style);
    }
    syncStyles() {
        const computed = window.getComputedStyle(this.input);
        this.container.style.width = computed.width;
        this.backdrop.style.fontFamily = computed.fontFamily;
        this.backdrop.style.fontSize = computed.fontSize;
        this.backdrop.style.fontWeight = computed.fontWeight;
        this.backdrop.style.lineHeight = computed.lineHeight;
        this.backdrop.style.padding = computed.padding;
        this.backdrop.style.border = computed.border;
        this.backdrop.style.boxSizing = computed.boxSizing;
        this.backdrop.style.letterSpacing = computed.letterSpacing;
        this.backdrop.style.textIndent = computed.textIndent;
        // this.backdrop.style.whiteSpace = computed.whiteSpace; // usually pre-wrap
        // Sync Colors
        this.backdrop.style.backgroundColor = computed.backgroundColor;
        this.backdrop.style.color = computed.color;
        this.input.classList.add('transparent-text');
        // Determine caret color based on theme logic or computed color
        if (computed.color && computed.color !== 'rgba(0, 0, 0, 0)' && computed.color !== 'transparent') {
            this.input.style.caretColor = computed.color;
        }
        else {
            this.input.style.caretColor = 'white'; // Fallback
        }
    }
    syncScroll() {
        this.backdrop.scrollTop = this.input.scrollTop;
        this.backdrop.scrollLeft = this.input.scrollLeft;
    }
    update() {
        const text = this.input.value;
        // Tokenize by regex match locations, build result string.
        const regex = /([^\s\[]+\[)|(\])/g;
        let lastIndex = 0;
        let match;
        let html = '';
        const colorStack = [];
        while ((match = regex.exec(text)) !== null) {
            // Append text before match (escaped)
            const plainText = text.substring(lastIndex, match.index);
            html += this.escapeHtml(plainText);
            if (match[1]) {
                // Opening Bracket: "groupName["
                const token = match[1]; // e.g. "reze["
                const groupName = token.slice(0, -1); // remove '['
                const color = this.stringToColor(groupName);
                colorStack.push(color);
                html += `<span style="color: ${color}; font-weight: bold;">${this.escapeHtml(token)}</span>`;
            }
            else if (match[2]) {
                // Closing Bracket: "]"
                const token = match[2];
                const color = colorStack.pop() || '#ccc'; // Default if unbalanced
                html += `<span style="color: ${color}; font-weight: bold;">${this.escapeHtml(token)}</span>`;
            }
            lastIndex = regex.lastIndex;
        }
        // Append remaining text
        html += this.escapeHtml(text.substring(lastIndex));
        // Handle specific newline issues for empty lines at end
        if (text.endsWith('\n')) {
            html += '<br>';
        }
        this.highlights.innerHTML = html;
    }
    escapeHtml(text) {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    stringToColor(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = str.charCodeAt(i) + ((hash << 5) - hash);
        }
        // HSL for better visibility control (high saturation, medium lightness)
        const h = Math.abs(hash % 360);
        return `hsl(${h}, 80%, 75%)`; // 75% lightness for better readability on dark bg
    }
}
//# sourceMappingURL=highlighter.js.map