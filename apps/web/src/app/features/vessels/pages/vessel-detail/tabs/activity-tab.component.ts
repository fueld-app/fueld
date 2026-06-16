import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { VesselDetailStore } from '../vessel-detail.store';
import { ActivityTimelineComponent } from '@app/shared/components/activity-timeline/activity-timeline.component';

@Component({
  selector: 'app-vessel-activity-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityTimelineComponent],
  template: `
    <app-activity-timeline entityType="vessel" [entityId]="store.vessel()!.id" />
  `,
})
export class VesselActivityTabComponent {
  readonly store = inject(VesselDetailStore);
}