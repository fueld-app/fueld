import { Component, ChangeDetectionStrategy, inject, OnInit, OnDestroy } from '@angular/core';
import { ActivatedRoute, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { Subscription } from 'rxjs';
import { PlaceDetailStore } from './place-detail.store';
import { PlaceHeaderComponent } from './components/place-header/place-header.component';

@Component({
  selector: 'app-place-detail-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
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
        class="mb-4 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clip-rule="evenodd" />
        </svg>
        Back to Places
      </button>

      @if (store.loading()) {
        <div class="flex items-center justify-center py-20">
          <svg class="h-6 w-6 animate-spin text-gray-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (store.place(); as place) {
        <app-place-header />

        <div class="mb-6 -mx-4 px-4 md:mx-0 md:px-0">
          <nav class="flex gap-1 overflow-x-auto border-b border-gray-200 pb-px scrollbar-hide" aria-label="Place sections">
            @for (tab of tabs; track tab.key) {
              <a
                [routerLink]="[tab.key]"
                routerLinkActive
                #rla="routerLinkActive"
                role="tab"
                [attr.aria-selected]="rla.isActive"
                [id]="'tab-' + tab.key"
                class="group inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none"
                [class]="rla.isActive
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700'"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path [attr.d]="tab.icon" />
                </svg>
                {{ tab.label }}
              </a>
            }
          </nav>
        </div>

        <router-outlet />

        @if (store.showDeleteModal() && store.canDeleteEntity()) {
          <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="store.showDeleteModal.set(false)">
            <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
              <h3 class="text-lg font-semibold text-gray-900">Delete place?</h3>
              <p class="mt-2 text-sm text-gray-500">
                Are you sure you want to delete <strong>{{ place.name }}</strong>?
                This cannot be undone.
              </p>
              @if (store.deleteError()) {
                <p class="mt-2 text-sm text-red-600">{{ store.deleteError() }}</p>
              }
              <div class="mt-4 flex justify-end gap-2">
                <button
                  (click)="store.showDeleteModal.set(false)"
                  class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
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
        <div class="text-center py-20 text-gray-400">Place not found</div>
      }
    </div>
  `,
})
export class PlaceDetailPageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  readonly store = inject(PlaceDetailStore);

  readonly tabs = [
    { key: 'overview', label: 'Overview', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' },
    { key: 'traffic', label: 'Traffic', icon: 'M6.75 2.994a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM4.094 6.75A3.094 3.094 0 017.188 3.656H9.75a.75.75 0 010 1.5H7.188a1.594 1.594 0 00-1.594 1.594v.469a.75.75 0 01-1.5 0v-.469zM2.25 10.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM2.25 13.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM2.25 16.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM13.5 6.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 9.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 12.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 15.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75z' },
    { key: 'structure', label: 'Structure', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.072M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' },
    { key: 'commercial', label: 'Commercial', icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941' },
  ] as const;

  private routeSub: Subscription | null = null;

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      void this.store.loadPlace(id);
    } else {
      this.store.loading.set(false);
    }

    this.routeSub = this.route.paramMap.subscribe((params) => {
      const newId = params.get('id');
      if (newId) {
        void this.store.loadPlace(newId);
      } else {
        this.store.loading.set(false);
      }
    });
  }

  ngOnDestroy(): void {
    this.store.destroy();
    this.routeSub?.unsubscribe();
  }
}
