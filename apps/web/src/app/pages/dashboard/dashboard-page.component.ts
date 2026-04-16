import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
  ElementRef,
  ViewChild,
  OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import type {
  CollectionsResponseDto,
  TeamStatsResponseDto,
  TraderStatsDto,
  PipelineStageDto,
  LossReasonDto,
  ConversionMetricsDto,
  ApiResponse,
  CounterpartyDto,
} from '@fueld/types';
import { firstValueFrom } from 'rxjs';
import { Router } from '@angular/router';
import { DatePipe } from '@angular/common';
import { Role } from '@fueld/types';

import { CollectionsWidgetComponent } from '../../features/dashboard/components/collections-widget/collections-widget.component';
import { AuthService } from '../../core/auth/auth.service';
import { API } from '@app/core/config/api';
import { RiskMonitoringService } from '../../core/risk-monitoring/risk-monitoring.service';

type DashboardFollowUpItem = {
  id: string;
  entityType: string;
  entityId: string;
  entityName: string | null;
  content: string;
  followUpDate: string;
  userName: string;
};

const UPCOMING_FOLLOW_UP_WINDOW_DAYS = 14;

// ═══════════════════════════════════════════════════════════════════════
//  Dashboard Page — Manager view with collections and team stats
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-dashboard-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, CollectionsWidgetComponent, DatePipe],
  template: `
    <div>
      <div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p class="mt-1 text-sm text-gray-500">Overview of your bunker trading operations.</p>
        </div>

        <!-- Date Range + Team Toggle -->
        <div class="flex w-full items-center justify-end gap-3 flex-shrink-0 sm:w-auto">
          @if (canUseTeamView()) {
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium text-gray-600">My Orders</span>
              <button
                (click)="toggleTeamView()"
                [class.bg-brand-600]="teamView()"
                [class.bg-gray-200]="!teamView()"
                class="relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                role="switch"
                [attr.aria-checked]="teamView()"
              >
                <span class="sr-only">Toggle team view</span>
                <span
                  aria-hidden="true"
                  [class.translate-x-5]="teamView()"
                  [class.translate-x-0]="!teamView()"
                  class="pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out"
                ></span>
              </button>
              <span class="text-sm font-medium text-gray-600">Team View</span>
            </div>
          }
          <div class="relative" #dateDropdown>
            <button
              (click)="dateDropdownOpen.set(!dateDropdownOpen())"
              class="flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50 transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clip-rule="evenodd" />
              </svg>
              {{ dateRangeLabel() }}
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z" clip-rule="evenodd" />
              </svg>
            </button>

            @if (dateDropdownOpen()) {
              <div class="absolute right-0 z-50 mt-1 w-[22rem] max-w-[calc(100vw-1rem)] origin-top-right rounded-lg border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 max-h-[calc(100vh-120px)] overflow-y-auto">
                <div class="py-1">
                  @for (preset of datePresets; track preset.key) {
                    <button
                      (click)="selectDatePreset(preset.key)"
                      class="flex w-full items-center justify-between px-4 py-2 text-sm transition-colors"
                      [class]="selectedDatePreset() === preset.key
                        ? 'bg-brand-50 text-brand-700 font-medium'
                        : 'text-gray-700 hover:bg-gray-50'"
                    >
                      {{ preset.label }}
                      @if (selectedDatePreset() === preset.key) {
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-brand-600" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                        </svg>
                      }
                    </button>
                  }
                </div>
                <div class="border-t border-gray-100 px-4 py-3">
                  <p class="mb-2 text-xs font-medium text-gray-500 uppercase tracking-wider">Custom Range</p>
                  <div class="flex items-center gap-2">
                    <input
                      type="date"
                      [ngModel]="customDateFrom()"
                      (ngModelChange)="customDateFrom.set($event)"
                      class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                    <span class="text-gray-400 text-xs shrink-0 px-1">to</span>
                    <input
                      type="date"
                      [ngModel]="customDateTo()"
                      (ngModelChange)="customDateTo.set($event)"
                      class="min-w-0 flex-1 rounded-md border border-gray-300 px-2 py-1.5 text-xs focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    />
                  </div>
                  <button
                    (click)="applyCustomRange()"
                    class="mt-2 w-full rounded-md bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 transition-colors"
                  >
                    Apply
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        @for (card of kpiCards(); track card.label) {
          <div class="app-kpi-card" [attr.title]="card.description">
            <p class="text-sm font-medium text-gray-500">{{ card.label }}</p>
            <p class="mt-2 text-3xl font-bold text-gray-900">{{ card.value }}</p>
          </div>
        }
      </div>

      <!-- Collections Widget -->
      <div class="mt-8">
        <app-collections-widget [overdueInvoices]="collections().items" />
      </div>

      <!-- Follow-Ups Widget -->
      @if (followUpGroups().total) {
        <div class="mt-8 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div class="border-b border-gray-100 px-5 py-3 flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clip-rule="evenodd" />
            </svg>
            <h3 class="text-sm font-semibold text-gray-900">Follow-Ups</h3>
            <span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
              {{ followUpGroups().total }}
            </span>
          </div>
          <div class="border-b border-gray-100 px-5 py-3 flex flex-wrap gap-2 bg-gray-50/70">
            @if (followUpGroups().overdue.length) {
              <span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                Overdue {{ followUpGroups().overdue.length }}
              </span>
            }
            @if (followUpGroups().dueToday.length) {
              <span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                Due Today {{ followUpGroups().dueToday.length }}
              </span>
            }
            @if (followUpGroups().upcoming.length) {
              <span class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                Next {{ upcomingFollowUpWindowDays }} Days {{ followUpGroups().upcoming.length }}
              </span>
            }
          </div>
          <div class="divide-y divide-gray-100">
            @if (followUpGroups().overdue.length) {
              <div class="px-5 py-4">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <h4 class="text-xs font-semibold uppercase tracking-[0.12em] text-red-700">Overdue</h4>
                  <span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700">
                    {{ followUpGroups().overdue.length }}
                  </span>
                </div>
                <div class="space-y-2">
                  @for (f of followUpGroups().overdue; track f.id) {
                    <div class="flex items-center gap-4 rounded-lg border border-red-100 bg-red-50/40 px-4 py-3">
                      <button
                        type="button"
                        (click)="openFollowUp(f)"
                        class="min-w-0 flex-1 rounded-md text-left transition-colors hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                        title="Open related record"
                      >
                        <div class="flex items-center gap-2">
                          <span
                            class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                            [class]="followUpDateClass(f.followUpDate)"
                          >{{ f.followUpDate | date:'mediumDate' }}</span>
                          <span class="text-xs uppercase tracking-wide text-gray-400">{{ f.entityType }}</span>
                          <span class="text-sm font-medium text-gray-900 truncate">{{ f.entityName || f.entityId }}</span>
                        </div>
                        <p class="mt-0.5 text-xs text-gray-500 line-clamp-1">{{ f.content }}</p>
                        <span class="text-[10px] text-gray-400">{{ f.userName }}</span>
                      </button>
                      <button
                        type="button"
                        (click)="completeFollowUp(f.id)"
                        class="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-green-50 hover:text-green-600 transition-colors"
                        title="Mark done"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  }
                </div>
              </div>
            }
            @if (followUpGroups().dueToday.length) {
              <div class="px-5 py-4">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <h4 class="text-xs font-semibold uppercase tracking-[0.12em] text-amber-700">Due Today</h4>
                  <span class="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                    {{ followUpGroups().dueToday.length }}
                  </span>
                </div>
                <div class="space-y-2">
                  @for (f of followUpGroups().dueToday; track f.id) {
                    <div class="flex items-center gap-4 rounded-lg border border-amber-100 bg-amber-50/40 px-4 py-3">
                      <button
                        type="button"
                        (click)="openFollowUp(f)"
                        class="min-w-0 flex-1 rounded-md text-left transition-colors hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                        title="Open related record"
                      >
                        <div class="flex items-center gap-2">
                          <span
                            class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                            [class]="followUpDateClass(f.followUpDate)"
                          >{{ f.followUpDate | date:'mediumDate' }}</span>
                          <span class="text-xs uppercase tracking-wide text-gray-400">{{ f.entityType }}</span>
                          <span class="text-sm font-medium text-gray-900 truncate">{{ f.entityName || f.entityId }}</span>
                        </div>
                        <p class="mt-0.5 text-xs text-gray-500 line-clamp-1">{{ f.content }}</p>
                        <span class="text-[10px] text-gray-400">{{ f.userName }}</span>
                      </button>
                      <button
                        type="button"
                        (click)="completeFollowUp(f.id)"
                        class="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-green-50 hover:text-green-600 transition-colors"
                        title="Mark done"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  }
                </div>
              </div>
            }
            @if (followUpGroups().upcoming.length) {
              <div class="px-5 py-4">
                <div class="mb-3 flex items-center justify-between gap-3">
                  <h4 class="text-xs font-semibold uppercase tracking-[0.12em] text-blue-700">Upcoming (Next {{ upcomingFollowUpWindowDays }} Days)</h4>
                  <span class="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                    {{ followUpGroups().upcoming.length }}
                  </span>
                </div>
                <div class="space-y-2">
                  @for (f of followUpGroups().upcoming; track f.id) {
                    <div class="flex items-center gap-4 rounded-lg border border-blue-100 bg-blue-50/40 px-4 py-3">
                      <button
                        type="button"
                        (click)="openFollowUp(f)"
                        class="min-w-0 flex-1 rounded-md text-left transition-colors hover:text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
                        title="Open related record"
                      >
                        <div class="flex items-center gap-2">
                          <span
                            class="inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium"
                            [class]="followUpDateClass(f.followUpDate)"
                          >{{ f.followUpDate | date:'mediumDate' }}</span>
                          <span class="text-xs uppercase tracking-wide text-gray-400">{{ f.entityType }}</span>
                          <span class="text-sm font-medium text-gray-900 truncate">{{ f.entityName || f.entityId }}</span>
                        </div>
                        <p class="mt-0.5 text-xs text-gray-500 line-clamp-1">{{ f.content }}</p>
                        <span class="text-[10px] text-gray-400">{{ f.userName }}</span>
                      </button>
                      <button
                        type="button"
                        (click)="completeFollowUp(f.id)"
                        class="shrink-0 rounded-full p-1.5 text-gray-400 hover:bg-green-50 hover:text-green-600 transition-colors"
                        title="Mark done"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </div>
                  }
                </div>
              </div>
            }
          </div>
        </div>
      }

      @if (showFrozenCounterpartiesWidget() && (frozenCompaniesLoading() || frozenCompanies().length)) {
        <div class="mt-8 rounded-xl border border-red-200 bg-white shadow-sm overflow-hidden">
          <div class="border-b border-red-100 bg-red-50 px-5 py-3 flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-red-600" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
              </svg>
              <div>
                <h3 class="text-sm font-semibold text-red-900">{{ frozenCounterpartiesTitle() }}</h3>
                <p class="text-xs text-red-700">Counterparties with active monitoring hits that currently freeze credit.</p>
              </div>
            </div>
            @if (frozenCompanies().length) {
              <span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
                {{ frozenCompanies().length }}
              </span>
            }
          </div>
          @if (frozenCompaniesLoading()) {
            <div class="flex items-center justify-center py-6">
              <svg class="h-5 w-5 animate-spin text-red-400" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            </div>
          } @else {
            <div class="divide-y divide-red-50">
              @for (company of frozenCompanies(); track company.id) {
                <button
                  type="button"
                  (click)="goToCompany(company.id)"
                  class="flex w-full items-center justify-between gap-4 px-5 py-3 text-left transition-colors hover:bg-red-50/60"
                >
                  <div class="min-w-0 flex-1">
                    <div class="flex flex-wrap items-center gap-2">
                      <span class="truncate text-sm font-semibold text-gray-900">{{ company.name }}</span>
                      <span class="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">Credit Frozen</span>
                    </div>
                    <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                      @if (company.country) {
                        <span>{{ company.country }}</span>
                      }
                      @if (company.responsibleUserName && showResponsibleInFrozenCounterparties()) {
                        <span>Responsible: {{ company.responsibleUserName }}</span>
                      }
                      @if (company.creditLimit && +company.creditLimit > 0) {
                        <span>Limit: {{ formatUsd(parseNumber(company.creditLimit)) }}</span>
                      }
                    </div>
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 flex-shrink-0 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 111.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clip-rule="evenodd" />
                  </svg>
                </button>
              }
            </div>
          }
        </div>
      }

      <!-- Top Customer Groups by Credit Exposure -->
      @if (topCreditGroups().length) {
        <div class="mt-8 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Top Customer Groups by Credit Exposure</h3>
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b border-gray-200 bg-gray-50/80">
                  <th class="px-4 py-2 text-left font-medium text-gray-600">Parent Company</th>
                  <th class="px-4 py-2 text-center font-medium text-gray-600">Companies</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Credit Limit</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Credit Used</th>
                  <th class="px-4 py-2 text-right font-medium text-gray-600">Utilization</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                @for (g of topCreditGroups(); track g.id) {
                  <tr class="hover:bg-gray-50/50 cursor-pointer transition-colors" (click)="goToCompanyGroup(g.id)">
                    <td class="px-4 py-2.5">
                      <span class="font-medium text-gray-900">{{ g.name }}</span>
                      @if (g.country) {
                        <span class="ml-1 text-xs text-gray-400">{{ g.country }}</span>
                      }
                    </td>
                    <td class="px-4 py-2.5 text-center text-gray-600">{{ g.childCount }}</td>
                    <td class="px-4 py-2.5 text-right font-medium tabular-nums text-gray-700">{{ formatUsd(+g.totalCreditLimit) }}</td>
                    <td class="px-4 py-2.5 text-right font-medium tabular-nums text-gray-700">{{ formatUsd(+g.totalCreditUsed) }}</td>
                    <td class="px-4 py-2.5 text-right">
                      @if (+g.totalCreditLimit > 0) {
                        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                          [class]="(+g.totalCreditUsed / +g.totalCreditLimit) >= 0.8 ? 'bg-red-100 text-red-700' :
                                   (+g.totalCreditUsed / +g.totalCreditLimit) >= 0.5 ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'">
                          {{ ((+g.totalCreditUsed / +g.totalCreditLimit) * 100).toFixed(0) }}%
                        </span>
                      } @else {
                        <span class="text-xs text-gray-400">—</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      }

      <!-- Pipeline & Loss Analysis -->
      <div class="mt-8 grid gap-6 lg:grid-cols-2 min-w-0">
        <!-- Sales Funnel / Pipeline -->
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm min-w-0 overflow-hidden">
          <h3 class="text-lg font-semibold text-gray-900 mb-4">Sales Pipeline</h3>
          @if (pipelineStages().length === 0) {
            <p class="text-sm text-gray-500">No data for this period.</p>
          } @else {
            <div class="space-y-3">
              @for (stage of pipelineStages(); track stage.status) {
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-sm font-medium text-gray-700">{{ stage.status }}</span>
                    <span class="text-sm font-semibold text-gray-900">{{ stage.count }} <span class="text-xs font-normal text-gray-500" title="Sell price × qty × unit conversion, converted to USD via FX rates">({{ formatUsd(parseNumber(stage.totalValue)) }})</span></span>
                  </div>
                  <div class="h-3 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      class="h-3 rounded-full transition-all duration-300"
                      [class]="pipelineBarColor(stage.status)"
                      [style.width.%]="pipelineBarWidth(stage.count)"
                    ></div>
                  </div>
                </div>
              }
            </div>
          }
        </div>

        <!-- Loss Analysis (cancel reasons) -->
        <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm min-w-0 overflow-hidden">
          <div class="flex items-center justify-between mb-4">
            <h3 class="text-lg font-semibold text-gray-900">Loss Analysis</h3>
            @if (lossAnalysis().totalCancelled > 0) {
              <span class="text-xs font-medium text-gray-500">{{ lossAnalysis().totalCancelled }} cancelled</span>
            }
          </div>
          @if (lossAnalysis().reasons.length === 0) {
            <p class="text-sm text-gray-500">No cancellations in this period.</p>
          } @else {
            <div class="space-y-3">
              @for (reason of lossAnalysis().reasons; track reason.reason) {
                <div>
                  <div class="flex items-center justify-between mb-1">
                    <span class="text-sm text-gray-700 truncate max-w-[70%]">{{ reason.reason }}</span>
                    <span class="text-sm font-semibold text-gray-900">{{ reason.count }} <span class="text-xs font-normal text-gray-500">({{ (reason.percentage * 100).toFixed(0) }}%)</span></span>
                  </div>
                  <div class="h-2.5 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      class="h-2.5 rounded-full bg-red-400 transition-all duration-300"
                      [style.width.%]="reason.percentage * 100"
                    ></div>
                  </div>
                </div>
              }
            </div>
          }
        </div>
      </div>

      <!-- Conversion Metrics -->
      <div class="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <div class="app-kpi-card">
          <p class="text-sm font-medium text-gray-500">Win Rate</p>
          <p class="mt-2 text-3xl font-bold" [class]="conversionMetrics().winRate >= 0.5 ? 'text-emerald-600' : 'text-amber-600'">
            {{ (conversionMetrics().winRate * 100).toFixed(1) }}%
          </p>
          <p class="mt-1 text-xs text-gray-400">{{ conversionMetrics().totalWon }}W / {{ conversionMetrics().totalLost }}L of {{ conversionMetrics().totalInquiries }} total</p>
        </div>
        <div class="app-kpi-card">
          <p class="text-sm font-medium text-gray-500">Avg. Days to Close</p>
          <p class="mt-2 text-3xl font-bold text-gray-900">{{ conversionMetrics().avgDaysToClose !== null ? conversionMetrics().avgDaysToClose : '—' }}</p>
          <p class="mt-1 text-xs text-gray-400">From inquiry to confirmed</p>
        </div>
        <div class="app-kpi-card">
          <p class="text-sm font-medium text-gray-500">Won Orders</p>
          <p class="mt-2 text-3xl font-bold text-emerald-600">{{ conversionMetrics().totalWon }}</p>
        </div>
        <div class="app-kpi-card">
          <p class="text-sm font-medium text-gray-500">Lost Orders</p>
          <p class="mt-2 text-3xl font-bold text-red-500">{{ conversionMetrics().totalLost }}</p>
        </div>
      </div>
    </div>
  `,
})
export class DashboardPageComponent implements OnInit, OnDestroy {
  readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly riskMonitoringService = inject(RiskMonitoringService);

  @ViewChild('dateDropdown') dateDropdownRef!: ElementRef;

  // ─── Date Range ──────────────────────────────────────────────────
  readonly dateDropdownOpen = signal(false);
  readonly selectedDatePreset = signal<string>('this_month');
  readonly customDateFrom = signal('');
  readonly customDateTo = signal('');

  readonly datePresets = [
    { key: 'today', label: 'Today' },
    { key: 'yesterday', label: 'Yesterday' },
    { key: 'this_week', label: 'This Week' },
    { key: 'last_7_days', label: 'Last 7 Days' },
    { key: 'this_month', label: 'This Month' },
    { key: 'last_30_days', label: 'Last 30 Days' },
    { key: 'this_quarter', label: 'This Quarter' },
    { key: 'this_year', label: 'Year to Date' },
  ];

  readonly dateRangeLabel = computed(() => {
    const preset = this.selectedDatePreset();
    if (preset === 'custom') {
      const from = this.customDateFrom();
      const to = this.customDateTo();
      if (from && to) return `${this.formatShortDate(from)} – ${this.formatShortDate(to)}`;
      return 'Custom Range';
    }
    return this.datePresets.find((p) => p.key === preset)?.label ?? 'This Month';
  });

  readonly dateRange = computed(() => {
    const preset = this.selectedDatePreset();
    const now = new Date();
    let from: Date;
    let to: Date = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    switch (preset) {
      case 'today':
        from = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        break;
      case 'yesterday': {
        const y = new Date(now);
        y.setDate(y.getDate() - 1);
        from = new Date(y.getFullYear(), y.getMonth(), y.getDate());
        to = new Date(y.getFullYear(), y.getMonth(), y.getDate(), 23, 59, 59);
        break;
      }
      case 'this_week': {
        const day = now.getDay();
        from = new Date(now);
        from.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
        from.setHours(0, 0, 0, 0);
        break;
      }
      case 'last_7_days':
        from = new Date(now);
        from.setDate(now.getDate() - 6);
        from.setHours(0, 0, 0, 0);
        break;
      case 'this_month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'last_30_days':
        from = new Date(now);
        from.setDate(now.getDate() - 29);
        from.setHours(0, 0, 0, 0);
        break;
      case 'this_quarter': {
        const q = Math.floor(now.getMonth() / 3);
        from = new Date(now.getFullYear(), q * 3, 1);
        break;
      }
      case 'this_year':
        from = new Date(now.getFullYear(), 0, 1);
        break;
      case 'custom':
        from = this.customDateFrom() ? new Date(this.customDateFrom()) : new Date(now.getFullYear(), now.getMonth(), 1);
        to = this.customDateTo() ? new Date(this.customDateTo() + 'T23:59:59') : to;
        break;
      default:
        from = new Date(now.getFullYear(), now.getMonth(), 1);
    }
    return { from, to };
  });

  private clickOutsideHandler = (event: MouseEvent) => {
    if (this.dateDropdownRef && !this.dateDropdownRef.nativeElement.contains(event.target)) {
      this.dateDropdownOpen.set(false);
    }
  };

  // ─── State ───────────────────────────────────────────────────────
  readonly teamView = signal(false);
  readonly collections = signal<CollectionsResponseDto>({ items: [], count: 0 });
  readonly rawTraderStats = signal<TraderStatsDto[]>([]);
  readonly teamStats = signal<TeamStatsResponseDto>({
    totalTraders: 0,
    activeOrders: 0,
    totalRevenueYTD: '—',
    totalGrossProfitYTD: '—',
    totalNetProfitYTD: '—',
    avgDealSize: '—',
    traderPerformance: [],
  });
  readonly pipelineStages = signal<PipelineStageDto[]>([]);
  readonly lossAnalysis = signal<{ reasons: LossReasonDto[]; totalCancelled: number }>({ reasons: [], totalCancelled: 0 });
  readonly conversionMetrics = signal<ConversionMetricsDto>({ totalInquiries: 0, totalWon: 0, totalLost: 0, winRate: 0, avgDaysToClose: null });
  readonly topCreditGroups = signal<{ id: string; name: string; country: string | null; totalCreditLimit: string; totalCreditUsed: string; childCount: number }[]>([]);
  readonly followUps = signal<DashboardFollowUpItem[]>([]);
  readonly frozenCompanies = signal<CounterpartyDto[]>([]);
  readonly frozenCompaniesLoading = signal(false);
  readonly upcomingFollowUpWindowDays = UPCOMING_FOLLOW_UP_WINDOW_DAYS;
  readonly canUseTeamView = computed(() => this.auth.isAdmin() || this.auth.isCreditManager());
  readonly showFrozenCounterpartiesWidget = computed(() => {
    const role = this.auth.user()?.role;
    return role === Role.Admin || role === Role.Teamlead || role === Role.CreditManager || role === Role.Trader;
  });
  readonly frozenCounterpartiesTitle = computed(() => this.showResponsibleInFrozenCounterparties() ? 'Frozen Counterparties' : 'My Frozen Counterparties');
  readonly followUpGroups = computed(() => {
    const today = this.todayIsoDate();
    const upcomingCutoff = this.offsetIsoDate(this.upcomingFollowUpWindowDays);
    const overdue: DashboardFollowUpItem[] = [];
    const dueToday: DashboardFollowUpItem[] = [];
    const upcoming: DashboardFollowUpItem[] = [];

    for (const item of this.followUps()) {
      if (item.followUpDate < today) {
        overdue.push(item);
      } else if (item.followUpDate === today) {
        dueToday.push(item);
      } else if (item.followUpDate <= upcomingCutoff) {
        upcoming.push(item);
      }
    }

    return {
      overdue,
      dueToday,
      upcoming,
      total: overdue.length + dueToday.length + upcoming.length,
    };
  });

  constructor() {}

  // ─── Lifecycle ────────────────────────────────────────────────────

  ngOnInit(): void {
    document.addEventListener('click', this.clickOutsideHandler);
    void this.loadDashboardData();
    void this.loadTopCreditGroups();
    void this.loadFollowUps();
    void this.loadFrozenCompanies();
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.clickOutsideHandler);
  }

  // ─── Computed ────────────────────────────────────────────────────

  readonly kpiCards = computed(() => [
    { label: 'Total Orders', value: this.teamStats().activeOrders.toString(), description: 'Count of all non-inquiry, non-cancelled orders in the selected period.' },
    { label: 'Total Revenue YTD', value: this.teamStats().totalRevenueYTD, description: 'Sum of sell price × qty × unit conversion factor, converted to USD via FX rates. Excludes inquiries and cancelled orders.' },
    { label: 'Gross Profit YTD', value: this.teamStats().totalGrossProfitYTD ?? '—', description: 'Total revenue minus total cost, both converted to USD via FX rates.' },
    { label: 'Net Profit YTD', value: this.teamStats().totalNetProfitYTD ?? '—', description: 'Gross profit minus estimated financing cost based on payment term differences.' },
    { label: 'Avg. Deal Size', value: this.teamStats().avgDealSize, description: 'Total Revenue YTD divided by total order count.' },
    { label: 'Overdue Invoices', value: this.collections().items.length.toString(), description: 'Number of unpaid invoices past their due date.' },
  ]);

  // ─── Actions ─────────────────────────────────────────────────────

  toggleTeamView(): void {
    this.teamView.update((current) => !current);
    void this.loadDashboardData();
  }

  selectDatePreset(key: string): void {
    this.selectedDatePreset.set(key);
    this.dateDropdownOpen.set(false);
    void this.loadDashboardData();
  }

  applyCustomRange(): void {
    if (!this.customDateFrom() && !this.customDateTo()) return;
    this.selectedDatePreset.set('custom');
    this.dateDropdownOpen.set(false);
    void this.loadDashboardData();
  }

  private formatShortDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }

  private formatDateForQuery(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private todayIsoDate(): string {
    return this.formatDateForQuery(new Date());
  }

  private offsetIsoDate(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return this.formatDateForQuery(date);
  }

  private buildDateQuery(): string {
    const params = new URLSearchParams();
    if (this.selectedDatePreset() === 'custom') {
      const from = this.customDateFrom();
      const to = this.customDateTo();
      if (from) params.set('from', from);
      if (to) params.set('to', to);
    } else {
      const range = this.dateRange();
      params.set('from', this.formatDateForQuery(range.from));
      params.set('to', this.formatDateForQuery(range.to));
    }
    // "My Orders" mode: filter server-side by current user
    const isMyOrders = this.canUseTeamView() ? !this.teamView() : true;
    if (isMyOrders) {
      const uid = this.auth.user()?.id;
      if (uid) params.set('userId', uid);
    }
    return params.toString();
  }

  private async loadDashboardData(): Promise<void> {
    try {
      const query = this.buildDateQuery();
      const suffix = query ? `?${query}` : '';
      const [collectionsRes, teamRes, pipelineRes, lossRes, convRes] = await Promise.all([
        firstValueFrom(this.http.get<CollectionsResponseDto>(`${API}/dashboard/collections${suffix}`)),
        firstValueFrom(this.http.get<{ traders: TraderStatsDto[] }>(`${API}/dashboard/team-stats${suffix}`)),
        firstValueFrom(this.http.get<{ stages: PipelineStageDto[] }>(`${API}/dashboard/pipeline${suffix}`)),
        firstValueFrom(this.http.get<{ reasons: LossReasonDto[]; totalCancelled: number }>(`${API}/dashboard/loss-analysis${suffix}`)),
        firstValueFrom(this.http.get<ConversionMetricsDto>(`${API}/dashboard/conversion${suffix}`)),
      ]);

      const itemsWithComments = (collectionsRes.items ?? []).map((item) => ({
        ...item,
        comments: item.comments ?? [],
      }));
      this.collections.set({ items: itemsWithComments, count: collectionsRes.count ?? itemsWithComments.length });
      this.rawTraderStats.set(teamRes.traders ?? []);
      this.applyTeamStats();

      // Pipeline — order stages logically
      const statusOrder = ['INQUIRY', 'OFFER', 'CONFIRMED', 'DELIVERED', 'INVOICED', 'PAID', 'CANCELLED'];
      const sorted = [...(pipelineRes.stages ?? [])].sort(
        (a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status),
      );
      this.pipelineStages.set(sorted);
      this.lossAnalysis.set({ reasons: lossRes.reasons ?? [], totalCancelled: lossRes.totalCancelled ?? 0 });
      this.conversionMetrics.set(convRes);
    } catch {
      this.collections.set({ items: [], count: 0 });
      this.teamStats.set({
        totalTraders: 0,
        activeOrders: 0,
        totalRevenueYTD: '—',
        totalGrossProfitYTD: '—',
        totalNetProfitYTD: '—',
        avgDealSize: '—',
        traderPerformance: [],
      });
      this.pipelineStages.set([]);
      this.lossAnalysis.set({ reasons: [], totalCancelled: 0 });
      this.conversionMetrics.set({ totalInquiries: 0, totalWon: 0, totalLost: 0, winRate: 0, avgDaysToClose: null });
    }
  }

  private applyTeamStats(): void {
    const traders = this.rawTraderStats();
    const userId = this.auth.user()?.id ?? null;
    const filtered = this.canUseTeamView() && !this.teamView() && userId
      ? traders.filter((trader) => trader.traderId === userId)
      : traders;

    const totalOrders = filtered.reduce((sum, trader) => sum + trader.orderCount, 0);
    const totalRevenue = filtered.reduce(
      (sum, trader) => sum + this.parseNumber(trader.totalRevenue),
      0,
    );
    const totalProfit = filtered.reduce(
      (sum, trader) => sum + this.parseNumber(trader.totalProfit),
      0,
    );
    const totalNetProfit = filtered.reduce(
      (sum, trader) => sum + this.parseNumber(trader.totalNetProfit),
      0,
    );
    const avgDealSize = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    this.teamStats.set({
      totalTraders: filtered.length,
      activeOrders: totalOrders,
      totalRevenueYTD: totalRevenue > 0 ? this.formatUsd(totalRevenue) : '—',
      totalGrossProfitYTD: totalProfit !== 0 ? this.formatUsd(totalProfit) : '—',
      totalNetProfitYTD: totalNetProfit !== 0 ? this.formatUsd(totalNetProfit) : '—',
      avgDealSize: avgDealSize > 0 ? this.formatUsd(avgDealSize) : '—',
      traderPerformance: filtered.map((trader) => ({
        name: trader.traderName,
        orders: trader.orderCount,
        revenue: this.formatUsd(this.parseNumber(trader.totalRevenue)),
        margin: this.formatUsd(this.parseNumber(trader.totalNetProfit)),
      })),
    });
  }

  parseNumber(value: string | null | undefined): number {
    if (value === null || value === undefined) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  formatUsd(value: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(value);
  }

  // ─── Pipeline Helpers ────────────────────────────────────────────

  pipelineBarWidth(count: number): number {
    const max = Math.max(...this.pipelineStages().map((s) => s.count), 1);
    return (count / max) * 100;
  }

  pipelineBarColor(status: string): string {
    const colors: Record<string, string> = {
      INQUIRY: 'bg-blue-400',
      OFFER: 'bg-indigo-400',
      CONFIRMED: 'bg-emerald-500',
      DELIVERED: 'bg-teal-500',
      INVOICED: 'bg-amber-500',
      PAID: 'bg-green-600',
      CANCELLED: 'bg-red-400',
    };
    return colors[status] ?? 'bg-gray-400';
  }

  private async loadTopCreditGroups(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<{ success: boolean; data: any[] }>(`${API}/companies/top-credit-groups`),
      );
      if (res.success) {
        this.topCreditGroups.set(res.data);
      }
    } catch {
      // Non-critical widget — silently fail
    }
  }

  goToCompanyGroup(id: string): void {
    void this.router.navigate(['/companies', id]);
  }

  goToCompany(id: string): void {
    void this.router.navigate(['/companies', id]);
  }

  openFollowUp(item: DashboardFollowUpItem): void {
    const route = this.followUpRoute(item);
    if (!route) return;
    void this.router.navigate(route);
  }

  private followUpRoute(item: DashboardFollowUpItem): string[] | null {
    switch (item.entityType) {
      case 'company':
        return ['/companies', item.entityId];
      case 'order':
        return ['/trading/orders', item.entityId];
      case 'place':
        return ['/places', item.entityId];
      case 'vessel':
        return ['/vessels', item.entityId];
      default:
        return null;
    }
  }

  showResponsibleInFrozenCounterparties(): boolean {
    const role = this.auth.user()?.role;
    return role === Role.Admin || role === Role.Teamlead || role === Role.CreditManager;
  }

  private async loadFrozenCompanies(): Promise<void> {
    if (!this.showFrozenCounterpartiesWidget()) return;

    const params = new URLSearchParams({
      page: '1',
      limit: this.showResponsibleInFrozenCounterparties() ? '100' : '25',
      type: 'CLIENT',
      sortBy: 'name',
      sortDir: 'asc',
    });

    if (!this.showResponsibleInFrozenCounterparties()) {
      const userId = this.auth.user()?.id;
      if (!userId) return;
      params.set('responsibleUserId', userId);
    }

    this.frozenCompaniesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ companies: CounterpartyDto[]; total: number }>>(`${API}/companies/local?${params}`),
      );
      const companies = res.success && res.data ? res.data.companies : [];
      if (!companies.length) {
        this.frozenCompanies.set([]);
        return;
      }

      const frozenIds = await this.riskMonitoringService.batchFrozen(companies.map((company) => company.id));
      this.frozenCompanies.set(companies.filter((company) => frozenIds.has(company.id)).slice(0, 8));
    } catch {
      this.frozenCompanies.set([]);
    } finally {
      this.frozenCompaniesLoading.set(false);
    }
  }

  // ─── Follow-ups ───────────────────────────────────────────────

  private async loadFollowUps(): Promise<void> {
    try {
      const params = new URLSearchParams();
      params.set('to', this.offsetIsoDate(this.upcomingFollowUpWindowDays));
      const suffix = params.size > 0 ? `?${params.toString()}` : '';
      const res = await firstValueFrom(
        this.http.get<{ items: DashboardFollowUpItem[] }>(`${API}/dashboard/follow-ups${suffix}`),
      );
      this.followUps.set(res.items ?? []);
    } catch {
      // non-critical
    }
  }

  followUpDateClass(dateStr: string): string {
    const today = this.todayIsoDate();
    if (dateStr < today) return 'bg-red-100 border-red-200 text-red-700';
    if (dateStr === today) return 'bg-amber-100 border-amber-200 text-amber-700';
    return 'bg-blue-100 border-blue-200 text-blue-700';
  }

  async completeFollowUp(commentId: string): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<unknown>>(`${API}/comments/${encodeURIComponent(commentId)}/complete`, {}),
      );
      if (res.success) {
        this.followUps.update((list) => list.filter((f) => f.id !== commentId));
      }
    } catch {
      // silent
    }
  }
}
