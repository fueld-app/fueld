import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  inject,
} from '@angular/core';
import type { OverdueInvoiceDto } from '@fueld/types';
import { AuthService } from '@app/core/auth/auth.service';

// ═══════════════════════════════════════════════════════════════════════
//  Collections Widget — Lists overdue invoices and allows adding notes
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-collections-widget',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
      <div class="flex items-center justify-between border-b border-gray-200 dark:border-line p-5">
        <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Collections</h3>
        <a href="/trading/inquiries" class="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 transition-colors">View All</a>
      </div>

      @if (overdueInvoices().length === 0) {
        <div class="p-5 text-center text-gray-500 dark:text-muted">
          <p>No overdue invoices. Good job!</p>
        </div>
      } @else {
        <ul class="divide-y divide-gray-100 dark:divide-line">
          @for (invoice of overdueInvoices(); track invoice.invoiceId) {
            <li class="p-5 hover:bg-gray-50/50 transition-colors last:border-b-0">
              <div class="flex justify-between items-start">
                <div>
                  <p class="text-sm font-medium text-gray-900 dark:text-ink">{{ invoice.invoiceNumber }}</p>
                  <p class="text-sm text-gray-500 dark:text-muted">{{ invoice.clientName }}</p>
                  <p class="text-xs text-red-600 dark:text-red-400 font-semibold mt-1">
                    Overdue by {{ invoice.daysOverdue }} days
                  </p>
                </div>
                <div class="text-right">
                  @if (auth.canSeePrices()) {
                    <p class="text-sm font-semibold text-red-700 dark:text-red-400">USD {{ invoice.amount }}</p>
                  } @else {
                    <p class="text-sm font-semibold text-gray-400 dark:text-muted italic">Hidden</p>
                  }
                  <p class="text-xs text-gray-500 dark:text-muted">Due {{ invoice.dueDate }}</p>
                </div>
              </div>
              @if (selectedInvoiceId() === invoice.invoiceId) {
                <div class="mt-4 flex flex-col gap-2">
                  <textarea
                    #noteTextarea
                    class="w-full rounded-md border-gray-300 dark:border-line-strong shadow-sm focus:border-brand-600 focus:ring-brand-600 text-sm"
                    rows="3"
                    placeholder="Add a follow-up note..."
                    (input)="noteContent.set($any($event.target).value)"
                    [value]="noteContent()"
                  ></textarea>
                  <div class="flex justify-end gap-2">
                    <button
                      (click)="cancelAddNote()"
                      class="rounded-md bg-white dark:bg-surface px-3 py-2 text-sm font-semibold text-gray-900 dark:text-ink shadow-sm ring-1 ring-inset ring-gray-300 dark:ring-line-strong hover:bg-gray-50 dark:hover:bg-surface-tint"
                    >
                      Cancel
                    </button>
                    <button
                      (click)="saveNote(invoice.invoiceId)"
                      [disabled]="!noteContent() || savingNote()"
                      class="rounded-md bg-brand-700 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 disabled:opacity-50"
                    >
                      @if (savingNote()) {
                        <svg class="h-4 w-4 animate-spin inline mr-1" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      }
                      Save Note
                    </button>
                  </div>
                  @if (invoice.comments && invoice.comments.length > 0) {
                    <div class="mt-3 pt-3 border-t border-gray-100 dark:border-line">
                      <p class="text-xs font-medium text-gray-600 dark:text-ink-dim mb-2">Previous Notes:</p>
                      @for (comment of invoice.comments; track comment.id) {
                        <div class="text-xs text-gray-500 dark:text-muted mb-1">
                          <span class="font-medium">{{ comment.userId }}</span>: {{ comment.comment }}
                          <span class="text-gray-400 dark:text-muted">({{ comment.createdAt }})</span>
                        </div>
                      }
                    </div>
                  }
                </div>
              } @else {
                <div class="mt-4 text-right">
                  <button
                    (click)="selectInvoiceForNote(invoice.invoiceId)"
                    class="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 transition-colors"
                  >
                    Add Note
                  </button>
                </div>
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
})
export class CollectionsWidgetComponent {
  readonly auth = inject(AuthService);

  // Using input() for now, will be fetched via service later
  readonly overdueInvoices = input<OverdueInvoiceDto[]>([]);

  readonly selectedInvoiceId = signal<string | null>(null);
  readonly noteContent = signal<string>('');
  readonly savingNote = signal(false);

  selectInvoiceForNote(invoiceId: string): void {
    this.selectedInvoiceId.set(invoiceId);
    this.noteContent.set(''); // Clear previous note content
  }

  cancelAddNote(): void {
    this.selectedInvoiceId.set(null);
    this.noteContent.set('');
  }

  async saveNote(invoiceId: string): Promise<void> {
    if (!this.noteContent()) return;

    this.savingNote.set(true);
    console.log(
      `Saving note for invoice ${invoiceId}: "${this.noteContent()}"`,
    );

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // In a real app, you would dispatch an action or call a service
    // to save the note to the backend (e.g., POST /invoices/:id/comments)

    // For now, let's just log and clear the form
    this.savingNote.set(false);
    this.selectedInvoiceId.set(null);
    this.noteContent.set('');
    // TODO: Ideally, emit an output event to notify the parent to refresh data
  }
}
