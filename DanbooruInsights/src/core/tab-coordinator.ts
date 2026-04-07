import {CONFIG} from '../config';

/** Messages exchanged between tabs via BroadcastChannel. */
type TabMessage =
  | {type: 'join'; id: string}
  | {type: 'pong'; id: string}
  | {type: 'ping'; id: string}
  | {type: 'leave'; id: string}
  | {type: 'backoff'; until: number};

/**
 * Coordinates rate limiting across browser tabs via BroadcastChannel.
 * Tracks active tab count and notifies listeners on changes so that
 * each tab can adjust its share of the global rate budget.
 */
export class TabCoordinator {
  private channel: BroadcastChannel | null = null;
  private readonly tabId: string;
  private readonly activeTabs = new Map<string, number>(); // tabId → lastSeen
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private readonly boundBeforeUnload: () => void;

  /** Called when the number of active tabs changes. */
  onTabCountChange: ((count: number) => void) | null = null;
  /** Called when a backoff signal is received from another tab. */
  onBackoffReceived: ((until: number) => void) | null = null;

  constructor() {
    this.tabId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2);

    this.boundBeforeUnload = () => this.destroy();
  }

  /** Start tab coordination: join the channel, begin heartbeat. */
  start(): void {
    if (typeof BroadcastChannel === 'undefined') return; // Fallback: single-tab mode

    const cfg = CONFIG.TAB_COORDINATOR;
    try {
      this.channel = new BroadcastChannel(cfg.channelName);
    } catch {
      return; // Cannot create channel — stay in single-tab mode
    }

    this.channel.onmessage = (e: MessageEvent<TabMessage>) =>
      this.handleMessage(e.data);

    // Register this tab
    this.activeTabs.set(this.tabId, Date.now());
    this.broadcast({type: 'join', id: this.tabId});

    // Heartbeat: keep-alive + stale cleanup
    this.heartbeatTimer = setInterval(() => {
      this.broadcast({type: 'ping', id: this.tabId});
      this.cleanupStaleTabs();
    }, cfg.heartbeatInterval);

    window.addEventListener('beforeunload', this.boundBeforeUnload);
  }

  /** Gracefully leave the coordination channel. */
  destroy(): void {
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.broadcast({type: 'leave', id: this.tabId});
    this.channel?.close();
    this.channel = null;
    window.removeEventListener('beforeunload', this.boundBeforeUnload);
  }

  /** Broadcast a 429-backoff signal to all other tabs. */
  broadcastBackoff(until: number): void {
    this.broadcast({type: 'backoff', until});
  }

  /** Current number of active tabs (including this one). */
  getTabCount(): number {
    return Math.max(1, this.activeTabs.size);
  }

  private handleMessage(msg: TabMessage): void {
    switch (msg.type) {
      case 'join':
        this.activeTabs.set(msg.id, Date.now());
        // Respond so the new tab knows about us
        this.broadcast({type: 'pong', id: this.tabId});
        this.notifyTabCountChange();
        break;
      case 'pong':
        this.activeTabs.set(msg.id, Date.now());
        this.notifyTabCountChange();
        break;
      case 'ping':
        this.activeTabs.set(msg.id, Date.now());
        break;
      case 'leave':
        this.activeTabs.delete(msg.id);
        this.notifyTabCountChange();
        break;
      case 'backoff':
        this.onBackoffReceived?.(msg.until);
        break;
    }
  }

  private broadcast(msg: TabMessage): void {
    try {
      this.channel?.postMessage(msg);
    } catch {
      // Channel may be closed — ignore
    }
  }

  private cleanupStaleTabs(): void {
    const now = Date.now();
    const staleTimeout = CONFIG.TAB_COORDINATOR.staleTimeout;
    let changed = false;
    for (const [id, lastSeen] of this.activeTabs) {
      if (id !== this.tabId && now - lastSeen > staleTimeout) {
        this.activeTabs.delete(id);
        changed = true;
      }
    }
    // Refresh own timestamp
    this.activeTabs.set(this.tabId, now);
    if (changed) this.notifyTabCountChange();
  }

  private notifyTabCountChange(): void {
    this.onTabCountChange?.(this.getTabCount());
  }
}
