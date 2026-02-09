// ═══════════════════════════════════════════════════════════════════════
//  Session Tracker — In-memory tracking of active WebSocket sessions
//
//  Tracks connected users, their client info, and current page.
//  Provides real-time session data to admin subscribers.
//  Broadcasts are serialised to match the UserSessionDto shape.
// ═══════════════════════════════════════════════════════════════════════

import { logActivity } from './activity.service';
import { lookupIp } from './geoip';

// ─── URL → Entity Parsing (Angular frontend routes) ──────────────────

const UUID_RE = '[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';

/** Maps frontend route patterns to entity types. Order matters — first match wins. */
const PAGE_ENTITY_PATTERNS: Array<[RegExp, string]> = [
  [new RegExp(`^/vessels/(${UUID_RE})`), 'Vessel'],
  [new RegExp(`^/companies/(${UUID_RE})`), 'Company'],
  [new RegExp(`^/places/(${UUID_RE})`), 'Place'],
  [new RegExp(`^/trading/orders/(${UUID_RE})`), 'Order'],
  [new RegExp(`^/trading/inquiries/(${UUID_RE})`), 'Inquiry'],
  [new RegExp(`^/admin/users/(${UUID_RE})`), 'User'],
];

/**
 * Parse the frontend URL to extract entity type and ID.
 * Extracts entity name from the page title (e.g. "Vessels > Cielo di Houston" → "Cielo di Houston").
 */
function parsePageEntity(url: string, pageTitle: string | null): {
  entityType: string;
  entityId: string | null;
  entityName: string | null;
} {
  for (const [regex, entityType] of PAGE_ENTITY_PATTERNS) {
    const match = url.match(regex);
    if (match) {
      // Extract name from page title: "Category > Entity Name" → "Entity Name"
      let entityName: string | null = null;
      if (pageTitle) {
        const parts = pageTitle.split('>');
        if (parts.length >= 2) {
          entityName = parts.slice(1).join('>').trim() || null;
        }
      }
      return { entityType, entityId: match[1] ?? null, entityName };
    }
  }
  return { entityType: 'Page', entityId: null, entityName: null };
}

export interface SessionInfo {
  socketId: string;
  userId: string;
  email: string;
  name: string;
  role: string;
  ip: string | null;
  userAgent: string | null;
  platform: string | null;
  timezone: string | null;
  language: string | null;
  country: string | null;
  city: string | null;
  currentUrl: string | null;
  pageTitle: string | null;
  connectedAt: string; // ISO
  lastActivity: string; // ISO
}

/** Shape sent to admin subscribers — matches UserSessionDto. */
function toDto(s: SessionInfo) {
  return {
    socketId: s.socketId,
    userId: s.userId,
    userEmail: s.email,
    userName: s.name,
    clientIp: s.ip,
    userAgent: s.userAgent,
    platform: s.platform,
    timezone: s.timezone,
    language: s.language,
    country: s.country,
    city: s.city,
    currentUrl: s.currentUrl,
    pageTitle: s.pageTitle,
    connectedAt: s.connectedAt,
    lastActivity: s.lastActivity,
  };
}

// ─── State ───────────────────────────────────────────────────────────

const sessions = new Map<string, SessionInfo>();
const wsConnections = new Map<string, any>(); // socketId → ws object
const adminSubscribers = new Set<string>(); // socketIds of admins subscribed

let broadcastTimer: ReturnType<typeof setTimeout> | null = null;

// ─── Session CRUD ────────────────────────────────────────────────────

export function addSession(
  socketId: string,
  ws: any,
  info: {
    userId: string;
    email: string;
    name: string;
    role: string;
    ip: string | null;
    userAgent: string | null;
  },
): void {
  const now = new Date().toISOString();
  const geo = lookupIp(info.ip);
  sessions.set(socketId, {
    socketId,
    ...info,
    platform: parsePlatform(info.userAgent),
    timezone: null,
    language: null,
    country: geo.country,
    city: geo.city,
    currentUrl: null,
    pageTitle: null,
    connectedAt: now,
    lastActivity: now,
  });
  wsConnections.set(socketId, ws);
  scheduleBroadcast();
}

export function removeSession(socketId: string): void {
  sessions.delete(socketId);
  wsConnections.delete(socketId);
  adminSubscribers.delete(socketId);
  scheduleBroadcast();
}

/** Optional callback invoked when a user navigates to an entity detail page. */
let onEntityViewCallback: ((socketId: string, entityType: string, entityId: string) => void) | null = null;

/** Register a callback for entity detail page views (used for auto-sync). */
export function onEntityView(cb: (socketId: string, entityType: string, entityId: string) => void): void {
  onEntityViewCallback = cb;
}

export function updatePresence(
  socketId: string,
  update: { currentUrl?: string; timezone?: string; platform?: string; pageTitle?: string; language?: string },
): void {
  const session = sessions.get(socketId);
  if (!session) return;

  // Log a PAGE_VIEW when the URL actually changes
  const urlChanged =
    update.currentUrl !== undefined && update.currentUrl !== session.currentUrl;

  if (update.currentUrl !== undefined) session.currentUrl = update.currentUrl;
  if (update.timezone !== undefined) session.timezone = update.timezone;
  if (update.language !== undefined) session.language = update.language;
  if (update.pageTitle !== undefined) session.pageTitle = update.pageTitle;
  if (update.platform !== undefined) {
    session.userAgent = update.platform; // raw UA string
    session.platform = parsePlatform(update.platform);
  }
  session.lastActivity = new Date().toISOString();

  if (urlChanged) {
    const { entityType, entityId, entityName } = parsePageEntity(
      session.currentUrl ?? '',
      session.pageTitle,
    );

    logActivity({
      userId: session.userId,
      action: 'PAGE_VIEW',
      entityType,
      entityId,
      entityName,
      pageTitle: session.pageTitle ?? null,
      httpPath: session.currentUrl ?? null,
      clientIp: session.ip,
      userAgent: session.userAgent,
      timezone: session.timezone,
      language: session.language,
      country: session.country,
      city: session.city,
    }).catch(() => {});

    // Trigger auto-sync for entity detail pages
    if (entityId && onEntityViewCallback) {
      onEntityViewCallback(socketId, entityType, entityId);
    }
  }

  scheduleBroadcast();
}

/** Log a copy event from the frontend. */
export function logCopyEvent(
  socketId: string,
  data: { text: string; sourceUrl: string; pageTitle?: string },
): void {
  const session = sessions.get(socketId);
  if (!session) return;

  logActivity({
    userId: session.userId,
    action: 'COPY',
    entityType: 'page',
    entityId: null,
    pageTitle: data.pageTitle ?? session.pageTitle ?? null,
    httpPath: data.sourceUrl ?? session.currentUrl ?? null,
    clientIp: session.ip,
    userAgent: session.userAgent,
    timezone: session.timezone,
    language: session.language,
    country: session.country,
    city: session.city,
    metadata: { copiedText: data.text.slice(0, 500) },
  }).catch(() => {});
}

/** Log a print event from the frontend. */
export function logPrintEvent(
  socketId: string,
  data: { sourceUrl: string; pageTitle?: string },
): void {
  const session = sessions.get(socketId);
  if (!session) return;

  logActivity({
    userId: session.userId,
    action: 'PRINT',
    entityType: 'page',
    entityId: null,
    pageTitle: data.pageTitle ?? session.pageTitle ?? null,
    httpPath: data.sourceUrl ?? session.currentUrl ?? null,
    clientIp: session.ip,
    userAgent: session.userAgent,
    timezone: session.timezone,
    language: session.language,
    country: session.country,
    city: session.city,
    metadata: null,
  }).catch(() => {});
}

/** Log a screenshot event from the frontend. */
export function logScreenshotEvent(
  socketId: string,
  data: { sourceUrl: string; pageTitle?: string },
): void {
  const session = sessions.get(socketId);
  if (!session) return;

  logActivity({
    userId: session.userId,
    action: 'SCREENSHOT',
    entityType: 'page',
    entityId: null,
    pageTitle: data.pageTitle ?? session.pageTitle ?? null,
    httpPath: data.sourceUrl ?? session.currentUrl ?? null,
    clientIp: session.ip,
    userAgent: session.userAgent,
    timezone: session.timezone,
    language: session.language,
    country: session.country,
    city: session.city,
    metadata: null,
  }).catch(() => {});
}

// ─── Queries ─────────────────────────────────────────────────────────

export function getAllSessions(): SessionInfo[] {
  return Array.from(sessions.values());
}

/** Get sessions serialised to the DTO shape for the frontend. */
export function getAllSessionDtos() {
  return Array.from(sessions.values()).map(toDto);
}

export function getSessionsByUser(userId: string): SessionInfo[] {
  return Array.from(sessions.values()).filter((s) => s.userId === userId);
}

/** Returns Map<userId, sessionCount> for all connected users. */
export function getUserSessionCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of sessions.values()) {
    counts[s.userId] = (counts[s.userId] ?? 0) + 1;
  }
  return counts;
}

// ─── Admin Subscriptions ─────────────────────────────────────────────

export function subscribeAdmin(socketId: string): void {
  adminSubscribers.add(socketId);
  // Immediately send current sessions
  const ws = wsConnections.get(socketId);
  if (ws) {
    try {
      ws.send(JSON.stringify({ type: 'admin:sessions', data: getAllSessionDtos() }));
    } catch { /* connection might be closing */ }
  }
}

export function unsubscribeAdmin(socketId: string): void {
  adminSubscribers.delete(socketId);
}

/** Send a typed JSON message to a specific connected socket. */
export function sendToSocket(socketId: string, message: Record<string, unknown>): void {
  const ws = wsConnections.get(socketId);
  if (ws) {
    try {
      ws.send(JSON.stringify(message));
    } catch { /* connection might be closing */ }
  }
}

/**
 * Force-disconnect all WebSocket sessions for a given user.
 * Sends a 'force-logout' message before closing, so the client can
 * clean up (clear tokens, redirect to login).
 */
export function disconnectUserSessions(userId: string, reason = 'Your account has been deactivated'): number {
  let count = 0;
  for (const [socketId, session] of sessions.entries()) {
    if (session.userId === userId) {
      const ws = wsConnections.get(socketId);
      if (ws) {
        try {
          ws.send(JSON.stringify({ type: 'force-logout', message: reason }));
          ws.close();
        } catch { /* already closing */ }
      }
      sessions.delete(socketId);
      wsConnections.delete(socketId);
      adminSubscribers.delete(socketId);
      count++;
    }
  }
  if (count > 0) scheduleBroadcast();
  return count;
}

// ─── Broadcast (debounced) ───────────────────────────────────────────

function scheduleBroadcast(): void {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    broadcastToAdmins();
  }, 300);
}

function broadcastToAdmins(): void {
  if (adminSubscribers.size === 0) return;

  const payload = JSON.stringify({ type: 'admin:sessions', data: getAllSessionDtos() });

  for (const subId of adminSubscribers) {
    const ws = wsConnections.get(subId);
    if (ws) {
      try {
        ws.send(payload);
      } catch {
        // ws closed — will be cleaned up on close event
      }
    }
  }
}

/**
 * Broadcast a message to ALL connected WebSocket clients.
 * Used for system-wide pushes like commodity price updates.
 */
export function broadcastToAll(message: Record<string, unknown>): void {
  if (wsConnections.size === 0) return;

  const payload = JSON.stringify(message);

  for (const ws of wsConnections.values()) {
    try {
      ws.send(payload);
    } catch {
      // ws closed — will be cleaned up on close event
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parsePlatform(ua: string | null): string | null {
  if (!ua) return null;

  let browser = 'Unknown';
  if (ua.includes('Firefox/')) browser = 'Firefox';
  else if (ua.includes('Edg/')) browser = 'Edge';
  else if (ua.includes('OPR/') || ua.includes('Opera/')) browser = 'Opera';
  else if (ua.includes('Chrome/')) browser = 'Chrome';
  else if (ua.includes('Safari/')) browser = 'Safari';

  let os = 'Unknown';
  if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'macOS';
  else if (ua.includes('Windows')) os = 'Windows';
  else if (ua.includes('iPhone')) os = 'iOS';
  else if (ua.includes('iPad')) os = 'iPadOS';
  else if (ua.includes('Android')) os = 'Android';
  else if (ua.includes('Linux')) os = 'Linux';

  return `${browser} / ${os}`;
}

export function extractClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return null;
}
