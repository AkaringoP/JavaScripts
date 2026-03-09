/* --- Helper: Rate Limited Fetch --- */

/** Internal task queued for rate-limited dispatch. */
interface QueueTask {
  url: string;
  options?: RequestInit;
  resolve: (value: Response) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Helper: Rate Limited Fetch
 * Implements strict rate limiting using a Token Bucket algorithm and dedicated queues.
 */
export class RateLimitedFetch {
  maxConcurrency: number;
  startDelayRange: [number, number];
  rateLimit: number;
  refillRate: number;
  tokens: number;
  lastRefill: number;
  queue: QueueTask[];
  activeWorkers: number;
  requestCounter: number;
  reportQueue: QueueTask[];
  isProcessingReport: boolean;
  repostQueue: QueueTask[];
  isProcessingReposts: boolean;

  /**
   * @param {number} maxConcurrency Maximum concurrent requests (for general queue).
   * @param {Array<number>} startDelayRange Random delay range before request [min, max] ms.
   * @param {number} requestsPerSecond Rate limit for general requests (default: 5).
   */
  constructor(
    maxConcurrency: number = 6,
    startDelayRange: [number, number] = [50, 150],
    requestsPerSecond: number = 6
  ) {
    this.maxConcurrency = maxConcurrency;
    this.startDelayRange = startDelayRange;

    // Token Bucket for General Requests
    this.rateLimit = requestsPerSecond; // Max tokens (burst)
    this.refillRate = 1000 / requestsPerSecond; // ms per token
    this.tokens = requestsPerSecond;
    this.lastRefill = Date.now();

    this.queue = [];
    this.activeWorkers = 0;
    this.requestCounter = 0;

    // Dedicated Worker for Reports (Strict cooldown)
    this.reportQueue = [];
    this.isProcessingReport = false;

    // Dedicated Worker for Reposts
    this.repostQueue = [];
    this.isProcessingReposts = false;
  }

  getRequestCount(): number {
    return this.requestCounter;
  }

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    // 1. Intercept /reports/ requests (Legacy custom report endpoints if any)
    if (url.includes('/reports/')) {
      return new Promise((resolve, reject) => {
        this.reportQueue.push({ url, options, resolve, reject });
        this.processReportQueue();
      });
    }

    // 2. Intercept /reposts/ requests (Strict 1 req / 3s)
    if (url.includes('/related_tag.json') || url.includes('/reposts/')) {
      // Note: related_tag.json usage in 'getFavCopyrightDistribution' was effectively a repost check or similar heavy op?
      // Actually user said "/reposts/posts.json". Let's stick to that strictly?
      // But let's check if 'related_tag' needs similar treatment. The user specific request was for "/reposts/posts.json".
      // Let's match strictly "reposts" or maybe "related_tag" if it's heavy.
      // For now, adhere to user request: /reposts/posts.json
    }

    if (url.includes('/reposts/')) {
      return new Promise((resolve, reject) => {
        this.repostQueue.push({ url, options, resolve, reject });
        this.processRepostQueue();
      });
    }

    // 3. General Queue (Token Bucket)
    return new Promise((resolve, reject) => {
      this.queue.push({ url, options, resolve, reject });
      this.processQueue();
    });
  }

  async processReportQueue(): Promise<void> {
    if (this.isProcessingReport || this.reportQueue.length === 0) return;

    this.isProcessingReport = true;
    const task = this.reportQueue.shift();
    if (!task) {
      this.isProcessingReport = false;
      return;
    }
    this.requestCounter++;

    try {
      const response = await fetch(task.url, task.options);
      task.resolve(response);
    } catch (e: unknown) {
      console.error(`[RateLimitedFetch] Report Failed: ${task.url}`, e);
      task.reject(e);
    } finally {
      // Strict 3s cooldown for reports
      await new Promise(r => setTimeout(r, 3000));
      this.isProcessingReport = false;
      this.processReportQueue();
    }
  }

  async processRepostQueue(): Promise<void> {
    if (this.isProcessingReposts || this.repostQueue.length === 0) return;

    this.isProcessingReposts = true;
    const task = this.repostQueue.shift();
    if (!task) {
      this.isProcessingReposts = false;
      return;
    }
    this.requestCounter++;

    try {
      const response = await fetch(task.url, task.options);
      task.resolve(response);
    } catch (e: unknown) {
      console.error(`[RateLimitedFetch] Repost Failed: ${task.url}`, e);
      task.reject(e);
    } finally {
      // Strict 3s cooldown for Reposts as requested
      await new Promise(r => setTimeout(r, 3000));
      this.isProcessingReposts = false;
      this.processRepostQueue();
    }
  }

  async processQueue(): Promise<void> {
    if (this.activeWorkers >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    // Token Bucket Check
    this.refillTokens();
    if (this.tokens < 1) {
      // Not enough tokens, schedule a retry after refill interval
      const waitTime = this.refillRate;
      setTimeout(() => this.processQueue(), waitTime);
      return;
    }

    // Consume Token
    this.tokens -= 1;
    this.activeWorkers++;
    this.requestCounter++;

    const task = this.queue.shift();
    if (!task) {
      this.activeWorkers--;
      return;
    }

    // Staggered Start Delay (minimal now, rely on token bucket for rate)
    // Keep small jitter to avoid bursty browser network thread locking?
    // User wants "1 sec 7 request". Token bucket handles the *average* rate.
    // Burst is allowed up to 'rateLimit' (7).
    // We can remove startDelay or keep it very small.
    // The original code had 100-300ms.
    // Minimal jitter to avoid burst — token bucket handles actual rate limiting
    const startDelay = Math.floor(Math.random() * (this.startDelayRange[1] - this.startDelayRange[0] + 1)) + this.startDelayRange[0];
    if (startDelay > 0) await new Promise(r => setTimeout(r, startDelay));

    try {
      const response = await fetch(task.url, task.options);
      task.resolve(response);
    } catch (e: unknown) {
      task.reject(e);
    } finally {
      this.activeWorkers--;
      // Immediately try next, token bucket will govern admission
      this.processQueue();
    }
  }

  refillTokens(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    if (elapsed > this.refillRate) {
      const newTokens = Math.floor(elapsed / this.refillRate);
      this.tokens = Math.min(this.rateLimit, this.tokens + newTokens);
      this.lastRefill = now; // Or use now - (elapsed % this.refillRate) for precision?
      // precision:
      this.lastRefill = now - (elapsed % this.refillRate);
    }
  }
}
