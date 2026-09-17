import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CommentsCardComponent } from '@app/shared/components/comments-card/comments-card.component';
import { CompanyDetailStore } from '../../company-detail.store';

@Component({
  selector: 'app-company-comments-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommentsCardComponent],
  styles: [':host { display: block }'],
  template: `
    @if (store.company(); as company) {
    <app-comments-card entityType="company" [entityId]="company.id" />
    } @else {
      <div class="flex items-center justify-center py-12">
        <svg class="h-6 w-6 animate-spin text-gray-400 dark:text-muted" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
        </svg>
      </div>
    }
  `,
})
export class CompanyCommentsTabComponent {
  readonly store = inject(CompanyDetailStore);
}