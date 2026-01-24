/**
 * Generates a consistent HSL color from a string.
 * @param str The input string (e.g. group name)
 * @param isDark Whether to generate colors optimized for dark theme
 */
export declare function stringToColor(str: string, isDark: boolean): string;
/**
 * Detects if the current page is using a dark theme based on body background.
 */
export declare function detectDarkTheme(): boolean;
/**
 * Helper to get Post ID from URL or Form Action
 */
export declare function getPostId(): number | null;
