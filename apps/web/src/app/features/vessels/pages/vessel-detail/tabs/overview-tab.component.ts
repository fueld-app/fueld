import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { VesselDetailStore } from '../vessel-detail.store';
import { VesselInfoCardComponent } from '../components/vessel-info-card.component';
import { VesselLatestInformationCardComponent } from '../components/vessel-latest-information-card.component';
import { VesselPositionMapCardComponent } from '../components/vessel-position-map-card.component';
import { VesselEnforcementBannerComponent } from '../components/vessel-enforcement-banner.component';
import { VesselOrdersCardComponent } from '../components/vessel-orders-card.component';
import { VesselPortCallHistoryCardComponent } from '../components/vessel-port-call-history-card.component';
import { CommentsCardComponent } from '@app/shared/components/comments-card/comments-card.component';

@Component({
  selector: 'app-vessel-overview-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    VesselInfoCardComponent,
    VesselLatestInformationCardComponent,
    VesselPositionMapCardComponent,
    VesselEnforcementBannerComponent,
    VesselOrdersCardComponent,
    VesselPortCallHistoryCardComponent,
    CommentsCardComponent,
  ],
  template: `
    <div class="vessel-card-grid grid grid-cols-1 gap-6 min-[900px]:grid-cols-2 min-[1600px]:grid-cols-3 min-[2000px]:grid-cols-4">

      <!-- Vessel Info + Dimensions -->
      <app-vessel-info-card
        [vessel]="store.vessel()!"
        [enrichment]="store.enrichment()"
        [vesselTypes]="store.vesselTypes()"
        [editing]="store.editing()"
        [editSaving]="store.editSaving()"
        [vesselInfoTab]="store.vesselInfoTab()"
        [editName]="store.editName()"
        [editImo]="store.editImo()"
        [editFlag]="store.editFlag()"
        [editType]="store.editType()"
        [editMmsi]="store.editMmsi()"
        [editStatus]="store.editStatus()"
        [editBuildYear]="store.editBuildYear()"
        [editBuilder]="store.editBuilder()"
        [editClassification]="store.editClassification()"
        [editPhone]="store.editPhone()"
        [editLoa]="store.editLoa()"
        [editBreadth]="store.editBreadth()"
        [editDepth]="store.editDepth()"
        [editDraught]="store.editDraught()"
        [editDwt]="store.editDwt()"
        [editGrossTonnage]="store.editGrossTonnage()"
        [navigatingCompanyId]="store.navigatingCompanyId()"
        (infoTabChange)="store.vesselInfoTab.set($event)"
        (startEditing)="store.startEditing()"
        (cancelEditing)="store.cancelEditing()"
        (saveEditing)="store.saveEditing()"
        (editNameChange)="store.editName.set($event)"
        (editImoChange)="store.editImo.set($event)"
        (editFlagChange)="store.editFlag.set($event)"
        (editTypeChange)="store.editType.set($event)"
        (editMmsiChange)="store.editMmsi.set($event)"
        (editStatusChange)="store.editStatus.set($event)"
        (editBuildYearChange)="store.editBuildYear.set($event)"
        (editBuilderChange)="store.editBuilder.set($event)"
        (editClassificationChange)="store.editClassification.set($event)"
        (editPhoneChange)="store.editPhone.set($event)"
        (editLoaChange)="store.editLoa.set($event)"
        (editBreadthChange)="store.editBreadth.set($event)"
        (editDepthChange)="store.editDepth.set($event)"
        (editDraughtChange)="store.editDraught.set($event)"
        (editDwtChange)="store.editDwt.set($event)"
        (editGrossTonnageChange)="store.editGrossTonnage.set($event)"
        (navigateToCompany)="store.navigateToCompanyById($event)"
      />

      <!-- Enforcement Banner -->
      @if (store.showCreditEnforcementException()) {
        <app-vessel-enforcement-banner
          [vessel]="store.vessel()!"
          [isSanctioned]="store.isSanctionedVessel()"
          [linkedCreditImpacts]="store.linkedCreditImpacts()"
          [creditImpactLoading]="store.creditImpactLoading()"
          [creditEnforcementSaving]="store.creditEnforcementSaving()"
          [canManageCreditEnforcement]="store.canManageCreditEnforcementException()"
          [seizureHitsForImpact]="seizureHitsFn"
          (toggleCreditEnforcement)="store.setIgnoreForCreditEnforcement($event)"
          class="min-[900px]:col-span-2 min-[1600px]:col-span-3 min-[2000px]:col-span-4"
        />
      }

      @if (store.hasActiveSeizureImpact()) {
        <app-vessel-enforcement-banner
          [vessel]="store.vessel()!"
          [linkedCreditImpacts]="store.linkedCreditImpacts()"
          [seizureHitsForImpact]="seizureHitsFn"
          variant="seizure"
          class="min-[900px]:col-span-2 min-[1600px]:col-span-3 min-[2000px]:col-span-4"
        />
      }

      <!-- Orders -->
      <app-vessel-orders-card
        [vesselOrders]="store.vesselOrders()"
        [ordersLoading]="store.ordersLoading()"
        (goToOrder)="store.goToOrder($event.orderId, $event.status)"
      />

      <!-- Latest Information -->
      @if (store.enrichmentLoading()) {
        <div class="rounded-xl border border-gray-200 bg-white shadow-sm p-6 flex items-center justify-center min-[900px]:h-[449px]">
          <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (store.enrichment()) {
        <app-vessel-latest-information-card
          [enrichment]="store.enrichment()"
          [positionTimestamp]="store.positionTimestamp()"
          [positionAge]="store.positionAge()"
          [destinationInfo]="store.destinationInfo()"
          [navigatingPlaceId]="store.navigatingPlaceId()"
          (navigateToPlace)="store.navigateToPlace($event)"
        />

        <!-- Current Position Map -->
        @if (store.enrichment()!.latestInformation?.position) {
          <app-vessel-position-map-card
            [vessel]="store.vessel()!"
            [enrichment]="store.enrichment()"
            class="min-[900px]:row-span-2"
          />
        }

        <!-- Sanctions -->
        @if (store.enrichment()!['isSanctioned']) {
          <div class="rounded-xl border border-red-200 bg-white shadow-sm min-[900px]:order-[8]">
            <div class="border-b border-red-100 px-5 py-3">
              <h2 class="text-sm font-semibold text-red-700">⚠️ Sanctioned</h2>
            </div>
            <div class="px-5 py-4 text-sm text-red-600">
              This vessel is flagged as sanctioned.
            </div>
          </div>
        }

        <!-- Comments -->
        <app-comments-card
          class="block min-[900px]:h-[449px] overflow-hidden"
          entityType="vessel"
          [entityId]="store.vessel()!.id"
        />
      } @else if (store.vessel()!.seasearcherId) {
        <div class="rounded-xl border border-gray-200 bg-white shadow-sm p-5 text-center">
          <p class="text-sm text-gray-400">Enrichment data unavailable</p>
        </div>
        <app-comments-card
          class="block min-[900px]:h-[449px] overflow-hidden"
          entityType="vessel"
          [entityId]="store.vessel()!.id"
        />
      }

      <!-- Port Call History -->
      @if (store.vessel()!.seasearcherId) {
        <app-vessel-port-call-history-card
          [movements]="store.movements()"
          [movementsLoading]="store.movementsLoading()"
          [navigatingPlaceId]="store.navigatingPlaceId()"
          (navigateToPlace)="store.navigateToPlace($event)"
          class="min-[900px]:col-span-2 min-[1600px]:col-span-3 min-[2000px]:col-span-4"
        />
      }
    </div>
  `,
})
export class VesselOverviewTabComponent {
  readonly store = inject(VesselDetailStore);

  readonly seizureHitsFn = (impact: any) => this.store.seizureHitsForImpact(impact);
}