import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
} from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../../core/auth/auth.service';
import { UserMenuComponent } from '../../shared/components/user-menu/user-menu.component';

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
  children?: { label: string; route: string }[];
}

const NAVIGATION: NavItem[] = [
  {
    label: 'Dashboard',
    icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1',
    route: '/dashboard',
  },
  {
    label: 'Trading',
    icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z',
    children: [
      { label: 'Orders', route: '/trading/orders' },
      { label: 'Inquiries', route: '/trading/inquiries' },
      { label: 'Counterparties', route: '/trading/counterparties' },
    ],
  },
  {
    label: 'Operations',
    icon: 'M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z',
    route: '/operations',
  },
  {
    label: 'Credit',
    icon: 'M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z',
    route: '/credit',
  },
  {
    label: 'Places',
    icon: 'M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z',
    route: '/admin/places',
  },
  {
    label: 'Admin',
    icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z',
    children: [
      { label: 'Users', route: '/admin/users' },
      { label: 'Vessels', route: '/admin/vessels' },
      { label: 'Settings', route: '/admin/settings' },
    ],
  },
];

@Component({
  selector: 'app-main-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, UserMenuComponent],
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
        @for (item of navItems; track item.label) {
          @if (item.route) {
            <!-- Simple nav link -->
            <a
              [routerLink]="item.route"
              routerLinkActive="bg-sidebar-active text-sidebar-text-active"
              class="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-active"
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
                class="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-active"
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
                    <a
                      [routerLink]="child.route"
                      routerLinkActive="text-sidebar-text-active bg-sidebar-active"
                      class="block rounded-md px-3 py-2 text-sm text-sidebar-text transition-colors hover:bg-sidebar-hover hover:text-sidebar-text-active"
                      (click)="closeSidebar()"
                    >
                      {{ child.label }}
                    </a>
                  }
                </div>
              }
            </div>
          }
        }
      </nav>

      <!-- Sidebar footer -->
      <div class="border-t border-sidebar-hover px-4 py-3">
        <p class="text-xs text-sidebar-text/60">Fueld v0.1.0</p>
      </div>
    </aside>

    <!-- ═══════════════════════════════════════════════════════════════ -->
    <!--  Main content area                                             -->
    <!-- ═══════════════════════════════════════════════════════════════ -->
    <div class="flex min-h-screen flex-col lg:pl-64">
      <!-- Top bar -->
      <header class="sticky top-0 z-30 flex h-16 items-center gap-4 border-b border-gray-200 bg-white/80 px-4 backdrop-blur-md sm:px-6">
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

        <!-- Page title (filled by child routes if needed) -->
        <div class="flex-1"></div>

        <!-- Right side actions -->
        <div class="flex items-center gap-3">
          <!-- Notifications bell -->
          <button
            class="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Notifications"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path stroke-linecap="round" stroke-linejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </button>

          <!-- User menu -->
          <app-user-menu />
        </div>
      </header>

      <!-- Page content -->
      <main class="flex-1 p-4 sm:p-6 lg:p-8">
        <router-outlet />
      </main>
    </div>
  `,
  styles: `
    :host {
      display: block;
      min-height: 100vh;
    }
  `,
})
export class MainLayoutComponent {
  private readonly auth = inject(AuthService);

  readonly sidebarOpen = signal(false);
  readonly openGroups = signal<Set<string>>(new Set());
  readonly navItems = NAVIGATION;

  readonly sidebarClasses = computed(() => {
    const base =
      'fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-sidebar transition-transform duration-300 ease-in-out';
    const mobileVisibility = this.sidebarOpen()
      ? 'translate-x-0'
      : '-translate-x-full';
    return `${base} ${mobileVisibility} lg:translate-x-0`;
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
}
