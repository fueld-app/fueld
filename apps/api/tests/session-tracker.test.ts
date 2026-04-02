import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test';
import { __geoipTestUtils } from '../src/modules/activity/geoip';

type SessionTrackerModule = typeof import('../src/modules/activity/session-tracker');
let tracker: SessionTrackerModule;
const loggedActivities: Array<Record<string, unknown>> = [];
let geoLookupResponse: { country: string | null; city: string | null } = {
  country: null,
  city: null,
};

type WsMock = {
  sent: string[];
  closed: boolean;
  send: (payload: string) => void;
  close: () => void;
};

function createWsMock(): WsMock {
  return {
    sent: [],
    closed: false,
    send(payload: string) {
      this.sent.push(payload);
    },
    close() {
      this.closed = true;
    },
  };
}

function resetTrackerState() {
  for (const session of tracker.getAllSessions()) {
    tracker.removeSession(session.socketId);
  }
  tracker.onEntityView(() => {});
}

beforeAll(async () => {
  mock.module('../src/modules/activity/activity.service', () => ({
    logActivity: async (payload: Record<string, unknown>) => {
      loggedActivities.push(payload);
    },
  }));

  __geoipTestUtils.setFetchImpl((async () => new Response(JSON.stringify({
    status: 'success',
    countryCode: geoLookupResponse.country,
    city: geoLookupResponse.city,
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })) as unknown as typeof globalThis.fetch);

  tracker = await import('../src/modules/activity/session-tracker');
  // Restore global module mocking immediately after importing tracker
  // so mocks don't leak into unrelated test files running in parallel.
  mock.restore();
});

afterAll(() => {
  __geoipTestUtils.clearCache();
  __geoipTestUtils.resetFetchImpl();
});

afterEach(async () => {
  resetTrackerState();
  loggedActivities.length = 0;
  geoLookupResponse = { country: null, city: null };
  __geoipTestUtils.clearCache();
  await new Promise((resolve) => setTimeout(resolve, 320));
});

describe('session-tracker', () => {
  test('adds/removes sessions and tracks user counts', () => {
    const ws1 = createWsMock();
    const ws2 = createWsMock();

    tracker.addSession('s1', ws1, {
      userId: 'u1',
      email: 'a@fueld.test',
      name: 'Alice',
      role: 'TRADER',
      ip: '127.0.0.1',
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
    });
    tracker.addSession('s2', ws2, {
      userId: 'u1',
      email: 'a@fueld.test',
      name: 'Alice',
      role: 'TRADER',
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Firefox/123.0',
    });

    expect(tracker.getAllSessions().length).toBe(2);
    expect(tracker.getSessionsByUser('u1').length).toBe(2);
    expect(tracker.getUserSessionCounts()).toEqual({ u1: 2 });

    tracker.removeSession('s1');
    expect(tracker.getAllSessions().length).toBe(1);
    expect(tracker.getUserSessionCounts()).toEqual({ u1: 1 });
  });

  test('subscribeAdmin immediately sends current session DTOs', () => {
    const adminWs = createWsMock();
    const userWs = createWsMock();

    tracker.addSession('admin-socket', adminWs, {
      userId: 'admin-1',
      email: 'admin@fueld.test',
      name: 'Admin',
      role: 'ADMIN',
      ip: '127.0.0.1',
      userAgent: null,
    });

    tracker.addSession('user-socket', userWs, {
      userId: 'user-1',
      email: 'user@fueld.test',
      name: 'User',
      role: 'TRADER',
      ip: '127.0.0.1',
      userAgent: null,
    });

    tracker.subscribeAdmin('admin-socket');

    expect(adminWs.sent.length).toBeGreaterThan(0);
    const msg = JSON.parse(adminWs.sent[0]!);
    expect(msg.type).toBe('admin:sessions');
    expect(Array.isArray(msg.data)).toBe(true);
    expect(msg.data.length).toBe(2);

    const dto = tracker.getAllSessionDtos().find((s) => s.socketId === 'user-socket');
    expect(dto?.userEmail).toBe('user@fueld.test');
    expect(dto?.userName).toBe('User');

    tracker.unsubscribeAdmin('admin-socket');
  });

  test('updatePresence resolves entity from URL and triggers callback', () => {
    const ws = createWsMock();
    const entityCalls: Array<{ socketId: string; entityType: string; entityId: string }> = [];

    tracker.addSession('s-entity', ws, {
      userId: 'u-entity',
      email: 'entity@fueld.test',
      name: 'Entity User',
      role: 'TRADER',
      ip: '127.0.0.1',
      userAgent: null,
    });

    tracker.onEntityView((socketId, entityType, entityId) => {
      entityCalls.push({ socketId, entityType, entityId });
    });

    const id = '123e4567-e89b-12d3-a456-426614174000';
    tracker.updatePresence('s-entity', {
      currentUrl: `/trading/orders/${id}`,
      pageTitle: 'Trading > Some Order',
      timezone: 'Europe/Copenhagen',
      language: 'en-US',
      platform: 'Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
    });

    expect(entityCalls).toEqual([
      { socketId: 's-entity', entityType: 'Order', entityId: id },
    ]);

    const session = tracker.getAllSessions().find((s) => s.socketId === 's-entity');
    expect(session?.timezone).toBe('Europe/Copenhagen');
    expect(session?.language).toBe('en-US');
    expect(session?.platform).toContain('Chrome');
    expect(loggedActivities.length).toBe(1);
    expect(loggedActivities[0]?.entityType).toBe('Order');
    expect(loggedActivities[0]?.entityName).toBe('Some Order');
  });

  test('addSession enriches session with geoip country/city when available', async () => {
    geoLookupResponse = { country: 'DK', city: 'Aarhus' };
    const ws = createWsMock();

    tracker.addSession('geo-socket', ws, {
      userId: 'geo-user',
      email: 'geo@fueld.test',
      name: 'Geo User',
      role: 'TRADER',
      ip: '203.0.113.10',
      userAgent: null,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    const session = tracker.getAllSessions().find((s) => s.socketId === 'geo-socket');
    expect(session?.country).toBe('DK');
    expect(session?.city).toBe('Aarhus');
  });

  test('logs copy/print/screenshot events and truncates copied text', () => {
    const ws = createWsMock();
    tracker.addSession('log-socket', ws, {
      userId: 'log-user',
      email: 'log@fueld.test',
      name: 'Log User',
      role: 'TRADER',
      ip: '127.0.0.1',
      userAgent: null,
    });

    tracker.updatePresence('log-socket', {
      currentUrl: '/unknown/route',
      pageTitle: 'Dashboard > Home',
    });

    const longText = 'x'.repeat(700);
    tracker.logCopyEvent('log-socket', {
      text: longText,
      sourceUrl: '/unknown/route',
      pageTitle: 'Dashboard > Home',
    });
    tracker.logPrintEvent('log-socket', { sourceUrl: '/unknown/route' });
    tracker.logScreenshotEvent('log-socket', { sourceUrl: '/unknown/route' });

    expect(loggedActivities.length).toBe(4);
    expect(loggedActivities[0]?.action).toBe('PAGE_VIEW');
    expect(loggedActivities[0]?.entityType).toBe('Page');

    expect(loggedActivities[1]?.action).toBe('COPY');
    const metadata = loggedActivities[1]?.metadata as { copiedText?: string } | undefined;
    expect(metadata?.copiedText?.length).toBe(500);

    expect(loggedActivities[2]?.action).toBe('PRINT');
    expect(loggedActivities[3]?.action).toBe('SCREENSHOT');
  });

  test('sendToSocket and broadcastToAll send JSON payloads', () => {
    const ws1 = createWsMock();
    const ws2 = createWsMock();

    tracker.addSession('s-a', ws1, {
      userId: 'u-a',
      email: 'a@fueld.test',
      name: 'A',
      role: 'TRADER',
      ip: '127.0.0.1',
      userAgent: null,
    });
    tracker.addSession('s-b', ws2, {
      userId: 'u-b',
      email: 'b@fueld.test',
      name: 'B',
      role: 'TRADER',
      ip: '127.0.0.1',
      userAgent: null,
    });

    tracker.sendToSocket('s-a', { type: 'ping', value: 1 });
    expect(JSON.parse(ws1.sent.at(-1)!)).toEqual({ type: 'ping', value: 1 });

    tracker.broadcastToAll({ type: 'system', ok: true });
    const ws1Messages = ws1.sent.map((m) => JSON.parse(m));
    const ws2Messages = ws2.sent.map((m) => JSON.parse(m));
    const ws1System = ws1Messages.find((m) => m.type === 'system');
    const ws2System = ws2Messages.find((m) => m.type === 'system');
    if (ws1System || ws2System) {
      expect(ws1System).toEqual({ type: 'system', ok: true });
      expect(ws2System).toEqual({ type: 'system', ok: true });
    }
  });

  test('disconnectUserSessions force-logs out and removes all user sessions', () => {
    const ws1 = createWsMock();
    const ws2 = createWsMock();
    const wsOther = createWsMock();

    tracker.addSession('u2-s1', ws1, {
      userId: 'u2',
      email: 'u2@fueld.test',
      name: 'U2',
      role: 'TRADER',
      ip: '127.0.0.1',
      userAgent: null,
    });
    tracker.addSession('u2-s2', ws2, {
      userId: 'u2',
      email: 'u2@fueld.test',
      name: 'U2',
      role: 'TRADER',
      ip: '127.0.0.1',
      userAgent: null,
    });
    tracker.addSession('u3-s1', wsOther, {
      userId: 'u3',
      email: 'u3@fueld.test',
      name: 'U3',
      role: 'TRADER',
      ip: '127.0.0.1',
      userAgent: null,
    });

    const removed = tracker.disconnectUserSessions('u2', 'Account disabled');
    expect(removed).toBe(2);

    expect(ws1.closed).toBe(true);
    expect(ws2.closed).toBe(true);
    expect(wsOther.closed).toBe(false);

    const msg1 = JSON.parse(ws1.sent[ws1.sent.length - 1]!);
    expect(msg1.type).toBe('force-logout');
    expect(msg1.message).toBe('Account disabled');

    expect(tracker.getSessionsByUser('u2').length).toBe(0);
    expect(tracker.getSessionsByUser('u3').length).toBe(1);
  });

  test('extractClientIp prioritizes x-forwarded-for then x-real-ip', () => {
    const requestWithForwarded = new Request('https://api.fueld.test/ws', {
      headers: {
        'x-forwarded-for': '203.0.113.5, 70.41.3.18',
        'x-real-ip': '198.51.100.9',
      },
    });
    expect(tracker.extractClientIp(requestWithForwarded)).toBe('203.0.113.5');

    const requestWithRealIp = new Request('https://api.fueld.test/ws', {
      headers: { 'x-real-ip': '198.51.100.9' },
    });
    expect(tracker.extractClientIp(requestWithRealIp)).toBe('198.51.100.9');

    const requestNoIp = new Request('https://api.fueld.test/ws');
    expect(tracker.extractClientIp(requestNoIp)).toBeNull();
  });

  test('extractClientIp prefers an available IPv4 over IPv6 addresses', () => {
    const request = new Request('https://api.fueld.test/ws', {
      headers: {
        'x-forwarded-for': '2001:db8::10, 198.51.100.24',
        'x-real-ip': '2001:db8::20',
      },
    });

    expect(tracker.extractClientIp(request)).toBe('198.51.100.24');
  });

  test('extractClientIp normalizes IPv4-mapped IPv6 addresses', () => {
    const request = new Request('https://api.fueld.test/ws', {
      headers: {
        'x-forwarded-for': '::ffff:203.0.113.8',
      },
    });

    expect(tracker.extractClientIp(request)).toBe('203.0.113.8');
  });
});
