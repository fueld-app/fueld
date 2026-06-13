import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CompanyDetailStore } from '../company-detail.store';
import { GroupStructureCardComponent } from '../components/group-structure-card/group-structure-card.component';

@Component({
  selector: 'app-group-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [GroupStructureCardComponent],
  template: `
    <app-group-structure-card
      [company]="store.company()!"
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
  `,
})
export class GroupTabComponent {
  readonly store = inject(CompanyDetailStore);
}
