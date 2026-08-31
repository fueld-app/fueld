import {
  Component,
  ChangeDetectionStrategy,
  signal,
  effect,
  inject,
  OnInit,
  OnDestroy,
  computed,
  input,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { FormsModule } from '@angular/forms';
import { StatusBadgeComponent } from '../../../../shared/components/status-badge/status-badge.component';
import { type DropdownOption } from '../../../../shared/components/searchable-dropdown/searchable-dropdown.component';
import { PaginationComponent, SortHeaderComponent } from '../../../../shared/components';
import { ColumnPickerComponent, type ColumnOption } from '../../../../shared/components/column-picker/column-picker.component';
import type { SortChangeEvent, SortField } from '../../../../shared/components';
import type { ApiResponse, OrderListRowDto, UserUiPreferences, CustomColumnDef } from '@fueld/types';
import { InquiriesListNewInquiryModalComponent } from './inquiries-list-new-inquiry-modal.component';
import type { TeamUserOption } from './inquiries-list.types';
import { DecimalPipe, DatePipe } from '@angular/common';
import { DateLabelPipe } from '../../../../shared/pipes/date-format.pipe';
import { DateFormatService } from '@app/core/services/date-format.service';
import { firstValueFrom } from 'rxjs';
import { FilterOverlayComponent, type FilterState, EMPTY_FILTERS, type FilterFieldDef } from '../../../../shared/components/filter-overlay/filter-overlay.component';

// ═══════════════════════════════════════════════════════════════════════
//  Inquiries List Page — INQUIRY + OFFER status orders
// ═══════════════════════════════════════════════════════════════════════

import { API } from '@app/core/config/api';
import { AuthService } from '@app/core/auth/auth.service';
import { UserPreferencesService } from '@app/core/services/user-preferences.service';
import { NewInquiryModalService } from '@app/core/trading/new-inquiry-modal.service';

// TeamUserOption is defined in inquiries-list.types.ts

@Component({
  selector: 'app-inquiries-list-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, StatusBadgeComponent, FormsModule, DecimalPipe, DatePipe, DateLabelPipe, PaginationComponent, SortHeaderComponent, ColumnPickerComponent, InquiriesListNewInquiryModalComponent, FilterOverlayComponent],
  template: `
    <div>
      <!-- Header -->
      <div class="mb-6">
        <div class="flex items-center justify-between">
          <div>
            <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">{{ titleText() }}</h1>
            <p class="mt-1 text-sm text-gray-500 dark:text-muted">{{ subtitleText() }}</p>
          </div>
          @if (isBrokerDeals()) {
            <a routerLink="/reports/broker-commission"
              class="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint transition-colors">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zm0 6a1 1 0 011-1h12a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6z" clip-rule="evenodd" />
              </svg>
              Commission Report
            </a>
          }
        </div>
      </div>

      <!-- Search bar + Filter button -->
      <div class="mb-4 flex flex-wrap items-center gap-3">
        <div class="flex flex-1 items-center gap-3">
          <input
            type="text"
            [ngModel]="searchTerm()"
            (ngModelChange)="onSearch($event)"
            [placeholder]="searchPlaceholder()"
            class="min-w-0 flex-1 max-w-md rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2.5 text-sm shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          />
          <app-filter-overlay
            [filters]="filterState()"
            [fields]="filterFields()"
            [countFn]="filterCountFn"
            [applying]="applyingFilters()"
            (filtersChange)="onFiltersChange($event)"
          />
        </div>
        <div class="ml-auto">
          <app-column-picker
            [columns]="allColumnOptions()"
            [visible]="visibleColumnFields()"
            [order]="columnOrder()"
            (visibleChange)="onColumnVisibilityChange($event)"
            (orderChange)="onColumnOrderChange($event)"
          />
        </div>
      </div>

      <!-- Active filter pills -->
      @if (activeFilterPills().length > 0) {
        <div class="mb-4 flex flex-wrap gap-2">
          @for (pill of activeFilterPills(); track pill.key) {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-brand-50 dark:bg-brand-700/15 px-3 py-1 text-xs font-medium text-brand-700 dark:text-brand-400">
              {{ pill.label }}: {{ pill.value }}
              <button type="button" (click)="removeFilter(pill.key)" class="inline-flex items-center justify-center rounded-full hover:bg-brand-100 dark:hover:bg-brand-700/25 w-4 h-4">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z"/>
                </svg>
              </button>
            </span>
          }
          <button type="button" (click)="clearAllFilters()" class="text-xs text-gray-500 dark:text-muted hover:text-gray-700 dark:hover:text-ink-dim underline">Clear all</button>
        </div>
      }

      <!-- Loading state -->
      @if (loading()) {
        <div class="flex items-center justify-center py-20">
          <svg class="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <!-- Batch complete bar (invoiced orders only) -->
        @if (isBatchMode() && selectedCount() > 0) {
          <div class="mb-3 flex items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-2.5 dark:border-brand-800 dark:bg-brand-900/20">
            <span class="text-sm font-medium text-brand-700 dark:text-brand-300">
              {{ selectedCount() }} order(s) selected
            </span>
            <button (click)="batchComplete()" [disabled]="batchLoading()"
              class="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50 inline-flex items-center gap-1.5">
              @if (batchLoading()) {
                <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path></svg>
                Completing…
              } @else {
                Batch Complete (Mark as Paid)
              }
            </button>
            <button (click)="clearSelection()"
              class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-1.5 text-sm font-medium text-gray-600 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint">
              Clear Selection
            </button>
          </div>
        }
        <!-- Desktop table -->
        <div class="hidden md:block overflow-x-auto rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface shadow-sm">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 dark:border-line bg-gray-50/80 dark:bg-surface-2">
                @if (isBatchMode()) {
                  <th class="px-4 py-3 w-10">
                    <input type="checkbox" [checked]="allOnPageSelected()" (change)="toggleSelectAll($event)"
                      class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                  </th>
                }
                @for (col of visibleColumns(); track col.field) {
                  @if (col.sortable) {
                    <th app-sort-header [field]="col.field" [sortFields]="activeSortFields()" (sortChange)="onSort($event)" class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">{{ col.label }}</th>
                  } @else {
                    <th class="px-4 py-3 text-left font-medium text-gray-600 dark:text-ink-dim">{{ col.label }}</th>
                  }
                }
                <th class="px-4 py-3 w-12"></th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100 dark:divide-line">
              @for (inq of inquiries(); track inq.id) {
                <tr class="transition-colors hover:bg-gray-50/50 cursor-pointer dark:hover:bg-surface-tint"
                  [class.bg-red-50\/60]="isEtaSoon(inq.eta, inq.status)"
                  [class.dark\:bg-red-500\/10]="isEtaSoon(inq.eta, inq.status)"
                  (click)="onRowClick($event, inq.orderNumber || inq.id)"
                  (auxclick)="onRowAuxClick($event, inq.orderNumber || inq.id)">
                  @if (isBatchMode()) {
                    <td class="px-4 py-3" (click)="$event.stopPropagation()">
                      <input type="checkbox" [checked]="selectedOrderIds().has(inq.id)"
                        (change)="toggleOrderSelection($event, inq.id)"
                        class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600" />
                    </td>
                  }
                  @for (col of visibleColumns(); track col.field) {
                    @switch (col.field) {
                      @case ('orderNumber') {
                        <td class="relative px-4 py-3 font-mono text-xs text-gray-500 dark:text-muted">
                          <a [routerLink]="[baseRoute(), inq.orderNumber || inq.id]"
                            class="absolute inset-0 z-0"
                            tabindex="-1" aria-hidden="true"
                            (click)="$event.stopPropagation()"></a>
                          <a [routerLink]="[baseRoute(), inq.orderNumber || inq.id]"
                            (click)="$event.stopPropagation()"
                            class="relative z-10 hover:text-brand-700 dark:hover:text-brand-400 hover:underline">
                            {{ inq.orderNumber ?? '—' }}
                          </a>
                        </td>
                      }
                      @case ('client') {
                        <td class="px-4 py-3 font-medium text-gray-900 dark:text-ink">{{ inq.clientName }}</td>
                      }
                      @case ('vessel') {
                        <td class="px-4 py-3 text-gray-600 dark:text-ink-dim">{{ inq.vesselName }}</td>
                      }
                      @case ('port') {
                        <td class="px-4 py-3 text-gray-600 dark:text-ink-dim">{{ inq.placeName }}</td>
                      }
                      @case ('status') {
                        <td class="px-4 py-3">
                          <app-status-badge [status]="inq.status" />
                        </td>
                      }
                      @case ('booking') {
                        <td class="px-4 py-3" (click)="$event.stopPropagation()">
                          <button type="button"
                            class="inline-flex h-5 w-5 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
                            [class.bg-green-500]="!!inq.bunkerBookingSentAt"
                            [class.bg-red-500]="!inq.bunkerBookingSentAt"
                            [title]="inq.bunkerBookingSentAt ? ('Bunker Booking sent ' + (inq.bunkerBookingSentAt | date: 'dd MMM yyyy HH:mm')) : 'Bunker Booking not sent — click to mark as sent'"
                            (click)="toggleBunkerBooking($event, inq)">
                            @if (inq.bunkerBookingSentAt) {
                              <svg class="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke-width="3" stroke="currentColor" aria-hidden="true">
                                <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                              </svg>
                            } @else {
                              <span class="block h-1.5 w-1.5 rounded-full bg-white"></span>
                            }
                          </button>
                        </td>
                      }
                      @case ('responsible') {
                        <td class="px-4 py-3 text-gray-600 dark:text-ink-dim">{{ inq.salesRepName || '—' }}</td>
                      }
                      @case ('invoicingCompany') {
                        <td class="px-4 py-3 text-gray-600 dark:text-ink-dim">{{ inq.invoicingCompanyName || '—' }}</td>
                      }
                      @case ('eta') {
                        <td class="px-4 py-3">
                          @if (inq.eta) {
                            @if (isEtaSoon(inq.eta, inq.status)) {
                              <span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500\/15 dark:text-red-400">{{ inq.eta | dateLabel }}</span>
                            } @else {
                              <span class="text-gray-500 dark:text-muted">{{ inq.eta | dateLabel }}</span>
                            }
                          } @else {
                            <span class="text-gray-500 dark:text-muted">—</span>
                          }
                        </td>
                      }
                      @case ('dueDate') {
                        <td class="px-4 py-3 text-gray-500 dark:text-muted">{{ inq.dueDate ? (inq.dueDate | dateLabel) : '—' }}</td>
                      }
                      @case ('value') {
                        <td class="px-4 py-3 text-right tabular-nums text-gray-900 dark:text-ink">
                          @if (inq.totalValue > 0) {
                            {{ inq.totalValue | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                          } @else {
                            <span class="text-gray-400 dark:text-muted">—</span>
                          }
                        </td>
                      }
                      @case ('gross') {
                        <td class="px-4 py-3 text-right tabular-nums" [class.text-green-600]="inq.totalProfit > 0" [class.text-red-600]="inq.totalProfit < 0">
                          @if (inq.totalValue > 0 || inq.totalProfit !== 0) {
                            {{ inq.totalProfit | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                          } @else {
                            <span class="text-gray-400 dark:text-muted">—</span>
                          }
                        </td>
                      }
                      @case ('financing') {
                        <td class="px-4 py-3 text-right tabular-nums text-amber-700 dark:text-amber-400">
                          @if (inq.totalValue > 0 || (inq.totalFinancingCost ?? 0) !== 0) {
                            {{ (inq.totalFinancingCost ?? 0) | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                          } @else {
                            <span class="text-gray-400 dark:text-muted">—</span>
                          }
                        </td>
                      }
                      @case ('net') {
                        <td class="px-4 py-3 text-right tabular-nums" [class.text-green-600]="(inq.totalNetProfit ?? 0) > 0" [class.text-red-600]="(inq.totalNetProfit ?? 0) < 0">
                          @if (inq.totalValue > 0 || (inq.totalNetProfit ?? 0) !== 0) {
                            {{ (inq.totalNetProfit ?? 0) | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                          } @else {
                            <span class="text-gray-400 dark:text-muted">—</span>
                          }
                        </td>
                      }
                      @case ('createdAt') {
                        <td class="px-4 py-3 text-gray-500 dark:text-muted">{{ inq.createdAt | dateLabel }}</td>
                      }
                      @default {
                        @if (customColumnForField(col.field); as cc) {
                          @if (isEditingCustomCell(inq.id, cc.key)) {
                            <td class="px-4 py-3" (click)="$event.stopPropagation()" (auxclick)="$event.stopPropagation()">
                              <input
                                type="text"
                                [attr.data-edit]="inq.id + '-' + cc.key"
                                class="w-full rounded border border-brand-300 px-1.5 py-1 text-sm text-gray-900 dark:border-brand-500 dark:bg-surface-2 dark:text-ink focus:border-brand-500 focus:outline-none"
                                [value]="editingCustomValue()"
                                (input)="editingCustomValue.set($any($event.target).value)"
                                (keydown.enter)="saveCustomField(inq, cc.key, $event)"
                                (keydown.escape)="cancelEditCustomCell($event)"
                                (blur)="saveCustomField(inq, cc.key, $event)"
                              />
                            </td>
                          } @else {
                            <td class="px-4 py-3 text-gray-600 dark:text-ink-dim"
                                (click)="startEditCustomCell(inq, cc.key, $event)"
                                title="Click to edit">
                              <span class="cursor-text hover:text-brand-700 dark:hover:text-brand-400">{{ inq.customFields?.[cc.key] || '—' }}</span>
                            </td>
                          }
                        } @else {
                          <td class="px-4 py-3"></td>
                        }
                      }
                    }
                  }
                  <td class="relative z-10 px-4 py-3">
                    <a
                      [routerLink]="[baseRoute(), inq.orderNumber || inq.id]"
                      class="rounded-md p-1 text-gray-400 dark:text-muted hover:text-brand-600 transition-colors"
                      [attr.aria-label]="isOrders() ? 'View order' : 'View inquiry'"
                      (click)="$event.stopPropagation()"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                        <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
                      </svg>
                    </a>
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td [attr.colspan]="visibleColumns().length + 1 + (isBatchMode() ? 1 : 0)" class="px-4 py-12 text-center">
                    <p class="text-sm text-gray-400 dark:text-muted">{{ isOrders() ? 'No orders found.' : 'No inquiries found.' }}</p>
                    @if (!isOrders()) {
        <button
                        (click)="openNewInquiryModal()"
                        class="mt-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700"
                      >
                        + Create your first inquiry
                      </button>
                    }
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Pagination -->
        <app-pagination
          [currentPage]="currentPage()"
          [totalItems]="totalItems()"
          [pageSize]="pageSize()"
          (pageChange)="goToPage($event)"
        />

        <!-- Mobile cards -->
        <div class="space-y-3 md:hidden">
          @for (inq of inquiries(); track inq.id) {
            <a
              [routerLink]="[baseRoute(), inq.orderNumber || inq.id]"
              class="block overflow-hidden rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div class="flex items-center justify-between mb-2">
                <span class="min-w-0 font-semibold text-gray-900 dark:text-ink">{{ inq.clientName }}</span>
                <span class="flex items-center gap-1.5">
                  @if (isOrders()) {
                    <button type="button"
                      class="inline-flex h-3.5 w-3.5 items-center justify-center rounded-full"
                      [class.bg-green-500]="!!inq.bunkerBookingSentAt"
                      [class.bg-red-500]="!inq.bunkerBookingSentAt"
                      [title]="inq.bunkerBookingSentAt ? 'Bunker Booking sent' : 'Bunker Booking not sent — tap to mark as sent'"
                      (click)="$event.stopPropagation(); toggleBunkerBooking($event, inq)">
                      @if (inq.bunkerBookingSentAt) {
                        <svg class="h-2 w-2 text-white" fill="none" viewBox="0 0 24 24" stroke-width="4" stroke="currentColor" aria-hidden="true">
                          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                        </svg>
                      } @else {
                        <span class="block h-1 w-1 rounded-full bg-white"></span>
                      }
                    </button>
                  }
                  <app-status-badge [status]="inq.status" />
                </span>
              </div>
              @if (inq.orderNumber) {
                <p class="text-xs font-mono text-gray-400 dark:text-muted mb-1">{{ inq.orderNumber }}</p>
              }
              <div class="grid grid-cols-2 gap-1 text-xs text-gray-500 dark:text-muted">
                <span>{{ inq.vesselName }}</span>
                <span>{{ inq.placeName }}</span>
                <span [class.text-red-600]="isEtaSoon(inq.eta, inq.status)" [class.dark\:text-red-400]="isEtaSoon(inq.eta, inq.status)" [class.font-semibold]="isEtaSoon(inq.eta, inq.status)">ETA {{ inq.eta ? (inq.eta | dateLabel) : '—' }}</span>
                <span>Resp {{ inq.salesRepName || '—' }}</span>
                <span>{{ inq.createdAt | dateLabel }}</span>
              </div>
              @if (isOrders() && auth.canSeePrices()) {
                <div class="mt-3 grid grid-cols-2 gap-2 rounded-lg border border-gray-100 dark:border-line bg-gray-50 dark:bg-bg-2 p-3 text-xs">
                  <div>
                    <p class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-muted">Gross</p>
                    <p class="mt-1 font-semibold tabular-nums" [class.text-green-600]="inq.totalProfit > 0" [class.text-red-600]="inq.totalProfit < 0">
                      {{ inq.totalProfit | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                    </p>
                  </div>
                  <div>
                    <p class="text-[11px] uppercase tracking-wide text-amber-700 dark:text-amber-400">Financing</p>
                    <p class="mt-1 font-semibold tabular-nums text-amber-700 dark:text-amber-400">
                      {{ (inq.totalFinancingCost ?? 0) | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                    </p>
                  </div>
                  <div>
                    <p class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-muted">Net</p>
                    <p class="mt-1 font-semibold tabular-nums" [class.text-green-600]="(inq.totalNetProfit ?? 0) > 0" [class.text-red-600]="(inq.totalNetProfit ?? 0) < 0">
                      {{ (inq.totalNetProfit ?? 0) | number:'1.2-2' }} {{ inq.displayCurrency || 'USD' }}
                    </p>
                  </div>
                  <div>
                    <p class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-muted">Net Margin</p>
                    <p class="mt-1 font-semibold tabular-nums text-gray-700 dark:text-ink-dim">
                      Net Margin {{ (inq.netMarginPct ?? 0) | number:'1.2-2' }}%
                    </p>
                  </div>
                </div>
              }
            </a>
          } @empty {
            <div class="rounded-xl border-2 border-dashed border-gray-300 dark:border-line-strong bg-white dark:bg-surface p-8 text-center">
              <p class="text-sm text-gray-400 dark:text-muted">{{ isOrders() ? 'No orders yet.' : 'No inquiries yet.' }}</p>
              @if (!isOrders()) {
                  <button
                    (click)="openNewInquiryModal()"
                    class="mt-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700"
                  >
                    + Create your first inquiry
                  </button>
              }
            </div>
          }
        </div>
      }
    </div>

    <!-- ═════════════════════════════════════════════════════════════ -->
    <!--  New Inquiry Modal                                           -->
    @if (!isOrders()) {
      <app-inquiries-list-new-inquiry-modal
        [open]="newInquiryModalOpen()"
        [responsibleOptions]="responsibleFilterOptions()"
        (close)="onNewInquiryModalClose()"
        (created)="onNewInquiryCreated()"
      />
    }

    <!-- Toast -->
    @if (toast()) {
      <div
        class="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium shadow-lg"
        [class]="toast()!.type === 'success'
          ? 'border-green-200 dark:border-green-500/30 bg-green-50 dark:bg-green-500/15 text-green-800 dark:text-green-300'
          : 'border-red-200 dark:border-red-500/30 bg-red-50 dark:bg-red-500/15 text-red-800 dark:text-red-300'"
      >
        {{ toast()!.message }}
      </div>
    }
  `,
})
export class InquiriesListPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly auth = inject(AuthService);
  private readonly newInquiryModal = inject(NewInquiryModalService);
  private queryParamSub?: Subscription;

  readonly mode = input<'inquiries' | 'active-orders' | 'delivered-orders' | 'invoiced-orders' | 'completed-orders' | 'cancelled-orders' | 'lost-inquiries' | 'broker-deals' | undefined>('inquiries');
  readonly resolvedMode = computed(() => this.mode() ?? 'inquiries');

  readonly isBrokerDeals = computed(() => this.resolvedMode() === 'broker-deals');
  readonly isOrders = computed(() => this.resolvedMode() !== 'inquiries' && this.resolvedMode() !== 'lost-inquiries' && this.resolvedMode() !== 'broker-deals');
  readonly isActiveOrders = computed(() => this.resolvedMode() === 'active-orders');
  readonly isDeliveredOrders = computed(() => this.resolvedMode() === 'delivered-orders');
  readonly isInvoicedOrders = computed(() => this.resolvedMode() === 'invoiced-orders');
  readonly isCompletedOrders = computed(() => this.resolvedMode() === 'completed-orders');
  readonly isCancelledOrders = computed(() => this.resolvedMode() === 'cancelled-orders');
  readonly isLostInquiries = computed(() => this.resolvedMode() === 'lost-inquiries');
  readonly baseRoute = computed(() => (
    this.isActiveOrders()
      ? '/trading/orders'
      : this.isDeliveredOrders()
        ? '/trading/delivered-orders'
        : this.isInvoicedOrders()
          ? '/trading/invoiced-orders'
          : this.isCompletedOrders()
            ? '/trading/completed-orders'
            : this.isCancelledOrders()
              ? '/trading/cancelled-orders'
              : this.isLostInquiries()
                ? '/trading/lost-inquiries'
                : this.isBrokerDeals()
                  ? '/trading/broker-deals'
                  : '/trading/inquiries'
  ));
  readonly titleText = computed(() => (
    this.isActiveOrders()
      ? 'Active Orders'
      : this.isDeliveredOrders()
        ? 'Delivered Orders'
        : this.isInvoicedOrders()
          ? 'Invoiced Orders'
          : this.isCompletedOrders()
            ? 'Completed Orders'
            : this.isCancelledOrders()
              ? 'Cancelled Orders'
              : this.isLostInquiries()
                ? 'Lost Inquiries'
                : this.isBrokerDeals()
                  ? 'Broker Deals'
                  : 'Inquiries'
  ));
  readonly subtitleText = computed(() =>
    this.isActiveOrders()
      ? 'Confirmed orders waiting for delivery.'
      : this.isDeliveredOrders()
        ? 'Orders that have been delivered but not yet invoiced or paid.'
        : this.isInvoicedOrders()
          ? 'Orders that have been invoiced but not yet paid.'
          : this.isCompletedOrders()
            ? 'Orders that are paid and delivered.'
            : this.isCancelledOrders()
              ? 'Orders that have been cancelled.'
              : this.isLostInquiries()
                ? 'Inquiries that were lost or cancelled before confirmation.'
                : this.isBrokerDeals()
                  ? 'Broker deals with commission tracking.'
                  : 'Manage bunker inquiries and offers before confirmation.',
  );
  readonly searchPlaceholder = computed(() =>
    this.isOrders()
      ? 'Search by client, vessel or port...'
      : 'Search by client, vessel or port...',
  );

  // ─── State ───────────────────────────────────────────────────────

  readonly inquiries = signal<OrderListRowDto[]>([]);
  /** Tenant-configurable custom columns (loaded from admin settings). */
  readonly customColumns = signal<CustomColumnDef[]>([]);
  /** Inline-editing state for a custom column cell. */
  readonly editingCustomCell = signal<{ orderId: string; key: string } | null>(null);
  readonly editingCustomValue = signal<string>('');
  readonly loading = signal(false);
  readonly totalItems = signal(0);
  readonly currentPage = signal(1);
  readonly pageSize = signal(25);
  readonly searchTerm = signal('');
  readonly sortFields = signal<SortField[]>([]);
  readonly defaultSortBy = computed(() => this.isOrders() ? 'eta' : 'createdAt');
  readonly defaultSortDir = computed<'asc' | 'desc'>(() => 'desc');
  /** Computed sort fields including default when user hasn't explicitly sorted. */
  readonly activeSortFields = computed<SortField[]>(() => {
    const user = this.sortFields();
    if (user.length > 0) return user;
    return [{ field: this.defaultSortBy(), dir: this.defaultSortDir() }];
  });
  /** Backwards-compatible single sort field for API calls. */
  readonly activeSortBy = computed(() => this.activeSortFields()[0]?.field ?? this.defaultSortBy());
  readonly activeSortDir = computed<'asc' | 'desc'>(() => this.activeSortFields()[0]?.dir ?? this.defaultSortDir());
  readonly toast = signal<{ type: 'success' | 'error'; message: string } | null>(null);

  // ─── Batch selection (invoiced orders only) ────────────────────────
  readonly selectedOrderIds = signal<Set<string>>(new Set());
  readonly isBatchMode = computed(() => this.isInvoicedOrders());
  readonly selectedCount = computed(() => this.selectedOrderIds().size);
  readonly allOnPageSelected = computed(() => {
    const ids = this.selectedOrderIds();
    const rows = this.inquiries();
    return rows.length > 0 && rows.every(r => ids.has(r.id));
  });
  readonly batchLoading = signal(false);

  // ─── Column configuration ─────────────────────────────────────────
  private readonly userPrefs = inject(UserPreferencesService);
  private readonly dateFormatSvc = inject(DateFormatService);

  readonly allColumnOptions = computed<ColumnOption[]>(() => {
    const base: ColumnOption[] = [
      { field: 'orderNumber', label: 'No.', sortable: true },
      { field: 'client', label: 'Client', sortable: true },
      { field: 'vessel', label: 'Vessel', sortable: true },
      { field: 'port', label: 'Port', sortable: true },
      { field: 'status', label: 'Status', sortable: true },
      { field: 'responsible', label: 'Responsible', sortable: true },
      { field: 'invoicingCompany', label: 'Invoicing', sortable: true },
      { field: 'eta', label: 'ETA', sortable: true },
      { field: 'dueDate', label: 'Due Date', sortable: true },
      { field: 'createdAt', label: 'Created', sortable: true },
    ];
    // "Sendt Bunker Booking" red/green indicator — orders only (Moxie request).
    if (this.isOrders()) {
      base.splice(base.findIndex((c) => c.field === 'status') + 1, 0, { field: 'booking', label: 'Booking', sortable: false });
    }
    if (this.auth.canSeePrices()) {
      base.push({ field: 'value', label: 'Value' });
    }
    if (this.isOrders() && this.auth.canSeePrices()) {
      base.push(
        { field: 'gross', label: 'Gross' },
        { field: 'financing', label: 'Financing' },
        { field: 'net', label: 'Net' },
      );
    }
    // Append tenant-configurable custom columns (prefixed so they never collide with built-in fields)
    for (const cc of this.customColumns()) {
      base.push({ field: `custom_${cc.key}`, label: cc.label, sortable: false });
    }
    return base;
  });

  readonly defaultVisibleColumns = computed<string[]>(() => {
    const base = ['orderNumber', 'client', 'vessel', 'port', 'status', 'responsible', 'eta', 'createdAt'];
    if (this.isOrders()) {
      base.splice(base.indexOf('status') + 1, 0, 'booking');
    }
    if (this.isDeliveredOrders() || this.isInvoicedOrders() || this.isCompletedOrders()) {
      base.splice(base.indexOf('eta') + 1, 0, 'dueDate');
    }
    if (this.auth.canSeePrices()) {
      base.push('value');
    }
    if (this.isOrders() && this.auth.canSeePrices()) {
      base.push('gross', 'financing', 'net');
    }
    // Tenant-configurable custom columns are visible by default.
    for (const cc of this.customColumns()) {
      base.push(`custom_${cc.key}`);
    }
    return base;
  });

  readonly defaultColumnOrder = computed<string[]>(() =>
    this.allColumnOptions().map((c) => c.field),
  );

  readonly columnConfig = computed(() => {
    const prefs = this.userPrefs.preferences();
    const mode = this.resolvedMode();
    const key = `orderList_${mode}` as keyof UserUiPreferences;
    return (prefs[key] as { visible?: string[]; order?: string[] } | undefined) ?? {};
  });

  readonly visibleColumnFields = computed(() => {
    const cfg = this.columnConfig();
    const saved = cfg.visible;
    if (!saved) return this.defaultVisibleColumns();
    // The "Booking" indicator column is new — users with saved column prefs
    // would never see it. Inject it once (after Status); a marker in the
    // prefs prevents re-injecting after the user deliberately hides it.
    if (this.isOrders() && !saved.includes('booking') && !(cfg as any).bookingInjected) {
      const withBooking = [...saved];
      const statusIdx = withBooking.indexOf('status');
      withBooking.splice(statusIdx >= 0 ? statusIdx + 1 : 0, 0, 'booking');
      queueMicrotask(() => this.userPrefs.patch({
        [`orderList_${this.resolvedMode()}`]: {
          visible: withBooking,
          order: this.columnOrder(),
          bookingInjected: true,
        },
      } as Partial<UserUiPreferences>));
      return withBooking;
    }
    return saved;
  });

  readonly columnOrder = computed(() =>
    this.columnConfig().order ?? this.defaultColumnOrder(),
  );

  readonly visibleColumns = computed(() => {
    const orderMap = new Map(this.columnOrder().map((f, i) => [f, i]));
    return this.allColumnOptions()
      .filter((c) => this.visibleColumnFields().includes(c.field))
      .sort((a, b) => (orderMap.get(a.field) ?? 0) - (orderMap.get(b.field) ?? 0));
  });

  onColumnVisibilityChange(visible: string[]): void {
    const mode = this.resolvedMode();
    this.userPrefs.patch({
      [`orderList_${mode}`]: {
        visible,
        order: this.columnOrder(),
      },
    } as Partial<UserUiPreferences>);
  }

  onColumnOrderChange(order: string[]): void {
    const mode = this.resolvedMode();
    this.userPrefs.patch({
      [`orderList_${mode}`]: {
        visible: this.visibleColumnFields(),
        order,
      },
    } as Partial<UserUiPreferences>);
  }

  // ─── Filter configuration (config-driven) ──────────────────────────

  readonly filterState = signal<FilterState>({ ...EMPTY_FILTERS });
  readonly applyingFilters = signal(false);
  readonly teamUsers = signal<TeamUserOption[]>([]);
  readonly responsibleFilterOptions = computed<DropdownOption[]>(() =>
    this.teamUsers().map((user) => ({ value: user.id, label: user.name })),
  );

  /** Product type options loaded from tenant settings. */
  readonly productOptions = signal<DropdownOption[]>([]);

  /** Filter field definitions — passed to the overlay component. */
  readonly filterFields = computed<FilterFieldDef[]>(() => [
    { key: 'clientId', label: 'Client', type: 'dropdown', searchFn: (term) => this.searchCompanies('CLIENT', term) },
    { key: 'vesselId', label: 'Vessel', type: 'dropdown', searchFn: (term) => this.searchVessels(term) },
    { key: 'placeId', label: 'Place', type: 'dropdown', searchFn: (term) => this.searchPlaces(term) },
    { key: 'salesRepId', label: 'Responsible', type: 'dropdown', multiSelect: true, options: this.responsibleFilterOptions() },
    { key: 'brokerId', label: 'Broker', type: 'dropdown', searchFn: (term) => this.searchCompanies('BROKER', term) },
    { key: 'invoicingCompanyId', label: 'Invoicing Company', type: 'dropdown', searchFn: (term) => this.searchInvoicingCompanies(term) },
    { key: 'productType', label: 'Product', type: 'dropdown', multiSelect: true, options: this.productOptions() },
    { key: 'eta', label: 'ETA', type: 'date-range' },
    { key: 'created', label: 'Created', type: 'date-range' },
  ]);

  /** Shared method to build filter URL params from filter state. */
  private buildFilterParams(params: URLSearchParams, state?: FilterState): void {
    const f = state ?? this.filterState();
    if (f['clientId']) params.set('clientId', f['clientId']);
    if (f['vesselId']) params.set('vesselId', f['vesselId']);
    if (f['placeId']) params.set('placeId', f['placeId']);
    if (f['salesRepId']) {
      const v = f['salesRepId'];
      params.set('salesRepId', Array.isArray(v) ? v.join(',') : v);
    }
    if (f['brokerId']) params.set('brokerId', f['brokerId']);
    if (f['invoicingCompanyId']) params.set('invoicingCompanyId', f['invoicingCompanyId']);
    if (f['productType']) {
      const v = f['productType'];
      params.set('productType', Array.isArray(v) ? v.join(',') : v);
    }
    if (f['etaFrom']) params.set('dateFrom', f['etaFrom']);
    if (f['etaTo']) params.set('dateTo', f['etaTo']);
    if (f['createdFrom']) params.set('createdFrom', f['createdFrom']);
    if (f['createdTo']) params.set('createdTo', f['createdTo']);
  }

  /** Count function — calls the API with draft filters to get total matching results. */
  readonly filterCountFn = (filters: FilterState): Promise<number> => {
    const params = new URLSearchParams();
    this.applyStatusFilter(params);
    this.buildFilterParams(params, filters);
    if (this.searchTerm()) params.set('search', this.searchTerm());
    params.set('limit', '1');
    return firstValueFrom(this.http.get<ApiResponse<{ items: unknown[]; total: number }>>(`${API}/orders?${params}`))
      .then(res => res.success ? res.data.total : 0)
      .catch(() => 0);
  };

  // Filter pills — uses labels from FilterState (persisted to localStorage)
  readonly activeFilterPills = computed(() => {
    const f = this.filterState();
    const pills: Array<{ key: string; label: string; value: string }> = [];
    if (f['clientId']) pills.push({ key: 'clientId', label: 'Client', value: f.labels['clientId'] ?? f['clientId'].slice(0, 8) });
    if (f['vesselId']) pills.push({ key: 'vesselId', label: 'Vessel', value: f.labels['vesselId'] ?? f['vesselId'].slice(0, 8) });
    if (f['placeId']) pills.push({ key: 'placeId', label: 'Place', value: f.labels['placeId'] ?? f['placeId'].slice(0, 8) });
    if (f['salesRepId']) pills.push({ key: 'salesRepId', label: 'Responsible', value: f.labels['salesRepId'] ?? f['salesRepId'].slice(0, 8) });
    if (f['brokerId']) pills.push({ key: 'brokerId', label: 'Broker', value: f.labels['brokerId'] ?? f['brokerId'].slice(0, 8) });
    if (f['invoicingCompanyId']) pills.push({ key: 'invoicingCompanyId', label: 'Invoicing', value: f.labels['invoicingCompanyId'] ?? f['invoicingCompanyId'].slice(0, 8) });
    if (f['productType']) pills.push({ key: 'productType', label: 'Product', value: f.labels['productType'] ?? f['productType'] });
    if (f['etaFrom']) pills.push({ key: 'etaFrom', label: 'ETA from', value: f['etaFrom'] });
    if (f['etaTo']) pills.push({ key: 'etaTo', label: 'ETA to', value: f['etaTo'] });
    if (f['createdFrom']) pills.push({ key: 'createdFrom', label: 'Created from', value: f['createdFrom'] });
    if (f['createdTo']) pills.push({ key: 'createdTo', label: 'Created to', value: f['createdTo'] });
    return pills;
  });

  private readonly filterStorageKey = computed(() => `filter_${this.resolvedMode()}`);

  // ─── New inquiry modal ────────────────────────────────────────────

  readonly showNewInquiryModal = signal(false);
  readonly newInquiryModalOpen = computed(() => this.showNewInquiryModal());

  openNewInquiryModal(): void {
    this.showNewInquiryModal.set(true);
  }

  onNewInquiryModalClose(): void {
    this.showNewInquiryModal.set(false);
  }

  onNewInquiryCreated(): void {
    this.showNewInquiryModal.set(false);
    this.showToast('success', 'Inquiry created.');
  }
  private lastHandledNewInquiryRequestId = 0;

  constructor() {
    effect(() => {
      const requestId = this.newInquiryModal.requestId();
      if (requestId > this.lastHandledNewInquiryRequestId) {
        this.showNewInquiryModal.set(true);
        this.lastHandledNewInquiryRequestId = requestId;
      }
    });
  }

  // ─── Lifecycle ────────────────────────────────────────────────────

  ngOnInit(): void {
    this.loadSavedFilters();
    this.loadInquiries();
    void this.loadResponsibleUsers();
    void this.loadProducts();
    void this.loadCustomColumns();
    void this.userPrefs.load();
    void this.dateFormatSvc.load();
    if (!this.isOrders()) {
      this.queryParamSub = this.route.queryParamMap.subscribe((params) => {
        if (params.get('new') === '1') {
          this.showNewInquiryModal.set(true);
          this.router.navigate([], { queryParams: {}, replaceUrl: true });
        }
      });
    }
  }

  ngOnDestroy(): void {
    this.queryParamSub?.unsubscribe();
    if (this.searchTimeout) {
      clearTimeout(this.searchTimeout);
      this.searchTimeout = null;
    }
  }

  // ─── Data loading ─────────────────────────────────────────────────

  private applyStatusFilter(params: URLSearchParams): void {
    if (this.isBrokerDeals()) {
      // Broker deals shows all statuses — no status filter
      return;
    } else if (this.isActiveOrders()) {
      params.set('statuses', 'CONFIRMED');
    } else if (this.isDeliveredOrders()) {
      params.set('statuses', 'DELIVERED');
    } else if (this.isInvoicedOrders()) {
      params.set('statuses', 'INVOICED');
    } else if (this.isCompletedOrders()) {
      params.set('statuses', 'PAID');
    } else if (this.isCancelledOrders()) {
      params.set('statuses', 'CANCELLED');
    } else if (this.isLostInquiries()) {
      params.set('statuses', 'LOST');
    } else {
      params.set('statuses', 'INQUIRY,OFFER');
    }
  }

  async loadInquiries(): Promise<void> {
    this.loading.set(true);
    this.applyingFilters.set(true);
    try {
      const params = new URLSearchParams();
      this.applyStatusFilter(params);
      if (this.isBrokerDeals()) params.set('isBrokerDeal', 'true');
      params.set('page', String(this.currentPage()));
      params.set('limit', String(this.pageSize()));
      if (this.searchTerm()) params.set('search', this.searchTerm());
      this.buildFilterParams(params);
      const fields = this.activeSortFields();
      if (fields.length > 0) {
        params.set('sortBy', fields.map((f) => f.field).join(','));
        params.set('sortDir', fields.map((f) => f.dir).join(','));
      }

      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ items: OrderListRowDto[]; total: number }>>(
          `${API}/orders?${params.toString()}`,
        ),
      );
      if (res.success) {
        this.inquiries.set(res.data.items);
        this.totalItems.set(res.data.total);
      }
    } catch {
      this.showToast('error', 'Failed to load inquiries.');
    } finally {
      this.loading.set(false);
      this.applyingFilters.set(false);
    }
  }

  /** Load tenant-configurable custom columns from admin settings. */
  private async loadCustomColumns(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<CustomColumnDef[]>>(`${API}/admin/settings/my-custom-columns`),
      );
      if (res.success && Array.isArray(res.data)) {
        this.customColumns.set(res.data);
      }
    } catch {
      // Custom columns are optional — fail silently.
    }
  }

  /** Resolve the custom column definition for a table column field (custom_<key>). */
  customColumnForField(field: string): CustomColumnDef | undefined {
    if (!field.startsWith('custom_')) return undefined;
    const key = field.slice('custom_'.length);
    return this.customColumns().find((c) => c.key === key);
  }

  /** Begin inline-editing a custom column cell. */
  startEditCustomCell(order: OrderListRowDto, key: string, event: MouseEvent): void {
    event.stopPropagation();
    event.preventDefault();
    this.editingCustomCell.set({ orderId: order.id, key });
    const existing = order.customFields?.[key];
    this.editingCustomValue.set(existing != null ? String(existing) : '');
    // Focus the rendered input on the next tick.
    setTimeout(() => {
      const sel = `input[data-edit="${order.id}-${key}"]`;
      const el = document.querySelector<HTMLInputElement>(sel);
      el?.focus();
      el?.select();
    });
  }

  /** Persist the edited custom column value. */
  async saveCustomField(order: OrderListRowDto, key: string, event: Event | null = null): Promise<void> {
    if (event) { event.stopPropagation(); event.preventDefault(); }
    const editing = this.editingCustomCell();
    if (!editing || editing.orderId !== order.id || editing.key !== key) return;
    const value = this.editingCustomValue().trim();
    const col = this.customColumns().find((c) => c.key === key);
    const typedValue: string | number | null = col?.type === 'number'
      ? (value === '' ? null : Number(value))
      : (value === '' ? null : value);
    this.editingCustomCell.set(null);
    // Optimistic local update
    this.inquiries.update((rows) =>
      rows.map((r) => r.id === order.id
        ? { ...r, customFields: { ...(r.customFields ?? {}), [key]: typedValue } }
        : r,
      ),
    );
    try {
      await firstValueFrom(
        this.http.put<ApiResponse<unknown>>(`${API}/orders/${order.orderNumber ?? order.id}`, { customFields: { ...(order.customFields ?? {}), [key]: typedValue } }),
      );
    } catch {
      this.showToast('error', 'Failed to save custom field.');
      await this.loadInquiries();
    }
  }

  cancelEditCustomCell(event: Event | null = null): void {
    if (event) event.stopPropagation();
    this.editingCustomCell.set(null);
  }

  isEditingCustomCell(orderId: string, key: string): boolean {
    const e = this.editingCustomCell();
    return !!e && e.orderId === orderId && e.key === key;
  }

  private async loadResponsibleUsers(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<TeamUserOption[]>>(`${API}/lloyds/users`),
      );
      if (res.success) {
        this.teamUsers.set(Array.isArray(res.data) ? res.data : []);
      }
    } catch {
      this.teamUsers.set([]);
    }
  }

  private async loadProducts(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ products: string[] }>>(`${API}/admin/settings/my-products`),
      );
      if (res.success && res.data?.products) {
        this.productOptions.set(res.data.products.map((p) => ({ value: p, label: p.replace(/_/g, ' ') })));
      }
    } catch {
      // ignore — product filter just won't have options
    }
  }

  // ─── Filter search helpers ────────────────────────────────────────

  private async searchCompanies(type: string, term: string): Promise<DropdownOption[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: Array<{ id: string; name: string }> }>>(
          `${API}/companies/local?type=${type}&search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      return res.success ? res.data.companies.map((c) => ({ value: c.id, label: c.name })) : [];
    } catch { return []; }
  }

  private async searchVessels(term: string): Promise<DropdownOption[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ vessels: Array<{ id: string; name: string }>; total: number }>>(
          `${API}/vessels/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      return res.success && res.data?.vessels ? res.data.vessels.map((v) => ({ value: v.id, label: v.name })) : [];
    } catch { return []; }
  }

  private async searchPlaces(term: string): Promise<DropdownOption[]> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ places: Array<{ id: string; name: string }>; total: number }>>(
          `${API}/lloyds/places/local?search=${encodeURIComponent(term)}&limit=20`,
        ),
      );
      return res.success && res.data?.places ? res.data.places.map((p) => ({ value: p.id, label: p.name })) : [];
    } catch { return []; }
  }

  private ownCompaniesCache: DropdownOption[] | null = null;

  private async searchInvoicingCompanies(term: string): Promise<DropdownOption[]> {
    if (!this.ownCompaniesCache) {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<Array<{ id: string; name: string }>>>(
            `${API}/admin/settings/my-own-companies`,
          ),
        );
        if (res.success && Array.isArray(res.data)) {
          this.ownCompaniesCache = res.data.map((c) => ({ value: c.id, label: c.name }));
        } else {
          this.ownCompaniesCache = [];
        }
      } catch { this.ownCompaniesCache = []; }
    }
    const cache = this.ownCompaniesCache ?? [];
    if (!term) return cache;
    return cache.filter((c) => c.label.toLowerCase().includes(term.toLowerCase()));
  }

  // ─── Actions ──────────────────────────────────────────────────────

  private searchTimeout: ReturnType<typeof setTimeout> | null = null;

  onSearch(term: string): void {
    this.searchTerm.set(term);
    if (this.searchTimeout) clearTimeout(this.searchTimeout);
    this.searchTimeout = setTimeout(() => {
      this.currentPage.set(1);
      this.loadInquiries();
    }, 300);
  }

  onFiltersChange(state: FilterState): void {
    this.filterState.set(state);
    this.saveFilters();
    this.currentPage.set(1);
    this.loadInquiries();
  }

  removeFilter(key: string): void {
    this.filterState.update((f) => {
      const next = { ...f, [key]: '' };
      const { [key]: _removed, ...restLabels } = f.labels;
      next.labels = restLabels;
      return next;
    });
    this.saveFilters();
    this.currentPage.set(1);
    this.loadInquiries();
  }

  clearAllFilters(): void {
    this.filterState.set({ labels: {} });
    this.saveFilters();
    this.currentPage.set(1);
    this.loadInquiries();
  }

  private loadSavedFilters(): void {
    try {
      const raw = localStorage.getItem(this.filterStorageKey());
      if (raw) {
        const saved = JSON.parse(raw) as Partial<FilterState>;
        this.filterState.set({ labels: {}, ...saved });
      }
    } catch { /* ignore */ }
  }

  private saveFilters(): void {
    try {
      localStorage.setItem(this.filterStorageKey(), JSON.stringify(this.filterState()));
    } catch { /* ignore */ }
  }

  goToPage(page: number): void {
    this.currentPage.set(page);
    this.loadInquiries();
  }

  onSort(event: SortChangeEvent): void {
    if (event.additive) {
      // Shift+click: add or remove from the sort stack
      const existing = this.sortFields();
      const idx = existing.findIndex((s) => s.field === event.field);
      if (idx >= 0) {
        // Already sorted by this field — remove it
        const next = existing.filter((_, i) => i !== idx);
        this.sortFields.set(next);
      } else {
        // Add as secondary sort
        this.sortFields.set([...existing, { field: event.field, dir: event.dir }]);
      }
    } else {
      // Regular click: replace all sorts with this one
      this.sortFields.set([{ field: event.field, dir: event.dir }]);
    }
    this.currentPage.set(1);
    this.loadInquiries();
  }

  /**
   * True when the row's ETA is within the next 7 days (or already overdue) —
   * used to highlight urgent rows in red on the list. Terminal statuses
   * (DELIVERED / INVOICED / PAID / CANCELLED / LOST) are excluded: a past
   * ETA is normal for them, not urgent.
   */
  isEtaSoon(eta: string | null | undefined, status?: string | null): boolean {
    if (!eta) return false;
    if (status && ['DELIVERED', 'INVOICED', 'PAID', 'CANCELLED', 'LOST'].includes(status)) return false;
    const d = new Date(eta);
    if (isNaN(d.getTime())) return false;
    return d.getTime() - Date.now() <= 7 * 24 * 60 * 60 * 1000;
  }

  /**
   * Toggle the "Sendt Bunker Booking" indicator (red/green) for an order.
   * Optimistic update + rollback on failure.
   */
  toggleBunkerBooking(event: Event, inq: OrderListRowDto): void {
    event.stopPropagation();
    const newSent = !inq.bunkerBookingSentAt;
    const prev = inq.bunkerBookingSentAt;
    // Optimistic update
    this.inquiries.update(rows =>
      rows.map(r => r.id === inq.id ? { ...r, bunkerBookingSentAt: newSent ? new Date().toISOString() : null } : r),
    );
    this.http
      .put<ApiResponse<{ bunkerBookingSentAt: string | null }>>(
        `${API}/orders/${inq.orderNumber || inq.id}/bunker-booking-sent`,
        { sent: newSent },
      )
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.inquiries.update(rows =>
              rows.map(r => r.id === inq.id ? { ...r, bunkerBookingSentAt: res.data!.bunkerBookingSentAt } : r),
            );
          } else {
            // Roll back
            this.inquiries.update(rows => rows.map(r => r.id === inq.id ? { ...r, bunkerBookingSentAt: prev } : r));
          }
        },
        error: () => {
          this.inquiries.update(rows => rows.map(r => r.id === inq.id ? { ...r, bunkerBookingSentAt: prev } : r));
        },
      });
  }

  goToDetail(id: string): void {
    this.router.navigate([this.baseRoute(), id]);
  }

  private buildDetailUrl(id: string): string {
    return `/${this.baseRoute()}/${id}`;
  }

  private openInNewTab(url: string): void {
    window.open(url, '_blank');
  }

  onRowClick(event: MouseEvent, id: string): void {
    if (event.ctrlKey || event.metaKey) {
      this.openInNewTab(this.buildDetailUrl(id));
      return;
    }
    this.goToDetail(id);
  }

  onRowAuxClick(event: MouseEvent, id: string): void {
    if (event.button === 1) {
      event.preventDefault();
      this.openInNewTab(this.buildDetailUrl(id));
    }
  }

  // ─── Toast ─────────────────────────────────────────────────────────

  private showToast(type: 'success' | 'error', message: string): void {
    this.toast.set({ type, message });
    setTimeout(() => this.toast.set(null), 4000);
  }

  // ─── Batch selection ─────────────────────────────────────────────────

  toggleOrderSelection(event: Event, orderId: string): void {
    event.stopPropagation();
    const checkbox = event.target as HTMLInputElement;
    this.selectedOrderIds.update(ids => {
      const next = new Set(ids);
      if (checkbox.checked) next.add(orderId); else next.delete(orderId);
      return next;
    });
  }

  toggleSelectAll(event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    if (checkbox.checked) {
      this.selectedOrderIds.update(ids => {
        const next = new Set(ids);
        for (const inq of this.inquiries()) next.add(inq.id);
        return next;
      });
    } else {
      this.selectedOrderIds.update(ids => {
        const next = new Set(ids);
        for (const inq of this.inquiries()) next.delete(inq.id);
        return next;
      });
    }
  }

  clearSelection(): void {
    this.selectedOrderIds.set(new Set());
  }

  async batchComplete(): Promise<void> {
    const ids = Array.from(this.selectedOrderIds());
    if (!ids.length) return;
    if (ids.length > 20) {
      this.showToast('error', 'You can complete at most 20 orders at once.');
      return;
    }
    this.batchLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ succeeded: number; failed: number }>>(`${API}/orders/batch/status`, { orderIds: ids, status: 'PAID' }),
      );
      if (res.success) {
        this.showToast('success', res.message || `${ids.length} order(s) marked as paid`);
        this.clearSelection();
        await this.loadInquiries();
      } else {
        this.showToast('error', res.message || 'Batch update failed');
      }
    } catch {
      this.showToast('error', 'Failed to batch complete orders');
    } finally {
      this.batchLoading.set(false);
    }
  }
}