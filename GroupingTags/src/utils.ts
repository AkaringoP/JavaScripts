
/**
 * Generates a consistent HSL color from a given string (e.g. group name).
 * Uses a simple hash function to determine the Hue, while keeping Saturation and Lightness
 * optimized for readability depending on the theme (Dark/Light).
 * 
 * @param str The input string to hash (e.g., "GroupName").
 * @param isDark If true, generates lighter pastels suitable for dark backgrounds. If false, generates darker colors for light backgrounds.
 * @returns A CSS color string in `hsl(h, s%, l%)` format.
 */
export function stringToColor(str: string, isDark: boolean): string {
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
 * Detects if the current page is using a dark theme by checking the body's background color brightness.
 * Calculates luminance using the standard formula: `0.299*R + 0.587*G + 0.114*B`.
 * 
 * @returns `true` if the background is dark (brightness < 128), `false` otherwise.
 */
export function detectDarkTheme(): boolean {
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
 * Retrieves the current Post ID from the URL or the Form Action attribute.
 * Supports standard Danbooru URL usage (e.g., `/posts/12345`) and upload forms.
 * 
 * @returns The Post ID as a number, or `null` if not found.
 */
export function getPostId(): number | null {
    // Option 1: URL (e.g., /posts/12345)
    const match = window.location.pathname.match(/\/posts\/(\d+)/);
    if (match) {
        return parseInt(match[1], 10);
    }

    // Option 2: Form action (Common on Edit pages)
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
