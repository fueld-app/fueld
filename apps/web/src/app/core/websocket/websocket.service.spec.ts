import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WebSocketService } from './websocket.service';

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readonly sent: string[] = [];
  readonly url: string;
  readyState = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    MockWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  receive(message: Record<string, unknown>): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent);
  }

  triggerUnexpectedClose(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
}

describe('WebSocketService', () => {
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    vi.useFakeTimers();
    MockWebSocket.instances = [];
    Object.assign(globalThis, { WebSocket: MockWebSocket as unknown as typeof WebSocket });
  });

  afterEach(() => {
    vi.useRealTimers();
    Object.assign(globalThis, { WebSocket: originalWebSocket });
  });

  it('flushes a queued initial presence only once after authentication', () => {
    const service = new WebSocketService();

    service.connect('token-1');
    const socket = MockWebSocket.instances[0]!;

    service.sendPresence('/dashboard', 'Fueld | Dashboard');
    expect(socket.sent).toHaveLength(0);

    socket.open();
    socket.receive({ type: 'connected', message: 'ok' });

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({
      type: 'presence',
      url: '/dashboard',
      pageTitle: 'Dashboard',
    });
  });

  it('re-sends the last presence after an authenticated reconnect', () => {
    const service = new WebSocketService();

    service.connect('token-1');
    const firstSocket = MockWebSocket.instances[0]!;
    firstSocket.open();
    firstSocket.receive({ type: 'connected', message: 'ok' });

    service.sendPresence('/trading/orders', 'Fueld | Trading > Orders');
    expect(firstSocket.sent).toHaveLength(1);

    firstSocket.triggerUnexpectedClose();
    vi.advanceTimersByTime(1000);

    const secondSocket = MockWebSocket.instances[1]!;
    secondSocket.open();
    secondSocket.receive({ type: 'connected', message: 'ok' });

    expect(secondSocket.sent).toHaveLength(1);
    expect(JSON.parse(secondSocket.sent[0]!)).toMatchObject({
      type: 'presence',
      url: '/trading/orders',
      pageTitle: 'Trading > Orders',
    });
  });
});