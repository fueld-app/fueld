import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  ElementRef,
  ViewChild,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';
import { AuthService } from '../../../core/auth/auth.service';
import { PushService } from '../../../core/pwa/push.service';

import { API } from '@app/core/config/api';

// ═══════════════════════════════════════════════════════════════════════
//  UserMenu — Avatar dropdown with user info & logout
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-user-menu',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'relative inline-block' },
  template: `
    <!-- Hidden file input for avatar upload -->
    <input
      #avatarInput
      type="file"
      accept="image/jpeg,image/png,image/webp,image/gif"
      class="hidden"
      (change)="onAvatarSelected($event)"
    />

    <button
      (click)="toggleMenu()"
      class="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500"
      [attr.aria-expanded]="isOpen()"
      aria-haspopup="true"
    >
      <!-- Avatar circle -->
      @if (avatarUrl()) {
        <img
          [src]="avatarUrl()"
          alt="Avatar"
          class="h-8 w-8 rounded-full object-cover"
        />
      } @else {
        <span
          class="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-semibold text-white"
        >
          {{ initials() }}
        </span>
      }
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
          <div class="flex items-center gap-3">
            <!-- Clickable avatar for upload -->
            <button
              (click)="triggerAvatarUpload($event)"
              class="relative group flex-shrink-0"
              title="Change avatar"
            >
              @if (avatarUrl()) {
                <img
                  [src]="avatarUrl()"
                  alt="Avatar"
                  class="h-10 w-10 rounded-full object-cover"
                />
              } @else {
                <span
                  class="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white"
                >
                  {{ initials() }}
                </span>
              }
              <span class="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 text-white" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M4 5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-1.586a1 1 0 0 1-.707-.293l-1.121-1.121A2 2 0 0 0 11.172 3H8.828a2 2 0 0 0-1.414.586L6.293 4.707A1 1 0 0 1 5.586 5H4z" />
                  <path d="M10 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />
                </svg>
              </span>
              @if (uploadingAvatar()) {
                <span class="absolute inset-0 flex items-center justify-center rounded-full bg-black/50">
                  <svg class="h-4 w-4 animate-spin text-white" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                </span>
              }
            </button>
            <div class="min-w-0">
              <p class="text-sm font-medium text-gray-900">{{ userName() }}</p>
              <p class="truncate text-xs text-gray-500">{{ userEmail() }}</p>
            </div>
          </div>
        </div>
        <div class="py-1">
          @if (notificationsSupported()) {
            @if (notificationPermission() === 'granted') {
              <button
                (click)="disableNotifications()"
                class="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                role="menuitem"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M10 2a6 6 0 00-6 6v2.5c0 .67-.167 1.33-.486 1.92l-.91 1.67A1 1 0 004.5 16h11a1 1 0 00.896-1.41l-.91-1.67A4 4 0 0115 10.5V8a6 6 0 00-6-6zm0 16a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0010 18z" clip-rule="evenodd" />
                </svg>
                Disable notifications
              </button>
            } @else if (notificationPermission() === 'denied') {
              <div class="px-4 py-2 text-xs text-gray-500">
                Notifications are blocked in your browser settings.
              </div>
            } @else {
              <button
                (click)="enableNotifications()"
                class="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                role="menuitem"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fill-rule="evenodd" d="M10 2a6 6 0 00-6 6v2.5c0 .67-.167 1.33-.486 1.92l-.91 1.67A1 1 0 004.5 16h11a1 1 0 00.896-1.41l-.91-1.67A4 4 0 0115 10.5V8a6 6 0 00-6-6zm0 16a2.5 2.5 0 002.45-2h-4.9A2.5 2.5 0 0010 18z" clip-rule="evenodd" />
                </svg>
                Enable notifications
              </button>
            }
          }
          <button
            (click)="goToSecurity()"
            class="flex w-full items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            role="menuitem"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fill-rule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clip-rule="evenodd" />
            </svg>
            Security
          </button>
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
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly elRef = inject(ElementRef);
  private readonly pushService = inject(PushService);

  @ViewChild('avatarInput') avatarInput!: ElementRef<HTMLInputElement>;

  readonly isOpen = signal(false);
  readonly uploadingAvatar = signal(false);
  readonly userName = this.auth.userName;
  readonly userEmail = this.auth.userEmail;
  readonly initials = this.auth.userInitials;
  readonly avatarUrl = this.auth.avatarUrl;
  readonly notificationsSupported = this.pushService.supported;
  readonly notificationPermission = this.pushService.permission;

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

  goToSecurity(): void {
    this.isOpen.set(false);
    this.router.navigate(['/account/security']);
  }

  handleLogout(): void {
    this.isOpen.set(false);
    this.auth.logout();
  }

  enableNotifications(): void {
    this.isOpen.set(false);
    void this.pushService.requestPermissionAndSubscribe();
  }

  disableNotifications(): void {
    this.isOpen.set(false);
    void this.pushService.unsubscribe();
  }

  triggerAvatarUpload(event: Event): void {
    event.stopPropagation();
    this.avatarInput.nativeElement.click();
  }

  async onAvatarSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    // Validate size (2MB max)
    if (file.size > 2 * 1024 * 1024) {
      alert('File too large. Maximum size is 2MB.');
      return;
    }

    this.uploadingAvatar.set(true);
    try {
      const formData = new FormData();
      formData.append('avatar', file);

      const res = await firstValueFrom(
        this.http.put<ApiResponse<{ user: any; avatarUrl: string }>>(`${API}/auth/avatar`, formData),
      );

      if (res.success && res.data?.user) {
        // Update the stored user with new avatar URL
        const current = this.auth.user();
        if (current) {
          this.auth.user.set({ ...current, avatarUrl: res.data.avatarUrl });
          localStorage.setItem('fueld_user', JSON.stringify({ ...current, avatarUrl: res.data.avatarUrl }));
        }
      }
    } catch (err) {
      console.error('[Avatar] Upload failed:', err);
    } finally {
      this.uploadingAvatar.set(false);
      input.value = ''; // Reset so same file can be re-selected
    }
  }
}
