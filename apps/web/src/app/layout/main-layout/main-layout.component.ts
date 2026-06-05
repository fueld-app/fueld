import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  effect,
  ElementRef,
  viewChild,
  HostListener,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { DecimalPipe, DatePipe } from '@angular/common';
import { Router, RouterOutlet, RouterLink, RouterLinkActive, NavigationEnd } from '@angular/router';
import { firstValueFrom, Subscription, filter } from 'rxjs';
import { Title } from '@angular/platform-browser';
import { AuthService } from '../../core/auth/auth.service';
import { WebSocketService } from '../../core/websocket/websocket.service';
import { UserMenuComponent } from '../../shared/components/user-menu/user-menu.component';
import type { ApiResponse, PlaceDto, VesselDto } from '@fueld/types';
import { AppUpdateService } from '../../core/pwa/app-update.service';
import { LlmHealthService } from '../../core/llm/llm-health.service';
import { NewInquiryModalService } from '../../core/trading/new-inquiry-modal.service';
import {
  AppHealthService,
  formatAppVersionLabel,
} from '../../core/runtime/app-health.service';

import { API } from '@app/core/config/api';

interface CommodityPrice {
  ticker: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  currency: string;
  updatedAt: string;
}

interface FxRatesPayload {
  base: string;
  rates: Record<string, number>;
  changes?: Record<string, { change: number; changePercent: number }>;
  updatedAt: string | null;
}

interface PriceSnapshotPayload {
  version: string;
  pricesByTicker: Record<string, CommodityPrice>;
  fxRates?: FxRatesPayload;
}

interface PricePatchPayload {
  pricesByTicker?: Record<string, CommodityPrice>;
  removedTickers?: string[];
  fxRates?: {
    base?: string;
    rates?: Record<string, number>;
    changes?: Record<string, Partial<{ change: number; changePercent: number }>>;
    updatedAt?: string | null;
  };
}

interface WireCommodityPrice {
  n: string;
  p: number;
  d: number;
  dp: number;
  c: string;
  u: string;
}

interface WireFxRatesPayload {
  b: string;
  r: Record<string, number>;
  c?: Record<string, { d?: number; p?: number }>;
  u: string | null;
}

interface WirePriceSnapshotPayload {
  v: string;
  p: Record<string, WireCommodityPrice>;
  f?: WireFxRatesPayload;
}

interface WirePricePatchPayload {
  p?: Record<string, WireCommodityPrice>;
  x?: string[];
  f?: {
    b?: string;
    r?: Record<string, number>;
    c?: Record<string, { d?: number; p?: number }>;
    u?: string | null;
  };
}

function decodeCommodityPrices(pricesByTicker: Record<string, WireCommodityPrice> | undefined): Record<string, CommodityPrice> {
  if (!pricesByTicker) return {};

  return Object.fromEntries(
    Object.entries(pricesByTicker).map(([ticker, price]) => [
      ticker,
      {
        ticker,
        name: price.n,
        price: price.p,
        change: price.d,
        changePercent: price.dp,
        currency: price.c,
        updatedAt: price.u,
      },
    ]),
  );
}

function decodeFxRatesPayload(fxRates: WireFxRatesPayload | undefined): FxRatesPayload | undefined {
  if (!fxRates) return undefined;

  return {
    base: fxRates.b,
    rates: fxRates.r,
    changes: fxRates.c
      ? Object.fromEntries(
          Object.entries(fxRates.c).map(([currency, change]) => [
            currency,
            {
              change: change.d ?? 0,
              changePercent: change.p ?? 0,
            },
          ]),
        )
      : undefined,
    updatedAt: fxRates.u,
  };
}

function decodePriceSnapshotPayload(data: WirePriceSnapshotPayload): PriceSnapshotPayload {
  return {
    version: data.v,
    pricesByTicker: decodeCommodityPrices(data.p),
    fxRates: decodeFxRatesPayload(data.f),
  };
}

function decodePricePatchPayload(data: WirePricePatchPayload): PricePatchPayload {
  return {
    pricesByTicker: data.p ? decodeCommodityPrices(data.p) : undefined,
    removedTickers: data.x,
    fxRates: data.f
      ? {
          base: data.f.b,
          rates: data.f.r,
          changes: data.f.c
            ? Object.fromEntries(
                Object.entries(data.f.c).map(([currency, change]) => [
                  currency,
                  {
                    ...(change.d !== undefined ? { change: change.d } : {}),
                    ...(change.p !== undefined ? { changePercent: change.p } : {}),
                  },
                ]),
              )
            : undefined,
          updatedAt: data.f.u,
        }
      : undefined,
  };
}

interface SearchResult {
  id: string;
  name: string;
  subtitle: string;
  kind: 'place' | 'company' | 'vessel' | 'order';
  orderStatus?: string;
}

// ═══════════════════════════════════════════════════════════════════════
//  Main Layout — Responsive sidebar + top bar shell
//
//  Desktop: Fixed sidebar (left, w-64, dark slate) + content area
//  Mobile:  Hidden sidebar, top bar with hamburger, slide-out drawer
// ═══════════════════════════════════════════════════════════════════════

interface NavItem {
  label: string;
  icon: string;
  route?: string;
  children?: { label: string; route: string; allowedRoles?: string[] }[];
  adminOnly?: boolean;
  /** When set, item is visible to these roles (and always to ADMIN). */
  allowedRoles?: string[];
}

const NAVIGATION: NavItem[] = [
  {
    label: 'Dashboard',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1',
    route: '/',
  },
  {
    label: 'Reports',
    icon: 'M3 3h18v18H3V3zm4 12h2V9H7v6zm4 0h2V6h-2v9zm4 0h2v-4h-2v4z',
    route: '/reports',
  },
  {
    label: 'Trading',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    children: [
      { label: 'Active Orders', route: '/trading/orders' },
      { label: 'Completed Orders', route: '/trading/completed-orders' },
      { label: 'Cancelled Orders', route: '/trading/cancelled-orders' },
      { label: 'Inquiries', route: '/trading/inquiries' },
    ],
  },
  {
    label: 'Credit',
    icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    children: [
      { label: 'Applications', route: '/credit/applications' },
      { label: 'Suppliers', route: '/credit/suppliers', allowedRoles: ['ADMIN', 'CREDITMANAGER'] },
      { label: 'Customers', route: '/credit/customers', allowedRoles: ['ADMIN', 'CREDITMANAGER'] },
    ],
  },
  {
    label: 'Operations',
    icon: 'M4 7h16M4 12h16M4 17h10',
    children: [
      { label: 'Inventory', route: '/operations/inventory' },
    ],
  },
  {
    label: 'Companies',
    icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4',
    route: '/companies',
  },
  {
    label: 'Places',
    icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z',
    route: '/places',
  },
  {
    label: 'Vessels',
    icon: 'M4 19h16M5 19l1-9h12l1 9M8 10V7a1 1 0 011-1h6a1 1 0 011 1v3M12 6V3',
    route: '/vessels',
  },
  {
    label: 'Resources',
    icon: 'M4 6.75A2.75 2.75 0 016.75 4h10.5A2.75 2.75 0 0120 6.75v10.5A2.75 2.75 0 0117.25 20H6.75A2.75 2.75 0 014 17.25V6.75zm3 1.5a.75.75 0 000 1.5h6.5a.75.75 0 000-1.5H7zm0 4a.75.75 0 000 1.5h10a.75.75 0 000-1.5H7zm0 4a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5H7z',
    children: [
      { label: 'Platts', route: '/resources/platts' },
    ],
  },
  {
    label: 'Admin',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    adminOnly: true,
    children: [
      { label: 'Users', route: '/admin/users' },
      { label: 'Our Companies', route: '/admin/our-companies' },
      { label: 'Teams', route: '/admin/teams' },
      { label: 'Company Groups', route: '/admin/company-groups' },
      { label: 'Integrations', route: '/admin/integrations' },
      { label: 'Activity Log', route: '/admin/activity' },
      { label: 'Security', route: '/admin/security' },
      { label: 'Settings', route: '/admin/settings' },
      { label: 'Port Documentation', route: '/admin/port-documentation' },
      { label: 'LLM / AI', route: '/admin/llm' },
      { label: 'Backup / Restore', route: '/admin/backup' },
      { label: 'Email', route: '/admin/email' },
      { label: 'Credit Settings', route: '/admin/credit' },
      { label: 'Vessel Sanctions', route: '/admin/vessel-sanctions' },
      { label: 'Warehouses', route: '/admin/warehouses' },
    ],
  },
];

@Component({
  selector: 'app-main-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UserMenuComponent, DecimalPipe, DatePipe],
  template: `
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!--  Mobile Overlay Backdrop                                       -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    @if (sidebarOpen()) {
      <div
        class="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm transition-opacity lg:hidden"
        (click)="closeSidebar()"
        aria-hidden="true"
      ></div>
    }

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!--  Sidebar                                                       -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <aside
      [class]="sidebarClasses()"
      role="navigation"
      aria-label="Main navigation"
    >
      <!-- Brand -->
      <div class="flex h-16 items-center gap-3 px-6">
        <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-white" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fill-rule="evenodd" d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z" clip-rule="evenodd" />
          </svg>
        </div>
        <span class="text-lg font-bold tracking-tight text-sidebar-text-active">FUELD</span>
      </div>

      <!-- Nav list -->
      <nav class="mt-4 flex-1 space-y-1 overflow-y-auto px-3">
        @for (item of navItems(); track item.label) {
          @if (item.route) {
            <!-- Simple nav link -->
            <a
              [routerLink]="item.route"
              routerLinkActive="bg-sidebar-active text-sidebar-text-active"
              [routerLinkActiveOptions]="{ exact: item.route === '/' }"
              class="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-active focus-visible:outline-none"
              (click)="closeSidebar()"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="item.icon" />
              </svg>
              {{ item.label }}
            </a>
          } @else {
            <!-- Expandable group -->
            <div>
              <button
                (click)="toggleGroup(item.label)"
                class="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-active focus-visible:outline-none"
                [attr.aria-expanded]="isGroupOpen(item.label)"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                  <path stroke-linecap="round" stroke-linejoin="round" [attr.d]="item.icon" />
                </svg>
                <span class="flex-1 text-left">{{ item.label }}</span>
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  class="h-4 w-4 transition-transform"
                  [class.rotate-90]="isGroupOpen(item.label)"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd" />
                </svg>
              </button>

              @if (isGroupOpen(item.label)) {
                <div class="ml-5 mt-1 space-y-0.5 border-l border-sidebar-hover pl-4">
                  @for (child of item.children; track child.label) {
                    @if (!child.allowedRoles || child.allowedRoles.includes('ADMIN') && auth.isAdmin() || child.allowedRoles.includes(auth.userRole())) {
                    <a
                      [routerLink]="child.route"
                      routerLinkActive="text-sidebar-text-active bg-sidebar-active"
                      class="block rounded-md px-3 py-2 text-sm text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-active focus-visible:outline-none"
                      (click)="closeSidebar()"
                    >
                      {{ child.label }}
                    </a>
                    }
                  }
                </div>
              }
            </div>
          }
        }
      </nav>

      <!-- Sidebar footer -->
      <div class="border-t border-sidebar-hover px-4 py-3">
        <div class="flex items-center justify-between">
          <p class="truncate text-xs text-sidebar-text/60" [title]="footerVersion()">{{ footerVersion() }}</p>
          @if (llmHealthy() !== null) {
            <a routerLink="/admin/llm" class="group flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] transition-colors hover:bg-sidebar-hover"
              [title]="llmHealthy() ? 'LLM Online' : 'LLM Offline'">
              <span class="relative flex h-2 w-2">
                @if (llmHealthy()) {
                  <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60"></span>
                  <span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-400"></span>
                } @else {
                  <span class="relative inline-flex h-2 w-2 rounded-full bg-red-400"></span>
                }
              </span>
              <span class="text-sidebar-text/50 group-hover:text-sidebar-text/80">AI</span>
            </a>
          }
        </div>
      </div>
    </aside>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!--  Main content area                                             -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <div class="app-shell flex min-h-screen min-h-[100dvh] flex-col lg:pl-64">
      @if (showUpdateToast()) {
        <div class="app-update-toast fixed z-50 w-80 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-lg">
          <p class="text-sm font-semibold text-amber-900">Update available</p>
          <p class="mt-1 text-xs text-amber-800">Reload to get the latest fixes and features.</p>
          <div class="mt-3 flex items-center gap-2">
            <button
              class="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
              (click)="reloadForUpdate()"
            >
              Reload
            </button>
            <button
              class="rounded-md px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
              (click)="dismissUpdateToast()"
            >
              Later
            </button>
          </div>
        </div>
      }
      <!-- Top bar -->
      <header class="app-topbar sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-gray-200 bg-white/80 px-4 backdrop-blur-md sm:px-6 lg:px-8">
        <!-- Hamburger (mobile only) -->
        <button
          class="rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 lg:hidden"
          (click)="toggleSidebar()"
          [attr.aria-label]="sidebarOpen() ? 'Close menu' : 'Open menu'"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" aria-hidden="true">
            @if (sidebarOpen()) {
              <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
            } @else {
              <path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16" />
            }
          </svg>
        </button>

        <!-- Global Search -->
        <div class="relative flex-1 transition-all duration-300" [class]="searchFocused() ? 'max-w-2xl' : 'max-w-md'" #searchWrapper>
          <div class="relative">
            <svg xmlns="http://www.w3.org/2000/svg" class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" />
            </svg>
            <input
              type="text"
              placeholder="Search…"
              class="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-700
                     placeholder:text-gray-400 transition-colors
                     focus:border-brand-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-brand-100"
              [value]="searchTerm()"
              (input)="onSearchInput($event)"
              (focus)="onSearchFocus()"
              (blur)="onSearchBlur()"
              (keydown.escape)="closeSearch()"
              (keydown.enter)="navigateFirstResult()"
            />
            @if (searchLoading()) {
              <svg class="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
            }
          </div>

          <!-- Search Results Dropdown -->
          @if (searchOpen() && (searchResults().length || (searchTerm().length >= 2 && !searchLoading()))) {
            <div class="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-gray-200 bg-white shadow-lg overflow-hidden">
              @if (searchResults().length) {
                @for (result of searchResults(); track result.id + result.kind) {
                  <button
                    class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors hover:bg-gray-50"
                    (click)="goToResult(result)"
                  >
                    @if (result.kind === 'order') {
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clip-rule="evenodd" />
                      </svg>
                    } @else if (result.kind === 'company') {
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clip-rule="evenodd" />
                      </svg>
                    } @else if (result.kind === 'vessel') {
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-teal-400" viewBox="0 0 20 20" fill="currentColor">
                        <path d="M3 18h18l-3-9H6L3 18zM10 2l2 7H8l2-7z" />
                      </svg>
                    } @else {
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                        <path fill-rule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clip-rule="evenodd" />
                      </svg>
                    }
                    <div class="min-w-0 flex-1">
                      <p class="truncate font-medium text-gray-900">{{ result.name }}</p>
                      <p class="truncate text-xs text-gray-500">{{ result.subtitle }}</p>
                    </div>
                    <span class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium"
                      [class]="result.kind === 'order' ? 'bg-amber-50 text-amber-600' : result.kind === 'company' ? 'bg-blue-50 text-blue-600' : result.kind === 'vessel' ? 'bg-teal-50 text-teal-600' : 'bg-gray-100 text-gray-500'">
                      {{ result.kind === 'order' ? 'Order' : result.kind === 'company' ? 'Company' : result.kind === 'vessel' ? 'Vessel' : 'Place' }}
                    </span>
                  </button>
                }
              } @else {
                <div class="px-4 py-3 text-sm text-gray-500">No results found</div>
              }
            </div>
          }
        </div>

        <!-- Right side actions -->
        <div class="ml-auto flex items-center gap-3">
          <!-- Commodity Prices (shrinks / hides when search expands) -->
          <div class="hidden shrink items-center gap-3 overflow-hidden md:flex">
            @if (eurRate() !== null) {
              <div class="flex shrink-0 flex-col leading-tight">
                <div class="flex items-center gap-1 text-xs">
                  <span class="font-medium text-gray-500">1 USD =</span>
                  <span class="font-semibold text-gray-900">{{ eurRate() | number:'1.2-2' }}</span>
                  <span class="font-medium text-gray-500">EUR</span>
                </div>
                <div class="flex items-center gap-1">
                  <span
                    class="text-[11px] font-medium"
                    [class]="eurChange() >= 0 ? 'text-emerald-600' : 'text-red-600'"
                  >
                    {{ eurChange() >= 0 ? '+' : '' }}{{ eurChange() | number:'1.2-2' }}
                    ({{ eurChangePercent() >= 0 ? '+' : '' }}{{ eurChangePercent() | number:'1.2-2' }}%)
                  </span>
                  <span class="text-[10px] text-gray-400" [title]="formatLocalDateTime(fxUpdatedAt())">{{ relativeTime(fxUpdatedAt()) }}</span>
                </div>
              </div>
            }
            @for (p of commodityPrices(); track p.ticker) {
              <div class="flex shrink-0 flex-col leading-tight">
                <div class="flex items-center gap-1 text-xs">
                  <span class="font-medium text-gray-500">{{ p.name }}</span>
                  <span class="font-semibold text-gray-900">{{ p.price | number:'1.2-2' }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <span
                    class="text-[11px] font-medium"
                    [class]="p.change >= 0 ? 'text-emerald-600' : 'text-red-600'"
                  >
                    {{ p.change >= 0 ? '+' : '' }}{{ p.change | number:'1.2-2' }}
                    ({{ p.change >= 0 ? '+' : '' }}{{ p.changePercent | number:'1.2-2' }}%)
                  </span>
                  <span class="text-[10px] text-gray-400" [title]="formatLocalDateTime(p.updatedAt)">{{ relativeTime(p.updatedAt) }}</span>
                </div>
              </div>
            }
          </div>

          @if (commodityPrices().length > 0) {
            <div class="hidden h-6 w-px bg-gray-200 md:block"></div>
          }

          <!-- New Inquiry quick button -->
          <button
            (click)="openNewInquiry()"
            class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 p-2 sm:px-3.5 sm:py-2 text-sm font-semibold
                   text-white shadow-sm transition-colors hover:bg-brand-700
                   focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2"
            aria-label="New Inquiry"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
            </svg>
            <span class="hidden sm:inline">New Inquiry</span>
          </button>

          <!-- Notifications bell (RFQ inbox) -->
          <button
            (click)="toggleRfqPanel()"
            class="relative rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Incoming RFQs"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
            @if (pendingRfqs().length > 0) {
              <span class="absolute -top-0.5 -right-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {{ pendingRfqs().length }}
              </span>
            }
          </button>

          <!-- User menu -->
          <app-user-menu />
        </div>
      </header>

      @if (auth.mfaSetupRequired()) {
        <section class="border-b border-amber-200 bg-amber-50/90 px-4 py-3 sm:px-6 lg:px-8">
          <div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div class="flex items-start gap-3">
              <div class="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l4.58 8.146c.75 1.334-.213 2.995-1.742 2.995H5.42c-1.53 0-2.492-1.66-1.743-2.995l4.58-8.146zM11 7a1 1 0 10-2 0v2a1 1 0 102 0V7zm-1 6a1.25 1.25 0 100-2.5A1.25 1.25 0 0010 13z" clip-rule="evenodd" />
                </svg>
              </div>
              <div>
                <p class="text-sm font-semibold text-amber-950">Security setup required</p>
                <p class="mt-1 text-sm text-amber-900">
                  Your organisation requires two-factor authentication before normal access is restored.
                  Finish setup in account settings using an authenticator app or a passkey.
                </p>
              </div>
            </div>

            @if (router.url !== '/account/settings') {
              <a
                routerLink="/account/settings"
                class="inline-flex items-center justify-center rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2"
              >
                Complete Security Setup
              </a>
            }
          </div>
        </section>
      }

      <!-- Page content -->
      <main class="app-main flex-1 px-4 pt-4 pb-[calc(env(safe-area-inset-bottom)+1.5rem)] sm:px-6 sm:pt-6 sm:pb-8 lg:px-8 lg:pt-8 lg:pb-10">
        <router-outlet />
      </main>
    </div>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!--  RFQ Slide-out Panel (right edge)                              -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    @if (rfqPanelOpen()) {
      <div class="fixed inset-0 z-[60] bg-black/30 backdrop-blur-sm" (click)="closeRfqPanel()"></div>
      <aside class="fixed inset-y-0 right-0 z-[61] w-full max-w-md bg-white shadow-xl flex flex-col animate-slide-in-right">
        <!-- Header -->
        <div class="flex items-center justify-between border-b px-5 py-4">
          <h2 class="text-lg font-semibold text-gray-900">Incoming RFQs</h2>
          <div class="flex items-center gap-2">
            <button (click)="openPasteModal()" class="text-xs font-medium text-brand-600 hover:text-brand-700">+ Paste RFQ</button>
            <button (click)="closeRfqPanel()" class="rounded p-1 text-gray-400 hover:text-gray-600">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
            </button>
          </div>
        </div>

        <!-- RFQ list -->
        <div class="flex-1 overflow-y-auto divide-y divide-gray-100">
          @if (rfqLoading()) {
            <div class="flex items-center justify-center p-8 text-gray-400">
              <svg class="h-5 w-5 animate-spin mr-2" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              Loading…
            </div>
          } @else if (pendingRfqs().length === 0) {
            <div class="flex flex-col items-center justify-center p-10 text-gray-400">
              <svg class="h-12 w-12 mb-3 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1"><path stroke-linecap="round" stroke-linejoin="round" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/></svg>
              <p class="text-sm font-medium">No pending RFQs</p>
              <p class="text-xs mt-1">Incoming WhatsApp messages with bunker requests will appear here.</p>
              <button
                (click)="openPasteModal()"
                class="mt-4 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
              >
                Paste RFQ
              </button>
            </div>
          } @else {
            @for (rfq of pendingRfqs(); track rfq.id) {
              <div class="px-5 py-4 hover:bg-gray-50 transition-colors">
                <!-- Sender + confidence -->
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex items-center justify-center h-7 w-7 rounded-full bg-green-100 text-green-700 text-xs font-bold">
                      {{ senderInitial(rfq) }}
                    </span>
                    <div>
                      <div class="text-sm font-medium text-gray-900">{{ senderDisplayName(rfq) }}</div>
                      <div class="text-xs text-gray-500">{{ senderDisplayMeta(rfq) }}</div>
                    </div>
                  </div>
                  <span class="text-xs px-1.5 py-0.5 rounded-full"
                    [class]="rfq.confidence > 0.6 ? 'bg-green-100 text-green-700' : rfq.confidence > 0.4 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'">
                    {{ (rfq.confidence * 100).toFixed(0) }}%
                  </span>
                </div>

                <!-- Parsed fields -->
                <div class="space-y-1 mb-3">
                  @if (rfq.vesselName) {
                    <div class="flex items-center gap-1.5 text-sm">
                      <span class="text-gray-400 w-4 text-center">🚢</span>
                      <span class="font-medium text-gray-800">{{ rfq.vesselName }}</span>
                      @if (rfq.imo) { <span class="text-xs text-gray-400">IMO {{ rfq.imo }}</span> }
                    </div>
                  }
                  @if (rfq.port) {
                    <div class="flex items-center gap-1.5 text-sm">
                      <span class="text-gray-400 w-4 text-center">📍</span>
                      <span class="text-gray-700">{{ rfq.port }}</span>
                    </div>
                  }
                  @if (rfq.products?.length) {
                    <div class="flex items-center gap-1.5 text-sm">
                      <span class="text-gray-400 w-4 text-center">⛽</span>
                      <span class="text-gray-700">
                        @for (p of rfq.products; track p.name; let last = $last) {
                          {{ p.name }}{{ p.quantity ? ' ' + p.quantity + ' ' + p.unit : '' }}{{ last ? '' : ', ' }}
                        }
                      </span>
                    </div>
                  }
                  @if (rfq.eta) {
                    <div class="flex items-center gap-1.5 text-sm">
                      <span class="text-gray-400 w-4 text-center">📅</span>
                      <span class="text-gray-700">{{ rfq.eta | date:'mediumDate' }}</span>
                    </div>
                  }
                </div>

                <!-- Raw text (truncated) -->
                <div class="text-xs text-gray-500 bg-gray-50 rounded p-2 mb-3 whitespace-pre-wrap max-h-24 overflow-y-auto">{{ rfq.rawText }}</div>

                <!-- Actions -->
                <div class="flex gap-2">
                  <button
                    (click)="createInquiryFromRfq(rfq)"
                    class="flex-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
                  >
                    Create Inquiry
                  </button>
                  <button
                    (click)="dismissRfqItem(rfq.id)"
                    class="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            }
          }
        </div>
      </aside>
    }

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!--  Paste RFQ Modal                                               -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    @if (pasteModalOpen()) {
      <div class="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 backdrop-blur-sm" (click)="closePasteModal()">
        <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4" (click)="$event.stopPropagation()">
          <div class="flex items-center justify-between px-6 py-4 border-b">
            <h3 class="text-base font-semibold text-gray-900">Paste RFQ</h3>
            <button (click)="closePasteModal()" class="text-gray-400 hover:text-gray-600">
              <svg class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd"/></svg>
            </button>
          </div>
          <div class="px-6 py-5">
            <label class="block text-sm font-medium text-gray-700 mb-2">Paste the RFQ message below</label>
            <textarea
              #pasteInput
              class="w-full h-44 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 placeholder-gray-400 resize-none"
              placeholder="MV Pacific Voyager&#10;IMO 9876543&#10;Fujairah Anchorage&#10;VLSFO 500 MT&#10;LSMGO 100 MT&#10;ETA 15/01/2025"
              [value]="pasteText()"
              (input)="pasteText.set($any($event.target).value)"
            ></textarea>
            @if (pasteError()) {
              <p class="text-xs text-red-500 mt-2">{{ pasteError() }}</p>
            }
          </div>
          <div class="flex justify-end gap-3 px-6 py-4 bg-gray-50 rounded-b-xl">
            <button (click)="closePasteModal()" class="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100">Cancel</button>
            <button
              (click)="submitPastedRfq()"
              [disabled]="pasteSubmitting()"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
            >
              @if (pasteSubmitting()) {
                <svg class="inline h-4 w-4 animate-spin mr-1" viewBox="0 0 24 24" fill="none"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>
              }
              Parse & Add
            </button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
      min-height: 100dvh;
    }
    @keyframes slide-in-right {
      from { transform: translateX(100%); }
      to { transform: translateX(0); }
    }
    .animate-slide-in-right {
      animation: slide-in-right 0.25s ease-out;
    }
  `,
})
export class MainLayoutComponent implements OnInit, OnDestroy {
  protected readonly auth = inject(AuthService);
  private readonly http = inject(HttpClient);
  protected readonly router = inject(Router);
  private readonly wsService = inject(WebSocketService);
  private readonly titleService = inject(Title);
  private readonly updateService = inject(AppUpdateService);
  private readonly appHealthService = inject(AppHealthService);
  private routerSub: Subscription | null = null;
  private priceSub: Subscription | null = null;
  private rfqSub: Subscription | null = null;
  private copyHandler: ((e: ClipboardEvent) => void) | null = null;
  private printHandler: (() => void) | null = null;
  private screenshotHandler: ((e: KeyboardEvent) => void) | null = null;

  readonly llmHealth = inject(LlmHealthService);
  private readonly newInquiryModal = inject(NewInquiryModalService);

  readonly sidebarOpen = signal(false);
  private readonly commodityPriceMap = signal<Record<string, CommodityPrice>>({});
  readonly commodityPrices = computed(() =>
    Object.values(this.commodityPriceMap()).sort((left, right) => left.name.localeCompare(right.name)),
  );
  private readonly fxRatesState = signal<FxRatesPayload | null>(null);
  private readonly priceVersion = signal<string | null>(null);
  readonly eurRate = signal<number | null>(null);
  readonly eurChange = signal<number>(0);
  readonly eurChangePercent = signal<number>(0);
  readonly fxUpdatedAt = signal<string | null>(null);
  private readonly pricesTick = signal(0);
  private pricesTickTimer: ReturnType<typeof setInterval> | null = null;
  readonly updateDismissed = signal(false);
  readonly appHealth = this.appHealthService.health;
  readonly showUpdateToast = computed(() =>
    this.updateService.updateAvailable() && !this.updateDismissed(),
  );
  readonly footerVersion = computed(() => formatAppVersionLabel(this.appHealth()));

  // ─── RFQ panel ──────────────────────────────────────────────────
  readonly rfqPanelOpen = signal(false);
  readonly rfqLoading = signal(false);
  readonly pendingRfqs = signal<any[]>([]);
  readonly pasteModalOpen = signal(false);
  readonly pasteText = signal('');
  readonly pasteError = signal<string | null>(null);
  readonly pasteSubmitting = signal(false);

  // ─── LLM health (admin-only, polled) ────────────────────────────
  /** null = not yet checked, true/false = healthy/unhealthy */
  readonly llmHealthy = computed(() => this.llmHealth.healthy());

  private readonly updateReset = effect(() => {
    if (this.updateService.updateAvailable()) {
      this.updateDismissed.set(false);
    }
  });

  ngOnInit(): void {
    void this.appHealthService.refresh();

    // Tick every 30s so the relative "X min ago" label refreshes
    this.pricesTickTimer = setInterval(() => this.pricesTick.update((n) => n + 1), 30_000);

    // Subscribe to commodity price updates from WebSocket
    const priceSnapshotSub = this.wsService
      .on<WirePriceSnapshotPayload>('prices:snapshot')
      .subscribe((data) => this.applyPriceSnapshot(decodePriceSnapshotPayload(data)));
    const pricePatchSub = this.wsService
      .on<WirePricePatchPayload>('prices:patch')
      .subscribe((data) => this.applyPricePatch(decodePricePatchPayload(data)));
    const priceConnectedSub = this.wsService
      .onRaw('connected')
      .subscribe(() => {
        this.requestLatestPrices();
      });
    this.priceSub = new Subscription();
    this.priceSub.add(priceSnapshotSub);
    this.priceSub.add(pricePatchSub);
    this.priceSub.add(priceConnectedSub);

    if (this.wsService.authenticated()) {
      this.requestLatestPrices();
    }

    // Send presence on every route navigation (with slight delay for TitleStrategy)
    this.routerSub = this.router.events
      .pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd))
      .subscribe((event) => {
        setTimeout(() => {
          this.wsService.sendPresence(event.urlAfterRedirects, this.titleService.getTitle());
        }, 50);
      });

    // Send initial presence
    setTimeout(() => {
      this.wsService.sendPresence(this.router.url, this.titleService.getTitle());
    }, 100);

    // Track copy events
    this.copyHandler = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData?.('text/plain') || window.getSelection()?.toString() || '';
      if (text.trim().length > 0) {
        this.wsService.sendCopyEvent(text, this.router.url, this.titleService.getTitle());
      }
    };
    document.addEventListener('copy', this.copyHandler as EventListener);

    // Track print events (Ctrl/Cmd+P, window.print())
    this.printHandler = () => {
      this.wsService.sendPrintEvent(this.router.url, this.titleService.getTitle());
    };
    window.addEventListener('beforeprint', this.printHandler);

    // Track screenshot key combos (best-effort)
    this.screenshotHandler = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      if (isMac && e.metaKey && e.shiftKey && (e.key === '3' || e.key === '4' || e.key === '5')) {
        this.wsService.sendScreenshotEvent(this.router.url, this.titleService.getTitle());
      } else if (!isMac && e.key === 'PrintScreen') {
        this.wsService.sendScreenshotEvent(this.router.url, this.titleService.getTitle());
      }
    };
    document.addEventListener('keydown', this.screenshotHandler as EventListener);

    // Subscribe to incoming RFQ notifications
    this.rfqSub = this.wsService
      .on<any>('rfq:new')
      .subscribe((data) => {
        this.pendingRfqs.update((list) => [data, ...list]);
      });

    // Load pending RFQs on startup
    this.loadPendingRfqs();

    // Poll LLM health if admin (every 60s)
    if (this.auth.isAdmin()) {
      this.llmHealth.startPolling();
    }
  }

  ngOnDestroy(): void {
    this.routerSub?.unsubscribe();
    this.priceSub?.unsubscribe();
    this.rfqSub?.unsubscribe();
    if (this.pricesTickTimer) clearInterval(this.pricesTickTimer);
    if (this.copyHandler) {
      document.removeEventListener('copy', this.copyHandler as EventListener);
    }
    if (this.printHandler) {
      window.removeEventListener('beforeprint', this.printHandler);
    }
    if (this.screenshotHandler) {
      document.removeEventListener('keydown', this.screenshotHandler as EventListener);
    }
  }

  private applyPriceSnapshot(data: PriceSnapshotPayload): void {
    this.priceVersion.set(data.version);
    this.commodityPriceMap.set(data.pricesByTicker ?? {});
    this.applyFxRatesState(data.fxRates ?? null);
  }

  private applyPricePatch(data: PricePatchPayload): void {
    if (data.pricesByTicker || data.removedTickers?.length) {
      const nextPrices = { ...this.commodityPriceMap() };

      for (const ticker of data.removedTickers ?? []) {
        delete nextPrices[ticker];
      }

      Object.assign(nextPrices, data.pricesByTicker ?? {});
      this.commodityPriceMap.set(nextPrices);
    }

    if (data.fxRates) {
      const currentFx = this.fxRatesState() ?? {
        base: 'USD',
        rates: { USD: 1 },
        changes: {},
        updatedAt: null,
      };
      const nextChanges = { ...(currentFx.changes ?? {}) };

      for (const [currency, changePatch] of Object.entries(data.fxRates.changes ?? {})) {
        const previousChange = nextChanges[currency] ?? { change: 0, changePercent: 0 };
        nextChanges[currency] = {
          change: changePatch.change ?? previousChange.change,
          changePercent: changePatch.changePercent ?? previousChange.changePercent,
        };
      }

      this.applyFxRatesState({
        base: data.fxRates.base ?? currentFx.base,
        rates: {
          ...currentFx.rates,
          ...(data.fxRates.rates ?? {}),
        },
        changes: nextChanges,
        updatedAt: data.fxRates.updatedAt ?? currentFx.updatedAt,
      });
    }
  }

  private requestLatestPrices(): void {
    this.wsService.send({
      type: 'get-prices',
      k: this.priceVersion() ?? undefined,
    });
  }

  private applyFxRatesState(fxRates: FxRatesPayload | null): void {
    this.fxRatesState.set(fxRates);

    const eur = fxRates?.rates?.['EUR'];
    if (typeof eur === 'number' && eur !== 0) {
      this.eurRate.set(1 / eur);
      const eurChanges = fxRates?.changes?.['EUR'];
      const eurPrevClose = eur - (eurChanges?.change ?? 0);
      const usdEurNow = 1 / eur;
      const usdEurPrev = eurPrevClose !== 0 ? 1 / eurPrevClose : usdEurNow;
      this.eurChange.set(Math.round((usdEurNow - usdEurPrev) * 100) / 100);
      this.eurChangePercent.set(usdEurPrev !== 0 ? Math.round(((usdEurNow - usdEurPrev) / usdEurPrev) * 10000) / 100 : 0);
      this.fxUpdatedAt.set(fxRates?.updatedAt ?? null);
      return;
    }

    this.eurRate.set(null);
    this.eurChange.set(0);
    this.eurChangePercent.set(0);
    this.fxUpdatedAt.set(null);
  }

  reloadForUpdate(): void {
    void this.updateService.activateUpdateAndReload();
  }

  dismissUpdateToast(): void {
    this.updateDismissed.set(true);
  }

  openNewInquiry(): void {
    this.newInquiryModal.requestOpen();
    this.router.navigate(['/trading/inquiries'], {
      queryParams: {
        new: '1',
        requestId: String(Date.now()),
      },
    });
  }

  readonly openGroups = signal<Set<string>>(new Set());
  readonly navItems = computed(() => {
    const role = this.auth.user()?.role;
    return NAVIGATION.filter((item) => {
      if (item.adminOnly) return this.auth.isAdmin();
      if (item.allowedRoles) return role ? item.allowedRoles.includes(role) : false;
      return true;
    });
  });

  // ─── Global search ──────────────────────────────────────────────
  readonly searchTerm = signal('');
  readonly searchFocused = signal(false);
  readonly searchResults = signal<SearchResult[]>([]);
  readonly searchLoading = signal(false);
  readonly searchOpen = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  readonly searchWrapper = viewChild<ElementRef<HTMLDivElement>>('searchWrapper');

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const wrapper = this.searchWrapper()?.nativeElement;
    if (wrapper && !wrapper.contains(event.target as Node)) {
      this.closeSearch();
    }
  }

  onSearchInput(event: Event): void {
    const term = (event.target as HTMLInputElement).value;
    this.searchTerm.set(term);

    if (this.searchTimer) clearTimeout(this.searchTimer);

    if (term.trim().length < 2) {
      this.searchResults.set([]);
      this.searchOpen.set(false);
      return;
    }

    this.searchLoading.set(true);
    this.searchOpen.set(true);

    this.searchTimer = setTimeout(() => this.executeSearch(term.trim()), 300);
  }

  onSearchFocus(): void {
    this.searchFocused.set(true);
    if (this.searchTerm().length >= 2 && this.searchResults().length) {
      this.searchOpen.set(true);
    }
  }

  onSearchBlur(): void {
    // Delay to allow click on search results
    setTimeout(() => this.searchFocused.set(false), 200);
  }

  closeSearch(): void {
    this.searchOpen.set(false);
    this.searchFocused.set(false);
  }

  async executeSearch(term: string): Promise<void> {
    try {
      const [placesRes, companiesRes, vesselsRes, ordersRes] = await Promise.all([
        firstValueFrom(
          this.http.get<ApiResponse<{ places: PlaceDto[]; total: number }>>(
            `${API}/lloyds/places/local?search=${encodeURIComponent(term)}&limit=5`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ companies: any[]; total: number }>>(
            `${API}/companies/local?search=${encodeURIComponent(term)}&limit=5`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ vessels: VesselDto[]; total: number }>>(
            `${API}/vessels/local?search=${encodeURIComponent(term)}&limit=5`,
          ),
        ),
        firstValueFrom(
          this.http.get<ApiResponse<{ items: any[]; total: number }>>(
            `${API}/orders?search=${encodeURIComponent(term)}&limit=5`,
          ),
        ),
      ]);

      const results: SearchResult[] = [];

      if (companiesRes.success && companiesRes.data?.companies?.length) {
        for (const c of companiesRes.data.companies) {
          results.push({
            id: c.id,
            name: c.name,
            subtitle: [c.country, c.types?.join(', ')].filter(Boolean).join(' · '),
            kind: 'company',
          });
        }
      }

      if (placesRes.success && placesRes.data?.places?.length) {
        for (const p of placesRes.data.places) {
          results.push({
            id: p.id,
            name: p.name,
            subtitle: [p.country, p.placeType].filter(Boolean).join(' · '),
            kind: 'place',
          });
        }
      }

      if (vesselsRes.success && vesselsRes.data?.vessels?.length) {
        for (const v of vesselsRes.data.vessels) {
          results.push({
            id: v.id,
            name: v.name,
            subtitle: [v.imo ? `IMO ${v.imo}` : null, v.flag, v.type].filter(Boolean).join(' · '),
            kind: 'vessel',
          });
        }
      }

      if (ordersRes.success && ordersRes.data?.items?.length) {
        for (const o of ordersRes.data.items) {
          const orderRouteId = o.id ?? o.orderNumber;
          if (!orderRouteId) continue;
          results.push({
            id: orderRouteId,
            name: o.orderNumber ?? o.id ?? 'Order',
            subtitle: [o.status, o.clientName, o.vesselName, o.placeName].filter(Boolean).join(' · '),
            kind: 'order',
            orderStatus: o.status,
          });
        }
      }

      this.searchResults.set(results);
    } catch {
      this.searchResults.set([]);
    } finally {
      this.searchLoading.set(false);
    }
  }

  goToPlace(id: string): void {
    this.searchOpen.set(false);
    this.searchTerm.set('');
    this.searchResults.set([]);
    this.router.navigate(['/places', id]);
  }

  goToCompany(id: string): void {
    this.searchOpen.set(false);
    this.searchTerm.set('');
    this.searchResults.set([]);
    this.router.navigate(['/companies', id]);
  }

  goToVessel(id: string): void {
    this.searchOpen.set(false);
    this.searchTerm.set('');
    this.searchResults.set([]);
    this.router.navigate(['/vessels', id]);
  }

  private orderDetailRoute(status?: string):
    '/trading/orders'
    | '/trading/inquiries'
    | '/trading/completed-orders'
    | '/trading/cancelled-orders' {
    if (status === 'INQUIRY' || status === 'OFFER') return '/trading/inquiries';
    if (status === 'PAID') return '/trading/completed-orders';
    if (status === 'CANCELLED') return '/trading/cancelled-orders';
    return '/trading/orders';
  }

  goToOrder(orderNumber: string, status?: string): void {
    this.searchOpen.set(false);
    this.searchTerm.set('');
    this.searchResults.set([]);
    this.router.navigate([this.orderDetailRoute(status), orderNumber]);
  }

  goToResult(result: SearchResult): void {
    if (result.kind === 'order') {
      this.goToOrder(result.id, result.orderStatus);
    } else if (result.kind === 'company') {
      this.goToCompany(result.id);
    } else if (result.kind === 'vessel') {
      this.goToVessel(result.id);
    } else {
      this.goToPlace(result.id);
    }
  }

  navigateFirstResult(): void {
    const results = this.searchResults();
    if (results.length) {
      this.goToResult(results[0]);
    }
  }

  readonly sidebarClasses = computed(() => {
    const base =
      'app-sidebar fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar transition-transform duration-300 ease-in-out';
    const mobileVisibility = this.sidebarOpen()
      ? 'translate-x-0 visible pointer-events-auto'
      : '-translate-x-full invisible pointer-events-none';
    return `${base} ${mobileVisibility} lg:translate-x-0 lg:visible lg:pointer-events-auto`;
  });

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  toggleGroup(label: string): void {
    this.openGroups.update((groups) => {
      const next = new Set(groups);
      if (next.has(label)) {
        next.delete(label);
      } else {
        next.add(label);
      }
      return next;
    });
  }

  isGroupOpen(label: string): boolean {
    return this.openGroups().has(label);
  }

  // ─── RFQ panel methods ──────────────────────────────────────────

  toggleRfqPanel(): void {
    const opening = !this.rfqPanelOpen();
    this.rfqPanelOpen.set(opening);
    if (opening) this.loadPendingRfqs();
  }

  closeRfqPanel(): void {
    this.rfqPanelOpen.set(false);
  }

  async loadPendingRfqs(): Promise<void> {
    this.rfqLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<any[]>>(`${API}/rfqs`),
      );
      if (res.success && res.data) {
        this.pendingRfqs.set(res.data);
      }
    } catch { /* ignore */ } finally {
      this.rfqLoading.set(false);
    }
  }

  async dismissRfqItem(rfqId: string): Promise<void> {
    try {
      await firstValueFrom(
        this.http.put(`${API}/rfqs/${rfqId}/dismiss`, {}),
      );
      this.pendingRfqs.update((list) => list.filter((r) => r.id !== rfqId));
    } catch { /* ignore */ }
  }

  createInquiryFromRfq(rfq: any): void {
    // Navigate to inquiry creation page with pre-filled data from the RFQ
    const params: any = {};
    if (rfq.vesselName) params.vesselName = rfq.vesselName;
    if (rfq.imo) params.imo = rfq.imo;
    if (rfq.port) params.port = rfq.port;
    if (rfq.eta) params.eta = rfq.eta;
    if (rfq.products?.length) params.products = JSON.stringify(rfq.products);
    params.rfqId = rfq.id;

    this.closeRfqPanel();
    this.router.navigate(['/trading/inquiries'], { queryParams: { new: '1', ...params } });
  }

  private extractSenderNameFromRawText(rawText: unknown): string | null {
    if (typeof rawText !== 'string') return null;
    const firstLine = rawText.split(/\r?\n/)[0]?.trim();
    if (!firstLine) return null;

    const exportMatch = firstLine.match(/^\[[^\]]+\]\s*([^:]+):/);
    if (exportMatch?.[1]?.trim()) {
      return exportMatch[1].trim();
    }

    const headerMatch = firstLine.match(/^(.+?)\s+\d{1,2}:\d{2}(?:\s?(?:AM|PM))?$/i);
    if (headerMatch?.[1]?.trim()) {
      return headerMatch[1].trim();
    }

    return null;
  }

  private normalizeSenderPhone(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.toLowerCase() === 'manual') return null;
    const digits = trimmed.replace(/\D/g, '');
    return digits.length >= 6 ? digits : null;
  }

  senderDisplayName(rfq: any): string {
    const explicit = typeof rfq?.senderName === 'string' ? rfq.senderName.trim() : '';
    if (explicit) return explicit;
    return this.extractSenderNameFromRawText(rfq?.rawText) ?? 'Unknown';
  }

  senderDisplayMeta(rfq: any): string {
    const phone = this.normalizeSenderPhone(rfq?.senderPhone);
    if (phone) return `+${phone}`;
    const source = typeof rfq?.source === 'string' ? rfq.source.trim() : '';
    return source || '—';
  }

  relativeTime(iso: string | null | undefined): string {
    this.pricesTick();
    if (!iso) return '';
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return 'just now';
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return 'just now';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  formatLocalDateTime(iso: string | null | undefined): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  senderInitial(rfq: any): string {
    const label = this.senderDisplayName(rfq);
    const first = label.charAt(0).toUpperCase();
    return first || '?';
  }

  // ─── Paste RFQ modal ───────────────────────────────────────────

  openPasteModal(): void {
    this.pasteText.set('');
    this.pasteError.set(null);
    this.pasteModalOpen.set(true);
  }

  closePasteModal(): void {
    this.pasteModalOpen.set(false);
  }

  async submitPastedRfq(): Promise<void> {
    const text = this.pasteText().trim();
    if (text.length < 10) {
      this.pasteError.set('Please paste a longer RFQ message.');
      return;
    }

    this.pasteSubmitting.set(true);
    this.pasteError.set(null);

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<any>>(`${API}/rfqs/parse`, { text }),
      );
      if (res.success && res.data?.parsed) {
        this.closePasteModal();
        await this.loadPendingRfqs();
        // Open the panel to show the newly added RFQ
        this.rfqPanelOpen.set(true);
      } else {
        this.pasteError.set('Could not detect any RFQ data in the text. Try including vessel name, port, and product (e.g. VLSFO, MGO).');
      }
    } catch {
      this.pasteError.set('Something went wrong. Please try again.');
    } finally {
      this.pasteSubmitting.set(false);
    }
  }
}
