import {
  Component,
  ChangeDetectionStrategy,
  signal,
  computed,
  inject,
  input,
  effect,
  OnDestroy,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';

import { API } from '@app/core/config/api';

interface LastEditInfo {
  userName: string | null;
  userEmail: string | null;
  action: string;
  httpPath: string | null;
  platform: string | null;
  createdAt: string;
}

function describeAction(action: string, httpPath: string | null): string {
  if (httpPath) {
    if (httpPath.includes('/suppliers') && action === 'CREATE') return 'Supplier added by';
    if (httpPath.includes('/suppliers') && action === 'DELETE') return 'Supplier removed by';
    if (httpPath.includes('/responsible-user')) return 'Responsible user updated by';
  }
  return action === 'CREATE' ? 'Last created by' : 'Last edited by';
}

@Component({
  selector: 'app-last-edited-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (info()) {
      <div class="inline-flex items-center gap-1.5 rounded-full bg-gray-50 dark:bg-bg-2 px-3 py-1 text-xs text-gray-500 dark:text-muted ring-1 ring-gray-200/60">
        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-400 dark:text-muted" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clip-rule="evenodd" />
        </svg>
        <span>{{ actionText() }}</span>
        <span class="font-medium text-gray-700 dark:text-ink-dim">{{ info()!.userName ?? info()!.userEmail ?? 'Unknown' }}</span>
        <span>&middot;</span>
        <span>{{ timeAgo() }}</span>
      </div>
    }
  `,
})
export class LastEditedBadgeComponent implements OnDestroy {
  private readonly http = inject(HttpClient);

  readonly entityType = input.required<string>();
  readonly entityId = input.required<string>();

  readonly info = signal<LastEditInfo | null>(null);
  readonly timeAgo = signal('');
  readonly actionText = computed(() => {
    const i = this.info();
    return i ? describeAction(i.action, i.httpPath) : '';
  });

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnDestroy(): void {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  constructor() {
    effect(() => {
      const id = this.entityId();
      const type = this.entityType();
      if (id && type) {
        this.fetchLastEdit();
      }
    });

    // Update the relative time every minute
    this.refreshTimer = setInterval(() => this.updateTimeAgo(), 60_000);
  }

  private async fetchLastEdit(): Promise<void> {
    const type = this.entityType();
    const id = this.entityId();
    if (!type || !id) return;

    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<LastEditInfo | null>>(
          `${API}/activity/${encodeURIComponent(type)}/${encodeURIComponent(id)}/last-edit`,
        ),
      );

      if (res.success && res.data) {
        this.info.set(res.data);
        this.updateTimeAgo();
      }
    } catch {
      // silently fail
    }
  }

  private updateTimeAgo(): void {
    const data = this.info();
    if (!data) return;

    const now = Date.now();
    const then = new Date(data.createdAt).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60_000);
    const diffHrs = Math.floor(diffMs / 3_600_000);
    const diffDays = Math.floor(diffMs / 86_400_000);

    if (diffMin < 1) {
      this.timeAgo.set('just now');
    } else if (diffMin < 60) {
      this.timeAgo.set(`${diffMin}m ago`);
    } else if (diffHrs < 24) {
      this.timeAgo.set(`${diffHrs}h ago`);
    } else if (diffDays < 30) {
      this.timeAgo.set(`${diffDays}d ago`);
    } else {
      this.timeAgo.set(
        new Date(data.createdAt).toLocaleDateString('en-GB', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        }),
      );
    }
  }
}
