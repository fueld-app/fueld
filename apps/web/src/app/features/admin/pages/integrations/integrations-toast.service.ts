import { Service, signal } from '@angular/core';

@Service()
export class IntegrationsToastService {
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  show(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 3000);
  }
}
