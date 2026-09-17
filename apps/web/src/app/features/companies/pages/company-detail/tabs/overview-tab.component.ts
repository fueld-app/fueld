import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CompanyDetailStore } from '../company-detail.store';
import { CompanyInfoCardComponent } from '../components/company-info-card/company-info-card.component';
import { ContactsCardComponent } from '../components/contacts-card/contacts-card.component';

@Component({
  selector: 'app-overview-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CompanyInfoCardComponent,
    ContactsCardComponent,
  ],
  styles: [':host { display: block }'],
  template: `
    @if (store.company(); as company) {
      <div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <app-company-info-card
        [company]="company"
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
          [companyId]="company.id"
          (mutated)="store.loadContacts(company.id)"
        />
      </div>
      </div>
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
export class OverviewTabComponent {
  readonly store = inject(CompanyDetailStore);
}