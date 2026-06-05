import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  ReleaseTwoReportsDto,
  ReportComparisonMode,
  ReportDrilldownResponseDto,
  ReportDrilldownTarget,
  ReportExceptionType,
  ReportFiltersDto,
  ReportScheduleBodyMode,
  ReportScheduleDeliveryMode,
  ReportScheduleMode,
  ReportScheduleType,
  SavedReportViewDto,
} from '@fueld/types';
import { Role } from '@fueld/types';
import { API } from '@app/core/config/api';

type ExportKind = 'trader-performance' | 'invoice-aging' | 'commercial-summary' | 'margin-analysis' | 'exceptions';
type ExportFormat = 'csv' | 'xlsx';
type DatePresetKey = 'today' | 'yesterday' | 'this_week' | 'last_7_days' | 'this_month' | 'last_30_days' | 'this_quarter' | 'year_to_date' | 'custom';

@Component({
  selector: 'app-reports-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <div class="space-y-6 pb-8">
      <div class="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <nav class="mb-3 flex items-center gap-1.5 text-sm text-gray-500">
            <a routerLink="/" class="transition-colors hover:text-brand-600">Dashboard</a>
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
            </svg>
            <span class="font-medium text-gray-900">Reports</span>
          </nav>
          <div class="flex flex-wrap items-center gap-3">
            <h1 class="text-2xl font-bold text-gray-900">Reports</h1>
            @if (data(); as reportData) {
              <span class="inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
                Scope: {{ describeScope(reportData.access.scope) }}
              </span>
              @if (reportData.access.canViewFinance) {
                <span class="inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-700">
                  Finance-enabled
                </span>
              }
              @if (reportData.access.canManageSharedViews) {
                <span class="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700">
                  Shared views
                </span>
              }
            }
          </div>
          <p class="mt-1 max-w-3xl text-sm text-gray-500">Historical, filterable reporting for trader performance, collections, commercial conversion, and margin analysis, with comparison windows, drill-downs, and exception monitoring.</p>
        </div>

        <div class="flex items-center gap-3">
          <div
            aria-live="polite"
            class="inline-flex min-h-10 items-center rounded-lg border px-3 py-2 text-sm font-medium transition-colors"
            [class.border-sky-200]="loading()"
            [class.bg-sky-50]="loading()"
            [class.text-sky-700]="loading()"
            [class.border-gray-200]="!loading()"
            [class.bg-gray-50]="!loading()"
            [class.text-gray-500]="!loading()"
            data-testid="reports-loading-indicator"
          >
            {{ loading() ? (data() ? 'Updating…' : 'Loading…') : 'Live updates on' }}
          </div>
          <button
            type="button"
            (click)="clearFilters()"
            class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
          >
            Reset filters
          </button>
        </div>
      </div>

      <section class="min-w-0 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-testid="reports-filter-bar">
        <div class="mb-4 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Report Filters</h2>
            <p class="text-sm text-gray-500">Choose a reporting slice, then compare it against a prior period or open the underlying records.</p>
          </div>
          <div class="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600">
            Comparison: {{ comparisonModeLabel(comparisonMode()) }}
          </div>
        </div>
        <div class="grid min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-6">
          <div class="relative min-w-0" #dateDropdown>
            <label class="flex min-w-0 flex-col gap-1 text-sm text-gray-600">
              <span>Date Range</span>
              <button
                type="button"
                (click)="dateDropdownOpen.set(!dateDropdownOpen())"
                class="flex w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm transition-colors hover:bg-gray-50 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
                data-testid="reports-date-filter-trigger"
              >
                <span class="flex items-center gap-2 truncate">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd" />
                  </svg>
                  <span class="truncate">{{ dateRangeLabel() }}</span>
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z" clip-rule="evenodd" />
                </svg>
              </button>
            </label>

            @if (dateDropdownOpen()) {
              <div class="absolute left-0 z-30 mt-2 w-full min-w-0 max-w-[calc(100vw-2rem)] origin-top-left rounded-xl border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 max-h-[calc(100vh-140px)] overflow-y-auto sm:w-[22rem]">
                <div class="py-1">
                  @for (preset of datePresets; track preset.key) {
                    <button
                      type="button"
                      (click)="selectDatePreset(preset.key)"
                      class="flex w-full items-center justify-between px-4 py-2 text-sm transition-colors"
                      [class]="selectedDatePreset() === preset.key ? 'bg-brand-50 text-brand-700 font-medium' : 'text-gray-700 hover:bg-gray-50'"
                      [attr.data-testid]="'reports-date-preset-' + preset.key"
                    >
                      <span>{{ preset.label }}</span>
                      @if (selectedDatePreset() === preset.key) {
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-brand-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                      }
                    </button>
                  }
                </div>
                <div class="border-t border-gray-100 px-4 py-3">
                  <p class="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-gray-500">Custom Range</p>
                  <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <input
                      type="date"
                      [value]="customDateFrom()"
                      (change)="customDateFrom.set(($any($event.target).value || ''))"
                      class="w-full min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                    <span class="shrink-0 px-1 text-xs text-gray-400">to</span>
                    <input
                      type="date"
                      [value]="customDateTo()"
                      (change)="customDateTo.set(($any($event.target).value || ''))"
                      class="w-full min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <button
                    type="button"
                    (click)="applyCustomRange()"
                    class="mt-2 w-full rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700"
                    data-testid="reports-date-custom-apply"
                  >
                    Apply
                  </button>
                </div>
              </div>
            }
          </div>
          <label class="flex min-w-0 flex-col gap-1 text-sm text-gray-600">
            <span>Trader</span>
            <select [value]="traderId() ?? ''" (change)="onTraderChange($event)" class="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
              <option value="">All</option>
              @for (option of data()?.filterOptions?.traders ?? []; track option.id) {
                <option [value]="option.id">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-sm text-gray-600">
            <span>Team</span>
            <select [value]="teamId() ?? ''" (change)="onTeamChange($event)" class="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
              <option value="">All</option>
              @for (option of data()?.filterOptions?.teams ?? []; track option.id) {
                <option [value]="option.id">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-sm text-gray-600">
            <span>Customer</span>
            <select [value]="customerId() ?? ''" (change)="onCustomerChange($event)" class="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
              <option value="">All</option>
              @for (option of data()?.filterOptions?.customers ?? []; track option.id) {
                <option [value]="option.id">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-sm text-gray-600">
            <span>Product</span>
            <select [value]="productType() ?? ''" (change)="onProductTypeChange($event)" class="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
              <option value="">All</option>
              @for (option of data()?.filterOptions?.products ?? []; track option.id) {
                <option [value]="option.id">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="flex min-w-0 flex-col gap-1 text-sm text-gray-600">
            <span>Comparison</span>
            <select data-testid="reports-comparison-mode" [value]="comparisonMode()" (change)="onComparisonModeChange($event)" class="w-full min-w-0 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
              <option value="NONE">None</option>
              <option value="PREVIOUS_PERIOD">Previous period</option>
              <option value="PREVIOUS_MONTH">Previous month</option>
              <option value="PREVIOUS_QUARTER">Previous quarter</option>
              <option value="PREVIOUS_YEAR">Previous year</option>
            </select>
          </label>
        </div>
      </section>

      @if (error()) {
        <div class="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {{ error() }}
        </div>
      }

      @if (loading() && !data()) {
        <div class="rounded-2xl border border-gray-200 bg-white px-5 py-10 text-center text-sm text-gray-500 shadow-sm">
          Loading report data…
        </div>
      } @else if (data(); as reportData) {
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          @for (card of summaryCards(); track card.label) {
            <div class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
              <p class="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">{{ card.label }}</p>
              <p class="mt-3 text-2xl font-semibold text-gray-900">{{ card.value }}</p>
              <p class="mt-2 text-sm text-gray-500">{{ card.description }}</p>
            </div>
          }
        </div>

        @if (reportData.variance.summary; as varianceSummary) {
          <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-testid="reports-variance-section">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="text-lg font-semibold text-gray-900">Variance</h2>
                <p class="text-sm text-gray-500">{{ reportData.variance.comparison?.label || 'Comparison disabled' }}</p>
              </div>
              <div class="rounded-full border border-gray-200 bg-gray-50 px-3 py-1 text-xs font-medium text-gray-600">
                Current window vs prior baseline
              </div>
            </div>
            <div class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-400">Revenue</div>
                <div class="mt-2 text-lg font-semibold text-gray-900">{{ formatCurrency(varianceSummary.totalRevenue.deltaValue) }}</div>
                <div class="text-sm text-gray-500">{{ varianceSummary.totalRevenue.deltaPct ?? '—' }}%</div>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-400">Net Profit</div>
                <div class="mt-2 text-lg font-semibold text-gray-900">{{ formatCurrency(varianceSummary.totalNetProfit.deltaValue) }}</div>
                <div class="text-sm text-gray-500">{{ varianceSummary.totalNetProfit.deltaPct ?? '—' }}%</div>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-400">Outstanding</div>
                <div class="mt-2 text-lg font-semibold text-gray-900">{{ formatCurrency(varianceSummary.totalOutstanding.deltaValue) }}</div>
                <div class="text-sm text-gray-500">{{ varianceSummary.totalOutstanding.deltaPct ?? '—' }}%</div>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-400">Win Rate</div>
                <div class="mt-2 text-lg font-semibold text-gray-900">{{ varianceSummary.winRate.deltaValue }} pts</div>
                <div class="text-sm text-gray-500">{{ varianceSummary.winRate.deltaPct ?? '—' }}%</div>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50 p-4">
                <div class="text-xs uppercase tracking-[0.18em] text-gray-400">Avg Deal</div>
                <div class="mt-2 text-lg font-semibold text-gray-900">{{ formatCurrency(varianceSummary.avgDealSize.deltaValue) }}</div>
                <div class="text-sm text-gray-500">{{ varianceSummary.avgDealSize.deltaPct ?? '—' }}%</div>
              </div>
            </div>
            <div class="mt-6 grid gap-4 xl:grid-cols-3">
              <div>
                <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Trader Movers</h3>
                <div class="mt-3 space-y-2">
                  @for (row of reportData.variance.topTraderMovers; track row.key) {
                    <button type="button" [attr.data-testid]="'reports-variance-trader-' + row.key" (click)="openOrderDrilldown('TRADER', row.key)" class="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm hover:bg-white">
                      <span class="font-medium text-gray-900">{{ row.label }}</span>
                      <span class="text-gray-500">{{ formatCurrency(row.deltaValue) }}</span>
                    </button>
                  } @empty {
                    <p class="text-sm text-gray-500">No comparison data available.</p>
                  }
                </div>
              </div>
              <div>
                <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Customer Movers</h3>
                <div class="mt-3 space-y-2">
                  @for (row of reportData.variance.topCustomerMovers; track row.key) {
                    <button type="button" [attr.data-testid]="'reports-variance-customer-' + row.key" (click)="openOrderDrilldown('CUSTOMER', row.key)" class="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm hover:bg-white">
                      <span class="font-medium text-gray-900">{{ row.label }}</span>
                      <span class="text-gray-500">{{ formatCurrency(row.deltaValue) }}</span>
                    </button>
                  } @empty {
                    <p class="text-sm text-gray-500">No comparison data available.</p>
                  }
                </div>
              </div>
              <div>
                <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Product Movers</h3>
                <div class="mt-3 space-y-2">
                  @for (row of reportData.variance.topProductMovers; track row.key) {
                    <button type="button" [attr.data-testid]="'reports-variance-product-' + row.key" (click)="openOrderDrilldown('PRODUCT', row.key)" class="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm hover:bg-white">
                      <span class="font-medium text-gray-900">{{ row.label }}</span>
                      <span class="text-gray-500">{{ formatCurrency(row.deltaValue) }}</span>
                    </button>
                  } @empty {
                    <p class="text-sm text-gray-500">No comparison data available.</p>
                  }
                </div>
              </div>
            </div>
          </section>
        }

        @if (reportData.access.canManageSharedViews || reportData.savedViews.length > 0) {
          <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 class="text-lg font-semibold text-gray-900">Saved Views</h2>
                <p class="text-sm text-gray-500">Store a shared filter preset for repeated reporting cuts.</p>
              </div>
              @if (reportData.access.canManageSharedViews) {
                <div class="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[420px]">
                  <div class="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                    <input type="text" data-testid="reports-view-name" [value]="newViewName()" (input)="newViewName.set(($any($event.target).value || '').trimStart())" placeholder="View name" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    <input type="text" data-testid="reports-view-description" [value]="newViewDescription()" (input)="newViewDescription.set(($any($event.target).value || '').trimStart())" placeholder="Description (optional)" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    <div class="flex gap-2">
                      <button type="button" data-testid="reports-save-view" (click)="saveCurrentView()" [disabled]="savingView() || !newViewName().trim()" class="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60">
                        {{ savingView() ? 'Saving…' : editingViewId() ? 'Update view' : 'Save view' }}
                      </button>
                      @if (editingViewId()) {
                        <button type="button" (click)="resetViewEditor()" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
                          Cancel
                        </button>
                      }
                    </div>
                  </div>
                </div>
              }
            </div>

            <div class="mt-4 flex flex-wrap gap-3">
              @for (view of reportData.savedViews; track view.id) {
                <div class="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2" [attr.data-testid]="'reports-view-card-' + view.id">
                  <button type="button" (click)="applySavedView(view)" class="text-left">
                    <div class="text-sm font-medium text-gray-900">{{ view.name }}</div>
                    <div class="text-xs text-gray-500">{{ view.description || 'Shared preset' }}</div>
                  </button>
                  @if (reportData.access.canManageSharedViews) {
                    <button type="button" [attr.data-testid]="'reports-view-edit-' + view.id" (click)="startEditSavedView(view)" class="rounded-md px-2 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-white">
                      Edit
                    </button>
                    <button type="button" [attr.data-testid]="'reports-view-delete-' + view.id" (click)="deleteSavedView(view.id)" class="rounded-md px-2 py-1 text-xs font-medium text-red-600 transition-colors hover:bg-red-50">
                      Delete
                    </button>
                  }
                </div>
              } @empty {
                <p class="text-sm text-gray-500">No shared views saved yet.</p>
              }
            </div>
          </section>
        }

        <section class="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div class="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="text-lg font-semibold text-gray-900">Trader Performance</h2>
              <p class="text-sm text-gray-500">Revenue, profitability, and win-rate by visible trader.</p>
            </div>
            <div class="flex gap-2">
              <button type="button" (click)="exportReport('trader-performance', 'csv')" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50">
                Export CSV
              </button>
              <button type="button" (click)="exportReport('trader-performance', 'xlsx')" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50">
                Export XLSX
              </button>
            </div>
          </div>
          <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200 text-sm">
              <thead class="bg-gray-50">
                <tr class="text-left text-gray-500">
                  <th class="px-5 py-3 font-medium">Trader</th>
                  <th class="px-5 py-3 font-medium">Team</th>
                  <th class="px-5 py-3 font-medium">Orders</th>
                  <th class="px-5 py-3 font-medium">Revenue</th>
                  <th class="px-5 py-3 font-medium">Gross</th>
                  <th class="px-5 py-3 font-medium">Net</th>
                  <th class="px-5 py-3 font-medium">Win Rate</th>
                  <th class="px-5 py-3 font-medium">Avg Deal</th>
                  <th class="px-5 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100 bg-white text-gray-700">
                @for (row of reportData.traderPerformance.rows; track row.traderId) {
                  <tr>
                    <td class="px-5 py-3">
                      <div class="font-medium text-gray-900">{{ row.traderName }}</div>
                      <div class="text-xs text-gray-500">{{ row.traderEmail }}</div>
                    </td>
                    <td class="px-5 py-3">{{ row.teamName || '—' }}</td>
                    <td class="px-5 py-3">{{ row.orderCount }}</td>
                    <td class="px-5 py-3">{{ formatCurrency(row.totalRevenue) }}</td>
                    <td class="px-5 py-3">{{ formatCurrency(row.totalGrossProfit) }}</td>
                    <td class="px-5 py-3">{{ formatCurrency(row.totalNetProfit) }}</td>
                    <td class="px-5 py-3">{{ formatPercent(row.winRate) }}</td>
                    <td class="px-5 py-3">{{ formatCurrency(row.avgDealSize) }}</td>
                    <td class="px-5 py-3 text-right">
                      <button type="button" [attr.data-testid]="'reports-trader-drilldown-' + row.traderId" (click)="openOrderDrilldown('TRADER', row.traderId)" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                        Drill-down
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="9" class="px-5 py-8 text-center text-sm text-gray-500">No trader performance data found for the selected period.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

        @if (drilldownData() || drilldownLoading() || drilldownError()) {
          <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-testid="reports-drilldown-panel">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h2 class="text-lg font-semibold text-gray-900">Drill-down</h2>
                <p class="text-sm text-gray-500">{{ drilldownData()?.title || 'Inspect the source records behind a summary row.' }}</p>
              </div>
              <button type="button" data-testid="reports-drilldown-close" (click)="closeDrilldown()" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Close
              </button>
            </div>
            @if (drilldownData(); as detailBadge) {
              <div class="mt-3 inline-flex items-center rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                {{ detailBadge.totalCount }} record{{ detailBadge.totalCount === 1 ? '' : 's' }} in {{ detailBadge.dataset.toLowerCase() }}
              </div>
            }

            @if (drilldownLoading()) {
              <div class="mt-4 text-sm text-gray-500">Loading drill-down…</div>
            } @else if (drilldownError()) {
              <div class="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{{ drilldownError() }}</div>
            } @else if (drilldownData(); as detail) {
              <div class="mt-4 overflow-x-auto">
                @if (detail.dataset === 'ORDERS') {
                  <table class="min-w-full divide-y divide-gray-200 text-sm">
                    <thead class="bg-gray-50 text-left text-gray-500">
                      <tr>
                        <th class="px-4 py-3 font-medium">Customer</th>
                        <th class="px-4 py-3 font-medium">Vessel</th>
                        <th class="px-4 py-3 font-medium">Trader</th>
                        <th class="px-4 py-3 font-medium">Status</th>
                        <th class="px-4 py-3 font-medium">Revenue</th>
                        <th class="px-4 py-3 font-medium">Net</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100 bg-white text-gray-700">
                      @for (row of detail.orders; track row.orderId) {
                        <tr>
                          <td class="px-4 py-3">{{ row.clientName }}</td>
                          <td class="px-4 py-3">{{ row.vesselName }}</td>
                          <td class="px-4 py-3">{{ row.traderName }}</td>
                          <td class="px-4 py-3">{{ row.status }}</td>
                          <td class="px-4 py-3">{{ formatCurrency(row.totalRevenue) }}</td>
                          <td class="px-4 py-3">{{ formatCurrency(row.totalNetProfit) }}</td>
                        </tr>
                      } @empty {
                        <tr><td colspan="6" class="px-4 py-6 text-center text-sm text-gray-500">No order rows matched this drill-down.</td></tr>
                      }
                    </tbody>
                  </table>
                } @else {
                  <table class="min-w-full divide-y divide-gray-200 text-sm">
                    <thead class="bg-gray-50 text-left text-gray-500">
                      <tr>
                        <th class="px-4 py-3 font-medium">Invoice</th>
                        <th class="px-4 py-3 font-medium">Customer</th>
                        <th class="px-4 py-3 font-medium">Trader</th>
                        <th class="px-4 py-3 font-medium">Due</th>
                        <th class="px-4 py-3 font-medium">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody class="divide-y divide-gray-100 bg-white text-gray-700">
                      @for (row of detail.invoices; track row.invoiceId) {
                        <tr>
                          <td class="px-4 py-3">{{ row.invoiceNumber }}</td>
                          <td class="px-4 py-3">{{ row.clientName }}</td>
                          <td class="px-4 py-3">{{ row.traderName || '—' }}</td>
                          <td class="px-4 py-3">{{ row.dueDate }}</td>
                          <td class="px-4 py-3">{{ formatCurrency(row.outstandingAmount) }}</td>
                        </tr>
                      } @empty {
                        <tr><td colspan="5" class="px-4 py-6 text-center text-sm text-gray-500">No invoice rows matched this drill-down.</td></tr>
                      }
                    </tbody>
                  </table>
                }
              </div>
            }
          </section>
        }

        <section class="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
          <div class="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div class="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="text-lg font-semibold text-gray-900">Invoice Aging</h2>
                <p class="text-sm text-gray-500">Open invoices bucketed by due-date age.</p>
              </div>
              <div class="flex gap-2">
                <button type="button" (click)="exportReport('invoice-aging', 'csv')" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50">
                  Export CSV
                </button>
                <button type="button" (click)="exportReport('invoice-aging', 'xlsx')" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50">
                  Export XLSX
                </button>
              </div>
            </div>

            <div class="grid gap-3 border-b border-gray-100 px-5 py-4 sm:grid-cols-5">
              @for (bucket of reportData.invoiceAging.buckets; track bucket.label) {
                <div class="rounded-xl border border-gray-200 bg-gray-50/80 p-3" [attr.data-testid]="'reports-aging-bucket-' + bucket.label">
                  <p class="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">{{ bucket.label }}</p>
                  <p class="mt-2 text-lg font-semibold text-gray-900">{{ bucket.count }}</p>
                  <p class="text-sm text-gray-500">{{ formatCurrency(bucket.outstandingAmount) }}</p>
                  <button type="button" [attr.data-testid]="'reports-invoice-drilldown-' + bucket.label" (click)="openInvoiceDrilldown(bucket.label)" class="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                    Open invoices
                  </button>
                </div>
              }
            </div>

            <div class="overflow-x-auto">
              <table class="min-w-full divide-y divide-gray-200 text-sm">
                <thead class="bg-gray-50">
                  <tr class="text-left text-gray-500">
                    <th class="px-5 py-3 font-medium">Invoice</th>
                    <th class="px-5 py-3 font-medium">Client</th>
                    <th class="px-5 py-3 font-medium">Trader</th>
                    <th class="px-5 py-3 font-medium">Due</th>
                    <th class="px-5 py-3 font-medium">Outstanding</th>
                    <th class="px-5 py-3 font-medium">Bucket</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100 bg-white text-gray-700">
                  @for (row of reportData.invoiceAging.rows.slice(0, 12); track row.invoiceId) {
                    <tr>
                      <td class="px-5 py-3">
                        <div class="font-medium text-gray-900">{{ row.invoiceNumber }}</div>
                        <div class="text-xs text-gray-500">{{ row.vesselName }}</div>
                      </td>
                      <td class="px-5 py-3">{{ row.clientName }}</td>
                      <td class="px-5 py-3">{{ row.traderName || '—' }}</td>
                      <td class="px-5 py-3">{{ row.dueDate }}</td>
                      <td class="px-5 py-3">{{ formatCurrency(row.outstandingAmount) }}</td>
                      <td class="px-5 py-3">{{ row.agingBucket }} · {{ row.daysOverdue }}</td>
                    </tr>
                  } @empty {
                    <tr>
                      <td colspan="6" class="px-5 py-8 text-center text-sm text-gray-500">No open invoices matched the selected range.</td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>

          <div class="rounded-2xl border border-gray-200 bg-white shadow-sm">
            <div class="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 class="text-lg font-semibold text-gray-900">Commercial Summary</h2>
                <p class="text-sm text-gray-500">Conversion, loss reasons, and pipeline status.</p>
              </div>
              <div class="flex gap-2">
                <button type="button" (click)="exportReport('commercial-summary', 'csv')" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50">
                  Export CSV
                </button>
                <button type="button" (click)="exportReport('commercial-summary', 'xlsx')" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50">
                  Export XLSX
                </button>
              </div>
            </div>

            <div class="grid gap-3 border-b border-gray-100 px-5 py-4 sm:grid-cols-2">
              <div class="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
                <p class="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">Win Rate</p>
                <p class="mt-2 text-2xl font-semibold text-gray-900">{{ formatPercent(reportData.commercialSummary.conversion.winRate) }}</p>
                <p class="mt-1 text-sm text-gray-500">Won {{ reportData.commercialSummary.conversion.totalWon }} / Lost {{ reportData.commercialSummary.conversion.totalLost }}</p>
              </div>
              <div class="rounded-xl border border-gray-200 bg-gray-50/80 p-4">
                <p class="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">Avg Days To Close</p>
                <p class="mt-2 text-2xl font-semibold text-gray-900">{{ reportData.commercialSummary.conversion.avgDaysToClose ?? '—' }}</p>
                <p class="mt-1 text-sm text-gray-500">Based on won orders in the selected period.</p>
              </div>
            </div>

            <div class="space-y-4 px-5 py-4">
              <div>
                <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Top Loss Reasons</h3>
                <div class="mt-3 space-y-2">
                  @for (reason of reportData.commercialSummary.lossAnalysis.reasons.slice(0, 5); track reason.reason) {
                    <div class="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2 text-sm">
                      <span class="font-medium text-gray-800">{{ reason.reason }}</span>
                      <span class="text-gray-500">{{ reason.count }} · {{ formatPercent(reason.percentage) }}</span>
                    </div>
                  } @empty {
                    <p class="text-sm text-gray-500">No cancelled orders with loss reasons in the selected period.</p>
                  }
                </div>
              </div>

              <div>
                <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Pipeline</h3>
                <div class="mt-3 space-y-3">
                  @for (stage of reportData.commercialSummary.pipeline; track stage.status) {
                    <div>
                      <div class="mb-1 flex items-center justify-between text-sm text-gray-600">
                        <span>{{ stage.status }}</span>
                        <span>{{ stage.count }} · {{ formatCurrency(stage.totalValue) }}</span>
                      </div>
                      <div class="h-2 rounded-full bg-gray-100">
                        <div class="h-2 rounded-full bg-brand-500" [style.width.%]="pipelineWidth(stage.count, reportData.commercialSummary.pipeline)"></div>
                      </div>
                    </div>
                  } @empty {
                    <p class="text-sm text-gray-500">No pipeline data in the selected period.</p>
                  }
                </div>
              </div>
            </div>
          </div>
        </section>

        <section class="rounded-2xl border border-gray-200 bg-white shadow-sm">
          <div class="flex flex-col gap-3 border-b border-gray-100 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="text-lg font-semibold text-gray-900">Margin Analysis</h2>
              <p class="text-sm text-gray-500">Net margin by customer, product, vessel, and month.</p>
            </div>
            <div class="flex gap-2">
              <button type="button" (click)="exportReport('margin-analysis', 'csv')" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50">
                Export CSV
              </button>
              <button type="button" (click)="exportReport('margin-analysis', 'xlsx')" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50">
                Export XLSX
              </button>
            </div>
          </div>

          <div class="grid gap-6 p-5 xl:grid-cols-3">
            <div>
              <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Top Customers</h3>
              <div class="mt-3 space-y-2">
                @for (row of reportData.marginAnalysis.byCustomer.slice(0, 5); track row.key) {
                  <div class="rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-3">
                    <div class="flex items-center justify-between gap-3">
                      <span class="font-medium text-gray-900">{{ row.label }}</span>
                      <span class="text-sm text-gray-500">{{ row.netMarginPct ?? '—' }}%</span>
                    </div>
                    <div class="mt-1 text-sm text-gray-600">{{ formatCurrency(row.totalNetProfit) }} net on {{ formatCurrency(row.totalRevenue) }} revenue</div>
                    <button type="button" [attr.data-testid]="'reports-customer-drilldown-' + row.key" (click)="openOrderDrilldown('CUSTOMER', row.key)" class="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                      Open orders
                    </button>
                  </div>
                } @empty {
                  <p class="text-sm text-gray-500">No customer margin data in the selected period.</p>
                }
              </div>
            </div>
            <div>
              <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Top Products</h3>
              <div class="mt-3 space-y-2">
                @for (row of reportData.marginAnalysis.byProduct.slice(0, 5); track row.key) {
                  <div class="rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-3">
                    <div class="flex items-center justify-between gap-3">
                      <span class="font-medium text-gray-900">{{ row.label }}</span>
                      <span class="text-sm text-gray-500">{{ row.netMarginPct ?? '—' }}%</span>
                    </div>
                    <div class="mt-1 text-sm text-gray-600">{{ formatCurrency(row.totalNetProfit) }} net on {{ formatCurrency(row.totalRevenue) }} revenue</div>
                    <button type="button" [attr.data-testid]="'reports-product-drilldown-' + row.key" (click)="openOrderDrilldown('PRODUCT', row.key)" class="mt-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50">
                      Open orders
                    </button>
                  </div>
                } @empty {
                  <p class="text-sm text-gray-500">No product margin data in the selected period.</p>
                }
              </div>
            </div>
            <div>
              <h3 class="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Monthly Trend</h3>
              <div class="mt-3 space-y-2">
                @for (point of reportData.marginAnalysis.monthlyTrend; track point.month) {
                  <div class="rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-3">
                    <div class="flex items-center justify-between gap-3">
                      <span class="font-medium text-gray-900">{{ point.month }}</span>
                      <span class="text-sm text-gray-500">{{ point.netMarginPct ?? '—' }}%</span>
                    </div>
                    <div class="mt-1 text-sm text-gray-600">{{ formatCurrency(point.totalNetProfit) }} net on {{ formatCurrency(point.totalRevenue) }} revenue</div>
                  </div>
                } @empty {
                  <p class="text-sm text-gray-500">No margin trend data in the selected period.</p>
                }
              </div>
            </div>
          </div>
        </section>

        <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm" data-testid="reports-exceptions-section">
          <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 class="text-lg font-semibold text-gray-900">Exceptions</h2>
              <p class="text-sm text-gray-500">High-signal issues surfaced from the current report scope, ready for export or scheduled delivery.</p>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              <div class="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-medium text-red-700" data-testid="reports-exceptions-total">
                {{ reportData.exceptions.totalCount }} open exception{{ reportData.exceptions.totalCount === 1 ? '' : 's' }}
              </div>
              <button type="button" data-testid="reports-exceptions-export-csv" (click)="exportReport('exceptions', 'csv')" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Export CSV
              </button>
              <button type="button" data-testid="reports-exceptions-export-xlsx" (click)="exportReport('exceptions', 'xlsx')" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                Export XLSX
              </button>
            </div>
          </div>
          <div class="mt-4 flex flex-wrap gap-2">
            @for (entry of reportData.exceptions.byType; track entry.type) {
              <span class="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700" [attr.data-testid]="'reports-exception-chip-' + entry.type">
                {{ exceptionTypeLabel(entry.type) }} · {{ entry.count }}
              </span>
            } @empty {
              <span class="text-sm text-gray-500">No active exceptions in this scope.</span>
            }
          </div>
          <div class="mt-4 grid gap-3 lg:grid-cols-2">
            @for (row of reportData.exceptions.rows; track row.type + '-' + row.entityId) {
              <div class="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3" [attr.data-testid]="'reports-exception-row-' + row.entityId">
                <div class="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div class="mb-2 inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]" [class.border-red-200]="row.severity === 'HIGH'" [class.bg-red-50]="row.severity === 'HIGH'" [class.text-red-700]="row.severity === 'HIGH'" [class.border-amber-200]="row.severity !== 'HIGH'" [class.bg-amber-50]="row.severity !== 'HIGH'" [class.text-amber-700]="row.severity !== 'HIGH'">
                      {{ row.severity }}
                    </div>
                    <div class="font-medium text-gray-900">{{ row.title }}</div>
                    <div class="text-sm text-gray-500">{{ row.description }}</div>
                  </div>
                  <div class="text-right text-sm">
                    <div class="font-medium text-gray-900">{{ row.primaryValue }}</div>
                    <div class="text-gray-500">{{ row.secondaryValue || exceptionTypeLabel(row.type) }}</div>
                  </div>
                </div>
              </div>
            } @empty {
              <p class="text-sm text-gray-500">No report exceptions matched the selected filters.</p>
            }
          </div>
        </section>

        @if (reportData.access.canManageSchedules || reportData.schedules.length > 0) {
          <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div class="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 class="text-lg font-semibold text-gray-900">Scheduled Delivery</h2>
                <p class="text-sm text-gray-500">Email report summaries on a daily UTC hour.</p>
              </div>
              @if (reportData.access.canManageSchedules) {
                <div class="flex w-full flex-col gap-3 lg:w-auto lg:min-w-[520px]">
                  <div class="grid gap-3 sm:grid-cols-2">
                    <input type="text" data-testid="reports-schedule-name" [value]="scheduleName()" (input)="scheduleName.set(($any($event.target).value || '').trimStart())" placeholder="Schedule name" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    <input type="text" data-testid="reports-schedule-description" [value]="scheduleDescription()" (input)="scheduleDescription.set(($any($event.target).value || '').trimStart())" placeholder="Description (optional)" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                    <select data-testid="reports-schedule-mode" [value]="scheduleMode()" (change)="scheduleMode.set($any($event.target).value)" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
                      <option value="SUMMARY">Summary</option>
                      <option value="EXCEPTIONS">Exceptions</option>
                    </select>
                    <select data-testid="reports-schedule-report-type" [value]="scheduleReportType()" (change)="scheduleReportType.set($any($event.target).value)" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
                      <option value="SUMMARY">Summary</option>
                      <option value="MARGIN_ANALYSIS">Margin analysis</option>
                    </select>
                    <select data-testid="reports-schedule-delivery-mode" [value]="scheduleDeliveryMode()" (change)="scheduleDeliveryMode.set($any($event.target).value)" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
                      <option value="HTML">HTML summary</option>
                      <option value="CSV">CSV attachment</option>
                      <option value="XLSX">XLSX attachment</option>
                      <option value="CSV_XLSX">CSV + XLSX</option>
                    </select>
                    <select data-testid="reports-schedule-body-mode" [value]="scheduleBodyMode()" (change)="scheduleBodyMode.set($any($event.target).value)" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
                      <option value="HTML_SUMMARY">Include HTML summary</option>
                      <option value="ATTACHMENT_ONLY">Attachment only email</option>
                    </select>
                    <select data-testid="reports-schedule-hour" [value]="scheduleHourValue()" (change)="onScheduleHourChange($event)" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
                      @for (hour of utcHours; track hour) {
                        <option [value]="hour">{{ hour }}:00 UTC</option>
                      }
                    </select>
                    <input type="text" data-testid="reports-schedule-extra-emails" [value]="scheduleExtraEmails()" (input)="scheduleExtraEmails.set(($any($event.target).value || '').trimStart())" placeholder="Extra emails, comma-separated" class="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
                  </div>
                  @if (scheduleMode() === 'EXCEPTIONS') {
                    <div class="flex flex-wrap gap-2">
                      @for (type of ['NEGATIVE_NET_PROFIT_ORDER', 'SEVERELY_OVERDUE_INVOICE', 'LOW_MARGIN_CUSTOMER']; track type) {
                        <button type="button" [attr.data-testid]="'reports-schedule-exception-type-' + type" (click)="toggleScheduleExceptionType($any(type))" class="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors" [class.border-red-600]="scheduleExceptionTypeSelected($any(type))" [class.bg-red-600]="scheduleExceptionTypeSelected($any(type))" [class.text-white]="scheduleExceptionTypeSelected($any(type))" [class.border-gray-300]="!scheduleExceptionTypeSelected($any(type))" [class.bg-white]="!scheduleExceptionTypeSelected($any(type))" [class.text-gray-700]="!scheduleExceptionTypeSelected($any(type))">
                          {{ exceptionTypeLabel($any(type)) }}
                        </button>
                      }
                    </div>
                    <label class="flex items-center gap-2 text-sm text-gray-600">
                      <input data-testid="reports-schedule-send-only-non-empty" type="checkbox" [checked]="scheduleSendOnlyWhenNonEmpty()" (change)="scheduleSendOnlyWhenNonEmpty.set(($any($event.target).checked))" class="rounded border-gray-300" />
                      Send only when exceptions exist
                    </label>
                  }
                  @if (editingScheduleId()) {
                    <label class="flex items-center gap-2 text-sm text-gray-600">
                      <input type="checkbox" [checked]="scheduleActive()" (change)="scheduleActive.set(($any($event.target).checked))" class="rounded border-gray-300" />
                      Active schedule
                    </label>
                  }
                  <div class="flex flex-wrap gap-2">
                    @for (role of scheduleRoleOptions; track role) {
                      <button type="button" (click)="toggleScheduleRole(role)" class="rounded-full border px-3 py-1.5 text-sm font-medium transition-colors" [class.border-gray-900]="scheduleRoleSelected(role)" [class.bg-gray-900]="scheduleRoleSelected(role)" [class.text-white]="scheduleRoleSelected(role)" [class.border-gray-300]="!scheduleRoleSelected(role)" [class.bg-white]="!scheduleRoleSelected(role)" [class.text-gray-700]="!scheduleRoleSelected(role)">
                        {{ roleLabel(role) }}
                      </button>
                    }
                  </div>
                  <div class="flex gap-2">
                    <button type="button" data-testid="reports-save-schedule" (click)="saveSchedule()" [disabled]="savingSchedule() || !scheduleName().trim() || scheduleRecipientRoles().length === 0" class="inline-flex items-center justify-center rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-60">
                      {{ savingSchedule() ? 'Saving…' : editingScheduleId() ? 'Update schedule' : 'Create schedule' }}
                    </button>
                    @if (editingScheduleId()) {
                      <button type="button" (click)="resetScheduleEditor()" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
                        Cancel
                      </button>
                    }
                  </div>
                </div>
              }
            </div>

            <div class="mt-4 space-y-3">
              @for (schedule of reportData.schedules; track schedule.id) {
                <div class="flex flex-col gap-3 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 lg:flex-row lg:items-center lg:justify-between" [attr.data-testid]="'reports-schedule-card-' + schedule.id">
                  <div>
                    <div class="font-medium text-gray-900">{{ schedule.name }}</div>
                    <div class="text-sm text-gray-500">{{ scheduleModeLabel(schedule.reportMode) }} · {{ schedule.reportType === 'MARGIN_ANALYSIS' ? 'Margin analysis' : 'Summary' }} · {{ schedule.hourUtc }}:00 UTC · {{ formatRecipientRoles(schedule.recipientRoles) }}</div>
                    <div class="text-xs text-gray-500">Delivery: {{ describeDeliveryMode(schedule.deliveryMode) }} · {{ describeBodyMode(schedule.bodyMode) }} · {{ schedule.isActive ? 'Active' : 'Paused' }}</div>
                    @if (schedule.reportMode === 'EXCEPTIONS') {
                      <div class="text-xs text-gray-500">{{ schedule.sendOnlyWhenNonEmpty ? 'Send only when non-empty' : 'Always send' }} · {{ formatExceptionTypes(schedule.exceptionTypes) }}</div>
                    }
                    <div class="text-xs text-gray-500">Last sent: {{ schedule.lastSentAt || 'Not sent yet' }}</div>
                  </div>
                  @if (reportData.access.canManageSchedules) {
                    <div class="flex gap-2">
                      <button type="button" [attr.data-testid]="'reports-schedule-edit-' + schedule.id" (click)="startEditSchedule(schedule)" class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50">
                        Edit
                      </button>
                      <button type="button" [attr.data-testid]="'reports-schedule-toggle-' + schedule.id" (click)="toggleScheduleActive(schedule)" class="inline-flex items-center justify-center rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-50">
                        {{ schedule.isActive ? 'Pause' : 'Resume' }}
                      </button>
                      <button type="button" [attr.data-testid]="'reports-schedule-delete-' + schedule.id" (click)="deleteSchedule(schedule.id)" class="inline-flex items-center justify-center rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50">
                        Delete
                      </button>
                    </div>
                  }
                </div>
              } @empty {
                <p class="text-sm text-gray-500">No report schedules configured.</p>
              }
            </div>
          </section>
        }
      }
    </div>
  `,
})
export class ReportsPageComponent {
  private readonly http = inject(HttpClient);
  private autoReloadHandle: ReturnType<typeof setTimeout> | null = null;
  readonly dateDropdownRef = viewChild<ElementRef>('dateDropdown');

  private readonly clickOutsideHandler = (event: MouseEvent) => {
    const dropdown = this.dateDropdownRef();
    if (this.dateDropdownOpen() && dropdown && !dropdown.nativeElement.contains(event.target as Node)) {
      this.dateDropdownOpen.set(false);
    }
  };

  readonly utcHours = Array.from({ length: 24 }, (_, index) => index);
  readonly scheduleRoleOptions: Role[] = [Role.Admin, Role.Finance, Role.Teamlead, Role.CreditManager, Role.OperationsManager, Role.Light];

  readonly today = signal(this.formatDateInput(new Date()));
  readonly defaultFrom = signal(this.formatDateInput(new Date(new Date().getFullYear(), 0, 1)));
  readonly from = signal(this.defaultFrom());
  readonly to = signal(this.today());
  readonly dateDropdownOpen = signal(false);
  readonly selectedDatePreset = signal<DatePresetKey>('year_to_date');
  readonly customDateFrom = signal(this.defaultFrom());
  readonly customDateTo = signal(this.today());
  readonly datePresets: Array<{ key: Exclude<DatePresetKey, 'custom'>; label: string }> = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'this_week', label: 'This Week' },
    { key: 'last_7_days', label: 'Last 7 Days' },
    { key: 'this_month', label: 'This Month' },
    { key: 'last_30_days', label: 'Last 30 Days' },
    { key: 'this_quarter', label: 'This Quarter' },
    { key: 'year_to_date', label: 'Year to Date' },
  ];
  readonly dateRangeLabel = computed(() => {
    const preset = this.selectedDatePreset();
    if (preset === 'custom') {
      const from = this.customDateFrom();
      const to = this.customDateTo();
      if (from && to) return `${this.formatShortDate(from)} - ${this.formatShortDate(to)}`;
      return 'Custom Range';
    }

    return this.datePresets.find((option) => option.key === preset)?.label ?? 'Year to Date';
  });
  readonly traderId = signal<string | null>(null);
  readonly teamId = signal<string | null>(null);
  readonly customerId = signal<string | null>(null);
  readonly productType = signal<string | null>(null);
  readonly comparisonMode = signal<ReportComparisonMode>('PREVIOUS_PERIOD');
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly data = signal<ReleaseTwoReportsDto | null>(null);
  readonly drilldownLoading = signal(false);
  readonly drilldownError = signal<string | null>(null);
  readonly drilldownData = signal<ReportDrilldownResponseDto | null>(null);

  readonly editingViewId = signal<string | null>(null);
  readonly newViewName = signal('');
  readonly newViewDescription = signal('');
  readonly savingView = signal(false);

  readonly editingScheduleId = signal<string | null>(null);
  readonly scheduleName = signal('');
  readonly scheduleDescription = signal('');
  readonly scheduleMode = signal<ReportScheduleMode>('SUMMARY');
  readonly scheduleReportType = signal<ReportScheduleType>('SUMMARY');
  readonly scheduleDeliveryMode = signal<ReportScheduleDeliveryMode>('HTML');
  readonly scheduleBodyMode = signal<ReportScheduleBodyMode>('HTML_SUMMARY');
  readonly scheduleHourUtc = signal(8);
  readonly scheduleRecipientRoles = signal<Role[]>([Role.Admin, Role.Finance]);
  readonly scheduleHourValue = computed(() => `${this.scheduleHourUtc()}`);
  readonly scheduleExtraEmails = signal('');
  readonly scheduleExceptionTypes = signal<ReportExceptionType[]>([]);
  readonly scheduleSendOnlyWhenNonEmpty = signal(true);
  readonly scheduleActive = signal(true);
  readonly savingSchedule = signal(false);

  readonly summaryCards = computed(() => {
    const reportData = this.data();
    if (!reportData) return [];

    return [
      {
        label: 'Net Profit',
        value: this.formatCurrency(reportData.traderPerformance.totals.totalNetProfit),
        description: 'Visible net profit across the selected reporting scope.',
      },
      {
        label: 'Open Invoices',
        value: reportData.invoiceAging.totalInvoices.toString(),
        description: `${this.formatCurrency(reportData.invoiceAging.totalOutstanding)} outstanding across all aging buckets.`,
      },
      {
        label: 'Win Rate',
        value: this.formatPercent(reportData.commercialSummary.conversion.winRate),
        description: `Won ${reportData.commercialSummary.conversion.totalWon} and lost ${reportData.commercialSummary.conversion.totalLost}.`,
      },
      {
        label: 'Margin',
        value: this.formatPercentFromRevenue(reportData.traderPerformance.totals.totalNetProfit, reportData.traderPerformance.totals.totalRevenue),
        description: `Average deal size ${this.formatCurrency(reportData.traderPerformance.totals.avgDealSize)}.`,
      },
    ];
  });

  constructor() {
    document.addEventListener('click', this.clickOutsideHandler);
    void this.reload();
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.clickOutsideHandler);
    if (this.autoReloadHandle !== null) {
      clearTimeout(this.autoReloadHandle);
      this.autoReloadHandle = null;
    }
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);

    try {
      const query = this.buildQuery();
      const suffix = query ? `?${query}` : '';
      const response = await firstValueFrom(this.http.get<ApiResponse<ReleaseTwoReportsDto>>(`${API}/reports/release-two${suffix}`));

      if (!response.success) {
        throw new Error(response.message ?? 'Failed to load reports');
      }

      this.data.set(response.data);
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to load reports'));
    } finally {
      this.loading.set(false);
    }
  }

  async exportReport(kind: ExportKind, format: ExportFormat): Promise<void> {
    try {
      const query = this.buildQuery();
      const suffix = query ? `?${query}` : '';
      const response = await firstValueFrom(
        this.http.get(`${API}/reports/${kind}/${format === 'xlsx' ? 'export.xlsx' : 'export'}${suffix}`, {
          observe: 'response',
          responseType: 'blob',
        }),
      );

      const fileName = this.extractFileName(response.headers.get('content-disposition')) ?? `${kind}.${format}`;
      this.downloadBlob(response.body, fileName);
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to export report'));
    }
  }

  async saveCurrentView(): Promise<void> {
    if (!this.newViewName().trim()) return;
    this.savingView.set(true);
    this.error.set(null);

    try {
      const payload = {
        name: this.newViewName().trim(),
        description: this.newViewDescription().trim() || undefined,
        filters: this.currentFilters(),
      };
      const response = this.editingViewId()
        ? await firstValueFrom(this.http.patch<ApiResponse<SavedReportViewDto[]>>(`${API}/reports/saved-views/${this.editingViewId()}`, payload))
        : await firstValueFrom(this.http.post<ApiResponse<SavedReportViewDto[]>>(`${API}/reports/saved-views`, payload));

      if (!response.success) {
        throw new Error(response.message ?? 'Failed to save report view');
      }

      this.data.update((current) => current ? { ...current, savedViews: response.data } : current);
      this.resetViewEditor();
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to save report view'));
    } finally {
      this.savingView.set(false);
    }
  }

  startEditSavedView(view: SavedReportViewDto): void {
    this.editingViewId.set(view.id);
    this.newViewName.set(view.name);
    this.newViewDescription.set(view.description ?? '');
    this.applyFilters(view.filters);
  }

  resetViewEditor(): void {
    this.editingViewId.set(null);
    this.newViewName.set('');
    this.newViewDescription.set('');
  }

  async deleteSavedView(id: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.http.delete<ApiResponse<SavedReportViewDto[]>>(`${API}/reports/saved-views/${id}`));
      if (!response.success) {
        throw new Error(response.message ?? 'Failed to delete report view');
      }
      this.data.update((current) => current ? { ...current, savedViews: response.data } : current);
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to delete report view'));
    }
  }

  applySavedView(view: SavedReportViewDto): void {
    this.applyFilters(view.filters);
    this.queueAutoReload();
  }

  async saveSchedule(): Promise<void> {
    if (!this.scheduleName().trim() || this.scheduleRecipientRoles().length === 0) return;
    this.savingSchedule.set(true);
    this.error.set(null);

    try {
      const payload = {
        name: this.scheduleName().trim(),
        description: this.scheduleDescription().trim() || undefined,
        reportMode: this.scheduleMode(),
        reportType: this.scheduleReportType(),
        deliveryMode: this.scheduleDeliveryMode(),
        bodyMode: this.scheduleBodyMode(),
        hourUtc: this.scheduleHourUtc(),
        recipientRoles: this.scheduleRecipientRoles(),
        extraEmails: this.scheduleExtraEmails().split(',').map((value) => value.trim()).filter(Boolean),
        exceptionTypes: this.scheduleExceptionTypes(),
        sendOnlyWhenNonEmpty: this.scheduleSendOnlyWhenNonEmpty(),
        filters: this.currentFilters(),
        isActive: this.scheduleActive(),
      };
      const response = this.editingScheduleId()
        ? await firstValueFrom(this.http.patch<ApiResponse<ReleaseTwoReportsDto['schedules']>>(`${API}/reports/schedules/${this.editingScheduleId()}`, payload))
        : await firstValueFrom(this.http.post<ApiResponse<ReleaseTwoReportsDto['schedules']>>(`${API}/reports/schedules`, payload));

      if (!response.success) {
        throw new Error(response.message ?? 'Failed to create schedule');
      }

      this.data.update((current) => current ? { ...current, schedules: response.data } : current);
      this.resetScheduleEditor();
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to create schedule'));
    } finally {
      this.savingSchedule.set(false);
    }
  }

  startEditSchedule(schedule: ReleaseTwoReportsDto['schedules'][number]): void {
    this.editingScheduleId.set(schedule.id);
    this.scheduleName.set(schedule.name);
    this.scheduleDescription.set(schedule.description ?? '');
    this.scheduleMode.set(schedule.reportMode);
    this.scheduleReportType.set(schedule.reportType);
    this.scheduleDeliveryMode.set(schedule.deliveryMode);
    this.scheduleBodyMode.set(schedule.bodyMode);
    this.scheduleHourUtc.set(schedule.hourUtc);
    this.scheduleRecipientRoles.set([...schedule.recipientRoles]);
    this.scheduleExtraEmails.set(schedule.extraEmails.join(', '));
    this.scheduleExceptionTypes.set([...schedule.exceptionTypes]);
    this.scheduleSendOnlyWhenNonEmpty.set(schedule.sendOnlyWhenNonEmpty);
    this.scheduleActive.set(schedule.isActive);
    this.applyFilters(schedule.filters);
  }

  resetScheduleEditor(): void {
    this.editingScheduleId.set(null);
    this.scheduleName.set('');
    this.scheduleDescription.set('');
    this.scheduleMode.set('SUMMARY');
    this.scheduleReportType.set('SUMMARY');
    this.scheduleDeliveryMode.set('HTML');
    this.scheduleBodyMode.set('HTML_SUMMARY');
    this.scheduleHourUtc.set(8);
    this.scheduleRecipientRoles.set([Role.Admin, Role.Finance]);
    this.scheduleExtraEmails.set('');
    this.scheduleExceptionTypes.set([]);
    this.scheduleSendOnlyWhenNonEmpty.set(true);
    this.scheduleActive.set(true);
  }

  async deleteSchedule(id: string): Promise<void> {
    try {
      const response = await firstValueFrom(this.http.delete<ApiResponse<ReleaseTwoReportsDto['schedules']>>(`${API}/reports/schedules/${id}`));
      if (!response.success) {
        throw new Error(response.message ?? 'Failed to delete schedule');
      }
      this.data.update((current) => current ? { ...current, schedules: response.data } : current);
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to delete schedule'));
    }
  }

  async toggleScheduleActive(schedule: ReleaseTwoReportsDto['schedules'][number]): Promise<void> {
    try {
      const response = await firstValueFrom(this.http.patch<ApiResponse<ReleaseTwoReportsDto['schedules']>>(`${API}/reports/schedules/${schedule.id}`, {
        name: schedule.name,
        description: schedule.description ?? undefined,
        reportMode: schedule.reportMode,
        reportType: schedule.reportType,
        deliveryMode: schedule.deliveryMode,
        bodyMode: schedule.bodyMode,
        hourUtc: schedule.hourUtc,
        recipientRoles: schedule.recipientRoles,
        extraEmails: schedule.extraEmails,
        exceptionTypes: schedule.exceptionTypes,
        sendOnlyWhenNonEmpty: schedule.sendOnlyWhenNonEmpty,
        filters: schedule.filters,
        isActive: !schedule.isActive,
      }));
      if (!response.success) {
        throw new Error(response.message ?? 'Failed to update schedule');
      }
      this.data.update((current) => current ? { ...current, schedules: response.data } : current);
    } catch (error) {
      this.error.set(this.describeError(error, 'Failed to update schedule'));
    }
  }

  clearFilters(): void {
    this.syncDateFilterState(this.defaultFrom(), this.today());
    this.traderId.set(null);
    this.teamId.set(null);
    this.customerId.set(null);
    this.productType.set(null);
    this.queueAutoReload();
  }

  selectDatePreset(preset: Exclude<DatePresetKey, 'custom'>): void {
    const { from, to } = this.resolveDatePreset(preset);
    this.syncDateFilterState(from, to, preset);
    this.dateDropdownOpen.set(false);
    this.queueAutoReload();
  }

  applyCustomRange(): void {
    const from = this.customDateFrom() || this.from();
    const to = this.customDateTo() || this.to();
    this.syncDateFilterState(from || this.defaultFrom(), to || this.today(), 'custom');
    this.dateDropdownOpen.set(false);
    this.queueAutoReload();
  }

  onTraderChange(event: Event): void {
    this.traderId.set((event.target as HTMLSelectElement | null)?.value || null);
    this.queueAutoReload();
  }

  onTeamChange(event: Event): void {
    this.teamId.set((event.target as HTMLSelectElement | null)?.value || null);
    this.queueAutoReload();
  }

  onCustomerChange(event: Event): void {
    this.customerId.set((event.target as HTMLSelectElement | null)?.value || null);
    this.queueAutoReload();
  }

  onProductTypeChange(event: Event): void {
    this.productType.set((event.target as HTMLSelectElement | null)?.value || null);
    this.queueAutoReload();
  }

  onComparisonModeChange(event: Event): void {
    this.comparisonMode.set(((event.target as HTMLSelectElement | null)?.value as ReportComparisonMode | '') || 'NONE');
    this.queueAutoReload();
  }

  async openOrderDrilldown(dimension: Extract<ReportDrilldownTarget, 'TRADER' | 'CUSTOMER' | 'PRODUCT'>, value: string): Promise<void> {
    this.drilldownLoading.set(true);
    this.drilldownError.set(null);

    try {
      const params = new URLSearchParams(this.buildQuery());
      params.set('dimension', dimension);
      params.set('value', value);
      const response = await firstValueFrom(this.http.get<ApiResponse<ReportDrilldownResponseDto>>(`${API}/reports/drilldown/orders?${params.toString()}`));
      if (!response.success) throw new Error(response.message ?? 'Failed to load drilldown');
      this.drilldownData.set(response.data);
    } catch (error) {
      this.drilldownError.set(this.describeError(error, 'Failed to load drilldown'));
    } finally {
      this.drilldownLoading.set(false);
    }
  }

  async openInvoiceDrilldown(bucket: string): Promise<void> {
    this.drilldownLoading.set(true);
    this.drilldownError.set(null);

    try {
      const params = new URLSearchParams(this.buildQuery());
      params.set('dimension', 'AGING_BUCKET');
      params.set('value', bucket);
      const response = await firstValueFrom(this.http.get<ApiResponse<ReportDrilldownResponseDto>>(`${API}/reports/drilldown/invoices?${params.toString()}`));
      if (!response.success) throw new Error(response.message ?? 'Failed to load drilldown');
      this.drilldownData.set(response.data);
    } catch (error) {
      this.drilldownError.set(this.describeError(error, 'Failed to load drilldown'));
    } finally {
      this.drilldownLoading.set(false);
    }
  }

  closeDrilldown(): void {
    this.drilldownData.set(null);
    this.drilldownError.set(null);
  }

  toggleScheduleRole(role: Role): void {
    const current = this.scheduleRecipientRoles();
    this.scheduleRecipientRoles.set(current.includes(role)
      ? current.filter((value) => value !== role)
      : [...current, role]);
  }

  scheduleRoleSelected(role: Role): boolean {
    return this.scheduleRecipientRoles().includes(role);
  }

  toggleScheduleExceptionType(type: ReportExceptionType): void {
    const current = this.scheduleExceptionTypes();
    this.scheduleExceptionTypes.set(current.includes(type)
      ? current.filter((value) => value !== type)
      : [...current, type]);
  }

  scheduleExceptionTypeSelected(type: ReportExceptionType): boolean {
    return this.scheduleExceptionTypes().includes(type);
  }

  onScheduleHourChange(event: Event): void {
    const value = Number((event.target as HTMLSelectElement | null)?.value ?? 8);
    this.scheduleHourUtc.set(Number.isFinite(value) ? value : 8);
  }

  describeScope(scope: ReleaseTwoReportsDto['access']['scope']): string {
    switch (scope) {
      case 'ALL':
        return 'All data';
      case 'TEAM':
        return 'My team';
      default:
        return 'My scope';
    }
  }

  comparisonModeLabel(mode: ReportComparisonMode): string {
    switch (mode) {
      case 'PREVIOUS_MONTH':
        return 'Previous month';
      case 'PREVIOUS_QUARTER':
        return 'Previous quarter';
      case 'PREVIOUS_YEAR':
        return 'Previous year';
      case 'PREVIOUS_PERIOD':
        return 'Previous period';
      default:
        return 'No comparison';
    }
  }

  exceptionTypeLabel(type: ReportExceptionType): string {
    switch (type) {
      case 'NEGATIVE_NET_PROFIT_ORDER':
        return 'Negative net profit orders';
      case 'SEVERELY_OVERDUE_INVOICE':
        return 'Severely overdue invoices';
      case 'LOW_MARGIN_CUSTOMER':
        return 'Low-margin customers';
    }
  }

  scheduleModeLabel(mode: ReportScheduleMode): string {
    return mode === 'EXCEPTIONS' ? 'Exceptions' : 'Summary';
  }

  roleLabel(role: Role): string {
    switch (role) {
      case Role.Teamlead:
        return 'Team lead';
      case Role.CreditManager:
        return 'Credit';
      case Role.OperationsManager:
        return 'Operations';
      case Role.Light:
        return 'Light';
      default:
        return role.charAt(0) + role.slice(1).toLowerCase();
    }
  }

  formatRecipientRoles(roles: Role[]): string {
    return roles.map((role) => this.roleLabel(role)).join(', ');
  }

  formatExceptionTypes(types: ReportExceptionType[]): string {
    return types.length > 0 ? types.map((type) => this.exceptionTypeLabel(type)).join(', ') : 'All exception types';
  }

  describeDeliveryMode(mode: ReportScheduleDeliveryMode): string {
    switch (mode) {
      case 'CSV':
        return 'CSV attachment';
      case 'XLSX':
        return 'XLSX attachment';
      case 'CSV_XLSX':
        return 'CSV + XLSX attachments';
      default:
        return 'HTML summary';
    }
  }

  describeBodyMode(mode: ReportScheduleBodyMode): string {
    return mode === 'ATTACHMENT_ONLY' ? 'Attachment only' : 'HTML summary included';
  }

  formatCurrency(value: string | number): string {
    const numericValue = typeof value === 'number' ? value : Number(value);
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(Number.isFinite(numericValue) ? numericValue : 0);
  }

  formatPercent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  formatPercentFromRevenue(netProfit: string | number, revenue: string | number): string {
    const revenueValue = typeof revenue === 'number' ? revenue : Number(revenue);
    const profitValue = typeof netProfit === 'number' ? netProfit : Number(netProfit);
    if (!Number.isFinite(revenueValue) || revenueValue <= 0) return '0.0%';
    return `${((profitValue / revenueValue) * 100).toFixed(1)}%`;
  }

  pipelineWidth(count: number, stages: ReleaseTwoReportsDto['commercialSummary']['pipeline']): number {
    const max = Math.max(...stages.map((stage) => stage.count), 1);
    return (count / max) * 100;
  }

  private currentFilters(): ReportFiltersDto {
    return {
      from: this.from(),
      to: this.to(),
      traderId: this.traderId(),
      teamId: this.teamId(),
      customerId: this.customerId(),
      productType: this.productType(),
    };
  }

  private applyFilters(filters: ReportFiltersDto): void {
    this.syncDateFilterState(filters.from || this.defaultFrom(), filters.to || this.today());
    this.traderId.set(filters.traderId ?? null);
    this.teamId.set(filters.teamId ?? null);
    this.customerId.set(filters.customerId ?? null);
    this.productType.set(filters.productType ?? null);
  }

  private buildQuery(): string {
    const params = new URLSearchParams();
    const filters = this.currentFilters();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.traderId) params.set('traderId', filters.traderId);
    if (filters.teamId) params.set('teamId', filters.teamId);
    if (filters.customerId) params.set('customerId', filters.customerId);
    if (filters.productType) params.set('productType', filters.productType);
    if (this.comparisonMode() !== 'NONE') params.set('comparisonMode', this.comparisonMode());
    return params.toString();
  }

  private formatDateInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private formatShortDate(value: string): string {
    const date = new Date(`${value}T00:00:00`);
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  private syncDateFilterState(from: string, to: string, preset?: DatePresetKey): void {
    this.from.set(from);
    this.to.set(to);
    this.customDateFrom.set(from);
    this.customDateTo.set(to);

    if (preset) {
      this.selectedDatePreset.set(preset);
      return;
    }

    this.selectedDatePreset.set(this.matchDatePreset(from, to) ?? 'custom');
  }

  private matchDatePreset(from: string, to: string): Exclude<DatePresetKey, 'custom'> | null {
    for (const preset of this.datePresets) {
      const range = this.resolveDatePreset(preset.key);
      if (range.from === from && range.to === to) {
        return preset.key;
      }
    }

    return null;
  }

  private resolveDatePreset(preset: Exclude<DatePresetKey, 'custom'>): { from: string; to: string } {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let from = new Date(today);
    let to = new Date(today);

    switch (preset) {
      case 'today':
        break;
      case 'yesterday':
        from.setDate(from.getDate() - 1);
        to = new Date(from);
        break;
      case 'this_week': {
        const day = today.getDay();
        from.setDate(today.getDate() - (day === 0 ? 6 : day - 1));
        break;
      }
      case 'last_7_days':
        from.setDate(from.getDate() - 6);
        break;
      case 'this_month':
        from = new Date(today.getFullYear(), today.getMonth(), 1);
        break;
      case 'last_30_days':
        from.setDate(from.getDate() - 29);
        break;
      case 'this_quarter': {
        const quarter = Math.floor(today.getMonth() / 3);
        from = new Date(today.getFullYear(), quarter * 3, 1);
        break;
      }
      case 'year_to_date':
        from = new Date(today.getFullYear(), 0, 1);
        break;
    }

    return {
      from: this.formatDateInput(from),
      to: this.formatDateInput(to),
    };
  }

  private extractFileName(contentDisposition: string | null): string | null {
    if (!contentDisposition) return null;
    const match = /filename="?([^\"]+)"?/i.exec(contentDisposition);
    return match?.[1] ?? null;
  }

  private downloadBlob(blob: Blob | null, fileName: string): void {
    if (!blob) return;
    const objectUrl = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.click();
    window.URL.revokeObjectURL(objectUrl);
  }

  private describeError(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    return fallback;
  }

  private queueAutoReload(): void {
    if (this.autoReloadHandle !== null) {
      clearTimeout(this.autoReloadHandle);
    }

    this.autoReloadHandle = setTimeout(() => {
      this.autoReloadHandle = null;
      void this.reload();
    }, 250);
  }
}
