interface GMRequestOptions {
    method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
    headers?: Record<string, string>;
    body?: string;
}
/**
 * Wrapper for GM_xmlhttpRequest to mimic portions of the standard fetch API.
 * Bypasses CORS restrictions.
 */
export declare function gmFetch(url: string, options?: GMRequestOptions): Promise<any>;
export {};
