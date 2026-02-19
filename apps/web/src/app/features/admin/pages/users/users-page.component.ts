import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom, Subscription } from 'rxjs';
import type { ApiResponse, AdminUserDto, InvitationDto, TeamDto, UserSessionDto } from '@fueld/types';
import { Role } from '@fueld/types';
import { AuthService } from '../../../../core/auth/auth.service';
import { WebSocketService } from '../../../../core/websocket/websocket.service';

import { API } from '@app/core/config/api';

@Component({
  selector: 'app-users-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <!-- Header -->
      <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
          <h1 class="text-2xl font-bold text-gray-900">Users</h1>
          <p class="mt-1 text-sm text-gray-500">
            Manage team members, invite new users, and control access.
          </p>
        </div>
        <button
          (click)="openInviteModal()"
          class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-brand-700 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Invite User
        </button>
      </div>

      <!-- Users Table -->
      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <!-- Search & Team Filter -->
        <div class="flex flex-wrap items-center gap-3 mb-4">
          <div class="relative flex-1 min-w-[200px] max-w-xs">
            <svg xmlns="http://www.w3.org/2000/svg" class="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400 pointer-events-none" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clip-rule="evenodd" />
            </svg>
            <input
              type="text"
              [ngModel]="searchQuery()"
              (ngModelChange)="searchQuery.set($event)"
              placeholder="Search by name or email…"
              class="w-full rounded-lg border border-gray-300 pl-9 pr-8 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
            />
            @if (searchQuery()) {
              <button
                (click)="searchQuery.set('')"
                class="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                </svg>
              </button>
            }
          </div>
          <select
            [ngModel]="filterTeam()"
            (ngModelChange)="filterTeam.set($event)"
            class="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
          >
            <option value="">All Teams</option>
            <option value="__none__">No Team</option>
            @for (team of teamsList(); track team.id) {
              <option [value]="team.id">{{ team.name }}</option>
            }
          </select>
          <select
            [ngModel]="filterStatus()"
            (ngModelChange)="filterStatus.set($event)"
            class="rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 focus:border-brand-500 focus:ring-1 focus:ring-brand-500">
            <option value="active">Active</option>
            <option value="deactivated">Deactivated</option>
            <option value="">All</option>
          </select>
          @if (searchQuery() || filterTeam() || filterStatus()) {
            <span class="text-xs text-gray-400">{{ filteredUsers().length }} of {{ users().length }} users</span>
          }
        </div>

        @if (passwordResetError()) {
          <div class="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {{ passwordResetError() }}
          </div>
        }

        @if (passwordResetLinkResult()) {
          <div class="mb-4 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <p class="text-sm font-semibold text-indigo-900">Password reset link</p>
                <p class="mt-0.5 text-xs text-indigo-700">
                  For <span class="font-medium">{{ passwordResetTargetEmail() }}</span>
                  @if (passwordResetExpiresAt()) {
                    · Expires {{ formatDate(passwordResetExpiresAt()) }}
                  }
                  @if (passwordResetEmailSent() === false) {
                    · SMTP not configured (email not sent)
                  }
                </p>
              </div>
              <button
                (click)="clearPasswordResetLink()"
                class="rounded-md px-2 py-1 text-xs font-medium text-indigo-700 hover:bg-indigo-100 transition-colors"
                title="Dismiss"
              >
                Close
              </button>
            </div>

            <div class="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                class="w-full flex-1 rounded-lg border border-indigo-200 bg-white px-3 py-2 text-xs font-mono text-gray-700"
                [value]="passwordResetLinkResult()"
                readonly
              />
              <button
                (click)="copyPasswordResetLink()"
                class="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 transition-colors"
              >
                {{ passwordResetCopied() ? 'Copied!' : 'Copy' }}
              </button>
            </div>
          </div>
        }

        <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-b border-gray-200 bg-gray-50/80">
                <th class="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Role</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Team</th>
                <th class="px-4 py-3 text-center font-medium text-gray-600">Auth</th>
                <th class="px-4 py-3 text-center font-medium text-gray-600">Status</th>
                <th class="px-4 py-3 text-center font-medium text-gray-600">IP Lock</th>
                <th class="px-4 py-3 text-center font-medium text-gray-600">Sessions</th>
                <th class="px-4 py-3 text-left font-medium text-gray-600">Joined</th>
                <th class="px-4 py-3 w-28 text-right font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody class="divide-y divide-gray-100">
              @for (user of filteredUsers(); track user.id) {
                <tr class="transition-colors hover:bg-gray-50/50" [class.opacity-50]="!user.isActive">
                  <td class="px-4 py-3">
                    <div class="flex items-center gap-2.5">
                      <div class="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700">
                        {{ initials(user.name) }}
                      </div>
                      <span class="font-medium text-gray-900">{{ user.name }}</span>
                      @if (user.id === currentUserId()) {
                        <span class="inline-flex items-center rounded-full bg-brand-50 px-1.5 py-0.5 text-[10px] font-medium text-brand-700">You</span>
                      }
                    </div>
                  </td>
                  <td class="px-4 py-3 text-gray-600">{{ user.email }}</td>
                  <td class="px-4 py-3">
                    @if (editingRoleId() === user.id) {
                      <select
                        [ngModel]="editingRole()"
                        (ngModelChange)="editingRole.set($event)"
                        (blur)="saveRole(user.id)"
                        class="rounded-md border border-gray-300 px-2 py-1 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                      >
                        @for (r of roles; track r.value) {
                          <option [value]="r.value">{{ r.label }}</option>
                        }
                      </select>
                    } @else {
                      <button
                        (click)="startEditRole(user)"
                        class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors"
                        [class]="roleBadgeClass(user.role)"
                        [disabled]="user.id === currentUserId()"
                        [class.cursor-not-allowed]="user.id === currentUserId()"
                      >
                        {{ roleLabel(user.role) }}
                        @if (user.id !== currentUserId()) {
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 opacity-50" viewBox="0 0 20 20" fill="currentColor">
                            <path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" />
                          </svg>
                        }
                      </button>
                    }
                  </td>
                  <td class="px-4 py-3">
                    <select
                      [ngModel]="user.teamId || ''"
                      (ngModelChange)="changeTeam(user.id, $event)"
                      class="rounded-md border border-gray-200 bg-transparent px-2 py-1 text-xs text-gray-700 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                    >
                      <option value="">No team</option>
                      @for (team of teamsList(); track team.id) {
                        <option [value]="team.id">{{ team.name }}</option>
                      }
                    </select>
                  </td>
                  <td class="px-4 py-3 text-center">
                    <div class="flex flex-wrap justify-center gap-1">
                      @if (user.is2faEnabled) {
                        <span class="inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">2FA</span>
                      }
                      @if (user.hasPasskeys) {
                        <span class="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700">Passkey</span>
                      }
                      @if (user.hasMicrosoftSso) {
                        <span class="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700">Microsoft</span>
                      }
                      @if (!user.is2faEnabled && !user.hasPasskeys && !user.hasMicrosoftSso) {
                        <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">None</span>
                      }
                    </div>
                  </td>
                  <td class="px-4 py-3 text-center">
                    @if (user.isActive) {
                      <span class="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                        <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                        Active
                      </span>
                    } @else {
                      <span class="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
                        <span class="h-1.5 w-1.5 rounded-full bg-red-400"></span>
                        Deactivated
                      </span>
                    }
                  </td>
                  <td class="px-4 py-3 text-center">
                    @if (user.allowedIps && user.allowedIps.length > 0) {
                      <button
                        (click)="openIpModal(user)"
                        class="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 hover:bg-amber-100 transition-colors cursor-pointer"
                        [class.cursor-not-allowed]="user.id === currentUserId()"
                        [disabled]="user.id === currentUserId()"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clip-rule="evenodd" />
                        </svg>
                        {{ user.allowedIps.length }}
                      </button>
                    } @else {
                      <button
                        (click)="openIpModal(user)"
                        class="text-xs text-gray-300 hover:text-brand-500 transition-colors cursor-pointer"
                        [class.cursor-not-allowed]="user.id === currentUserId()"
                        [disabled]="user.id === currentUserId()"
                        title="Configure IP restrictions"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 mx-auto" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    }
                  </td>
                  <td class="px-4 py-3 text-center">
                    @if (userSessionCount(user.id) > 0) {
                      <button
                        (click)="toggleSessionDetails(user.id)"
                        class="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-100 transition-colors cursor-pointer"
                      >
                        <span class="h-1.5 w-1.5 rounded-full bg-green-500 animate-pulse"></span>
                        {{ userSessionCount(user.id) }}
                      </button>
                    } @else {
                      <span class="text-xs text-gray-300">—</span>
                    }
                  </td>
                  <td class="px-4 py-3 text-xs text-gray-500">{{ formatDate(user.createdAt) }}</td>
                  <td class="px-4 py-3 text-right">
                    @if (user.id !== currentUserId()) {
                      <div class="relative inline-flex" (click)="$event.stopPropagation()">
                        <button
                          (click)="toggleActionsMenu(user.id, $event)"
                          class="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                          [attr.aria-expanded]="actionsMenuUserId() === user.id"
                        >
                          Actions
                          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                            <path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08z" clip-rule="evenodd" />
                          </svg>
                        </button>
                      </div>
                    }
                  </td>
                </tr>
                @if (expandedSessionUserId() === user.id) {
                  <tr>
                  <td colspan="10" class="bg-gray-50/80 px-4 py-3">
                      <div class="ml-10">
                        <p class="text-xs font-medium text-gray-500 mb-2">Active Sessions</p>
                        <div class="space-y-2">
                          @for (session of getUserSessions(user.id); track session.socketId) {
                            <div class="flex items-center gap-4 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs">
                              <div class="flex items-center gap-1.5">
                                <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
                                <span class="font-medium text-gray-700">{{ session.platform ?? 'Unknown' }}</span>
                              </div>
                              @if (session.currentUrl) {
                                <span class="text-gray-500 truncate max-w-48" [title]="session.currentUrl">{{ session.currentUrl }}</span>
                              }
                              @if (session.clientIp) {
                                <span class="font-mono text-gray-400">{{ session.clientIp }}</span>
                              }
                              @if (session.city || session.country) {
                                <span class="text-gray-400">
                                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3 inline -mt-0.5 mr-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                                  {{ session.city ? session.city + ', ' + session.country : session.country }}
                                </span>
                              }
                              @if (session.timezone) {
                                <span class="text-gray-400">🕐 {{ session.timezone }}</span>
                              }
                              @if (session.language) {
                                <span class="text-gray-400">{{ session.language }}</span>
                              }
                            </div>
                          }
                        </div>
                      </div>
                    </td>
                  </tr>
                }
              } @empty {
                <tr>
                  <td colspan="10" class="px-4 py-8 text-center text-gray-400">No users found</td>
                </tr>
              }
            </tbody>
          </table>
        </div>

        <!-- Actions dropdown overlay (fixed so it isn't clipped by overflow containers) -->
        @if (actionsMenuPos(); as pos) {
          @if (actionsMenuUser(); as menuUser) {
            <div
              class="fixed z-[9999] w-40 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm"
              [style.top.px]="pos.top"
              [style.left.px]="pos.left"
              (click)="$event.stopPropagation()"
            >
              <div class="py-1">
                @if (menuUser.is2faEnabled) {
                  <button
                    (click)="reset2fa(menuUser); closeActionsMenu()"
                    class="block w-full px-3 py-2 text-left text-xs font-medium text-amber-700 hover:bg-amber-50"
                  >
                    Reset 2FA
                  </button>
                }
                <button
                  (click)="sendPasswordReset(menuUser); closeActionsMenu()"
                  class="block w-full px-3 py-2 text-left text-xs font-medium text-indigo-700 hover:bg-indigo-50"
                  [disabled]="passwordResetSendingId() === menuUser.id"
                  [class.opacity-50]="passwordResetSendingId() === menuUser.id"
                >
                  {{ passwordResetSendingId() === menuUser.id ? 'Sending…' : 'Reset password' }}
                </button>
                <button
                  (click)="toggleActive(menuUser); closeActionsMenu()"
                  class="block w-full px-3 py-2 text-left text-xs font-medium hover:bg-gray-50"
                  [class]="menuUser.isActive ? 'text-red-700' : 'text-green-700'"
                >
                  {{ menuUser.isActive ? 'Deactivate' : 'Activate' }}
                </button>
              </div>
            </div>
          }
        }

        <!-- Pending Invitations -->
        @if (pendingInvitations().length > 0) {
          <div class="mt-8">
            <h2 class="mb-3 text-lg font-semibold text-gray-900">Pending Invitations</h2>
            <div class="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
              <table class="w-full text-sm">
                <thead>
                  <tr class="border-b border-gray-200 bg-gray-50/80">
                    <th class="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-600">Role</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-600">Invited By</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-600">Expires</th>
                    <th class="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody class="divide-y divide-gray-100">
                  @for (inv of pendingInvitations(); track inv.id) {
                    <tr class="transition-colors hover:bg-gray-50/50">
                      <td class="px-4 py-3 font-medium text-gray-900">{{ inv.name }}</td>
                      <td class="px-4 py-3 text-gray-600">{{ inv.email }}</td>
                      <td class="px-4 py-3">
                        <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                              [class]="roleBadgeClass(inv.role)">
                          {{ roleLabel(inv.role) }}
                        </span>
                      </td>
                      <td class="px-4 py-3 text-gray-600">{{ inv.invitedByName }}</td>
                      <td class="px-4 py-3 text-xs text-gray-500">{{ formatDate(inv.expiresAt) }}</td>
                      <td class="px-4 py-3">
                        @if (inv.acceptedAt) {
                          <span class="text-xs font-medium text-green-600">Accepted</span>
                        } @else if (isExpired(inv.expiresAt)) {
                          <span class="text-xs font-medium text-red-500">Expired</span>
                        } @else {
                          <span class="text-xs font-medium text-amber-600">Pending</span>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      }

      <!-- Invite Modal -->
      @if (showInviteModal()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div
            class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
            (click)="$event.stopPropagation()"
          >
            <h2 class="text-lg font-bold text-gray-900 mb-4">Invite New User</h2>

            @if (inviteSuccess()) {
              <!-- Success state with invite link -->
              <div class="space-y-4">
                <div class="rounded-lg bg-green-50 border border-green-200 p-4">
                  <div class="flex items-start gap-3">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-600 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
                    </svg>
                    <div>
                      <p class="text-sm font-medium text-green-800">Invitation created!</p>
                      <p class="mt-1 text-sm text-green-700">Share this link with <strong>{{ inviteForm.email }}</strong> to complete their signup:</p>
                    </div>
                  </div>
                </div>

                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    [value]="inviteLinkResult()"
                    readonly
                    class="flex-1 rounded-lg border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-700 font-mono"
                  />
                  <button
                    (click)="copyInviteLink()"
                    class="shrink-0 rounded-lg bg-brand-600 px-3 py-2 text-sm font-medium text-white hover:bg-brand-700 transition-colors"
                  >
                    {{ copied() ? 'Copied!' : 'Copy' }}
                  </button>
                </div>

                <div class="flex justify-end pt-2">
                  <button
                    (click)="closeInviteModal()"
                    class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            } @else {
              <!-- Form state -->
              <div class="space-y-4">
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    [(ngModel)]="inviteForm.name"
                    placeholder="e.g. Jane Smith"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
                  <input
                    type="email"
                    [(ngModel)]="inviteForm.email"
                    placeholder="e.g. jane@company.com"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label class="block text-sm font-medium text-gray-700 mb-1">Role</label>
                  <select
                    [(ngModel)]="inviteForm.role"
                    class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                  >
                    @for (r of roles; track r.value) {
                      <option [value]="r.value">{{ r.label }}</option>
                    }
                  </select>
                </div>

                @if (inviteError()) {
                  <div class="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                    {{ inviteError() }}
                  </div>
                }

                <div class="flex justify-end gap-2 pt-2">
                  <button
                    (click)="closeInviteModal()"
                    class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    (click)="sendInvite()"
                    [disabled]="inviting()"
                    class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                  >
                    @if (inviting()) {
                      <svg class="h-4 w-4 animate-spin inline mr-1" viewBox="0 0 24 24" fill="none">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                      </svg>
                      Sending…
                    } @else {
                      Send Invite
                    }
                  </button>
                </div>
              </div>
            }
          </div>
        </div>
      }

      <!-- IP Restriction Modal -->
      @if (ipModalUser()) {
        <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" (click)="$event.stopPropagation()">
            <h2 class="text-lg font-bold text-gray-900 mb-1">IP Restrictions</h2>
            <p class="text-sm text-gray-500 mb-4">
              Configure allowed IP addresses for <strong>{{ ipModalUser()!.name }}</strong>.
              Leave empty for unrestricted access. Supports individual IPs and CIDR notation (e.g. 192.168.1.0/24).
            </p>

            <div class="space-y-3">
              <!-- Existing IPs -->
              @for (ip of ipList(); track $index) {
                <div class="flex items-center gap-2">
                  <input
                    type="text"
                    [ngModel]="ip"
                    (ngModelChange)="updateIp($index, $event)"
                    placeholder="e.g. 203.0.113.50 or 10.0.0.0/8"
                    class="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  />
                  <button
                    (click)="removeIp($index)"
                    class="rounded-md p-1.5 text-gray-400 hover:text-red-500 transition-colors"
                    title="Remove"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              }

              <!-- Add IP button -->
              <button
                (click)="addIpRow()"
                class="inline-flex items-center gap-1 rounded-md border border-dashed border-gray-300 px-3 py-1.5 text-xs text-gray-500 hover:border-brand-400 hover:text-brand-600 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
                </svg>
                Add IP address
              </button>
            </div>

            @if (ipError()) {
              <div class="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                {{ ipError() }}
              </div>
            }

            <div class="flex items-center justify-between gap-2 pt-4 mt-4 border-t border-gray-100">
              <div>
                @if (ipList().length > 0) {
                  <button
                    (click)="clearAllIps()"
                    class="text-xs text-red-500 hover:text-red-700 transition-colors"
                  >
                    Remove all restrictions
                  </button>
                }
              </div>
              <div class="flex gap-2">
                <button
                  (click)="closeIpModal()"
                  class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors"
                >
                  Cancel
                </button>
                <button
                  (click)="saveIpRestrictions()"
                  [disabled]="savingIps()"
                  class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 transition-colors disabled:opacity-50"
                >
                  @if (savingIps()) {
                    Saving…
                  } @else {
                    Save
                  }
                </button>
              </div>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class UsersPageComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly wsService = inject(WebSocketService);

  readonly loading = signal(true);
  readonly users = signal<AdminUserDto[]>([]);
  readonly pendingInvitations = signal<InvitationDto[]>([]);
  readonly teamsList = signal<TeamDto[]>([]);

  // Filters
  readonly searchQuery = signal('');
  readonly filterTeam = signal('');
  readonly filterStatus = signal<'active' | 'deactivated' | ''>('active');

  readonly filteredUsers = computed(() => {
    let result = this.users();
    const q = this.searchQuery().toLowerCase().trim();
    if (q) {
      result = result.filter(
        (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      );
    }
    const team = this.filterTeam();
    if (team === '__none__') {
      result = result.filter((u) => !u.teamId);
    } else if (team) {
      result = result.filter((u) => u.teamId === team);
    }
    const status = this.filterStatus();
    if (status === 'active') {
      result = result.filter((u) => u.isActive);
    } else if (status === 'deactivated') {
      result = result.filter((u) => !u.isActive);
    }
    return result;
  });

  // Sessions (real-time via WebSocket)
  readonly sessions = signal<UserSessionDto[]>([]);
  readonly expandedSessionUserId = signal<string | null>(null);
  private sessionsSub: Subscription | null = null;

  // Current user ID for "You" badges and preventing self-actions
  readonly currentUserId = this.auth.user()?.id
    ? signal(this.auth.user()!.id)
    : signal('');

  // Role editing
  readonly editingRoleId = signal<string | null>(null);
  readonly editingRole = signal('');

  // Per-row actions dropdown
  readonly actionsMenuUserId = signal<string | null>(null);
  readonly actionsMenuPos = signal<{ top: number; left: number } | null>(null);
  readonly actionsMenuUser = computed(() => {
    const id = this.actionsMenuUserId();
    if (!id) return null;
    return this.users().find((u) => u.id === id) ?? null;
  });

  private readonly onDocumentClick = () => this.closeActionsMenu();

  // Invite modal
  readonly showInviteModal = signal(false);
  readonly inviting = signal(false);
  readonly inviteError = signal('');
  readonly inviteSuccess = signal(false);
  readonly inviteLinkResult = signal('');
  readonly copied = signal(false);

  // Password reset link (admin-triggered)
  readonly passwordResetSendingId = signal<string | null>(null);
  readonly passwordResetError = signal('');
  readonly passwordResetLinkResult = signal('');
  readonly passwordResetTargetEmail = signal('');
  readonly passwordResetExpiresAt = signal('');
  readonly passwordResetEmailSent = signal<boolean | null>(null);
  readonly passwordResetCopied = signal(false);

  inviteForm = { name: '', email: '', role: 'TRADER' };

  // IP restriction modal
  readonly ipModalUser = signal<AdminUserDto | null>(null);
  readonly ipList = signal<string[]>([]);
  readonly savingIps = signal(false);
  readonly ipError = signal('');

  readonly roles = [
    { value: 'ADMIN', label: 'Admin' },
    { value: 'TRADER', label: 'Trader' },
    { value: 'FINANCE', label: 'Finance' },
    { value: 'TEAMLEAD', label: 'Teamlead' },
    { value: 'CREDITMANAGER', label: 'Credit Manager' },
  ];

  ngOnInit() {
    this.loadData();

    document.addEventListener('click', this.onDocumentClick);
    window.addEventListener('scroll', this.onDocumentClick, true);
    window.addEventListener('resize', this.onDocumentClick);

    // Subscribe to real-time session updates
    this.sessionsSub = this.wsService.on<UserSessionDto[]>('admin:sessions').subscribe((data) => {
      this.sessions.set(data);
    });
    this.wsService.send({ type: 'admin:subscribe-sessions' });
  }

  ngOnDestroy() {
    this.wsService.send({ type: 'admin:unsubscribe-sessions' });
    this.sessionsSub?.unsubscribe();

    document.removeEventListener('click', this.onDocumentClick);
    window.removeEventListener('scroll', this.onDocumentClick, true);
    window.removeEventListener('resize', this.onDocumentClick);
  }

  toggleActionsMenu(userId: string, ev: MouseEvent) {
    ev.stopPropagation();

    if (this.actionsMenuUserId() === userId) {
      this.closeActionsMenu();
      return;
    }

    const target = ev.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const menuWidth = 160; // Tailwind w-40
    const gutter = 8;

    // Estimate menu height (2–3 items)
    const user = this.users().find((u) => u.id === userId);
    const estimatedHeight = user?.is2faEnabled ? 132 : 98;

    let top = rect ? rect.bottom + 6 : gutter;
    let left = rect ? rect.right - menuWidth : gutter;
    left = Math.max(gutter, Math.min(left, window.innerWidth - menuWidth - gutter));

    if (top + estimatedHeight > window.innerHeight - gutter && rect) {
      top = rect.top - estimatedHeight - 6;
    }
    top = Math.max(gutter, top);

    this.actionsMenuUserId.set(userId);
    this.actionsMenuPos.set({ top, left });
  }

  closeActionsMenu() {
    this.actionsMenuUserId.set(null);
    this.actionsMenuPos.set(null);
  }

  async loadData() {
    this.loading.set(true);
    try {
      const [usersRes, invitesRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<AdminUserDto[]>>(`${API}/admin/users`)),
        firstValueFrom(this.http.get<ApiResponse<InvitationDto[]>>(`${API}/admin/invitations`)),
      ]);

      if (usersRes.success && usersRes.data) {
        this.users.set(usersRes.data);
      }
      if (invitesRes.success && invitesRes.data) {
        // Show only non-accepted invites
        this.pendingInvitations.set(
          invitesRes.data.filter((i) => !i.acceptedAt),
        );
      }

      // Load teams for filter + team assignment dropdowns
      try {
        const teamsRes = await firstValueFrom(
          this.http.get<ApiResponse<TeamDto[]>>(`${API}/admin/settings/teams`),
        );
        if (teamsRes.success && teamsRes.data) {
          this.teamsList.set(teamsRes.data);
        }
      } catch { /* teams optional */ }
    } catch (err) {
      console.error('Failed to load admin data:', err);
    } finally {
      this.loading.set(false);
    }
  }

  // ── Role badge styling ──────────────────────────────────────────

  roleLabel(role: string): string {
    return this.roles.find((r) => r.value === role)?.label ?? role;
  }

  roleBadgeClass(role: string): string {
    switch (role) {
      case 'ADMIN':
        return 'bg-purple-50 text-purple-700 ring-1 ring-purple-200';
      case 'TRADER':
        return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200';
      case 'FINANCE':
        return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
      case 'TEAMLEAD':
        return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
      case 'CREDITMANAGER':
        return 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200';
      default:
        return 'bg-gray-100 text-gray-600 ring-1 ring-gray-200';
    }
  }

  // ── Role editing ────────────────────────────────────────────────

  startEditRole(user: AdminUserDto) {
    if (user.id === this.currentUserId()) return;
    this.editingRoleId.set(user.id);
    this.editingRole.set(user.role);
  }

  async saveRole(userId: string) {
    const newRole = this.editingRole();
    this.editingRoleId.set(null);

    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<AdminUserDto>>(`${API}/admin/users/${userId}/role`, {
          role: newRole,
        }),
      );

      if (res.success) {
        this.users.update((list) =>
          list.map((u) => (u.id === userId ? { ...u, role: newRole as Role } : u)),
        );
      }
    } catch (err) {
      console.error('Failed to update role:', err);
    }
  }

  // ── Team assignment ──────────────────────────────────────────────

  async changeTeam(userId: string, teamId: string) {
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<AdminUserDto>>(`${API}/admin/settings/users/${userId}/team`, {
          teamId: teamId || null,
        }),
      );
      if (res.success) {
        this.users.update((list) =>
          list.map((u) =>
            u.id === userId
              ? { ...u, teamId: teamId || null, teamName: this.teamsList().find(t => t.id === teamId)?.name ?? null }
              : u,
          ),
        );
      }
    } catch (err) {
      console.error('Failed to change team:', err);
    }
  }

  // ── Activate / Deactivate ───────────────────────────────────────

  async toggleActive(user: AdminUserDto) {
    const newStatus = !user.isActive;

    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<AdminUserDto>>(`${API}/admin/users/${user.id}/active`, {
          isActive: newStatus,
        }),
      );

      if (res.success) {
        this.users.update((list) =>
          list.map((u) => (u.id === user.id ? { ...u, isActive: newStatus } : u)),
        );
      }
    } catch (err) {
      console.error('Failed to toggle user status:', err);
    }
  }

  // ── Admin Reset 2FA ─────────────────────────────────────────────

  async reset2fa(user: AdminUserDto) {
    if (!confirm(`Reset 2FA for ${user.name || user.email}? They will need to set it up again on next login.`)) {
      return;
    }

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{ id: string; is2faEnabled: boolean }>>(`${API}/admin/users/${user.id}/reset-2fa`, {}),
      );

      if (res.success) {
        this.users.update((list) =>
          list.map((u) => (u.id === user.id ? { ...u, is2faEnabled: false } : u)),
        );
      }
    } catch (err) {
      console.error('Failed to reset 2FA:', err);
    }
  }

  // ── Admin Password Reset Link ───────────────────────────────────

  clearPasswordResetLink() {
    this.passwordResetError.set('');
    this.passwordResetLinkResult.set('');
    this.passwordResetTargetEmail.set('');
    this.passwordResetExpiresAt.set('');
    this.passwordResetEmailSent.set(null);
    this.passwordResetCopied.set(false);
  }

  async copyPasswordResetLink() {
    try {
      await navigator.clipboard.writeText(this.passwordResetLinkResult());
      this.passwordResetCopied.set(true);
      setTimeout(() => this.passwordResetCopied.set(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = this.passwordResetLinkResult();
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      this.passwordResetCopied.set(true);
      setTimeout(() => this.passwordResetCopied.set(false), 2000);
    }
  }

  async sendPasswordReset(user: AdminUserDto) {
    if (user.id === this.currentUserId()) return;

    this.passwordResetSendingId.set(user.id);
    this.passwordResetError.set('');
    this.passwordResetCopied.set(false);

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{
          userId: string;
          email: string;
          resetLink: string;
          expiresAt: string;
          emailSent: boolean;
        }>>(`${API}/admin/users/${user.id}/send-password-reset`, {}),
      );

      if (!res.success || !res.data?.resetLink) {
        this.passwordResetError.set(res.message || 'Failed to generate password reset link');
        return;
      }

      this.passwordResetLinkResult.set(res.data.resetLink);
      this.passwordResetTargetEmail.set(res.data.email || user.email);
      this.passwordResetExpiresAt.set(res.data.expiresAt || '');
      this.passwordResetEmailSent.set(!!res.data.emailSent);

      // Auto-copy for convenience (still shows link + manual copy button)
      await this.copyPasswordResetLink();
    } catch (err: any) {
      const msg = err?.error?.message || err?.error?.error || 'Failed to send password reset link';
      this.passwordResetError.set(msg);
    } finally {
      this.passwordResetSendingId.set(null);
    }
  }

  // ── Invite modal ────────────────────────────────────────────────

  openInviteModal() {
    this.inviteForm = { name: '', email: '', role: 'TRADER' };
    this.inviteError.set('');
    this.inviteSuccess.set(false);
    this.inviteLinkResult.set('');
    this.copied.set(false);
    this.showInviteModal.set(true);
  }

  closeInviteModal() {
    this.showInviteModal.set(false);
    if (this.inviteSuccess()) {
      this.loadData(); // Refresh after successful invite
    }
  }

  async sendInvite() {
    if (!this.inviteForm.name.trim() || !this.inviteForm.email.trim()) {
      this.inviteError.set('Name and email are required');
      return;
    }

    this.inviting.set(true);
    this.inviteError.set('');

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<InvitationDto>>(`${API}/admin/users/invite`, this.inviteForm),
      );

      if (res.success && res.data) {
        this.inviteSuccess.set(true);
        this.inviteLinkResult.set(res.data.inviteLink);
      } else {
        this.inviteError.set(res.message || 'Failed to send invitation');
      }
    } catch (err: any) {
      this.inviteError.set(err?.error?.message || 'Failed to send invitation');
    } finally {
      this.inviting.set(false);
    }
  }

  async copyInviteLink() {
    try {
      await navigator.clipboard.writeText(this.inviteLinkResult());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
      // Fallback
      const input = document.createElement('input');
      input.value = this.inviteLinkResult();
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    }
  }

  // ── IP Restrictions ──────────────────────────────────────────────

  openIpModal(user: AdminUserDto) {
    if (user.id === this.currentUserId()) return;
    this.ipModalUser.set(user);
    this.ipList.set(user.allowedIps ? [...user.allowedIps] : []);
    this.ipError.set('');
  }

  closeIpModal() {
    this.ipModalUser.set(null);
    this.ipList.set([]);
    this.ipError.set('');
  }

  addIpRow() {
    this.ipList.update((list) => [...list, '']);
  }

  updateIp(index: number, value: string) {
    this.ipList.update((list) => {
      const copy = [...list];
      copy[index] = value.trim();
      return copy;
    });
  }

  removeIp(index: number) {
    this.ipList.update((list) => list.filter((_, i) => i !== index));
  }

  clearAllIps() {
    this.ipList.set([]);
  }

  async saveIpRestrictions() {
    const user = this.ipModalUser();
    if (!user) return;

    // Filter out empty strings
    const ips = this.ipList().filter((ip) => ip.trim().length > 0);

    this.savingIps.set(true);
    this.ipError.set('');

    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<{ id: string; allowedIps: string[] | null }>>(
          `${API}/admin/users/${user.id}/allowed-ips`,
          { allowedIps: ips.length > 0 ? ips : null },
        ),
      );

      if (res.success) {
        this.users.update((list) =>
          list.map((u) => u.id === user.id ? { ...u, allowedIps: res.data!.allowedIps } : u),
        );
        this.closeIpModal();
      } else {
        this.ipError.set(res.message || 'Failed to update IP restrictions');
      }
    } catch (err: any) {
      this.ipError.set(err?.error?.message || 'Failed to update IP restrictions');
    } finally {
      this.savingIps.set(false);
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  initials(name: string): string {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0]![0]!.toUpperCase();
    return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
  }

  formatDate(dateStr: string): string {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  }

  isExpired(dateStr: string): boolean {
    return new Date(dateStr) < new Date();
  }

  // ── Session helpers ─────────────────────────────────────────────

  userSessionCount(userId: string): number {
    return this.sessions().filter((s) => s.userId === userId).length;
  }

  getUserSessions(userId: string): UserSessionDto[] {
    return this.sessions().filter((s) => s.userId === userId);
  }

  toggleSessionDetails(userId: string): void {
    this.expandedSessionUserId.update((current) =>
      current === userId ? null : userId,
    );
  }
}
