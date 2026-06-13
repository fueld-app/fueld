import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { CompanyDetailStore } from '../company-detail.store';
import { FleetMapCardComponent } from '../components/fleet-map-card/fleet-map-card.component';
import { FleetTableCardComponent } from '../components/fleet-table-card/fleet-table-card.component';

@Component({
  selector: 'app-fleet-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FleetMapCardComponent, FleetTableCardComponent],
  template: `
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
        [companyId]="store.company()!.id"
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
        (mutated)="store.loadCompanyVessels(store.company()!.id)"
        (fleetRoleChange)="store.onFleetRoleChange($event.vessel, $event.role)"
        (navigateToVessel)="store.navigateToVessel($event)"
        (openGroupVessel)="store.openGroupVessel($event)"
        (deleteVesselAssoc)="store.confirmDeleteVesselAssoc.set($event)"
      />
    </div>
  `,
})
export class FleetTabComponent {
  readonly store = inject(CompanyDetailStore);
}
