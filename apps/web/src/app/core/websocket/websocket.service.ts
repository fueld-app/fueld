import { Injectable, signal } from '@angular/core';
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

const WS_BASE = 'ws://localhost:3000/ws';

interface WsMessage {
  type: string;
  data?: unknown;
  message?: string;
}

@Injectable({ providedIn: 'root' })
export class WebSocketService {
  private ws: WebSocket | null = null;
  private currentToken: string | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private intentionallyClosed = false;

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
   */
  send(message: { type: string; [key: string]: unknown }): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      console.warn('[WS] Cannot send — not connected');
    }
  }

  /**
   * Connect to the WebSocket server with a JWT token.
   * Called by AuthService on login and by MainLayout on init (page reload).
   */
  connect(token: string): void {
    // Don't create duplicate connections
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.currentToken = token;
    this.intentionallyClosed = false;
    this.ws = new WebSocket(`${WS_BASE}?token=${encodeURIComponent(token)}`);

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
          return;
        }

        if (msg.type === 'auth-error') {
          console.error('[WS] Auth error:', msg.message);
          this.authenticated.set(false);
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

      if (!this.intentionallyClosed && this.currentToken) {
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
    this.currentToken = null;
    this.connected.set(false);
    this.authenticated.set(false);

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
      if (!this.intentionallyClosed && this.currentToken) {
        this.connect(this.currentToken);
      }
    }, delay);
  }
}
