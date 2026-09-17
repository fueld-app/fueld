import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivityTimelineComponent } from '@app/shared/components/activity-timeline/activity-timeline.component';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-activity-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityTimelineComponent],
  template: `
    @if (store.place(); as place) {
      <app-activity-timeline entityType="place" [entityId]="place.id" />
    } @else {
      <div class="flex items-center justify-center py-12"><div class="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500 dark:border-line dark:border-t-muted"></div></div>
    }
  `,
})
export class PlaceActivityTabComponent {
  readonly store = inject(PlaceDetailStore);
}