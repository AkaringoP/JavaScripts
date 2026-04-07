import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {TabCoordinator} from '../src/core/tab-coordinator';

// Minimal BroadcastChannel mock
class MockBroadcastChannel {
  static instances: MockBroadcastChannel[] = [];
  name: string;
  onmessage: ((e: MessageEvent) => void) | null = null;
  closed = false;

  constructor(name: string) {
    this.name = name;
    MockBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    if (this.closed) throw new Error('Channel is closed');
    // Deliver to all OTHER instances with the same name
    for (const inst of MockBroadcastChannel.instances) {
      if (inst !== this && inst.name === this.name && !inst.closed && inst.onmessage) {
        inst.onmessage(new MessageEvent('message', {data}));
      }
    }
  }

  close(): void {
    this.closed = true;
    const idx = MockBroadcastChannel.instances.indexOf(this);
    if (idx !== -1) MockBroadcastChannel.instances.splice(idx, 1);
  }
}

// Minimal window mock for addEventListener/removeEventListener
const windowListeners: Record<string, Function[]> = {};
const mockWindow = {
  addEventListener: (event: string, fn: Function) => {
    (windowListeners[event] ??= []).push(fn);
  },
  removeEventListener: (event: string, fn: Function) => {
    const arr = windowListeners[event];
    if (arr) {
      const idx = arr.indexOf(fn);
      if (idx !== -1) arr.splice(idx, 1);
    }
  },
};

beforeEach(() => {
  vi.useFakeTimers();
  MockBroadcastChannel.instances = [];
  (globalThis as any).BroadcastChannel = MockBroadcastChannel;
  (globalThis as any).window = mockWindow;
  // Mock crypto.randomUUID
  vi.stubGlobal('crypto', {randomUUID: () => Math.random().toString(36).slice(2)});
  // Clear listeners
  for (const key of Object.keys(windowListeners)) {
    windowListeners[key] = [];
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  MockBroadcastChannel.instances = [];
  delete (globalThis as any).window;
});

describe('TabCoordinator', () => {
  it('starts with tabCount = 1 (self)', () => {
    const coord = new TabCoordinator();
    coord.start();
    expect(coord.getTabCount()).toBe(1);
    coord.destroy();
  });

  it('increments tabCount when another tab joins', () => {
    const tabCounts: number[] = [];
    const coord1 = new TabCoordinator();
    coord1.onTabCountChange = (c) => tabCounts.push(c);
    coord1.start();

    const coord2 = new TabCoordinator();
    coord2.start();

    // coord1 should have seen coord2 join (and coord2's pong)
    expect(coord1.getTabCount()).toBe(2);
    expect(coord2.getTabCount()).toBe(2);

    coord1.destroy();
    coord2.destroy();
  });

  it('decrements tabCount when a tab leaves', () => {
    const coord1 = new TabCoordinator();
    coord1.start();

    const coord2 = new TabCoordinator();
    coord2.start();

    expect(coord1.getTabCount()).toBe(2);

    coord2.destroy(); // sends 'leave'
    expect(coord1.getTabCount()).toBe(1);

    coord1.destroy();
  });

  it('cleans up stale tabs after timeout', () => {
    const coord1 = new TabCoordinator();
    coord1.start();

    const coord2 = new TabCoordinator();
    coord2.start();
    expect(coord1.getTabCount()).toBe(2);

    // Simulate coord2 crashing (close channel without sending leave)
    coord2['channel']?.close();
    coord2['channel'] = null;

    // Advance time past stale timeout (15s) + heartbeat interval (5s)
    vi.advanceTimersByTime(20000);

    // coord1's heartbeat should have cleaned up stale coord2
    expect(coord1.getTabCount()).toBe(1);

    coord1.destroy();
  });

  it('propagates backoff signals to other tabs', () => {
    const backoffReceived: number[] = [];

    const coord1 = new TabCoordinator();
    coord1.start();

    const coord2 = new TabCoordinator();
    coord2.onBackoffReceived = (until) => backoffReceived.push(until);
    coord2.start();

    const until = Date.now() + 5000;
    coord1.broadcastBackoff(until);

    expect(backoffReceived).toEqual([until]);

    coord1.destroy();
    coord2.destroy();
  });

  it('calls onTabCountChange callback', () => {
    const counts: number[] = [];

    const coord1 = new TabCoordinator();
    coord1.onTabCountChange = (c) => counts.push(c);
    coord1.start();

    const coord2 = new TabCoordinator();
    coord2.start();

    // join triggers callback (coord2 join + coord1 pong response triggers another update)
    expect(counts.length).toBeGreaterThanOrEqual(1);
    expect(counts[counts.length - 1]).toBe(2);

    coord2.destroy();
    expect(counts[counts.length - 1]).toBe(1);

    coord1.destroy();
  });

  it('falls back to single-tab mode when BroadcastChannel is unavailable', () => {
    delete (globalThis as any).BroadcastChannel;

    const coord = new TabCoordinator();
    coord.start();
    expect(coord.getTabCount()).toBe(1);

    // broadcastBackoff should not throw
    coord.broadcastBackoff(Date.now() + 5000);

    coord.destroy();
  });
});
