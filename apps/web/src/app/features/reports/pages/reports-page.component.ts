import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type {
  ApiResponse,
  ReleaseTwoReportsDto,
  ReportFiltersDto,
  ReportScheduleBodyMode,
  ReportScheduleDeliveryMode,
  ReportScheduleType,
  SavedReportViewDto,
} from '@fueld/types';
import { Role } from '@fueld/types';
import { API } from '@app/core/config/api';

type ExportKind = 'trader-performance' | 'invoice-aging' | 'commercial-summary' | 'margin-analysis';
type ExportFormat = 'csv' | 'xlsx';

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
          <p class="mt-1 text-sm text-gray-500">Historical, filterable reporting for trader performance, collections, commercial conversion, and margin analysis.</p>
        </div>

        <div class="flex items-center gap-3">
          <button
            type="button"
            (click)="clearFilters()"
            class="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-gray-400 hover:bg-gray-50"
          >
            Reset filters
          </button>
          <button
            type="button"
            (click)="reload()"
            class="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
            [disabled]="loading()"
          >
            {{ loading() ? 'Loading…' : 'Refresh' }}
          </button>
        </div>
      </div>

      <section class="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
          <label class="flex flex-col gap-1 text-sm text-gray-600">
            <span>From</span>
            <input type="date" [value]="from()" (change)="from.set(($any($event.target).value || defaultFrom()))" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
          </label>
          <label class="flex flex-col gap-1 text-sm text-gray-600">
            <span>To</span>
            <input type="date" [value]="to()" (change)="to.set(($any($event.target).value || today()))" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100" />
          </label>
          <label class="flex flex-col gap-1 text-sm text-gray-600">
            <span>Trader</span>
            <select [value]="traderId() ?? ''" (change)="traderId.set(($any($event.target).value || null))" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
              <option value="">All</option>
              @for (option of data()?.filterOptions?.traders ?? []; track option.id) {
                <option [value]="option.id">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="flex flex-col gap-1 text-sm text-gray-600">
            <span>Team</span>
            <select [value]="teamId() ?? ''" (change)="teamId.set(($any($event.target).value || null))" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
              <option value="">All</option>
              @for (option of data()?.filterOptions?.teams ?? []; track option.id) {
                <option [value]="option.id">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="flex flex-col gap-1 text-sm text-gray-600">
            <span>Customer</span>
            <select [value]="customerId() ?? ''" (change)="customerId.set(($any($event.target).value || null))" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
              <option value="">All</option>
              @for (option of data()?.filterOptions?.customers ?? []; track option.id) {
                <option [value]="option.id">{{ option.label }}</option>
              }
            </select>
          </label>
          <label class="flex flex-col gap-1 text-sm text-gray-600">
            <span>Product</span>
            <select [value]="productType() ?? ''" (change)="productType.set(($any($event.target).value || null))" class="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100">
              <option value="">All</option>
              @for (option of data()?.filterOptions?.products ?? []; track option.id) {
                <option [value]="option.id">{{ option.label }}</option>
              }
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
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="8" class="px-5 py-8 text-center text-sm text-gray-500">No trader performance data found for the selected period.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>

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
                <div class="rounded-xl border border-gray-200 bg-gray-50/80 p-3">
                  <p class="text-xs font-medium uppercase tracking-[0.18em] text-gray-400">{{ bucket.label }}</p>
                  <p class="mt-2 text-lg font-semibold text-gray-900">{{ bucket.count }}</p>
                  <p class="text-sm text-gray-500">{{ formatCurrency(bucket.outstandingAmount) }}</p>
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
                    <div class="text-sm text-gray-500">{{ schedule.reportType === 'MARGIN_ANALYSIS' ? 'Margin analysis' : 'Summary' }} · {{ schedule.hourUtc }}:00 UTC · {{ formatRecipientRoles(schedule.recipientRoles) }}</div>
                    <div class="text-xs text-gray-500">Delivery: {{ describeDeliveryMode(schedule.deliveryMode) }} · {{ describeBodyMode(schedule.bodyMode) }} · {{ schedule.isActive ? 'Active' : 'Paused' }}</div>
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

  readonly utcHours = Array.from({ length: 24 }, (_, index) => index);
  readonly scheduleRoleOptions: Role[] = [Role.Admin, Role.Finance, Role.Teamlead, Role.CreditManager];

  readonly today = signal(this.formatDateInput(new Date()));
  readonly defaultFrom = signal(this.formatDateInput(new Date(new Date().getFullYear(), 0, 1)));
  readonly from = signal(this.defaultFrom());
  readonly to = signal(this.today());
  readonly traderId = signal<string | null>(null);
  readonly teamId = signal<string | null>(null);
  readonly customerId = signal<string | null>(null);
  readonly productType = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly data = signal<ReleaseTwoReportsDto | null>(null);

  readonly editingViewId = signal<string | null>(null);
  readonly newViewName = signal('');
  readonly newViewDescription = signal('');
  readonly savingView = signal(false);

  readonly editingScheduleId = signal<string | null>(null);
  readonly scheduleName = signal('');
  readonly scheduleDescription = signal('');
  readonly scheduleReportType = signal<ReportScheduleType>('SUMMARY');
  readonly scheduleDeliveryMode = signal<ReportScheduleDeliveryMode>('HTML');
  readonly scheduleBodyMode = signal<ReportScheduleBodyMode>('HTML_SUMMARY');
  readonly scheduleHourUtc = signal(8);
  readonly scheduleRecipientRoles = signal<Role[]>([Role.Admin, Role.Finance]);
  readonly scheduleHourValue = computed(() => `${this.scheduleHourUtc()}`);
  readonly scheduleExtraEmails = signal('');
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
    void this.reload();
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
    void this.reload();
  }

  async saveSchedule(): Promise<void> {
    if (!this.scheduleName().trim() || this.scheduleRecipientRoles().length === 0) return;
    this.savingSchedule.set(true);
    this.error.set(null);

    try {
      const payload = {
        name: this.scheduleName().trim(),
        description: this.scheduleDescription().trim() || undefined,
        reportType: this.scheduleReportType(),
        deliveryMode: this.scheduleDeliveryMode(),
        bodyMode: this.scheduleBodyMode(),
        hourUtc: this.scheduleHourUtc(),
        recipientRoles: this.scheduleRecipientRoles(),
        extraEmails: this.scheduleExtraEmails().split(',').map((value) => value.trim()).filter(Boolean),
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
    this.scheduleReportType.set(schedule.reportType);
    this.scheduleDeliveryMode.set(schedule.deliveryMode);
    this.scheduleBodyMode.set(schedule.bodyMode);
    this.scheduleHourUtc.set(schedule.hourUtc);
    this.scheduleRecipientRoles.set([...schedule.recipientRoles]);
    this.scheduleExtraEmails.set(schedule.extraEmails.join(', '));
    this.scheduleActive.set(schedule.isActive);
    this.applyFilters(schedule.filters);
  }

  resetScheduleEditor(): void {
    this.editingScheduleId.set(null);
    this.scheduleName.set('');
    this.scheduleDescription.set('');
    this.scheduleReportType.set('SUMMARY');
    this.scheduleDeliveryMode.set('HTML');
    this.scheduleBodyMode.set('HTML_SUMMARY');
    this.scheduleHourUtc.set(8);
    this.scheduleRecipientRoles.set([Role.Admin, Role.Finance]);
    this.scheduleExtraEmails.set('');
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
        reportType: schedule.reportType,
        deliveryMode: schedule.deliveryMode,
        bodyMode: schedule.bodyMode,
        hourUtc: schedule.hourUtc,
        recipientRoles: schedule.recipientRoles,
        extraEmails: schedule.extraEmails,
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
    this.from.set(this.defaultFrom());
    this.to.set(this.today());
    this.traderId.set(null);
    this.teamId.set(null);
    this.customerId.set(null);
    this.productType.set(null);
    void this.reload();
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

  roleLabel(role: Role): string {
    switch (role) {
      case Role.Teamlead:
        return 'Team lead';
      case Role.CreditManager:
        return 'Credit';
      default:
        return role.charAt(0) + role.slice(1).toLowerCase();
    }
  }

  formatRecipientRoles(roles: Role[]): string {
    return roles.map((role) => this.roleLabel(role)).join(', ');
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
    this.from.set(filters.from || this.defaultFrom());
    this.to.set(filters.to || this.today());
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
    return params.toString();
  }

  private formatDateInput(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
}
