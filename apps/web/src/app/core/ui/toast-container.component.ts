import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ToastService } from './toast.service';

// ═══════════════════════════════════════════════════════════════════════
//  ToastContainer — renders the global toast stack.
//  Place once in the root layout. Bottom-right on desktop, bottom-center
//  above the safe area on mobile (thumb-reachable, never covers the navbar).
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-toast-container',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="toast-stack" role="status" aria-live="polite">
      @for (t of toastSvc.toasts(); track t.id) {
        <div
          class="toast-item"
          [class.toast-leaving]="t.leaving"
          [attr.data-type]="t.type"
        >
          <span class="toast-icon" aria-hidden="true">
            @switch (t.type) {
              @case ('success') {
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clip-rule="evenodd"/></svg>
              }
              @case ('error') {
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd"/></svg>
              }
              @case ('warning') {
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M8.485 2.495c.673-1.17 2.357-1.17 3.03 0l6.28 10.875c.673 1.17-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.455-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clip-rule="evenodd"/></svg>
              }
              @default {
                <svg viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010 15.5a1.75 1.75 0 00.25-3.482V9.25a.75.75 0 000-1.5H9z" clip-rule="evenodd"/></svg>
              }
            }
          </span>
          <p class="toast-message">{{ t.message }}</p>
          @if (t.action) {
            <button type="button" class="toast-action" (click)="toastSvc.runAction(t.id)">
              {{ t.action.label }}
            </button>
          }
          <button type="button" class="toast-close" aria-label="Dismiss" (click)="toastSvc.dismiss(t.id)">
            <svg viewBox="0 0 20 20" fill="currentColor"><path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/></svg>
          </button>
        </div>
      }
    </div>
  `,
  styles: [`
    :host { display: contents; }
  `],
})
export class ToastContainerComponent {
  protected readonly toastSvc = inject(ToastService);
}