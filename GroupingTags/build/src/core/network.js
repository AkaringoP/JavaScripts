import { GM_xmlhttpRequest } from '$';
/**
 * Wrapper for GM_xmlhttpRequest to mimic portions of the standard fetch API.
 * Bypasses CORS restrictions.
 */
export function gmFetch(url, options = {}) {
    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method: options.method || 'GET',
            url: url,
            headers: options.headers,
            data: options.body,
            onload: (response) => {
                if (response.status >= 200 && response.status < 300) {
                    // Mock a Response-like object for JSON parsing
                    resolve({
                        ok: true,
                        status: response.status,
                        json: () => {
                            try {
                                return Promise.resolve(JSON.parse(response.responseText));
                            }
                            catch (e) {
                                return Promise.reject(e);
                            }
                        },
                        text: () => Promise.resolve(response.responseText)
                    });
                }
                else {
                    reject(new Error(`Request failed with status ${response.status}: ${response.statusText}`));
                }
            },
            onerror: (err) => reject(new Error('Network error')),
            ontimeout: () => reject(new Error('Timeout'))
        });
    });
}
//# sourceMappingURL=network.js.map