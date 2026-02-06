import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  ElementRef,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { AuthService } from '../../../core/auth/auth.service';

// ═══════════════════════════════════════════════════════════════════════
//  UserMenu — Avatar dropdown with user info & logout
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-user-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative inline-block' },
  template: `
    <button
      (click)="toggleMenu()"
      class="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      [attr.aria-expanded]="isOpen()"
      aria-haspopup="true"
    >
      <!-- Avatar circle -->
      <span
        class="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white"
      >
        {{ initials() }}
      </span>
      <span class="hidden text-sm font-medium text-gray-700 md:inline">
        {{ userName() }}
      </span>
      <!-- Chevron -->
      <svg
        class="hidden h-4 w-4 text-gray-400 transition-transform md:inline"
        [class.rotate-180]="isOpen()"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fill-rule="evenodd"
          d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
          clip-rule="evenodd"
        />
      </svg>
    </button>

    <!-- Dropdown panel -->
    @if (isOpen()) {
      <div
        class="absolute right-0 z-50 mt-2 w-56 origin-top-right rounded-lg border border-gray-200 bg-white shadow-lg ring-1 ring-black/5 focus:outline-none"
        role="menu"
      >
        <div class="border-b border-gray-100 px-4 py-3">
          <p class="text-sm font-medium text-gray-900">{{ userName() }}</p>
          <p class="truncate text-xs text-gray-500">{{ userEmail() }}</p>
        </div>
        <div class="py-1">
          <button
            (click)="handleLogout()"
            class="flex w-full items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            role="menuitem"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clip-rule="evenodd" />
              <path fill-rule="evenodd" d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-.943a.75.75 0 1 0-1.004-1.114l-2.5 2.25a.75.75 0 0 0 0 1.114l2.5 2.25a.75.75 0 1 0 1.004-1.114l-1.048-.943h9.546A.75.75 0 0 0 19 10Z" clip-rule="evenodd" />
            </svg>
            Sign out
          </button>
        </div>
      </div>
    }
  `,
})
export class UserMenuComponent implements OnInit, OnDestroy {
  private readonly auth = inject(AuthService);
  private readonly elRef = inject(ElementRef);

  readonly isOpen = signal(false);
  readonly userName = this.auth.userName;
  readonly userEmail = this.auth.userEmail;
  readonly initials = this.auth.userInitials;

  private clickOutsideHandler = (event: MouseEvent) => {
    if (!this.elRef.nativeElement.contains(event.target)) {
      this.isOpen.set(false);
    }
  };

  ngOnInit(): void {
    document.addEventListener('click', this.clickOutsideHandler);
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.clickOutsideHandler);
  }

  toggleMenu(): void {
    this.isOpen.update((v) => !v);
  }

  handleLogout(): void {
    this.isOpen.set(false);
    this.auth.logout();
  }
}
