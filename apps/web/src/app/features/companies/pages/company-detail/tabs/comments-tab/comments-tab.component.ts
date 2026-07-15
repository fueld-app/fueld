import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommentsCardComponent } from '@app/shared/components/comments-card/comments-card.component';
import { CompanyDetailStore } from '../../company-detail.store';

@Component({
  selector: 'app-company-comments-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommentsCardComponent],
  template: `
    <app-comments-card entityType="company" [entityId]="store.company()!.id" />
  `,
})
export class CompanyCommentsTabComponent {
  readonly store = inject(CompanyDetailStore);
}