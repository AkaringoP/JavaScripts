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

  // Golden Ratio Hue (Even Distribution)
  // Using the golden ratio conjugate (0.618...) to separate sequential/similar hashes widely
  const goldenRatio = 0.618033988749895;

  // Ensure positive integer for calculation
  const seed = Math.abs(hash);

  // Hue: Multiply by golden ratio and take fractional part -> Map to 0-360
  const hue = Math.floor(((seed * goldenRatio) % 1) * 360);

  // Add slight variation to Saturation/Lightness based on hash to help distinguish close hues
  const sVar = (seed % 20) - 10; // +/- 10%
  const lVar = (seed % 10) - 5; // +/- 5%

  const saturation = (isDark ? 70 : 65) + sVar;
  const lightness = (isDark ? 70 : 45) + lVar;

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
    return (r * 299 + g * 587 + b * 114) / 1000 < 128;
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

/**
 * Displays a simple toast notification at the bottom of the screen.
 *
 * @param message The message to display.
 * @param type The type of toast ('info' | 'error'). Defaults to 'info'.
 * @param duration Duration in milliseconds. Defaults to 3000ms.
 */
export function showToast(
  message: string,
  type: 'info' | 'error' = 'info',
  duration = 3000,
) {
  const toast = document.createElement('div');
  toast.textContent = message;

  // Basic Styles
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '20px',
    left: '50%',
    transform: 'translateX(-50%) translateY(20px)',
    backgroundColor: type === 'error' ? '#d32f2f' : '#323232',
    color: '#fff',
    padding: '10px 20px',
    borderRadius: '4px',
    fontSize: '14px',
    boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
    opacity: '0',
    transition: 'transform 0.3s, opacity 0.3s',
    zIndex: '10000',
    pointerEvents: 'none',
  });

  document.body.appendChild(toast);

  // Animate In
  requestAnimationFrame(() => {
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
  });

  // Remove after duration
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(-50%) translateY(20px)';
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, duration);
}
