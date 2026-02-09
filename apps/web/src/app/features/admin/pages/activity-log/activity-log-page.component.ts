import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
  OnDestroy,
  computed,
  effect,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subscription } from 'rxjs';
import type { ApiResponse, ActivityLogDto, UserSessionDto } from '@fueld/types';
import { WebSocketService } from '../../../../core/websocket/websocket.service';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-activity-log-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Activity &amp; Sessions</h1>
          <p class="mt-1 text-sm text-gray-500">
            Real-time user sessions and activity audit log.
          </p>
        </div>
        <div class="flex items-center gap-3">
          <!-- Retention setting -->
          <div class="flex items-center gap-2 text-sm text-gray-600">
            <span>Retention:</span>
            <input
              type="number"
              [ngModel]="retentionDays()"
              (ngModelChange)="retentionDays.set($event)"
              (blur)="saveRetention()"
              min="1"
              max="3650"
              class="w-20 rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <span>days</span>
          </div>
        </div>
      </div>

      <!-- Tabs -->
      <div class="border-b border-gray-200 mb-6">
        <nav class="flex gap-6">
          <button
            (click)="activeTab.set('sessions')"
            class="pb-3 text-sm font-medium border-b-2 transition-colors"
            [class]="activeTab() === 'sessions'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'"
          >
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3" />
                <path d="M12 1v2m0 18v2m-9-11h2m18 0h2m-3.636-6.364l-1.414 1.414M6.05 17.95l-1.414 1.414m0-12.728l1.414 1.414m11.314 11.314l1.414 1.414" />
              </svg>
              Live Sessions
              @if (sessions().length > 0) {
                <span class="inline-flex items-center justify-center rounded-full bg-green-100 text-green-700 text-xs font-bold px-2 py-0.5">
                  {{ sessions().length }}
                </span>
              }
            </div>
          </button>
          <button
            (click)="activeTab.set('log')"
            class="pb-3 text-sm font-medium border-b-2 transition-colors"
            [class]="activeTab() === 'log'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'"
          >
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              Audit Log
            </div>
          </button>
        </nav>
      </div>

      <!-- ══════════ Sessions Tab ══════════ -->
      @if (activeTab() === 'sessions') {
        @if (sessions().length === 0) {
          <div class="text-center py-12 text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
            </svg>
            <p class="font-medium">No active sessions</p>
            <p class="text-sm mt-1">Sessions will appear here when users are online.</p>
          </div>
        } @else {
          <!-- Session summary cards -->
          <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
            <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p class="text-sm text-gray-500">Active Sessions</p>
              <p class="text-2xl font-bold text-gray-900 mt-1">{{ sessions().length }}</p>
            </div>
            <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p class="text-sm text-gray-500">Unique Users</p>
              <p class="text-2xl font-bold text-gray-900 mt-1">{{ uniqueUserCount() }}</p>
            </div>
            <div class="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <p class="text-sm text-gray-500">Avg. Sessions / User</p>
              <p class="text-2xl font-bold text-gray-900 mt-1">{{ avgSessionsPerUser() }}</p>
            </div>
          </div>

          <!-- Sessions table -->
          <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 bg-gray-50/80">
                  <th class="px-4 py-3 text-left font-medium text-gray-600">User</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Current Page</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Platform</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">IP</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Location</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Timezone</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Language</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Connected</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                @for (s of sessions(); track s.socketId) {
                  <tr class="transition-colors hover:bg-gray-50/50">
                    <td class="px-4 py-3">
                      <div class="flex items-center gap-2">
                        <span class="relative flex h-2.5 w-2.5">
                          <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75"></span>
                          <span class="relative inline-flex h-2.5 w-2.5 rounded-full bg-green-500"></span>
                        </span>
                        <div>
                          <p class="font-medium text-gray-900">{{ s.userName || 'Unknown' }}</p>
                          <p class="text-xs text-gray-500">{{ s.userEmail }}</p>
                        </div>
                      </div>
                    </td>
                    <td class="px-4 py-3 text-gray-600">
                      @if (s.pageTitle) {
                        <a [href]="s.currentUrl || '/'" class="text-xs font-medium text-brand-600 hover:text-brand-800 hover:underline">{{ s.pageTitle }}</a>
                      } @else {
                        <a [href]="s.currentUrl || '/'" class="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-brand-600 hover:text-brand-800 hover:underline font-mono">{{ s.currentUrl || '/' }}</a>
                      }
                    </td>
                    <td class="px-4 py-3 text-gray-600 text-xs">{{ s.platform || '—' }}</td>
                    <td class="px-4 py-3 text-gray-600">
                      <code class="text-xs">{{ s.clientIp || '—' }}</code>
                    </td>
                    <td class="px-4 py-3 text-gray-600 text-xs">
                      @if (s.city && s.country) {
                        {{ s.city }}, {{ s.country }}
                      } @else if (s.country) {
                        {{ s.country }}
                      } @else {
                        —
                      }
                    </td>
                    <td class="px-4 py-3 text-gray-600 text-xs">{{ s.timezone || '—' }}</td>
                    <td class="px-4 py-3 text-gray-600 text-xs">{{ s.language || '—' }}</td>
                    <td class="px-4 py-3 text-gray-600 text-xs">{{ formatTime(s.connectedAt) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      }

      <!-- ══════════ Audit Log Tab ══════════ -->
      @if (activeTab() === 'log') {
        <!-- Filters -->
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <select
            [ngModel]="filterAction()"
            (ngModelChange)="filterAction.set($event); loadLogs()"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All Actions</option>
            <option value="PAGE_VIEW">Page View</option>
            <option value="CREATE">Create</option>
            <option value="UPDATE">Update</option>
            <option value="DELETE">Delete</option>
            <option value="COPY">Copy</option>
            <option value="PRINT">Print</option>
            <option value="SCREENSHOT">Screenshot</option>
          </select>
          <select
            [ngModel]="filterEntity()"
            (ngModelChange)="filterEntity.set($event); loadLogs()"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
          >
            <option value="">All Entities</option>
            <option value="page">Page</option>
            <option value="company">Company</option>
            <option value="vessel">Vessel</option>
            <option value="place">Place</option>
            <option value="order">Order</option>
            <option value="credit_line">Credit Line</option>
            <option value="team">Team</option>
            <option value="user">User</option>
          </select>
          <input
            type="text"
            placeholder="Filter by user email..."
            [ngModel]="filterEmail()"
            (ngModelChange)="filterEmail.set($event)"
            (keyup.enter)="loadLogs()"
            class="rounded-md border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 w-60"
          />
          <div class="flex items-center gap-1.5">
            <input
              type="date"
              [ngModel]="filterDateFrom()"
              (ngModelChange)="filterDateFrom.set($event); loadLogs()"
              class="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
            <span class="text-gray-400 text-xs">–</span>
            <input
              type="date"
              [ngModel]="filterDateTo()"
              (ngModelChange)="filterDateTo.set($event); loadLogs()"
              class="rounded-md border border-gray-300 px-2 py-1.5 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
            />
          </div>
          <button
            (click)="loadLogs()"
            class="rounded-md bg-gray-100 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
          >
            Apply
          </button>
        </div>

        @if (logsLoading()) {
          <div class="flex items-center justify-center py-12">
            <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
            </svg>
          </div>
        } @else if (logs().length === 0) {
          <div class="text-center py-12 text-gray-500">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-12 w-12 mx-auto mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m5.231 13.481L15 17.25m-4.5-15H5.625c-.621 0-1.125.504-1.125 1.125v16.5c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9zm3.75 11.625a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
            </svg>
            <p class="font-medium">No activity logs found</p>
            <p class="text-sm mt-1">Activity will be recorded as users interact with the system.</p>
          </div>
        } @else {
          <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 bg-gray-50/80">
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Time</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">User</th>
                  <th class="px-4 py-3 text-center font-medium text-gray-600">Action</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Page / Entity</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Details</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">IP</th>
                  <th class="px-4 py-3 text-left font-medium text-gray-600">Platform</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                @for (log of logs(); track log.id) {
                  <tr class="transition-colors hover:bg-gray-50/50 cursor-pointer" (click)="expandedLogId.set(expandedLogId() === log.id ? null : log.id)">
                    <td class="px-4 py-3 text-gray-500 text-xs whitespace-nowrap">
                      <div class="flex items-center gap-1.5">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 text-gray-400 transition-transform" [class.rotate-90]="expandedLogId() === log.id" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
                        </svg>
                        {{ formatTimestamp(log.createdAt) }}
                      </div>
                    </td>
                    <td class="px-4 py-3">
                      <p class="font-medium text-gray-900 text-xs">{{ log.userName || 'System' }}</p>
                      <p class="text-[11px] text-gray-500">{{ log.userEmail }}</p>
                    </td>
                    <td class="px-4 py-3 text-center">
                      <span
                        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold"
                        [class]="actionBadge(log.action)"
                      >
                        {{ formatAction(log.action) }}
                      </span>
                    </td>
                    <td class="px-4 py-3">
                      @if (log.entityName && log.entityType) {
                        <span class="text-xs text-gray-700">{{ formatEntityLabel(log.entityType) }}</span>
                        <span class="text-xs text-gray-400 mx-1">›</span>
                        <span class="text-xs font-medium text-gray-800">{{ log.entityName }}</span>
                      } @else if (log.pageTitle) {
                        <a [href]="log.httpPath || '/'" class="text-xs font-medium text-brand-600 hover:text-brand-800 hover:underline">{{ log.pageTitle }}</a>
                      } @else if (log.entityType && log.entityType !== 'page') {
                        <span class="text-xs text-gray-700 capitalize">{{ formatEntityLabel(log.entityType) }}</span>
                        @if (log.entityId) {
                          <span class="text-[11px] text-gray-400 ml-1">#{{ log.entityId.slice(0, 8) }}</span>
                        }
                      } @else if (log.httpPath) {
                        <a [href]="log.httpPath" class="text-xs text-brand-600 hover:text-brand-800 hover:underline font-mono">{{ log.httpPath }}</a>
                      } @else {
                        <span class="text-xs text-gray-400">\u2014</span>
                      }
                    </td>
                    <td class="px-4 py-3">
                      @if (log.action === 'COPY' && log.metadata) {
                        <span class="text-[11px] text-gray-500 italic line-clamp-1" [title]="getCopiedText(log.metadata)">\u201c{{ getCopiedText(log.metadata) }}\u201d</span>
                      } @else if (log.httpMethod && log.action !== 'PAGE_VIEW') {
                        <code class="rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">{{ log.httpMethod }} {{ log.httpPath }}</code>
                      } @else {
                        <span class="text-xs text-gray-400">\u2014</span>
                      }
                    </td>
                    <td class="px-4 py-3">
                      <code class="text-[11px] text-gray-500">{{ log.clientIp || '\u2014' }}</code>
                    </td>
                    <td class="px-4 py-3 text-[11px] text-gray-500">{{ log.platform || '\u2014' }}</td>
                  </tr>                  @if (expandedLogId() === log.id) {
                    <tr class="bg-gray-50/80">
                      <td colspan="7" class="px-6 py-4">
                        <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-xs">
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">User Agent</p>
                            <p class="text-gray-700 break-all">{{ log.userAgent || '—' }}</p>
                          </div>
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">IP Address</p>
                            <p class="text-gray-700 font-mono">{{ log.clientIp || '—' }}</p>
                          </div>
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">Platform</p>
                            <p class="text-gray-700">{{ log.platform || '—' }}</p>
                          </div>
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">Timezone</p>
                            <p class="text-gray-700">{{ log.timezone || '—' }}</p>
                          </div>
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">Language</p>
                            <p class="text-gray-700">{{ log.language || '—' }}</p>
                          </div>
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">Location</p>
                            <p class="text-gray-700">
                              @if (log.city && log.country) {
                                {{ log.city }}, {{ log.country }}
                              } @else if (log.country) {
                                {{ log.country }}
                              } @else {
                                —
                              }
                            </p>
                          </div>
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">Page Title</p>
                            <p class="text-gray-700">{{ log.pageTitle || '—' }}</p>
                          </div>
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">Entity Type</p>
                            <p class="text-gray-700 capitalize">{{ log.entityType || '—' }}</p>
                          </div>
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">Entity ID</p>
                            <p class="text-gray-700 font-mono break-all">{{ log.entityId || '—' }}</p>
                          </div>
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">Entity Name</p>
                            <p class="text-gray-700">{{ log.entityName || '—' }}</p>
                          </div>
                          <div>
                            <p class="font-medium text-gray-500 mb-0.5">HTTP</p>
                            @if (log.httpMethod) {
                              <p class="text-gray-700 font-mono">{{ log.httpMethod }} {{ log.httpPath }}</p>
                            } @else {
                              <p class="text-gray-700">—</p>
                            }
                          </div>
                          @if (log.metadata) {
                            <div class="col-span-2 md:col-span-4">
                              <p class="font-medium text-gray-500 mb-0.5">Metadata</p>
                              <pre class="text-gray-700 bg-gray-100 rounded-md px-3 py-2 overflow-x-auto text-[11px]">{{ formatMetadata(log.metadata) }}</pre>
                            </div>
                          }
                        </div>
                      </td>
                    </tr>
                  }                }
              </tbody>
            </table>
          </div>

          <!-- Pagination -->
          <div class="flex items-center justify-between mt-4 text-sm text-gray-600">
            <p>Showing {{ logs().length }} of {{ totalLogs() }} entries</p>
            <div class="flex gap-2">
              <button
                (click)="prevPage()"
                [disabled]="currentPage() <= 1"
                class="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span class="flex items-center px-3 py-1.5 text-sm text-gray-500">
                Page {{ currentPage() }}
              </span>
              <button
                (click)="nextPage()"
                [disabled]="logs().length < pageSize"
                class="rounded-md border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        }
      }
    </div>
  `,
})
export class ActivityLogPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly wsService = inject(WebSocketService);
  private readonly titleService = inject(Title);
  private sessionSub?: Subscription;

  // ── Tab state ──
  readonly activeTab = signal<'sessions' | 'log'>('sessions');

  private readonly tabTitleEffect = effect(() => {
    const tab = this.activeTab();
    const label = tab === 'sessions' ? 'Live Sessions' : 'Audit Log';
    this.titleService.setTitle(`Fueld | Admin > Activity Log > ${label}`);
    this.wsService.sendPresence(location.pathname, `Admin > Activity Log > ${label}`);
  });

  // ── Sessions ──
  readonly sessions = signal<UserSessionDto[]>([]);
  readonly uniqueUserCount = computed(() => {
    const ids = new Set(this.sessions().map((s) => s.userId));
    return ids.size;
  });
  readonly avgSessionsPerUser = computed(() => {
    const unique = this.uniqueUserCount();
    if (unique === 0) return '0';
    return (this.sessions().length / unique).toFixed(1);
  });

  // ── Audit logs ──
  readonly logs = signal<ActivityLogDto[]>([]);
  readonly logsLoading = signal(false);
  readonly totalLogs = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = 50;

  // ── Filters ──
  readonly filterAction = signal('');
  readonly filterEntity = signal('');
  readonly filterEmail = signal('');
  readonly filterDateFrom = signal('');
  readonly filterDateTo = signal('');

  // ── Expanded detail ──
  readonly expandedLogId = signal<string | null>(null);

  // ── Retention ──
  readonly retentionDays = signal(90);

  ngOnInit(): void {
    // Subscribe to live sessions
    this.sessionSub = this.wsService
      .on<UserSessionDto[]>('admin:sessions')
      .subscribe((data) => this.sessions.set(data));
    this.wsService.send({ type: 'admin:subscribe-sessions' });

    // Load retention setting
    this.loadRetention();

    // Load initial logs
    this.loadLogs();
  }

  ngOnDestroy(): void {
    this.wsService.send({ type: 'admin:unsubscribe-sessions' });
    this.sessionSub?.unsubscribe();
  }

  // ── Sessions helpers ──

  formatTime(iso: string): string {
    if (!iso) return '—';
    const d = new Date(iso);
    const now = Date.now();
    const diff = now - d.getTime();
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return d.toLocaleDateString();
  }

  // ── Audit log methods ──

  async loadLogs(): Promise<void> {
    this.logsLoading.set(true);
    try {
      const params: Record<string, string> = {
        page: String(this.currentPage()),
        pageSize: String(this.pageSize),
      };
      if (this.filterAction()) params['action'] = this.filterAction();
      if (this.filterEntity()) params['entityType'] = this.filterEntity();
      if (this.filterDateFrom()) params['dateFrom'] = this.filterDateFrom();
      if (this.filterDateTo()) params['dateTo'] = this.filterDateTo();

      const qs = new URLSearchParams(params).toString();
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: ActivityLogDto[]; total: number }>>(
          `${API}/admin/activity?${qs}`,
        ),
      );
      if (res.success && res.data) {
        this.logs.set(res.data.items);
        this.totalLogs.set(res.data.total);
      }
    } catch {
      // silent
    } finally {
      this.logsLoading.set(false);
    }
  }

  nextPage(): void {
    this.currentPage.update((p) => p + 1);
    this.loadLogs();
  }

  prevPage(): void {
    this.currentPage.update((p) => Math.max(1, p - 1));
    this.loadLogs();
  }

  formatTimestamp(ts: string): string {
    if (!ts) return '—';
    const d = new Date(ts);
    return d.toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  }

  actionBadge(action: string): string {
    switch (action) {
      case 'CREATE':
        return 'bg-green-100 text-green-700';
      case 'UPDATE':
        return 'bg-blue-100 text-blue-700';
      case 'DELETE':
        return 'bg-red-100 text-red-700';
      case 'PAGE_VIEW':
        return 'bg-purple-100 text-purple-700';
      case 'COPY':
        return 'bg-amber-100 text-amber-700';
      case 'PRINT':
        return 'bg-cyan-100 text-cyan-700';
      case 'SCREENSHOT':
        return 'bg-rose-100 text-rose-700';
      case 'VIEW':
        return 'bg-gray-100 text-gray-600';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  }

  formatAction(action: string): string {
    switch (action) {
      case 'PAGE_VIEW': return 'Page View';
      case 'COPY': return 'Copy';
      case 'PRINT': return 'Print';
      case 'SCREENSHOT': return 'Screenshot';
      case 'CREATE': return 'Create';
      case 'UPDATE': return 'Update';
      case 'DELETE': return 'Delete';
      case 'VIEW': return 'View';
      default: return action;
    }
  }

  formatEntityLabel(entityType: string): string {
    const labels: Record<string, string> = {
      place: 'Places',
      company: 'Companies',
      vessel: 'Vessels',
      order: 'Orders',
      credit_line: 'Credit Lines',
      port_supplier: 'Port Suppliers',
      team: 'Teams',
      user: 'Users',
      company_group: 'Company Groups',
      integration: 'Integrations',
    };
    return labels[entityType] || entityType.charAt(0).toUpperCase() + entityType.slice(1);
  }

  getCopiedText(metadata: unknown): string {
    if (metadata && typeof metadata === 'object' && 'copiedText' in metadata) {
      return String((metadata as any).copiedText);
    }
    return '';
  }

  formatMetadata(metadata: unknown): string {
    try {
      return JSON.stringify(metadata, null, 2);
    } catch {
      return String(metadata);
    }
  }

  // ── Retention ──

  async loadRetention(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ retentionDays: number }>>(
          `${API}/admin/settings/activity-retention`,
        ),
      );
      if (res.success && res.data) {
        this.retentionDays.set(res.data.retentionDays);
      }
    } catch {
      // silent
    }
  }

  async saveRetention(): Promise<void> {
    try {
      await firstValueFrom(
        this.http.put(`${API}/admin/settings/activity-retention`, {
          retentionDays: this.retentionDays(),
        }),
      );
    } catch {
      // silent
    }
  }
}
