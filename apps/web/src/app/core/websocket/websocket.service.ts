import { Service, signal } from '@angular/core';
import { Subject, Observable, filter, map } from 'rxjs';

// ═══════════════════════════════════════════════════════════════════════
//  WebSocket Service — persistent authenticated connection
//
//  • Connects on login / page load (if token present)
//  • Auto-reconnects with exponential backoff
//  • Disconnects on logout
//  • Components subscribe to specific message types via `on(type)`
//  • Backend can push messages to the client at any time
// ═══════════════════════════════════════════════════════════════════════

import { WS_BASE } from '@app/core/config/api';

interface WsMessage {
  type: string;
  data?: unknown;
  message?: string;
}

@Service()
export class WebSocketService {
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private intentionallyClosed = false;
  private pendingMessages: { type: string; [key: string]: unknown }[] = [];
  private lastPresenceMessage: { type: 'presence'; [key: string]: unknown } | null = null;

  /** Stream of all incoming messages */
  private readonly messages$ = new Subject<WsMessage>();

  /** Connection state */
  readonly connected = signal(false);
  readonly authenticated = signal(false);

  // ─── Public API ──────────────────────────────────────────────────

  /**
   * Subscribe to messages of a specific type.
   * Components call: `this.ws.on<MyData>('nearby-vessels').subscribe(data => …)`
   */
  on<T = unknown>(type: string): Observable<T> {
    return this.messages$.pipe(
      filter((msg) => msg.type === type),
      map((msg) => msg.data as T),
    );
  }

  /**
   * Subscribe to raw messages (including type + message fields).
   */
  onRaw(type: string): Observable<WsMessage> {
    return this.messages$.pipe(filter((msg) => msg.type === type));
  }

  /**
   * Send a typed message to the server.
   * If the socket isn't authenticated yet, the message is queued
   * and will be flushed as soon as the connection is ready.
   */
  send(message: { type: string; [key: string]: unknown }): void {
    if (this.ws?.readyState === WebSocket.OPEN && this.authenticated()) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.pendingMessages.push(message);
    }
  }

  /**
   * Send a presence update with the current page URL, timezone, platform, and page title.
   * Called on every route navigation by MainLayoutComponent.
   */
  sendPresence(url: string, pageTitle?: string): void {
    // Strip "Fueld | " prefix from the page title for the backend
    const cleanTitle = pageTitle?.replace(/^Fueld\s*\|\s*/, '') ?? null;
    const message = {
      type: 'presence',
      url,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      platform: navigator.userAgent,
      language: navigator.language,
      pageTitle: cleanTitle,
    } as const;
    this.lastPresenceMessage = message;
    this.send(message);
  }

  /**
   * Send a copy event when the user copies text.
   * Called by the global copy listener in MainLayoutComponent.
   */
  sendCopyEvent(text: string, sourceUrl: string, pageTitle?: string): void {
    const cleanTitle = pageTitle?.replace(/^Fueld\s*\|\s*/, '') ?? null;
    this.send({
      type: 'copy-event',
      text: text.slice(0, 500),
      sourceUrl,
      pageTitle: cleanTitle,
    });
  }

  /**
   * Send a print event when the user prints the page.
   */
  sendPrintEvent(sourceUrl: string, pageTitle?: string): void {
    const cleanTitle = pageTitle?.replace(/^Fueld\s*\|\s*/, '') ?? null;
    this.send({
      type: 'print-event',
      sourceUrl,
      pageTitle: cleanTitle,
    });
  }

  /**
   * Send a screenshot event when the user takes a screenshot.
   */
  sendScreenshotEvent(sourceUrl: string, pageTitle?: string): void {
    const cleanTitle = pageTitle?.replace(/^Fueld\s*\|\s*/, '') ?? null;
    this.send({
      type: 'screenshot-event',
      sourceUrl,
      pageTitle: cleanTitle,
    });
  }

  /** Flush any messages that were queued before the socket was ready. */
  private flushPending(): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    const queued = this.pendingMessages.splice(0);
    const hadQueuedPresence = queued.some((msg) => msg.type === 'presence');
    for (const msg of queued) {
      this.ws.send(JSON.stringify(msg));
    }
    return hadQueuedPresence;
  }

  /**
   * Connect to the WebSocket server with a JWT token.
   * Called by AuthService on login and by MainLayout on init (page reload).
   */
  connect(token?: string): void {
    // Don't create duplicate connections
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.intentionallyClosed = false;
    // Cookies are sent automatically with the WebSocket upgrade request
    // No need to pass token in URL (backward compat: still accept it for non-browser clients)
    const wsUrl = token ? `${WS_BASE}?token=${encodeURIComponent(token)}` : WS_BASE;
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this.connected.set(true);
      this.reconnectAttempts = 0;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: WsMessage = JSON.parse(event.data);

        // Handle auth responses
        if (msg.type === 'connected') {
          this.authenticated.set(true);
          console.log('[WS] Authenticated');
          this.messages$.next(msg);
          const hadQueuedPresence = this.flushPending();
          if (!hadQueuedPresence && this.lastPresenceMessage) {
            this.send(this.lastPresenceMessage);
          }
          return;
        }

        if (msg.type === 'auth-error') {
          console.error('[WS] Auth error:', msg.message);
          this.authenticated.set(false);
          return;
        }

        // Handle force-logout from server (e.g. account deactivated)
        if (msg.type === 'force-logout') {
          console.warn('[WS] Force logout:', msg.message);
          this.intentionallyClosed = true;
          this.messages$.next(msg);
          return;
        }

        // Forward all other messages to subscribers
        this.messages$.next(msg);
      } catch (err) {
        console.error('[WS] Failed to parse message:', err);
      }
    };

    this.ws.onclose = () => {
      this.connected.set(false);
      this.authenticated.set(false);

      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }

  /**
   * Disconnect the WebSocket. Called on logout.
   */
  disconnect(): void {
    this.intentionallyClosed = true;
    this.connected.set(false);
    this.authenticated.set(false);
    this.pendingMessages = [];
    this.lastPresenceMessage = null;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.reconnectAttempts = 0;
  }

  // ─── Auto-reconnect with exponential backoff ──────────────────────

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.warn('[WS] Max reconnect attempts reached, giving up');
      return;
    }

    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30_000);
    this.reconnectAttempts++;

    console.log(`[WS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      if (!this.intentionallyClosed) {
        this.connect();
      }
    }, delay);
  }
}
