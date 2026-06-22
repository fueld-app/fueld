import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { PaginationComponent } from '../../../../shared/components';
import { firstValueFrom } from 'rxjs';
import {
  CreditApplicationStatus,
} from '@fueld/types';
import type {
  CreditApplicationDto,
  ApiResponse,
  PaginatedResponse,
} from '@fueld/types';
import { AuthService } from '@app/core/auth/auth.service';
import { API } from '@app/core/config/api';

@Component({
  selector: 'app-credit-applications-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, RouterLink, PaginationComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Credit Applications</h1>
          <p class="mt-1 text-sm text-gray-500 dark:text-muted">
            Review and manage credit applications from traders.
          </p>
        </div>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap items-center gap-3 mb-4">
        @for (s of statusFilters; track s.value) {
          <button
            (click)="onStatusFilter(s.value)"
            class="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors"
            [class]="statusFilter() === s.value
              ? 'bg-brand-700 text-white shadow-sm'
              : 'bg-white dark:bg-surface text-gray-600 dark:text-ink-dim border border-gray-200 dark:border-line hover:bg-gray-50 dark:hover:bg-surface-tint'"
          >
            {{ s.label }}
            @if (s.value === 'PENDING' && pendingCount() > 0) {
              <span class="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
                {{ pendingCount() }}
              </span>
            }
          </button>
        }
      </div>

      <!-- Loading -->
      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <!-- Applications list -->
        <div class="space-y-4">
          @for (app of applications(); track app.id) {
            <div class="rounded-xl border bg-white dark:bg-surface shadow-sm overflow-hidden transition-all"
              [class]="app.status === 'PENDING' ? 'border-amber-200 dark:border-amber-500/30' : 'border-gray-200 dark:border-line'">

              <!-- Card header -->
              <div class="flex items-start justify-between gap-4 px-6 py-4 border-b border-gray-100 dark:border-line">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <a [routerLink]="['/companies', app.counterpartyId]"
                      class="text-base font-semibold text-gray-900 dark:text-ink hover:text-brand-600 transition-colors">
                      {{ app.counterpartyName }}
                    </a>
                    <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                      [class]="app.type === 'CUSTOMER'
                        ? 'bg-blue-50 dark:bg-blue-500/15 text-blue-700 dark:text-blue-400'
                        : 'bg-purple-50 dark:bg-purple-500/15 text-purple-700 dark:text-purple-400'">
                      {{ app.type }}
                    </span>
                    <span class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
                      [class]="statusClass(app.status)">
                      {{ app.status }}
                    </span>
                  </div>
                  <div class="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-muted">
                    <span>Requested by <strong class="text-gray-700 dark:text-ink-dim">{{ app.requestedByName }}</strong></span>
                    <span>{{ formatDate(app.createdAt) }}</span>
                    @if (app.orderReference) {
                      <span>
                        Order:
                        <a [routerLink]="['/trading/orders', app.orderId]"
                          class="font-medium text-brand-600 dark:text-brand-400 hover:underline">
                          {{ app.orderReference }}
                        </a>
                      </span>
                    }
                  </div>
                </div>
                <div class="text-right shrink-0">
                  <div class="text-lg font-bold text-gray-900 dark:text-ink">
                    {{ app.requestedCurrency }} {{ formatNumber(app.requestedAmount) }}
                  </div>
                  @if (app.requestedDays) {
                    <div class="text-sm text-gray-500 dark:text-muted">{{ app.requestedDays }} days</div>
                  }
                </div>
              </div>

              <!-- Reason -->
              @if (app.reason) {
                <div class="px-6 py-3 bg-gray-50/50 border-b border-gray-100 dark:border-line">
                  <p class="text-sm text-gray-600 dark:text-ink-dim">
                    <span class="font-medium text-gray-700 dark:text-ink-dim">Reason:</span>
                    {{ app.reason }}
                  </p>
                </div>
              }

              <!-- Reviews -->
              @if (app.reviews.length) {
                <div class="px-6 py-3 border-b border-gray-100 dark:border-line">
                  <h4 class="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-muted mb-2">Reviews</h4>
                  <div class="space-y-2">
                    @for (review of app.reviews; track review.id) {
                      <div class="flex items-start gap-2">
                        <span class="mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full"
                          [class]="review.decision === 'APPROVED'
                            ? 'bg-green-100 dark:bg-green-500/15 text-green-600 dark:text-green-400'
                            : 'bg-red-100 dark:bg-red-500/15 text-red-600 dark:text-red-400'">
                          @if (review.decision === 'APPROVED') {
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                            </svg>
                          } @else {
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                            </svg>
                          }
                        </span>
                        <div>
                          <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">{{ review.reviewerName }}</span>
                          <span class="text-sm text-gray-400 dark:text-muted"> &middot; {{ formatDate(review.decidedAt) }}</span>
                          @if (review.comment) {
                            <p class="text-sm text-gray-600 dark:text-ink-dim mt-0.5">{{ review.comment }}</p>
                          }
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }

              <!-- Actions (for credit managers on pending apps) -->
              @if (app.status === 'PENDING' && canReview()) {
                <div class="px-6 py-3 bg-gray-50/30">
                  @if (reviewingId() === app.id) {
                    <div class="space-y-3">
                      <div>
                        <label class="block text-sm font-medium text-gray-700 dark:text-ink-dim mb-1">Comment (optional)</label>
                        <textarea [ngModel]="reviewComment()" (ngModelChange)="reviewComment.set($event)" rows="2"
                          placeholder="Add a note about your decision..."
                          class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none resize-none">
                        </textarea>
                      </div>
                      <div class="flex items-center gap-2">
                        <button (click)="submitReview(app.id, 'APPROVED')"
                          [disabled]="submitting()"
                          class="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-green-700 transition-colors disabled:opacity-50">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/>
                          </svg>
                          Approve
                        </button>
                        <button (click)="submitReview(app.id, 'REJECTED')"
                          [disabled]="submitting()"
                          class="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-red-700 transition-colors disabled:opacity-50">
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/>
                          </svg>
                          Reject
                        </button>
                        <button (click)="reviewingId.set(null)"
                          class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors">
                          Cancel
                        </button>
                      </div>
                    </div>
                  } @else {
                    <button (click)="openReview(app.id)"
                      class="inline-flex items-center gap-1.5 rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-800 transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M10 12a2 2 0 100-4 2 2 0 000 4z"/>
                        <path fill-rule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clip-rule="evenodd"/>
                      </svg>
                      Review
                    </button>
                  }
                </div>
              }

              <!-- Cancel button for requester -->
              @if (app.status === 'PENDING' && app.requestedByUserId === currentUserId()) {
                <div class="px-6 py-3 bg-gray-50/30 flex justify-end">
                  <button (click)="cancelApplication(app.id)"
                    [disabled]="submitting()"
                    class="text-sm text-gray-500 dark:text-muted hover:text-red-600 transition-colors">
                    Cancel application
                  </button>
                </div>
              }
            </div>
          } @empty {
            <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-12 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" class="mx-auto h-12 w-12 text-gray-300 dark:text-muted" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd"/>
              </svg>
              <h3 class="mt-4 text-base font-medium text-gray-900 dark:text-ink">No applications</h3>
              <p class="mt-1 text-sm text-gray-500 dark:text-muted">
                @if (statusFilter() === 'PENDING') {
                  No pending credit applications to review.
                } @else {
                  No credit applications found with the selected filter.
                }
              </p>
            </div>
          }
        </div>

        <!-- Pagination -->
        <app-pagination
          [currentPage]="currentPage()"
          [totalItems]="total()"
          [pageSize]="pageSize"
          (pageChange)="changePage($event)"
        />
      }
    </div>
  `,
})
export class CreditApplicationsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly loading = signal(true);
  readonly applications = signal<CreditApplicationDto[]>([]);
  readonly total = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = 25;
  readonly pendingCount = signal(0);
  readonly statusFilter = signal<CreditApplicationStatus | ''>(CreditApplicationStatus.Pending);
  readonly submitting = signal(false);
  readonly reviewingId = signal<string | null>(null);
  readonly reviewComment = signal('');

  readonly canReview = computed(() => this.auth.canAccessCredit());
  readonly currentUserId = computed(() => this.auth.user()?.id ?? '');

  readonly statusFilters = [
    { label: 'Pending', value: CreditApplicationStatus.Pending },
    { label: 'Approved', value: CreditApplicationStatus.Approved },
    { label: 'Rejected', value: CreditApplicationStatus.Rejected },
    { label: 'Cancelled', value: CreditApplicationStatus.Cancelled },
    { label: 'All', value: '' as const },
  ];

  ngOnInit() {
    this.load();
    this.loadPendingCount();
  }

  async load() {
    this.loading.set(true);
    try {
      const params: Record<string, string> = {
        page: String(this.currentPage()),
        limit: String(this.pageSize),
      };
      if (this.statusFilter()) params['status'] = this.statusFilter();

      const res = await firstValueFrom(
        this.http.get<ApiResponse<PaginatedResponse<CreditApplicationDto>>>(
          `${API}/credit/applications`,
          { params },
        ),
      );
      if (res.success && res.data) {
        this.applications.set(res.data.items);
        this.total.set(res.data.total);
      }
    } catch (err) {
      console.error('Failed to load credit applications:', err);
    } finally {
      this.loading.set(false);
    }
  }

  async loadPendingCount() {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ count: number }>>(`${API}/credit/applications/pending-count`),
      );
      if (res.success && res.data) {
        this.pendingCount.set(res.data.count);
      }
    } catch { /* ignore */ }
  }

  onStatusFilter(status: CreditApplicationStatus | '') {
    this.statusFilter.set(status);
    this.currentPage.set(1);
    this.load();
  }

  changePage(page: number) {
    this.currentPage.set(page);
    this.load();
  }

  openReview(id: string) {
    this.reviewingId.set(id);
    this.reviewComment.set('');
  }

  async submitReview(applicationId: string, decision: 'APPROVED' | 'REJECTED') {
    this.submitting.set(true);
    try {
      const body: { decision: string; comment?: string } = { decision };
      if (this.reviewComment()) body.comment = this.reviewComment();

      await firstValueFrom(
        this.http.post<ApiResponse<CreditApplicationDto>>(
          `${API}/credit/applications/${applicationId}/review`,
          body,
        ),
      );

      this.reviewingId.set(null);
      this.reviewComment.set('');
      await Promise.all([this.load(), this.loadPendingCount()]);
    } catch (err) {
      console.error('Failed to submit review:', err);
    } finally {
      this.submitting.set(false);
    }
  }

  async cancelApplication(id: string) {
    if (!confirm('Cancel this credit application?')) return;
    this.submitting.set(true);
    try {
      await firstValueFrom(
        this.http.post<ApiResponse<CreditApplicationDto>>(
          `${API}/credit/applications/${id}/cancel`,
          {},
        ),
      );
      await Promise.all([this.load(), this.loadPendingCount()]);
    } catch (err) {
      console.error('Failed to cancel application:', err);
    } finally {
      this.submitting.set(false);
    }
  }

  statusClass(status: CreditApplicationStatus): string {
    switch (status) {
      case CreditApplicationStatus.Pending: return 'bg-amber-100 text-amber-800';
      case CreditApplicationStatus.Approved: return 'bg-green-100 text-green-800';
      case CreditApplicationStatus.Rejected: return 'bg-red-100 text-red-800';
      case CreditApplicationStatus.Cancelled: return 'bg-gray-100 text-gray-600';
      default: return 'bg-gray-100 text-gray-600';
    }
  }

  formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString('en-GB', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  formatNumber(val: string): string {
    return Number(val).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
}
