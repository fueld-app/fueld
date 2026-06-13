import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CompanyDetailStore } from '../company-detail.store';
import { CompanyInfoCardComponent } from '../components/company-info-card/company-info-card.component';
import { ContactsCardComponent } from '../components/contacts-card/contacts-card.component';
import { CommentsCardComponent } from '@app/shared/components/comments-card/comments-card.component';
import { ActivityTimelineComponent } from '@app/shared/components/activity-timeline/activity-timeline.component';

@Component({
  selector: 'app-overview-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CompanyInfoCardComponent,
    ContactsCardComponent,
    CommentsCardComponent,
    ActivityTimelineComponent,
  ],
  template: `
    <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <app-company-info-card
        [company]="store.company()!"
        [enrichment]="store.enrichment()"
        [syncConflicts]="store.syncConflicts()"
        [ownCompanies]="store.ownCompanies()"
        [allTypes]="store.allTypes()"
        [companyTypes]="store.companyTypes()"
        [companyOffices]="store.companyOffices()"
        [companyEmails]="store.companyEmails()"
        [emailsLoading]="store.emailsLoading()"
        (companyChange)="store.onCompanyInfoSave($event)"
        (typeToggle)="store.toggleType($event)"
        (conflictAccept)="store.acceptSeasearcherValue($event)"
        (conflictDismiss)="store.dismissConflict($event.field, $event.seasearcherValue)"
        (officeSave)="store.onOfficeSave($event)"
        (officeDelete)="store.deleteCompanyOffice($event)"
        (emailSave)="store.onEmailSave($event)"
        (emailDelete)="store.deleteCompanyEmail($event)"
        (requestCredit)="store.showCreditApplicationModal.set(true)"
      />

      <div class="flex flex-col gap-6">
        <app-contacts-card
          [contacts]="store.contacts()"
          [contactsLoading]="store.contactsLoading()"
          [companyId]="store.company()!.id"
          (mutated)="store.loadContacts(store.company()!.id)"
        />
        <app-comments-card entityType="company" [entityId]="store.company()!.id" />
      </div>
    </div>

    <div class="mt-6">
      <app-activity-timeline entityType="company" [entityId]="store.company()!.id" />
    </div>
  `,
})
export class OverviewTabComponent {
  readonly store = inject(CompanyDetailStore);
}
