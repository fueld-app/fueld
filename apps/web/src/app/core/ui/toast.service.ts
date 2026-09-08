import { Service, signal } from '@angular/core';

// ═══════════════════════════════════════════════════════════════════════
//  ToastService — global toast notifications with optional actions (undo)
//
//  Usage:
//    toast.success('Saved');
//    toast.error('Something went wrong');
//    toast.show('Order marked as sent', {
//      action: { label: 'Undo', run: () => revert() },
//    });
//
//  Undo pattern: pass an action and (optionally) a longer duration so the
//  user has time to act. Actions run once; the toast dismisses afterwards.
// ═══════════════════════════════════════════════════════════════════════

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastAction {
  label: string;
  run: () => void | Promise<void>;
}

export interface ToastOptions {
  type?: ToastType;
  /** Optional action button, e.g. "Undo". */
  action?: ToastAction;
  /** Auto-dismiss ms. Defaults: 4000 (plain) / 7000 (with action). */
  duration?: number;
}

export interface Toast {
  id: number;
  type: ToastType;
  message: string;
  action: ToastAction | null;
  leaving: boolean;
}

const DEFAULT_DURATION = 4000;
const ACTION_DURATION = 7000;
const LEAVE_ANIMATION_MS = 180;

@Service()
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;
  private timers = new Map<number, ReturnType<typeof setTimeout>>();

  show(message: string, opts: ToastOptions = {}): number {
    const id = ++this.seq;
    const duration = opts.duration ?? (opts.action ? ACTION_DURATION : DEFAULT_DURATION);
    const toast: Toast = {
      id,
      type: opts.type ?? 'info',
      message,
      action: opts.action ?? null,
      leaving: false,
    };
    // Cap concurrent toasts — drop the oldest
    this.toasts.update((list) => [...list.slice(-3), toast]);
    this.timers.set(id, setTimeout(() => this.dismiss(id), duration));
    return id;
  }

  success(message: string, opts: Omit<ToastOptions, 'type'> = {}): number {
    return this.show(message, { ...opts, type: 'success' });
  }

  error(message: string, opts: Omit<ToastOptions, 'type'> = {}): number {
    return this.show(message, { ...opts, type: 'error' });
  }

  info(message: string, opts: Omit<ToastOptions, 'type'> = {}): number {
    return this.show(message, { ...opts, type: 'info' });
  }

  warning(message: string, opts: Omit<ToastOptions, 'type'> = {}): number {
    return this.show(message, { ...opts, type: 'warning' });
  }

  /** Animate out, then remove. */
  dismiss(id: number): void {
    const timer = this.timers.get(id);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(id);
    }
    this.toasts.update((list) => list.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
    setTimeout(() => {
      this.toasts.update((list) => list.filter((t) => t.id !== id));
    }, LEAVE_ANIMATION_MS);
  }

  /** Run the toast's action (if any), then dismiss. */
  async runAction(id: number): Promise<void> {
    const toast = this.toasts().find((t) => t.id === id);
    if (!toast?.action) return;
    this.dismiss(id);
    try {
      await toast.action.run();
    } catch {
      // Actions handle their own errors — never crash the UI here
    }
  }
}