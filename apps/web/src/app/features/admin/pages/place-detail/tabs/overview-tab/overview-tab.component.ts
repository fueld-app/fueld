import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { PlaceDetailStore } from '../../place-detail.store';
import { PlaceMapCardComponent } from '../../components/place-map-card/place-map-card.component';
import { PlaceInfoCardComponent } from '../../components/place-info-card/place-info-card.component';
import { ActivityTimelineComponent } from '@app/shared/components/activity-timeline/activity-timeline.component';
import { CommentsCardComponent } from '@app/shared/components/comments-card/comments-card.component';

@Component({
  selector: 'app-place-overview-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    PlaceMapCardComponent,
    PlaceInfoCardComponent,
    ActivityTimelineComponent,
    CommentsCardComponent,
  ],
  template: `
    <div class="space-y-4">
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <app-place-map-card />
        <app-place-info-card />
      </div>
      <div class="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <app-comments-card entityType="place" [entityId]="store.place()!.id" />
        <app-activity-timeline entityType="place" [entityId]="store.place()!.id" />
      </div>
    </div>
  `,
})
export class PlaceOverviewTabComponent {
  readonly store = inject(PlaceDetailStore);
}
