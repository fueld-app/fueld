import { Component, ChangeDetectionStrategy, computed, inject, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterOutlet } from '@angular/router';
import { Subscription } from 'rxjs';
import { PlaceDetailStore } from './place-detail.store';
import { PlaceHeaderComponent } from './components/place-header/place-header.component';
import { PlaceTabsNavComponent } from './place-tabs-nav.component';

@Component({
  selector: 'app-place-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    PlaceTabsNavComponent,
    PlaceHeaderComponent,
  ],
  providers: [PlaceDetailStore],
  styles: [`
    :host ::ng-deep .leaflet-container { font-family: inherit; }
  `],
  template: `
    <div>
      <button
        (click)="store.goBack()"
        class="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 dark:text-muted hover:text-gray-700 transition-colors"
      >
        <span class="text-base leading-none" aria-hidden="true">←</span>
        Back to Places
      </button>

      @if (store.loading()) {
        <div class="flex items-center justify-center py-20">
          <div class="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500 dark:border-line dark:border-t-muted"></div>
        </div>
      } @else if (store.place(); as place) {
        <app-place-header />

        @if (store.showDeleteModal() && store.canDeleteEntity()) {
          <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="store.showDeleteModal.set(false)">
            <div class="rounded-xl bg-white dark:bg-surface p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
              <h3 class="text-lg font-semibold text-gray-900 dark:text-ink">Delete place?</h3>
              <p class="mt-2 text-sm text-gray-500 dark:text-muted">
                Are you sure you want to delete <strong>{{ place.name }}</strong>?
                This cannot be undone.
              </p>
              @if (store.deleteError()) {
                <p class="mt-2 text-sm text-red-600 dark:text-red-400">{{ store.deleteError() }}</p>
              }
              <div class="mt-4 flex justify-end gap-2">
                <button
                  (click)="store.showDeleteModal.set(false)"
                  class="rounded-lg border border-gray-300 dark:border-line-strong px-4 py-2 text-sm font-medium text-gray-700 dark:text-ink-dim hover:bg-gray-50 dark:hover:bg-surface-tint"
                >Cancel</button>
                <button
                  (click)="store.executeDeletePlace()"
                  [disabled]="store.deletingPlace()"
                  class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  @if (store.deletingPlace()) { Deleting… } @else { Delete }
                </button>
              </div>
            </div>
          </div>
        }
      } @else {
        <div class="text-center py-20 text-gray-400 dark:text-muted">Place not found</div>
      }

      <!-- Tab nav + router-outlet live OUTSIDE the loading/place @if blocks —
           see company-tabs-nav.component.ts for why: signal-controlled blocks
           around the outlet let loading/place flickers tear it down mid-activation,
           and inline <svg> in the template makes production builds create the
           outlet's child hosts as SVGElement (0×0 blank tabs). -->
      @if (!store.loading() && store.place()) {
        <app-place-tabs-nav [tabs]="tabs()" />

        <router-outlet />
      }
    </div>
  `,
})
export class PlaceDetailPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  readonly store = inject(PlaceDetailStore);

  // Tabs backed purely by Seasearcher data (traffic, structure) are hidden for
  // manual places that have no Seasearcher integration/sync — otherwise they
  // render permanently-empty panels that look like broken data.
  readonly tabs = computed(() => {
    const all = [
    { key: 'overview', label: 'Overview', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' },
    { key: 'traffic', label: 'Traffic', icon: 'M6.75 2.994a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM4.094 6.75A3.094 3.094 0 017.188 3.656H9.75a.75.75 0 010 1.5H7.188a1.594 1.594 0 00-1.594 1.594v.469a.75.75 0 01-1.5 0v-.469zM2.25 10.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM2.25 13.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM2.25 16.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM13.5 6.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 9.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 12.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 15.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75z' },
    { key: 'structure', label: 'Structure', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.072M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' },
    { key: 'commercial', label: 'Commercial', icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941' },
    { key: 'comments', label: 'Comments', icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.5h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375A1.125 1.125 0 002.25 4.875v10.5c0 .621.504 1.125 1.125 1.125z' },
    { key: 'activity', label: 'Activity', icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z' },
    ] as const;
    if (this.store.isManualPlace()) {
      return all.filter((t) => t.key !== 'traffic' && t.key !== 'structure');
    }
    return all;
  });

  private routeSub: Subscription | null = null;
  private loadedId: string | null = null;

  ngOnInit(): void {
    // The paramMap subscription fires immediately with the current id, so a
    // separate snapshot read is redundant — and calling loadPlace twice for
    // the same id races two HTTP requests whose resetState()/loading flips
    // tear down the router-outlet (and the Leaflet map card) mid-init.
    this.routeSub = this.route.paramMap.subscribe((params) => {
      const newId = params.get('id');
      if (newId && newId !== this.loadedId) {
        this.loadedId = newId;
        void this.store.loadPlace(newId);
      } else if (!newId) {
        this.store.loading.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.store.destroy();
    this.routeSub?.unsubscribe();
  }
}
