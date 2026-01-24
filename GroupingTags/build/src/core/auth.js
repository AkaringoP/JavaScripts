/**
 * @fileoverview Authentication Manager
 * Handles storage and retrieval of GitHub Personal Access Tokens and Gist IDs.
 */
import { GM_getValue, GM_setValue, GM_deleteValue } from '$';
export class AuthManager {
    static KEY = 'github_gist_token';
    static GIST_ID_KEY = 'my_gist_id';
    /**
     * Retrieves the stored Personal Access Token.
     * @param silent - If true, suppresses any potential prompts (logic removed, but parameter kept for API compatibility).
     * @returns {Promise<string | null>} The token or null if not found.
     */
    static async getToken(silent = false) {
        let token = GM_getValue(this.KEY, null);
        return token;
    }
    /**
     * Saves the Personal Access Token to secure storage.
     * @param token - The token string (e.g. ghp_...).
     */
    static async setToken(token) {
        await GM_setValue(this.KEY, token);
    }
    /**
     * Retrieves the stored Gist ID used for synchronization.
     * @returns {string | null} The Gist ID.
     */
    static getGistId() {
        return GM_getValue(this.GIST_ID_KEY, null);
    }
    /**
     * Saves the Gist ID to storage.
     * @param id - The Gist ID.
     */
    static setGistId(id) {
        GM_setValue(this.GIST_ID_KEY, id);
    }
    /**
     * Clears all authentication data (Token and Gist ID).
     */
    static clearAuth() {
        GM_deleteValue(this.KEY);
        GM_deleteValue(this.GIST_ID_KEY);
    }
}
//# sourceMappingURL=auth.js.map