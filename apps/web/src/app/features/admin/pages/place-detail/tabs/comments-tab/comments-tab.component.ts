import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommentsCardComponent } from '@app/shared/components/comments-card/comments-card.component';
import { PlaceDetailStore } from '../../place-detail.store';

@Component({
  selector: 'app-place-comments-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommentsCardComponent],
  template: `
    @if (store.place(); as place) {
      <app-comments-card entityType="place" [entityId]="place.id" />
    } @else {
      <div class="flex items-center justify-center py-12"><div class="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-500 dark:border-line dark:border-t-muted"></div></div>
    }
  `,
})
export class PlaceCommentsTabComponent {
  readonly store = inject(PlaceDetailStore);
}