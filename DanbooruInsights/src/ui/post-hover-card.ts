import {getBestThumbnailUrl} from '../utils';

/**
 * Reusable hover preview card for post lists (scatter popover, approval popover).
 *
 * Behavior:
 * - On `mouseenter`, schedules a fetch after a 100 ms debounce window.
 * - If the mouse leaves before 100 ms, the fetch is cancelled (never sent).
 * - Fetched details are cached in-memory by post id, so re-hovering an
 *   already-seen post is instant.
 * - Card is positioned next to the cursor, viewport-clamped, and dismissed
 *   on `mouseleave` from the trigger element.
 * - Disabled on touch devices (caller is responsible for not attaching).
 */

interface PostDetails {
  id: number;
  created_at?: string;
  score?: number;
  fav_count?: number;
  rating?: string;
  tag_string_artist?: string;
  tag_string_copyright?: string;
  tag_string_character?: string;
  preview_file_url?: string;
  file_url?: string;
  variants?: any[];
}

type PostFetcher = (postId: number) => Promise<PostDetails | null>;

const isTouchDevice = (): boolean =>
  'ontouchstart' in window || navigator.maxTouchPoints > 0;

const cardId = 'di-post-hover-card';
const cache = new Map<number, PostDetails>();
const inFlight = new Map<number, Promise<PostDetails | null>>();

const RATING_LABELS: Record<string, string> = {
  g: 'General',
  s: 'Sensitive',
  q: 'Questionable',
  e: 'Explicit',
};

const ensureCard = (): HTMLElement => {
  let el = document.getElementById(cardId);
  if (el) return el;
  el = document.createElement('div');
  el.id = cardId;
  el.style.cssText = [
    'position: absolute',
    'background: #fff',
    'border: 1px solid #d0d7de',
    'border-radius: 8px',
    'box-shadow: 0 6px 20px rgba(0,0,0,0.18)',
    'padding: 10px',
    'width: 300px',
    'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    'font-size: 12px',
    'color: #333',
    'pointer-events: none',
    'z-index: 100000',
    'display: none',
  ].join(';');
  document.body.appendChild(el);
  return el;
};

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  } as Record<string, string>)[ch]!);

const firstTag = (tagString?: string): string => {
  if (!tagString) return '';
  const first = tagString.split(' ').find(t => t.length > 0);
  return first ? first.replace(/_/g, ' ') : '';
};

const buildCardHtml = (post: PostDetails): string => {
  const thumb = getBestThumbnailUrl(post) || post.preview_file_url || '';
  const dateStr = post.created_at ? post.created_at.slice(0, 10) : '?';
  const score = post.score ?? '?';
  const favs = post.fav_count ?? '?';
  const rating = post.rating ? (RATING_LABELS[post.rating] ?? post.rating) : '?';
  const artist = firstTag(post.tag_string_artist);
  const copyright = firstTag(post.tag_string_copyright);
  const character = firstTag(post.tag_string_character);

  const tagLine = (icon: string, label: string, value: string) => value
    ? `<div style="font-size:11px;color:#444;"><strong>${icon} ${label}:</strong> ${escapeHtml(value)}</div>`
    : '';

  const tagsBlock = (artist || copyright || character)
    ? `<div style="margin-top:6px;border-top:1px solid #eee;padding-top:6px;display:flex;flex-direction:column;gap:2px;">
        ${tagLine('🎨', 'Artist', artist)}
        ${tagLine('©', 'Copy', copyright)}
        ${tagLine('👤', 'Char', character)}
      </div>`
    : '';

  return `
    <div style="display:flex;gap:10px;align-items:flex-start;">
      <div style="width:80px;height:80px;flex-shrink:0;background:#eee;border-radius:4px;overflow:hidden;">
        ${thumb ? `<img src="${escapeHtml(thumb)}" style="width:100%;height:100%;object-fit:cover;">` : ''}
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:bold;color:#0969da;font-size:13px;">Post #${post.id}</div>
        <div style="font-size:11px;color:#555;line-height:1.5;margin-top:2px;">
          📅 ${dateStr}<br>
          ❤️ Score: <strong>${score}</strong><br>
          ⭐ Favs: <strong>${favs}</strong><br>
          🤔 Rating: <strong>${rating}</strong>
        </div>
      </div>
    </div>
    ${tagsBlock}
  `;
};

const positionCard = (
  card: HTMLElement,
  anchor: HTMLElement,
  positionRef: HTMLElement
) => {
  // The card is positioned next to the *positionRef* element (typically the
  // enclosing popover), not the small list item itself. This keeps the card
  // from overlapping the list and matches user expectation that the preview
  // floats next to the popup.
  const refRect = positionRef.getBoundingClientRect();
  const anchorRect = anchor.getBoundingClientRect();

  card.style.display = 'block';
  const cardRect = card.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const margin = 8;
  const gap = 10;

  // Vertical: align card top with hovered item, but clamp to viewport
  let top = anchorRect.top + window.scrollY;
  if (top + cardRect.height > window.scrollY + vh - margin) {
    top = window.scrollY + vh - cardRect.height - margin;
  }
  if (top < window.scrollY + margin) top = window.scrollY + margin;

  // Horizontal: prefer the side of the popover that has more room
  const spaceRight = vw - refRect.right;
  const spaceLeft = refRect.left;
  let left: number;
  if (spaceRight >= cardRect.width + gap + margin) {
    // Fit on the right
    left = refRect.right + window.scrollX + gap;
  } else if (spaceLeft >= cardRect.width + gap + margin) {
    // Fit on the left
    left = refRect.left + window.scrollX - cardRect.width - gap;
  } else {
    // Neither side has enough room — pick whichever has more, then clamp
    if (spaceRight >= spaceLeft) {
      left = refRect.right + window.scrollX + gap;
    } else {
      left = refRect.left + window.scrollX - cardRect.width - gap;
    }
  }

  // Final clamp so the card never escapes the viewport horizontally
  const minLeft = window.scrollX + margin;
  const maxLeft = window.scrollX + vw - cardRect.width - margin;
  if (left < minLeft) left = minLeft;
  if (left > maxLeft) left = maxLeft;

  card.style.left = `${left}px`;
  card.style.top = `${top}px`;
};

const fetchWithCache = async (
  postId: number,
  fetcher: PostFetcher
): Promise<PostDetails | null> => {
  const cached = cache.get(postId);
  if (cached) return cached;

  const pending = inFlight.get(postId);
  if (pending) return pending;

  const promise = (async () => {
    const result = await fetcher(postId);
    if (result) cache.set(postId, result);
    inFlight.delete(postId);
    return result;
  })();
  inFlight.set(postId, promise);
  return promise;
};

/**
 * Attaches hover preview behavior to a single element.
 *
 * @param el The trigger element (e.g. a list item or anchor)
 * @param postId The post id to fetch details for
 * @param fetcher Function that returns post details for a given id
 * @param positionRef Optional element to position the card next to instead
 *   of `el` itself. Use the enclosing popover so the card doesn't overlap
 *   the list it was triggered from.
 */
export function attachPostHoverCard(
  el: HTMLElement,
  postId: number,
  fetcher: PostFetcher,
  positionRef?: HTMLElement
): void {
  if (isTouchDevice()) return;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let currentToken = 0;

  const hide = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    currentToken++; // invalidate any in-flight result
    const card = document.getElementById(cardId);
    if (card) card.style.display = 'none';
  };

  el.addEventListener('mouseenter', () => {
    if (debounceTimer) clearTimeout(debounceTimer);
    const token = ++currentToken;
    debounceTimer = setTimeout(async () => {
      debounceTimer = null;
      const details = await fetchWithCache(postId, fetcher);
      // Bail out if a newer hover happened, or mouse already left
      if (token !== currentToken) return;
      if (!details) return;
      const card = ensureCard();
      card.innerHTML = buildCardHtml(details);
      positionCard(card, el, positionRef ?? el);
    }, 100);
  });

  el.addEventListener('mouseleave', hide);
}

/** Hides any visible hover card. Useful when a popover closes. */
export function hidePostHoverCard(): void {
  const card = document.getElementById(cardId);
  if (card) card.style.display = 'none';
}
