/**
 * Generates a consistent HSL color from a given string (e.g. group name).
 * Uses a simple hash function to determine the Hue, while keeping Saturation and Lightness
 * optimized for readability depending on the theme (Dark/Light).
 *
 * @param str The input string to hash (e.g., "GroupName").
 * @param isDark If true, generates lighter pastels suitable for dark backgrounds. If false, generates darker colors for light backgrounds.
 * @returns A CSS color string in `hsl(h, s%, l%)` format.
 */
export declare function stringToColor(str: string, isDark: boolean): string;
/**
 * Detects if the current page is using a dark theme by checking the body's background color brightness.
 * Calculates luminance using the standard formula: `0.299*R + 0.587*G + 0.114*B`.
 *
 * @returns `true` if the background is dark (brightness < 128), `false` otherwise.
 */
export declare function detectDarkTheme(): boolean;
/**
 * Retrieves the current Post ID from the URL or the Form Action attribute.
 * Supports standard Danbooru URL usage (e.g., `/posts/12345`) and upload forms.
 *
 * @returns The Post ID as a number, or `null` if not found.
 */
export declare function getPostId(): number | null;
