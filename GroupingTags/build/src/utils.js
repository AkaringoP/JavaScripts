/**
 * Generates a consistent HSL color from a string.
 * @param str The input string (e.g. group name)
 * @param isDark Whether to generate colors optimized for dark theme
 */
export function stringToColor(str, isDark) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash % 360);
    const saturation = isDark ? 75 : 65;
    const lightness = isDark ? 75 : 40;
    return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
/**
 * Detects if the current page is using a dark theme based on body background.
 */
export function detectDarkTheme() {
    const bg = window.getComputedStyle(document.body).backgroundColor;
    const rgb = bg.match(/\d+/g);
    if (rgb) {
        const r = parseInt(rgb[0]);
        const g = parseInt(rgb[1]);
        const b = parseInt(rgb[2]);
        return ((r * 299 + g * 587 + b * 114) / 1000) < 128;
    }
    return false;
}
/**
 * Helper to get Post ID from URL or Form Action
 */
export function getPostId() {
    // Option 1: URL (e.g., /posts/12345)
    const match = window.location.pathname.match(/\/posts\/(\d+)/);
    if (match) {
        return parseInt(match[1], 10);
    }
    // Option 2: Form action
    const form = document.querySelector('form#form');
    if (form) {
        const action = form.getAttribute('action');
        const actionMatch = action?.match(/\/posts\/(\d+)/);
        if (actionMatch) {
            return parseInt(actionMatch[1], 10);
        }
    }
    return null;
}
//# sourceMappingURL=utils.js.map