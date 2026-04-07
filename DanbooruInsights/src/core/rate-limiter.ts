import {CONFIG} from '../config';

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
 * Supports dynamic limit updates (for cross-tab coordination) and global backoff.
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

  /** Timestamp until which all requests should be paused (global backoff). */
  backoffUntil: number;
  /** Called when a 429 response triggers global backoff. */
  onBackoff: ((until: number) => void) | null;

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

    // Global backoff
    this.backoffUntil = 0;
    this.onBackoff = null;

  }

  getRequestCount(): number {
    return this.requestCounter;
  }

  /**
   * Dynamically update rate limits (e.g., when tab count changes).
   * Takes effect on the next queue processing cycle.
   */
  updateLimits(requestsPerSecond: number, maxConcurrency: number): void {
    this.rateLimit = requestsPerSecond;
    this.refillRate = 1000 / requestsPerSecond;
    this.maxConcurrency = maxConcurrency;
    // Clamp existing tokens to new burst limit
    this.tokens = Math.min(this.tokens, this.rateLimit);
  }

  /**
   * Set global backoff — pause all request processing until the given timestamp.
   * Only updates if the new timestamp is later than the current backoff.
   */
  setBackoff(until: number): void {
    this.backoffUntil = Math.max(this.backoffUntil, until);
  }

  async fetch(url: string, options?: RequestInit): Promise<Response> {
    // 1. Intercept /reports/ requests (Legacy custom report endpoints if any)
    if (url.includes('/reports/')) {
      return new Promise((resolve, reject) => {
        this.reportQueue.push({ url, options, resolve, reject });
        this.processReportQueue();
      });
    }

    // 2. General Queue (Token Bucket)
    return new Promise((resolve, reject) => {
      this.queue.push({ url, options, resolve, reject });
      this.processQueue();
    });
  }

  async processReportQueue(): Promise<void> {
    if (this.isProcessingReport || this.reportQueue.length === 0) return;

    // Global backoff check
    const now = Date.now();
    if (now < this.backoffUntil) {
      setTimeout(() => this.processReportQueue(), this.backoffUntil - now);
      return;
    }

    this.isProcessingReport = true;
    const task = this.reportQueue.shift();
    if (!task) {
      this.isProcessingReport = false;
      return;
    }
    this.requestCounter++;

    try {
      const response = await fetch(task.url, task.options);
      if (response.status === 429) this.triggerBackoff();
      task.resolve(response);
    } catch (e: unknown) {
      console.error(`[RateLimitedFetch] Report Failed: ${task.url}`, e);
      task.reject(e);
    } finally {
      // Strict 3s cooldown for reports
      await new Promise(r => setTimeout(r, CONFIG.REPORT_COOLDOWN_MS));
      this.isProcessingReport = false;
      this.processReportQueue();
    }
  }

  async processQueue(): Promise<void> {
    if (this.activeWorkers >= this.maxConcurrency || this.queue.length === 0) {
      return;
    }

    // Global backoff check
    const now = Date.now();
    if (now < this.backoffUntil) {
      setTimeout(() => this.processQueue(), this.backoffUntil - now);
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
    const startDelay = Math.floor(Math.random() * (this.startDelayRange[1] - this.startDelayRange[0] + 1)) + this.startDelayRange[0];
    if (startDelay > 0) await new Promise(r => setTimeout(r, startDelay));

    try {
      const response = await fetch(task.url, task.options);
      if (response.status === 429) this.triggerBackoff();
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
      // precision:
      this.lastRefill = now - (elapsed % this.refillRate);
    }
  }

  /** Activate global backoff and notify listeners (e.g., TabCoordinator). */
  private triggerBackoff(): void {
    const until = Date.now() + CONFIG.BACKOFF_DURATION_MS;
    this.setBackoff(until);
    this.onBackoff?.(until);
  }
}
