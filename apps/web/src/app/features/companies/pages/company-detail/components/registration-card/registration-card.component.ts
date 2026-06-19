import { Component, ChangeDetectionStrategy, input, output, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { DateLabelPipe } from '@app/shared/pipes/date-format.pipe';

interface HierarchyNode {
  level: number;
  companyId: string;
  companyName: string;
  active: boolean;
  isSanctioned: boolean;
  beneficialOwner: number;
  commercialOperator: number;
  thirdPartyOperator: number;
  technicalManager: number;
  registered: number;
  nominalOwner: number;
  ismManager: number;
  companyHierarchy?: HierarchyNode[];
}

interface CompanyEnrichment {
  companyRegistration: {
    localName?: string | null;
    registryName?: string | null;
    incorporationDate?: string | null;
    registrationNumbers: Array<{ value: string | null; typeDescription: string | null }>;
  } | null;
  counterpartyRiskReportMetadata: any;
}

interface HierarchyResponse {
  companyHierarchy: HierarchyNode;
}

@Component({
  selector: 'app-registration-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DateLabelPipe, DatePipe],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-8 flex flex-col overflow-hidden">
      <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <h2 class="text-sm font-semibold text-gray-700">Registration & Ownership</h2>
        <div class="flex gap-1">
          <button type="button"
            class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
            [class]="tab() === 'ownership' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
            (click)="tab.set('ownership')">Ownership Structure</button>
          <button type="button"
            class="rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
            [class]="tab() === 'registration' ? 'bg-brand-50 text-brand-700' : 'text-gray-400 hover:text-gray-600'"
            (click)="tab.set('registration')">Registration</button>
        </div>
      </div>
      <div class="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-3 text-sm">
        @if (tab() === 'registration') {
          @if (enrichment()?.companyRegistration; as reg) {
            <div class="space-y-2">
              @if (reg.localName) {
                <div class="flex justify-between"><span class="text-gray-500">Local Name</span><span class="font-medium text-gray-900">{{ reg.localName }}</span></div>
              }
              @if (reg.registryName) {
                <div class="flex justify-between"><span class="text-gray-500">Registry</span><span class="font-medium text-gray-900">{{ reg.registryName }}</span></div>
              }
              @if (reg.incorporationDate) {
                <div class="flex justify-between"><span class="text-gray-500">Incorporated</span><span class="font-medium text-gray-900">{{ reg.incorporationDate | dateLabel }}</span></div>
              }
              @for (r of reg.registrationNumbers; track $index) {
                @if (r.value) {
                  <div class="flex justify-between">
                    <span class="text-gray-500">{{ r.typeDescription ?? 'Reg #' }}</span>
                    <span class="font-medium text-gray-900 font-mono text-xs">{{ r.value }}</span>
                  </div>
                }
              }
            </div>
          } @else {
            <div class="text-xs text-gray-500 text-center">Registration data unavailable</div>
          }
        } @else {
          @if (hierarchy(); as h) {
            <div class="p-5 max-h-[500px] overflow-y-auto">
              @if (flatNodes().length) {
                <div class="space-y-1">
                  @for (node of flatNodes(); track $index) {
                    <div class="flex items-center gap-2 text-sm" [style.padding-left.px]="(node.level - 1) * 20">
                      <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-gray-300 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                        @if (node.level === 1) {
                          <path fill-rule="evenodd" d="M4.083 9h1.946c.089-1.546.383-2.97.837-4.118A6.004 6.004 0 004.083 9zM10 2a8 8 0 100 16 8 8 0 000-16zm0 2c-.076 0-.232.032-.465.262-.238.234-.497.623-.737 1.182-.389.907-.673 2.142-.766 3.556h3.936c-.093-1.414-.377-2.649-.766-3.556-.24-.56-.5-.948-.737-1.182C10.232 4.032 10.076 4 10 4zm3.971 5c-.089-1.546-.383-2.97-.837-4.118A6.004 6.004 0 0115.917 9h-1.946zm-2.003 2H8.032c.093 1.414.377 2.649.766 3.556.24.56.5.948.737 1.182.233.23.389.262.465.262.076 0 .232-.032.465-.262.238-.234.497-.623.737-1.182.389-.907.673-2.142.766-3.556zm1.166 4.118c.454-1.147.748-2.572.837-4.118h1.946a6.004 6.004 0 01-2.783 4.118zm-6.268 0C6.412 13.97 6.118 12.546 6.029 11H4.083a6.004 6.004 0 002.783 4.118z" clip-rule="evenodd" />
                        } @else {
                          <path fill-rule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 110 2h-3a1 1 0 01-1-1v-2a1 1 0 00-1-1H9a1 1 0 00-1 1v2a1 1 0 01-1 1H4a1 1 0 110-2V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clip-rule="evenodd" />
                        }
                      </svg>
                      @if (node.companyId === seasearcherId()) {
                        <span class="font-medium text-brand-600">{{ node.companyName }}</span>
                      } @else {
                        <button
                          (click)="navigateToCompany.emit(node.companyId)"
                          [disabled]="navigatingCompanyId() === node.companyId"
                          class="font-medium text-gray-900 hover:text-brand-600 hover:underline text-left disabled:opacity-50">
                          @if (navigatingCompanyId() === node.companyId) {
                            <svg class="inline h-3 w-3 animate-spin mr-0.5" viewBox="0 0 24 24" fill="none">
                              <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                              <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                            </svg>
                          }
                          {{ node.companyName }}
                        </button>
                      }
                      @if (node.isSanctioned) { <span class="text-xs text-red-600">⚠️</span> }
                      @if (!node.active) { <span class="text-xs text-gray-400">(inactive)</span> }
                      <span class="text-xs text-gray-400 ml-auto">{{ hierarchyRoles(node) }}</span>
                    </div>
                  }
                </div>
              } @else {
                <p class="text-sm text-gray-400 text-center">No hierarchy data</p>
              }
            </div>
          } @else {
            <div class="text-xs text-gray-500 text-center">Ownership data unavailable</div>
          }
        }
      </div>
    </div>
  `,
})
export class RegistrationCardComponent {
  readonly enrichment = input<CompanyEnrichment | null>(null);
  readonly hierarchy = input<HierarchyResponse | null>(null);
  readonly seasearcherId = input<string | null | undefined>(null);
  readonly navigatingCompanyId = input<string | null>(null);

  readonly navigateToCompany = output<string>();

  readonly tab = signal<'ownership' | 'registration'>('ownership');

  flatNodes(): HierarchyNode[] {
    const h = this.hierarchy();
    if (!h?.companyHierarchy) return [];
    const nodes: HierarchyNode[] = [];
    const flatten = (node: HierarchyNode) => {
      nodes.push(node);
      if (node.companyHierarchy?.length) {
        for (const child of node.companyHierarchy) flatten(child);
      }
    };
    flatten(h.companyHierarchy);
    return nodes;
  }

  hierarchyRoles(node: HierarchyNode): string {
    const roles: string[] = [];
    if (node.beneficialOwner > 0) roles.push(`BO: ${node.beneficialOwner}`);
    if (node.commercialOperator > 0) roles.push(`CO: ${node.commercialOperator}`);
    if (node.thirdPartyOperator > 0) roles.push(`TP: ${node.thirdPartyOperator}`);
    if (node.technicalManager > 0) roles.push(`TM: ${node.technicalManager}`);
    if (node.registered > 0) roles.push(`RO: ${node.registered}`);
    if (node.nominalOwner > 0) roles.push(`NO: ${node.nominalOwner}`);
    if (node.ismManager > 0) roles.push(`ISM: ${node.ismManager}`);
    return roles.join(', ');
  }
}
