/**
 * @fileoverview Authentication Manager
 * Handles storage and retrieval of GitHub Personal Access Tokens and Gist IDs.
 */
export declare class AuthManager {
    private static KEY;
    private static GIST_ID_KEY;
    /**
     * Retrieves the stored Personal Access Token.
     * @param silent - If true, suppresses any potential prompts (logic removed, but parameter kept for API compatibility).
     * @returns {Promise<string | null>} The token or null if not found.
     */
    static getToken(silent?: boolean): Promise<string | null>;
    /**
     * Saves the Personal Access Token to secure storage.
     * @param token - The token string (e.g. ghp_...).
     */
    static setToken(token: string): Promise<void>;
    /**
     * Retrieves the stored Gist ID used for synchronization.
     * @returns {string | null} The Gist ID.
     */
    static getGistId(): string | null;
    /**
     * Saves the Gist ID to storage.
     * @param id - The Gist ID.
     */
    static setGistId(id: string): void;
    /**
     * Clears all authentication data (Token and Gist ID).
     */
    static clearAuth(): void;
}
