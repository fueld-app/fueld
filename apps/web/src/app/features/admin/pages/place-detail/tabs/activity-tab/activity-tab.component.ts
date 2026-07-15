import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivityTimelineComponent } from '@app/shared/components/activity-timeline/activity-timeline.component';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-activity-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityTimelineComponent],
  template: `
    <app-activity-timeline entityType="place" [entityId]="store.place()!.id" />
  `,
})
export class PlaceActivityTabComponent {
  readonly store = inject(PlaceDetailStore);
}