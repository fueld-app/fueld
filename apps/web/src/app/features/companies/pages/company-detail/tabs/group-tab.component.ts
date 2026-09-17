import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CompanyDetailStore } from '../company-detail.store';
import { GroupStructureCardComponent } from '../components/group-structure-card/group-structure-card.component';

@Component({
  selector: 'app-group-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GroupStructureCardComponent],
  styles: [':host { display: block }'],
  template: `
    @if (store.company(); as company) {
    <app-group-structure-card
      [company]="company"
      [childCompanies]="store.childCompanies()"
      [parentCompany]="store.parentCompany()"
      [isParent]="store.isParent()"
      [isChild]="store.isChild()"
      [linkingChildId]="store.linkingChildId()"
      [unlinkingChildId]="store.unlinkingChildId()"
      [linkChildResults]="store.linkChildResults()"
      (linkChildRequest)="store.linkChild($event)"
      (unlinkChild)="store.unlinkChild($event)"
      (linkSearchChange)="store.onLinkChildSearch($event)"
    />
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
export class GroupTabComponent {
  readonly store = inject(CompanyDetailStore);
}
