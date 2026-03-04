import type {TargetUser} from '../types';

/**
 * Manages the context of the current profile page.
 * Extracts and provides user information from the DOM.
 */
export class ProfileContext {
  targetUser: TargetUser | null;

  /**
   * Initializes the profile context and attempts to fetch target user info.
   */
  constructor() {
    try {
      this.targetUser = this.getTargetUserInfo();
    } catch (e) {
      console.error('[Danbooru Grass] Context Init Failed:', e);
      this.targetUser = null;
    }
  }

  /**
   * Extracts target user information from the DOM.
   * Scrapes the user's name, ID, and join date from various elements.
   * @return {?TargetUser} User info or null if unavailable.
   * @private
   */
  getTargetUserInfo(): TargetUser | null {
    let name = null;
    let id = null;
    let joinDate = new Date().toISOString();

    try {
      // --- 1. Extract Name ---
      const titleMatch = document.title.match(/^User: (.+?) \|/);
      if (titleMatch) {
        name = titleMatch[1];
      }

      if (!name) {
        const h1 = document.querySelector('h1');
        if (h1) name = h1.textContent.trim().replace(/^User: /, '');
      }

      // --- 2. Extract ID ---
      const urlMatch = window.location.pathname.match(/^\/users\/(\d+)/);
      if (urlMatch) {
        id = urlMatch[1];
      }

      if (!id && name) {
        const messagesLink = document.querySelector(
          'a[href*="/messages?search%5Bto_user_id%5D="]'
        );
        if (messagesLink) {
          const match = (messagesLink as HTMLAnchorElement).href.match(/to_user_id%5D=(\d+)/);
          if (match) id = match[1];
        }
      }

      // Look for "My Account" if we are on our own profile
      if (!id && window.location.pathname === '/profile') {
        const editLink = document.querySelector(
          'a[href^="/users/"][href$="/edit"]'
        );
        if (editLink) {
          const m = editLink.getAttribute('href').match(/\/users\/(\d+)\/edit/);
          if (m) id = m[1];
        }
      }

      // Scrape generic user links that match the name
      if (!id && name) {
        const userLinks = Array.from(document.querySelectorAll('a[href^="/users/"]'));
        for (const link of userLinks) {
          const m = link.getAttribute('href').match(/\/users\/(\d+)(?:\?|$)/);
          if (m && link.textContent.trim() === name) {
            id = m[1];
            break;
          }
        }
      }

      // --- 3. Extract Join Date ---
      const cells = Array.from(document.querySelectorAll('th, td'));
      const joinHeader = cells.find((el) => el.textContent.trim() === 'Join Date');

      if (joinHeader) {
        const valEl = joinHeader.nextElementSibling;
        if (valEl) {
          const timeEl = valEl.querySelector('time');
          if (timeEl) {
            joinDate = timeEl.getAttribute('datetime') || timeEl.textContent.trim();
          } else {
            joinDate = valEl.textContent.trim();
          }
        }
      }

      // --- 4. Extract Level ---
      let level_string = null;
      const levelHeader = cells.find((el) => el.textContent.trim() === 'Level');
      if (levelHeader) {
        const valEl = levelHeader.nextElementSibling;
        if (valEl) {
          level_string = valEl.textContent.trim();
        }
      }

      if (!name) return null;
      if (!id) {
        console.warn('[Danbooru Grass] User ID not found. Functionality may be limited (Notes).');
      }

      return {
        name,
        normalizedName: name.replace(/ /g, '_'),
        id,
        created_at: joinDate,
        joinDate: new Date(joinDate),
        level_string
      };

    } catch (e) {
      console.warn('[Danbooru Grass] Extraction error:', e);
      return null;
    }
  }

  /**
   * Checks if the current page is a valid profile page.
   * @return {boolean} True if valid.
   */
  isValidProfile(): boolean {
    if (!this.targetUser || !this.targetUser.name) return false;

    // Strict URL Check: Only main profile pages
    const path = window.location.pathname;
    const isProfileUrl = path === '/profile' || /^\/users\/\d+$/.test(path);

    return isProfileUrl;
  }
}
