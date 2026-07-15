import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommentsCardComponent } from '@app/shared/components/comments-card/comments-card.component';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-comments-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommentsCardComponent],
  template: `
    <app-comments-card entityType="place" [entityId]="store.place()!.id" />
  `,
})
export class PlaceCommentsTabComponent {
  readonly store = inject(PlaceDetailStore);
}