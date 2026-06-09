import { Component, inject, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { API } from '@app/core/config/api';
import type { ApiResponse } from '@fueld/types';

@Component({
  selector: 'app-dashboard-redirect',
  standalone: true,
  template: '',
})
export class DashboardRedirectComponent implements OnInit {
  private readonly router = inject(Router);
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  async ngOnInit(): Promise<void> {
    const role = this.auth.user()?.role;
    let target = '/dashboard';

    if (role) {
      try {
        const res = await firstValueFrom(
          this.http.get<ApiResponse<{ dashboards: Record<string, string> }>>(
            `${API}/admin/settings/role-dashboards`,
          ),
        );
        if (res.success && res.data.dashboards[role]) {
          target = res.data.dashboards[role];
        }
      } catch {
        // fallback to default
      }
    }

    await this.router.navigateByUrl(target, { replaceUrl: true });
  }
}