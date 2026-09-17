import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ActivityTimelineComponent } from '@app/shared/components/activity-timeline/activity-timeline.component';
import { CompanyDetailStore } from '../../company-detail.store';

@Component({
  selector: 'app-company-activity-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ActivityTimelineComponent],
  styles: [':host { display: block }'],
  template: `
    <app-activity-timeline entityType="company" [entityId]="store.company()!.id" />
  `,
})
export class CompanyActivityTabComponent {
  readonly store = inject(CompanyDetailStore);
}