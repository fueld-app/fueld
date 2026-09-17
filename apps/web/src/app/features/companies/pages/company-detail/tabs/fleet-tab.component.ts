import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CompanyDetailStore } from '../company-detail.store';
import { FleetMapCardComponent } from '../components/fleet-map-card/fleet-map-card.component';
import { FleetTableCardComponent } from '../components/fleet-table-card/fleet-table-card.component';

@Component({
  selector: 'app-fleet-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FleetMapCardComponent, FleetTableCardComponent],
  styles: [':host { display: block }'],
  template: `
    @if (store.company(); as company) {
    <div class="grid grid-cols-1 gap-6">
      <app-fleet-map-card
        [vessels]="store.fleetVesselsWithPosition()"
        [mode]="store.groupFleetMode()"
        [loading]="store.groupFleetLoading()"
        [totalMatches]="store.activeFleetTotalMatches()"
        [limitNotice]="store.groupFleetLimitNotice()"
        (navigateToVessel)="store.navigateToVessel($event)"
      />

      <app-fleet-table-card
        [companyId]="company.id"
        [isParent]="store.isParent()"
        [contacts]="store.contacts()"
        [contactsLoading]="store.contactsLoading()"
        [mode]="store.groupFleetMode()"
        [fleet]="store.fleet()"
        [fleetLoading]="store.fleetLoading()"
        [vesselsLoading]="store.vesselsLoading()"
        [groupVessels]="store.groupVessels()"
        [groupVesselsLoading]="store.groupVesselsLoading()"
        [companyVessels]="store.companyVessels()"
        [fleetMatchBySeasearcherId]="store.fleetMatchBySeasearcherId()"
        [fleetMatchByImo]="store.fleetMatchByImo()"
        [fleetRoleSelections]="store.fleetRoleSelections()"
        [linkingFleetKey]="store.linkingFleetKey()"
        [totalMatches]="store.activeFleetTotalMatches()"
        [limitNotice]="store.groupFleetLimitNotice()"
        [navigatingVesselId]="store.navigatingVesselId()"
        (modeToggle)="store.toggleFleetMode()"
        (mutated)="store.loadCompanyVessels(company.id)"
        (fleetRoleChange)="store.onFleetRoleChange($event.vessel, $event.role)"
        (navigateToVessel)="store.navigateToVessel($event)"
        (openGroupVessel)="store.openGroupVessel($event)"
        (deleteVesselAssoc)="store.confirmDeleteVesselAssoc.set($event)"
      />
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
export class FleetTabComponent {
  readonly store = inject(CompanyDetailStore);
}
