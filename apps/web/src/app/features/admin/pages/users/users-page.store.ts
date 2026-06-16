import { Injectable, signal, computed, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom, Subscription } from 'rxjs';
import type { ApiResponse, AdminUserDto, InvitationDto, TeamDto, UserSessionDto } from '@fueld/types';
import { Role } from '@fueld/types';
import { AuthService } from '../../../../core/auth/auth.service';
import { WebSocketService } from '../../../../core/websocket/websocket.service';
import { API } from '@app/core/config/api';

@Injectable()
export class UsersPageStore {
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
      result = result.filter((u) => u.teamIds.length === 0);
    } else if (team) {
      result = result.filter((u) => u.teamIds.includes(team));
    }
    const status = this.filterStatus();
    if (status === 'active') {
      result = result.filter((u) => u.isActive);
    } else if (status === 'deactivated') {
      result = result.filter((u) => !u.isActive);
    }
    return result;
  });

  // Sessions
  readonly sessions = signal<UserSessionDto[]>([]);
  readonly expandedSessionUserId = signal<string | null>(null);
  private sessionsSub: Subscription | null = null;

  // Current user ID
  readonly currentUserId = computed(() => this.auth.user()?.id ?? '');

  // Role editing
  readonly editingRoleId = signal<string | null>(null);
  readonly editingRole = signal('');

  // Phone editing
  readonly editingPhoneId = signal<string | null>(null);
  readonly editingPhoneValue = signal('');

  // Name editing
  readonly editingNameId = signal<string | null>(null);
  readonly editingNameValue = signal('');

  // Actions dropdown
  readonly actionsMenuUserId = signal<string | null>(null);
  readonly actionsMenuPos = signal<{ top: number; left: number } | null>(null);
  readonly actionsMenuUser = computed(() => {
    const id = this.actionsMenuUserId();
    if (!id) return null;
    return this.users().find((u) => u.id === id) ?? null;
  });

  // Invite modal
  readonly showInviteModal = signal(false);
  readonly inviting = signal(false);
  readonly inviteError = signal('');
  readonly inviteSuccess = signal(false);
  readonly inviteLinkResult = signal('');
  readonly copied = signal(false);

  // Invite form state
  readonly inviteFormName = signal('');
  readonly inviteFormEmail = signal('');
  readonly inviteFormRole = signal('TRADER');

  // Password reset
  readonly passwordResetSendingId = signal<string | null>(null);
  readonly passwordResetError = signal('');
  readonly passwordResetLinkResult = signal('');
  readonly passwordResetTargetEmail = signal('');
  readonly passwordResetExpiresAt = signal('');
  readonly passwordResetEmailSent = signal<boolean | null>(null);
  readonly passwordResetCopied = signal(false);

  // Re-invite
  readonly reinvitingId = signal<string | null>(null);
  readonly reinviteError = signal('');
  readonly reinviteLinkResult = signal('');
  readonly reinviteTargetEmail = signal('');
  readonly reinviteExpiresAt = signal('');
  readonly reinviteEmailSent = signal<boolean | null>(null);
  readonly reinviteCopied = signal(false);

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
    { value: 'OPERATIONSMANAGER', label: 'Operations Manager' },
    { value: 'LIGHT', label: 'Light' },
  ];

  initSubscriptions(): void {
    this.sessionsSub = this.wsService.on<UserSessionDto[]>('admin:sessions').subscribe((data) => {
      this.sessions.set(data);
    });
    this.wsService.send({ type: 'admin:subscribe-sessions' });
  }

  destroySubscriptions(): void {
    this.wsService.send({ type: 'admin:unsubscribe-sessions' });
    this.sessionsSub?.unsubscribe();
  }

  toggleActionsMenu(userId: string, ev: MouseEvent): void {
    ev.stopPropagation();

    if (this.actionsMenuUserId() === userId) {
      this.closeActionsMenu();
      return;
    }

    const target = ev.currentTarget as HTMLElement | null;
    const rect = target?.getBoundingClientRect();
    const menuWidth = 160;
    const gutter = 8;

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

  closeActionsMenu(): void {
    this.actionsMenuUserId.set(null);
    this.actionsMenuPos.set(null);
  }

  async loadData(): Promise<void> {
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
        this.pendingInvitations.set(invitesRes.data.filter((i) => !i.acceptedAt));
      }

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

  roleLabel(role: string): string {
    return this.roles.find((r) => r.value === role)?.label ?? role;
  }

  roleBadgeClass(role: string): string {
    switch (role) {
      case 'ADMIN': return 'bg-purple-50 text-purple-700 ring-1 ring-purple-200';
      case 'TRADER': return 'bg-blue-50 text-blue-700 ring-1 ring-blue-200';
      case 'FINANCE': return 'bg-amber-50 text-amber-700 ring-1 ring-amber-200';
      case 'TEAMLEAD': return 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200';
      case 'CREDITMANAGER': return 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200';
      case 'OPERATIONSMANAGER': return 'bg-orange-50 text-orange-700 ring-1 ring-orange-200';
      case 'LIGHT': return 'bg-pink-50 text-pink-700 ring-1 ring-pink-200';
      default: return 'bg-gray-100 text-gray-600 ring-1 ring-gray-200';
    }
  }

  startEditRole(user: AdminUserDto): void {
    if (user.id === this.currentUserId()) return;
    this.editingRoleId.set(user.id);
    this.editingRole.set(user.role);
  }

  async saveRole(userId: string): Promise<void> {
    const newRole = this.editingRole();
    this.editingRoleId.set(null);

    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<AdminUserDto>>(`${API}/admin/users/${userId}/role`, { role: newRole }),
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

  startEditName(user: AdminUserDto): void {
    this.editingNameId.set(user.id);
    this.editingNameValue.set(user.name);
  }

  async saveNameEdit(userId: string): Promise<void> {
    const name = this.editingNameValue().trim();
    this.editingNameId.set(null);
    if (!name) return;

    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<{ id: string; name: string }>>(`${API}/admin/users/${userId}/name`, { name }),
      );
      if (res.success && res.data) {
        this.users.update((list) =>
          list.map((u) => (u.id === userId ? { ...u, name: res.data!.name } : u)),
        );
      }
    } catch (err) {
      console.error('Failed to update name:', err);
    }
  }

  startEditPhone(user: AdminUserDto): void {
    this.editingPhoneId.set(user.id);
    this.editingPhoneValue.set(user.phone ?? '');
  }

  async savePhoneEdit(userId: string): Promise<void> {
    const phone = this.editingPhoneValue().trim() || null;
    this.editingPhoneId.set(null);

    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<{ id: string; phone: string | null }>>(`${API}/admin/users/${userId}/phone`, { phone }),
      );
      if (res.success && res.data) {
        this.users.update((list) =>
          list.map((u) => (u.id === userId ? { ...u, phone: res.data!.phone } : u)),
        );
      }
    } catch (err) {
      console.error('Failed to update phone:', err);
    }
  }

  async toggleUserTeam(userId: string, teamId: string, checked: boolean): Promise<void> {
    const user = this.users().find((u) => u.id === userId);
    if (!user) return;

    const currentTeams = new Set(user.teamIds);
    if (checked) currentTeams.add(teamId);
    else currentTeams.delete(teamId);
    const teamIds = Array.from(currentTeams);

    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<AdminUserDto>>(`${API}/admin/settings/users/${userId}/teams`, { teamIds }),
      );
      if (res.success) {
        this.users.update((list) =>
          list.map((u) =>
            u.id === userId ? { ...u, teamIds: res.data.teamIds, teamNames: res.data.teamNames } : u,
          ),
        );
      }
    } catch (err) {
      console.error('Failed to update teams:', err);
    }
  }

  async toggleActive(user: AdminUserDto): Promise<void> {
    const newStatus = !user.isActive;
    try {
      const res = await firstValueFrom(
        this.http.patch<ApiResponse<AdminUserDto>>(`${API}/admin/users/${user.id}/active`, { isActive: newStatus }),
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

  async reset2fa(user: AdminUserDto): Promise<void> {
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

  clearPasswordResetLink(): void {
    this.passwordResetError.set('');
    this.passwordResetLinkResult.set('');
    this.passwordResetTargetEmail.set('');
    this.passwordResetExpiresAt.set('');
    this.passwordResetEmailSent.set(null);
    this.passwordResetCopied.set(false);
  }

  async copyPasswordResetLink(): Promise<void> {
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

  async sendPasswordReset(user: AdminUserDto): Promise<void> {
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

      await this.copyPasswordResetLink();
    } catch (err: any) {
      const msg = err?.error?.message || err?.error?.error || 'Failed to send password reset link';
      this.passwordResetError.set(msg);
    } finally {
      this.passwordResetSendingId.set(null);
    }
  }

  openInviteModal(): void {
    this.inviteFormName.set('');
    this.inviteFormEmail.set('');
    this.inviteFormRole.set('TRADER');
    this.inviteError.set('');
    this.inviteSuccess.set(false);
    this.inviteLinkResult.set('');
    this.copied.set(false);
    this.showInviteModal.set(true);
  }

  closeInviteModal(): void {
    this.showInviteModal.set(false);
    if (this.inviteSuccess()) {
      void this.loadData();
    }
  }

  async sendInvite(): Promise<void> {
    const name = this.inviteFormName().trim();
    const email = this.inviteFormEmail().trim();
    if (!name || !email) {
      this.inviteError.set('Name and email are required');
      return;
    }

    this.inviting.set(true);
    this.inviteError.set('');

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<InvitationDto>>(`${API}/admin/users/invite`, {
          name,
          email,
          role: this.inviteFormRole(),
        }),
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

  async copyInviteLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.inviteLinkResult());
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 2000);
    } catch {
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

  clearReinviteLink(): void {
    this.reinviteError.set('');
    this.reinviteLinkResult.set('');
    this.reinviteTargetEmail.set('');
    this.reinviteExpiresAt.set('');
    this.reinviteEmailSent.set(null);
    this.reinviteCopied.set(false);
  }

  async copyReinviteLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.reinviteLinkResult());
      this.reinviteCopied.set(true);
      setTimeout(() => this.reinviteCopied.set(false), 2000);
    } catch {
      const input = document.createElement('input');
      input.value = this.reinviteLinkResult();
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      this.reinviteCopied.set(true);
      setTimeout(() => this.reinviteCopied.set(false), 2000);
    }
  }

  async reinvite(inv: InvitationDto): Promise<void> {
    this.reinvitingId.set(inv.id);
    this.clearReinviteLink();

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<InvitationDto>>(`${API}/admin/users/invite`, {
          email: inv.email,
          name: inv.name,
          role: inv.role,
          allowReinvite: true,
        }),
      );

      if (res.success && res.data) {
        this.reinviteLinkResult.set(res.data.inviteLink);
        this.reinviteTargetEmail.set(res.data.email || inv.email);
        this.reinviteExpiresAt.set(res.data.expiresAt || '');
        this.reinviteEmailSent.set(
          typeof (res.data as { emailSent?: boolean }).emailSent === 'boolean'
            ? !!(res.data as { emailSent?: boolean }).emailSent
            : null,
        );
        await this.copyReinviteLink();
        void this.loadData();
      } else {
        this.reinviteError.set(res.message || 'Failed to re-invite user');
      }
    } catch (err: any) {
      const msg = err?.error?.message || err?.error?.error || 'Failed to re-invite user';
      this.reinviteError.set(msg);
    } finally {
      this.reinvitingId.set(null);
    }
  }

  openIpModal(user: AdminUserDto): void {
    if (user.id === this.currentUserId()) return;
    this.ipModalUser.set(user);
    this.ipList.set(user.allowedIps ? [...user.allowedIps] : []);
    this.ipError.set('');
  }

  closeIpModal(): void {
    this.ipModalUser.set(null);
    this.ipList.set([]);
    this.ipError.set('');
  }

  addIpRow(): void {
    this.ipList.update((list) => [...list, '']);
  }

  updateIp(index: number, value: string): void {
    this.ipList.update((list) => {
      const copy = [...list];
      copy[index] = value.trim();
      return copy;
    });
  }

  removeIp(index: number): void {
    this.ipList.update((list) => list.filter((_, i) => i !== index));
  }

  clearAllIps(): void {
    this.ipList.set([]);
  }

  async saveIpRestrictions(): Promise<void> {
    const user = this.ipModalUser();
    if (!user) return;

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
          list.map((u) => (u.id === user.id ? { ...u, allowedIps: res.data!.allowedIps } : u)),
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

  userSessionCount(userId: string): number {
    return this.sessions().filter((s) => s.userId === userId).length;
  }

  getUserSessions(userId: string): UserSessionDto[] {
    return this.sessions().filter((s) => s.userId === userId);
  }

  toggleSessionDetails(userId: string): void {
    this.expandedSessionUserId.update((current) => (current === userId ? null : userId));
  }
}
