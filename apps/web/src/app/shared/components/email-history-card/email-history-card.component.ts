import { Component, input, signal, effect, inject, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { API } from '@app/core/config/api';

interface EmailLogEntry {
  id: string;
  documentType: string;
  sentFromEmail: string;
  sentTo: string;
  ccEmails: string | null;
  subject: string;
  pdfFileName: string | null;
  channel: string;
  status: string;
  errorMessage: string | null;
  sentByUserId: string;
  sentByName: string | null;
  createdAt: string;
}

@Component({
  selector: 'app-email-history-card',
  imports: [DatePipe],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
      <!-- Header -->
      <div class="flex items-center justify-between border-b border-gray-100 dark:border-line px-5 py-3.5">
        <div class="flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-indigo-500 dark:text-indigo-300" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
            <path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
          </svg>
          <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">Email History</h3>
          @if (emails().length) {
            <span class="rounded-full bg-indigo-50 dark:bg-indigo-500/15 px-2 py-0.5 text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
              {{ filteredEmails().length }}
            </span>
          }
        </div>
        @if (allTypes().length > 1) {
          <select
            class="rounded-md border border-gray-200 dark:border-line bg-white dark:bg-surface px-2 py-1 text-xs text-gray-600 dark:text-ink-dim outline-none focus:border-indigo-300 focus:ring-1 focus:ring-indigo-200"
            [value]="filterType()"
            (change)="filterType.set(asString($event))"
          >
            <option value="">All types</option>
            @for (t of allTypes(); track t) {
              <option [value]="t">{{ formatType(t) }}</option>
            }
          </select>
        }
      </div>

      <!-- Content -->
      <div class="max-h-[400px] overflow-y-auto">
        @if (loading()) {
          <div class="flex items-center justify-center py-8">
            <div class="h-5 w-5 animate-spin rounded-full border-2 border-indigo-200 dark:border-indigo-500/30 border-t-indigo-500"></div>
          </div>
        } @else if (!filteredEmails().length) {
          <div class="py-8 text-center text-sm text-gray-400 dark:text-muted">No emails sent yet</div>
        } @else {
          <ul class="divide-y divide-gray-50">
            @for (email of filteredEmails(); track email.id) {
              <li class="group px-5 py-3 transition-colors hover:bg-gray-50/60">
                <div class="flex items-start justify-between gap-3">
                  <div class="min-w-0 flex-1">
                    <!-- Subject + type badge -->
                    <div class="flex items-center gap-2">
                      <span [class]="typeBadgeClass(email.documentType)"
                            class="inline-flex shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
                        {{ formatType(email.documentType) }}
                      </span>
                      <span class="truncate text-sm font-medium text-gray-800 dark:text-ink">{{ email.subject }}</span>
                    </div>

                    <!-- Recipient -->
                    <div class="mt-1 flex items-center gap-1.5 text-xs text-gray-500 dark:text-muted">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 shrink-0 text-gray-400 dark:text-muted" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M3 4a2 2 0 0 0-2 2v1.161l8.441 4.221a1.25 1.25 0 0 0 1.118 0L19 7.162V6a2 2 0 0 0-2-2H3Z" />
                        <path d="m19 8.839-7.77 3.885a2.75 2.75 0 0 1-2.46 0L1 8.839V14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.839Z" />
                      </svg>
                      <span class="truncate">{{ email.sentTo }}</span>
                      @if (email.ccEmails) {
                        <span class="text-gray-300 dark:text-muted">|</span>
                        <span class="text-gray-400 dark:text-muted">CC: {{ email.ccEmails }}</span>
                      }
                    </div>

                    <!-- PDF attachment -->
                    @if (email.pdfFileName) {
                      <div class="mt-1 flex items-center gap-1 text-[11px] text-gray-400 dark:text-muted">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M4 4a2 2 0 0 1 2-2h4.586A2 2 0 0 1 12 2.586L15.414 6A2 2 0 0 1 16 7.414V16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4Z" clip-rule="evenodd" />
                        </svg>
                        {{ email.pdfFileName }}
                      </div>
                    }
                  </div>

                  <!-- Right side: status, channel, time -->
                  <div class="flex shrink-0 flex-col items-end gap-1">
                    <div class="flex items-center gap-1.5">
                      @if (email.status === 'FAILED') {
                        <span class="inline-flex items-center rounded-full bg-red-50 dark:bg-red-500/15 px-1.5 py-0.5 text-[10px] font-medium text-red-600 dark:text-red-400">
                          Failed
                        </span>
                      }
                      <span class="rounded-full bg-gray-100 dark:bg-surface-3 px-1.5 py-0.5 text-[10px] text-gray-500 dark:text-muted">
                        {{ email.channel === 'GRAPH' ? 'Outlook' : email.channel }}
                      </span>
                    </div>
                    <span class="text-[11px] text-gray-400 dark:text-muted">{{ email.createdAt | date:'short' }}</span>
                    @if (email.sentByName) {
                      <span class="text-[10px] text-gray-400 dark:text-muted">by {{ email.sentByName }}</span>
                    }
                  </div>
                </div>

                <!-- Error message -->
                @if (email.status === 'FAILED' && email.errorMessage) {
                  <div class="mt-1.5 rounded bg-red-50 dark:bg-red-500/15 px-2 py-1 text-[11px] text-red-600 dark:text-red-400">
                    {{ email.errorMessage }}
                  </div>
                }
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailHistoryCardComponent implements OnDestroy {
  readonly orderId = input.required<string>();

  private readonly http = inject(HttpClient);

  readonly emails = signal<EmailLogEntry[]>([]);
  readonly loading = signal(true);
  readonly filterType = signal('');

  readonly allTypes = signal<string[]>([]);
  readonly filteredEmails = signal<EmailLogEntry[]>([]);

  private refreshInterval: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const id = this.orderId();
      if (!id) return;
      this.loadEmails(id);
    });

    // Update filtered list when filter or emails change
    effect(() => {
      const type = this.filterType();
      const all = this.emails();
      this.filteredEmails.set(type ? all.filter((e) => e.documentType === type) : all);
    });

    this.refreshInterval = setInterval(() => {
      const id = this.orderId();
      if (id) this.loadEmails(id);
    }, 60_000);
  }

  ngOnDestroy(): void {
    if (this.refreshInterval) clearInterval(this.refreshInterval);
  }

  async loadEmails(orderId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: EmailLogEntry[] }>(`${API}/orders/${orderId}/email-log`),
      );
      if (res?.data) {
        this.emails.set(res.data);
        const types = [...new Set(res.data.map((e) => e.documentType))];
        this.allTypes.set(types.sort());
      }
    } catch {
      // ignore
    } finally {
      this.loading.set(false);
    }
  }

  formatType(type: string): string {
    switch (type) {
      case 'SALES_CONFIRMATION': return 'Confirmation';
      case 'CREDIT_NOTE': return 'Credit Note';
      default: return type.charAt(0) + type.slice(1).toLowerCase();
    }
  }

  typeBadgeClass(type: string): string {
    switch (type) {
      case 'OFFER': return 'bg-blue-50 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
      case 'INVOICE': return 'bg-emerald-50 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
      case 'SALES_CONFIRMATION': return 'bg-violet-50 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300';
      case 'INQUIRY': return 'bg-amber-50 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
      case 'CREDIT_NOTE': return 'bg-pink-50 text-pink-700 dark:bg-pink-500/15 dark:text-pink-300';
      default: return 'bg-gray-100 text-gray-600 dark:bg-surface-3 dark:text-ink-dim';
    }
  }

  asString(event: Event): string {
    return (event.target as HTMLSelectElement).value;
  }
}
