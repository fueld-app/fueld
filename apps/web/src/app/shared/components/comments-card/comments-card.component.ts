import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  input,
  effect,
  OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { DatePipe } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../../core/auth/auth.service';
import type { ApiResponse } from '@fueld/types';

import { API } from '@app/core/config/api';
import {
  followUpDateFromDays,
  followUpDaysFromDate,
  normalizeFollowUpDays,
  todayDateString,
} from './comments-card.follow-up';
import { DateLabelPipe } from '@app/shared/pipes/date-format.pipe';

interface Comment {
  id: string;
  entityType: string;
  entityId: string;
  userId: string;
  userName: string;
  content: string;
  followUpDate: string | null;
  followUpCompleted: boolean;
  createdAt: string;
  updatedAt: string;
}

@Component({
  selector: 'app-comments-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateLabelPipe, FormsModule, DatePipe],
  template: `
    <div class="app-panel h-[420px] flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="app-panel-header app-panel-header--blue justify-between px-5 py-3">
        <h2 class="text-sm font-semibold text-gray-700 dark:text-ink-dim">Comments</h2>
        @if (comments().length) {
          <span class="inline-flex items-center rounded-full bg-gray-100 dark:bg-surface-3 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:text-ink-dim">
            {{ comments().length }}
          </span>
        }
      </div>

      <!-- Comment input -->
      <div class="border-b border-gray-50 px-5 py-3 shrink-0">
        <div class="flex gap-3">
          <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 dark:bg-brand-700/15 text-xs font-medium text-brand-700 dark:text-brand-400">
            {{ currentUserInitials() }}
          </div>
          <div class="min-w-0 flex-1">
            <textarea
              [(ngModel)]="newContent"
              placeholder="Write a comment…"
              rows="2"
              class="w-full rounded-lg border border-gray-200 dark:border-line px-3 py-2 text-sm text-gray-700 dark:text-ink-dim placeholder-gray-400 focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none resize-none"
            ></textarea>

            <div class="mt-1.5 flex items-center gap-3 flex-wrap">
              @if (enableFollowUp()) {
                <!-- Follow-up date row -->
                <label class="inline-flex h-8 items-center gap-1.5 text-xs text-gray-500 dark:text-muted cursor-pointer select-none">
                  <input
                    type="checkbox"
                    [checked]="showFollowUpInput()"
                    (change)="toggleFollowUpInput()"
                    class="h-3.5 w-3.5 rounded border-gray-300 dark:border-line-strong text-amber-600 dark:text-amber-400 focus:ring-amber-500"
                  />
                  Follow-up
                </label>
                @if (showFollowUpInput()) {
                  <div class="inline-flex h-8 items-center gap-1 rounded-md border border-gray-200 dark:border-line bg-white dark:bg-surface px-2 text-xs text-gray-600 dark:text-ink-dim">
                    <span>in</span>
                    <input
                      type="number"
                      [ngModel]="newFollowUpDays"
                      (ngModelChange)="onFollowUpDaysChange($event)"
                      class="h-full w-16 border-0 bg-transparent p-0 text-right text-xs font-medium leading-none text-gray-700 dark:text-ink-dim outline-none focus:ring-0"
                    />
                    <span>days</span>
                  </div>
                  <input
                    type="date"
                    [ngModel]="newFollowUpDate"
                    (ngModelChange)="onFollowUpDateChange($event)"
                    class="h-8 rounded-md border border-gray-200 dark:border-line px-2 text-xs leading-none text-gray-700 dark:text-ink-dim focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                  />
                }
              }
              <div class="ml-auto">
                <button
                  (click)="addComment()"
                  [disabled]="!newContent.trim() || saving()"
                  class="inline-flex h-8 items-center rounded-lg bg-brand-700 px-3 text-xs font-medium text-white hover:bg-brand-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  @if (saving()) {
                    <svg class="inline h-3.5 w-3.5 animate-spin mr-1" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                  }
                  Post
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Comments list -->
      @if (loading()) {
        <div class="flex-1 min-h-0 flex items-center justify-center py-8">
          <svg class="h-5 w-5 animate-spin text-gray-400 dark:text-muted" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (comments().length) {
        <div class="divide-y divide-gray-50 flex-1 min-h-0 overflow-y-auto">
          @for (c of comments(); track c.id) {
            <div class="px-5 py-3 group hover:bg-gray-50/50 transition-colors">
              <div class="flex items-start gap-3">
                <!-- Avatar -->
                <div class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 dark:bg-surface-3 text-xs font-medium text-gray-600 dark:text-ink-dim">
                  {{ initials(c.userName) }}
                </div>

                <!-- Content -->
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-900 dark:text-ink">{{ c.userName }}</span>
                    <span class="text-[11px] text-gray-400 dark:text-muted">{{ c.createdAt | date:'short' }}</span>
                    @if (c.updatedAt !== c.createdAt) {
                      <span class="text-[10px] text-gray-400 dark:text-muted italic">(edited)</span>
                    }
                  </div>

                  @if (editingId() === c.id) {
                    <!-- Edit mode -->
                    <textarea
                      [(ngModel)]="editContent"
                      rows="2"
                      class="mt-1 w-full rounded-lg border border-gray-200 dark:border-line px-3 py-2 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none resize-none"
                    ></textarea>
                    <div class="mt-1.5 flex items-center gap-3 flex-wrap">
                      @if (enableFollowUp()) {
                        <label class="inline-flex h-8 items-center gap-1.5 text-xs text-gray-500 dark:text-muted cursor-pointer select-none">
                          <input
                            type="checkbox"
                            [checked]="editShowFollowUpInput()"
                            (change)="toggleEditFollowUpInput()"
                            class="h-3.5 w-3.5 rounded border-gray-300 dark:border-line-strong text-amber-600 dark:text-amber-400 focus:ring-amber-500"
                          />
                          Follow-up
                        </label>
                        @if (editShowFollowUpInput()) {
                          <div class="inline-flex h-8 items-center gap-1 rounded-md border border-gray-200 dark:border-line bg-white dark:bg-surface px-2 text-xs text-gray-600 dark:text-ink-dim">
                            <span>in</span>
                            <input
                              type="number"
                              [ngModel]="editFollowUpDays"
                              (ngModelChange)="onEditFollowUpDaysChange($event)"
                              class="h-full w-16 border-0 bg-transparent p-0 text-right text-xs font-medium leading-none text-gray-700 dark:text-ink-dim outline-none focus:ring-0"
                            />
                            <span>days</span>
                          </div>
                          <input
                            type="date"
                            [ngModel]="editFollowUpDate"
                            (ngModelChange)="onEditFollowUpDateChange($event)"
                            class="h-8 rounded-md border border-gray-200 dark:border-line px-2 text-xs leading-none text-gray-700 dark:text-ink-dim focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                          />
                        }
                      }
                      <button
                        (click)="saveEdit(c.id)"
                        [disabled]="!editContent.trim() || saving()"
                        class="rounded-md bg-brand-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-brand-800 disabled:opacity-50"
                      >
                        Save
                      </button>
                      <button
                        (click)="cancelEdit()"
                        class="rounded-md px-2.5 py-1 text-xs font-medium text-gray-500 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-tint-strong"
                      >
                        Cancel
                      </button>
                    </div>
                  } @else {
                    <!-- Display mode -->
                    <p class="mt-0.5 text-sm text-gray-600 dark:text-ink-dim whitespace-pre-line">{{ c.content }}</p>

                    <!-- Follow-up badge -->
                    @if (c.followUpDate) {
                      <div class="mt-1.5 flex items-center gap-1.5">
                        @if (c.followUpCompleted) {
                          <span class="inline-flex items-center gap-1 rounded-full bg-green-50 dark:bg-green-500/15 border border-green-200 dark:border-green-500/30 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:text-green-400 line-through">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                            </svg>
                            {{ c.followUpDate | dateLabel }}
                          </span>
                        } @else {
                          <span
                            class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
                            [class]="followUpBadgeClass(c.followUpDate)"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" />
                            </svg>
                            {{ c.followUpDate | dateLabel }}
                          </span>
                          <button
                            (click)="markFollowUpDone(c.id)"
                            [disabled]="saving()"
                            class="rounded-full p-0.5 text-gray-400 dark:text-muted hover:bg-green-50 dark:hover:bg-green-500/15 hover:text-green-600 transition-colors"
                            title="Mark follow-up done"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                              <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                            </svg>
                          </button>
                        }
                      </div>
                    }
                  }
                </div>

                <!-- Actions (only for own comments) -->
                @if (c.userId === currentUserId() && editingId() !== c.id) {
                  <div class="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      (click)="startEdit(c)"
                      class="rounded-md p-1 text-gray-400 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-tint-strong hover:text-gray-600"
                      title="Edit"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                      </svg>
                    </button>
                    <button
                      (click)="removeComment(c.id)"
                      class="rounded-md p-1 text-gray-400 dark:text-muted hover:bg-red-50 dark:hover:bg-red-500/15 hover:text-red-500"
                      title="Delete"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022 1.005 11.36A2.75 2.75 0 0 0 7.765 20h4.47a2.75 2.75 0 0 0 2.742-2.53l.954-10.788c.793-.122 1.577-.221 2.367-.298a.75.75 0 0 0-.23-1.482c-.781.122-1.57.22-2.365.298v-.443A2.75 2.75 0 0 0 12.75 1h-4Z" clip-rule="evenodd" />
                      </svg>
                    </button>
                  </div>
                }
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="flex-1 min-h-0 px-5 py-8 text-center text-sm text-gray-400 dark:text-muted">
          No comments yet — be the first to add one.
        </div>
      }
    </div>
  `,
})
export class CommentsCardComponent implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly entityType = input.required<string>();
  readonly entityId = input.required<string>();
  readonly enableFollowUp = input(true);

  readonly comments = signal<Comment[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly showFollowUpInput = signal(false);
  readonly editShowFollowUpInput = signal(false);

  newContent = '';
  editContent = '';
  newFollowUpDays = 0;
  newFollowUpDate = '';
  editFollowUpDays = 0;
  editFollowUpDate = '';

  readonly currentUserId = computed(() => this.auth.user()?.id ?? '');
  readonly currentUserInitials = computed(() => {
    const name = this.auth.user()?.name ?? '';
    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 0) return '?';
    return parts.length === 1
      ? parts[0][0].toUpperCase()
      : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  });

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    effect(() => {
      const id = this.entityId();
      const type = this.entityType();
      if (id && type) this.loadComments();
    });

    this.refreshTimer = setInterval(() => this.loadComments(false), 30_000);
  }

  ngOnDestroy() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  toggleFollowUpInput(): void {
    const show = !this.showFollowUpInput();
    this.showFollowUpInput.set(show);
    if (show && !this.newFollowUpDate) {
      this.initializeFollowUpInputs();
    }
  }

  onFollowUpDaysChange(value: unknown): void {
    const days = normalizeFollowUpDays(value);
    this.newFollowUpDays = days;
    this.newFollowUpDate = followUpDateFromDays(days);
  }

  onFollowUpDateChange(value: string): void {
    this.newFollowUpDate = value;
    this.newFollowUpDays = followUpDaysFromDate(value);
  }

  toggleEditFollowUpInput(): void {
    const show = !this.editShowFollowUpInput();
    this.editShowFollowUpInput.set(show);
    if (show) {
      this.initializeEditFollowUpInputs(this.editFollowUpDate || null);
    } else {
      this.clearEditFollowUpInputs();
    }
  }

  onEditFollowUpDaysChange(value: unknown): void {
    const days = normalizeFollowUpDays(value);
    this.editFollowUpDays = days;
    this.editFollowUpDate = followUpDateFromDays(days);
  }

  onEditFollowUpDateChange(value: string): void {
    this.editFollowUpDate = value;
    this.editFollowUpDays = followUpDaysFromDate(value);
  }

  followUpBadgeClass(dateStr: string): string {
    const today = todayDateString();
    if (dateStr < today) return 'bg-red-50 border-red-200 text-red-700';
    if (dateStr === today) return 'bg-amber-50 border-amber-200 text-amber-700';
    return 'bg-gray-50 border-gray-200 text-gray-600';
  }

  private initializeFollowUpInputs(): void {
    this.newFollowUpDays = 0;
    this.newFollowUpDate = todayDateString();
  }

  private clearFollowUpInputs(): void {
    this.newFollowUpDays = 0;
    this.newFollowUpDate = '';
  }

  private initializeEditFollowUpInputs(dateStr: string | null): void {
    const effectiveDate = dateStr || todayDateString();
    this.editFollowUpDate = effectiveDate;
    this.editFollowUpDays = followUpDaysFromDate(effectiveDate);
  }

  private clearEditFollowUpInputs(): void {
    this.editFollowUpDays = 0;
    this.editFollowUpDate = '';
  }

  async markFollowUpDone(commentId: string): Promise<void> {
    this.saving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<Comment>>(
          `${API}/comments/${encodeURIComponent(commentId)}/complete`,
          {},
        ),
      );
      if (res.success && res.data) {
        this.comments.update((list) =>
          list.map((c) => (c.id === commentId ? res.data! : c)),
        );
      }
    } catch {
      // silent
    } finally {
      this.saving.set(false);
    }
  }

  initials(name: string): string {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 0) return '?';
    return parts.length === 1
      ? parts[0][0].toUpperCase()
      : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  async loadComments(showLoading = true): Promise<void> {
    const type = this.entityType();
    const id = this.entityId();
    if (!type || !id) return;

    if (showLoading) this.loading.set(true);

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<Comment[]>>(
          `${API}/comments/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
        ),
      );
      if (res.success && res.data) {
        this.comments.set(res.data);
      }
    } catch {
      // silent
    } finally {
      this.loading.set(false);
    }
  }

  async addComment(): Promise<void> {
    const content = this.newContent.trim();
    if (!content) return;

    const type = this.entityType();
    const id = this.entityId();
    if (!type || !id) return;

    const followUpDate = this.showFollowUpInput() && this.newFollowUpDate ? this.newFollowUpDate : null;

    this.saving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<Comment>>(
          `${API}/comments/${encodeURIComponent(type)}/${encodeURIComponent(id)}`,
          { content, followUpDate },
        ),
      );
      if (res.success && res.data) {
        this.comments.update((list) => [res.data!, ...list]);
        this.newContent = '';
        this.clearFollowUpInputs();
        this.showFollowUpInput.set(false);
      }
    } catch {
      // silent
    } finally {
      this.saving.set(false);
    }
  }

  startEdit(c: Comment): void {
    this.editingId.set(c.id);
    this.editContent = c.content;
    this.editShowFollowUpInput.set(!!c.followUpDate);
    if (c.followUpDate) {
      this.initializeEditFollowUpInputs(c.followUpDate);
    } else {
      this.clearEditFollowUpInputs();
    }
  }

  cancelEdit(): void {
    this.editingId.set(null);
    this.editContent = '';
    this.editShowFollowUpInput.set(false);
    this.clearEditFollowUpInputs();
  }

  async saveEdit(commentId: string): Promise<void> {
    const content = this.editContent.trim();
    if (!content) return;

    const followUpDate = this.editShowFollowUpInput() && this.editFollowUpDate
      ? this.editFollowUpDate
      : null;

    this.saving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<Comment>>(
          `${API}/comments/${encodeURIComponent(commentId)}`,
          { content, followUpDate },
        ),
      );
      if (res.success && res.data) {
        this.comments.update((list) =>
          list.map((c) => (c.id === commentId ? res.data! : c)),
        );
        this.editingId.set(null);
        this.editContent = '';
        this.editShowFollowUpInput.set(false);
        this.clearEditFollowUpInputs();
      }
    } catch {
      // silent
    } finally {
      this.saving.set(false);
    }
  }

  async removeComment(commentId: string): Promise<void> {
    this.saving.set(true);
    try {
      const res = await firstValueFrom(
        this.http.delete<ApiResponse<{ id: string }>>(
          `${API}/comments/${encodeURIComponent(commentId)}`,
        ),
      );
      if (res.success) {
        this.comments.update((list) => list.filter((c) => c.id !== commentId));
      }
    } catch {
      // silent
    } finally {
      this.saving.set(false);
    }
  }
}
