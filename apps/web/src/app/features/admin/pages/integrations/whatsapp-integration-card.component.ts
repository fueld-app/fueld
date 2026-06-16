import {
  Component,
  ChangeDetectionStrategy,
  inject,
  signal,
  computed,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';

import { API } from '@app/core/config/api';
import { IntegrationsToastService } from './integrations-toast.service';

interface WhatsAppGroup {
  jid: string;
  name: string;
  participants: number;
}

interface WhatsAppSettings {
  enabled: boolean;
  defaultGroupJid: string | null;
  incomingRfqEnabled: boolean;
  firstInquiryGroupNotificationEnabled: boolean;
}

interface WhatsAppNotificationRule {
  id: string;
  eventType: string;
  enabled: boolean;
  messageTemplate: string;
  targetGroupJid: string | null;
}

@Component({
  selector: 'app-whatsapp-integration-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm overflow-visible">
      <div class="app-panel-header app-panel-header--green">
        <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--green">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-600" viewBox="0 0 24 24" fill="currentColor">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347zM12.05 21.785c-1.875 0-3.713-.504-5.322-1.46l-.382-.227-3.961.99 1.01-3.694-.25-.394A9.848 9.848 0 011.847 12c0-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.82 9.82 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884zm0-21.67C5.495.115.112 5.498.112 12.055c0 2.104.549 4.162 1.595 5.98L.05 24l6.148-1.612a11.87 11.87 0 005.843 1.53h.005c6.554 0 11.89-5.335 11.893-11.893A11.82 11.82 0 0020.526 3.49 11.81 11.81 0 0012.05.115z" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-base font-semibold text-gray-900">WhatsApp</h3>
          <p class="text-sm text-gray-500">Enable WhatsApp messaging, RFQ parsing, and set a default broadcast group.</p>
        </div>
        <div>
          @if (waEnabled()) {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 ring-1 ring-green-600/20">
              <span class="h-1.5 w-1.5 rounded-full bg-green-500"></span>
              Enabled
            </span>
          } @else {
            <span class="inline-flex items-center gap-1.5 rounded-full bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 ring-1 ring-gray-500/10">
              <span class="h-1.5 w-1.5 rounded-full bg-gray-400"></span>
              Disabled
            </span>
          }
        </div>
      </div>

      <div class="px-6 py-5">
        @if (waSaveSuccess()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
            </svg>
            {{ waSaveSuccess() }}
          </div>
        }
        @if (waSaveError()) {
          <div class="mb-4 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            {{ waSaveError() }}
          </div>
        }

        <!-- Enable/Disable toggle -->
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium text-gray-900">Enable WhatsApp</p>
            <p class="text-xs text-gray-500">Allow users to link their WhatsApp accounts and send messages.</p>
          </div>
          <button
            (click)="toggleWhatsApp()"
            [disabled]="waSaving()"
            [class]="waEnabled()
              ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-green-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'
              : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'"
          >
            <span
              [class]="waEnabled()
                ? 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-5'
                : 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0'"
            ></span>
          </button>
        </div>

        <!-- Incoming RFQ parsing toggle -->
        @if (waEnabled()) {
          <div class="mt-4 flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-900">Enable Incoming RFQs</p>
              <p class="text-xs text-gray-500">Parse incoming WhatsApp DMs and create RFQs automatically.</p>
            </div>
            <button
              (click)="toggleWaIncomingRfq()"
              [disabled]="waSaving()"
              [class]="waIncomingRfqEnabled()
                ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-green-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'
                : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'"
            >
              <span
                [class]="waIncomingRfqEnabled()
                  ? 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-5'
                  : 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0'"
              ></span>
            </button>
          </div>
        }

        @if (waEnabled()) {
          <div class="mt-4 flex items-center justify-between">
            <div>
              <p class="text-sm font-medium text-gray-900">Share first inquiry to group</p>
              <p class="text-xs text-gray-500">Post the first successful inquiry batch to the configured default WhatsApp group.</p>
            </div>
            <button
              (click)="toggleWaFirstInquiryGroupNotification()"
              [disabled]="waSaving()"
              [class]="waFirstInquiryGroupNotificationEnabled()
                ? 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-green-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'
                : 'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'"
            >
              <span
                [class]="waFirstInquiryGroupNotificationEnabled()
                  ? 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-5'
                  : 'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0'"
              ></span>
            </button>
          </div>
        }

        <!-- Default Group picker (visible when enabled) -->
        @if (waEnabled()) {
          <div class="mt-5 border-t border-gray-100 pt-5">
            <label class="block text-sm font-medium text-gray-700">Default Group</label>
            <p class="mt-0.5 text-xs text-gray-500">
              Used when first inquiry sharing is enabled. Requires a user to have WhatsApp linked.
            </p>
            <div class="relative mt-2 flex items-center gap-2">
              <!-- Typeahead input -->
              <div class="relative flex-1">
                <input
                  type="text"
                  [value]="waGroupSearch()"
                  (input)="waGroupSearch.set($any($event.target).value); waGroupDropdownOpen.set(true)"
                  (focus)="waGroupDropdownOpen.set(true)"
                  (blur)="waGroupDropdownOpen.set(false); syncWaGroupSearchText()"
                  (keydown.escape)="waGroupDropdownOpen.set(false)"
                  [disabled]="waGroupsLoading() || waSaving()"
                  placeholder="Search groups…"
                  autocomplete="off"
                  class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm
                         focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:opacity-50"
                />
                @if (waGroupSearch() && !waGroupsLoading()) {
                  <button
                    (click)="clearWaGroupSelection()"
                    class="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    title="Clear selection"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                }

                <!-- Dropdown -->
                @if (waGroupDropdownOpen() && !waGroupsLoading()) {
                  <div
                    class="absolute left-0 top-full z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-gray-200 bg-white shadow-lg"
                    (mousedown)="$event.preventDefault()"
                  >
                    <button
                      (click)="selectWaGroup('', 'None')"
                      class="flex w-full items-center px-3 py-2 text-left text-sm text-gray-500 hover:bg-gray-50 transition-colors"
                      [class.bg-brand-50]="!waDefaultGroupJid()"
                    >
                      None
                    </button>
                    @for (g of filteredWaGroups(); track g.jid) {
                      <button
                        (click)="selectWaGroup(g.jid, g.name + ' (' + g.participants + ')')"
                        class="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-gray-900 hover:bg-gray-50 transition-colors"
                        [class.bg-brand-50]="g.jid === waDefaultGroupJid()"
                      >
                        <span>{{ g.name }}</span>
                        <span class="text-xs text-gray-400">{{ g.participants }} members</span>
                      </button>
                    } @empty {
                      @if (waGroups().length) {
                        <div class="px-3 py-2 text-sm text-gray-400">No groups matching "{{ waGroupSearch() }}"</div>
                      }
                    }
                  </div>
                }
              </div>

              <!-- Refresh button -->
              <button
                (click)="loadWaGroups()"
                [disabled]="waGroupsLoading()"
                class="rounded-lg border border-gray-300 p-2 text-gray-500 hover:bg-gray-50 transition-colors disabled:opacity-50"
                title="Refresh groups"
              >
                @if (waGroupsLoading()) {
                  <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                } @else {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="23 4 23 10 17 10" />
                    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                  </svg>
                }
              </button>
            </div>
            @if (!waGroups().length && !waGroupsLoading()) {
              <p class="mt-2 text-xs text-amber-600">
                No groups available. Make sure at least one user has linked WhatsApp, then click refresh.
              </p>
            }
          </div>
        }

        <!-- Notification Rules -->
        @if (waEnabled()) {
          <div class="mt-5 border-t border-gray-100 pt-5">
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-medium text-gray-900">Group Notification Rules</p>
                <p class="text-xs text-gray-500">Configure which events send messages to the linked WhatsApp group.</p>
              </div>
              <button
                (click)="loadWaNotificationRules()"
                [disabled]="waRulesLoading()"
                class="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                @if (waRulesLoading()) {
                  <svg class="h-3 w-3 animate-spin inline" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                } @else {
                  Refresh
                }
              </button>
            </div>

            @if (waRulesSaveSuccess()) {
              <div class="mt-3 flex items-center gap-2 rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-700">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clip-rule="evenodd" />
                </svg>
                {{ waRulesSaveSuccess() }}
              </div>
            }
            @if (waRulesSaveError()) {
              <div class="mt-3 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                  <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clip-rule="evenodd" />
                </svg>
                {{ waRulesSaveError() }}
              </div>
            }

            <div class="mt-3 space-y-3">
              @for (rule of waNotificationRules(); track rule.id) {
                <div class="rounded-lg border border-gray-200 bg-gray-50/50 p-3">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-3">
                      <button
                        (click)="toggleWaNotificationRule(rule)"
                        [disabled]="waRulesSaving()"
                        [class]="rule.enabled
                          ? 'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-green-500 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'
                          : 'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent bg-gray-200 transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 disabled:opacity-50'"
                      >
                        <span
                          [class]="rule.enabled
                            ? 'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-4'
                            : 'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out translate-x-0'"
                        ></span>
                      </button>
                      <span class="text-sm font-medium text-gray-900">{{ formatEventType(rule.eventType) }}</span>
                    </div>
                    <div class="flex items-center gap-2">
                      <button
                        (click)="startEditWaRule(rule)"
                        class="text-xs text-brand-600 hover:text-brand-700 font-medium"
                      >Edit</button>
                      <button
                        (click)="testWaRule(rule)"
                        [disabled]="waRulesSaving()"
                        class="text-xs text-gray-500 hover:text-gray-700 font-medium disabled:opacity-50"
                      >Test</button>
                    </div>
                  </div>

                  @if (waRulesEditing() === rule.id) {
                    <div class="mt-3 space-y-3">
                      <div>
                        <label class="block text-xs font-medium text-gray-700">Message Template</label>
                        <textarea
                          [ngModel]="waRulesEditTemplate()"
                          (ngModelChange)="waRulesEditTemplate.set($event)"
                          rows="3"
                          class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                          [placeholder]="waTemplatePlaceholder"
                        ></textarea>
                        <p class="mt-1 text-xs text-gray-500">{{ waTemplateHelp }}</p>
                      </div>
                      <div>
                        <label class="block text-xs font-medium text-gray-700">Target Group JID (optional)</label>
                        <input
                          type="text"
                          [ngModel]="waRulesEditGroupJid()"
                          (ngModelChange)="waRulesEditGroupJid.set($event)"
                          class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                          placeholder="Leave empty to use default group"
                        />
                      </div>
                      <div class="flex items-center gap-2">
                        <button
                          (click)="saveWaRuleEdit(rule.id)"
                          [disabled]="waRulesSaving()"
                          class="inline-flex items-center gap-1 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50 transition-colors"
                        >
                          Save
                        </button>
                        <button
                          (click)="cancelEditWaRule()"
                          class="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  } @else {
                    <p class="mt-2 text-xs text-gray-600 font-mono whitespace-pre-wrap">{{ rule.messageTemplate }}</p>
                    @if (rule.targetGroupJid) {
                      <p class="mt-1 text-xs text-gray-500">Group: {{ rule.targetGroupJid }}</p>
                    }
                  }
                </div>
              } @empty {
                @if (!waRulesLoading()) {
                  <p class="text-sm text-gray-500">No notification rules configured. Click Refresh to load rules.</p>
                }
              }
            </div>
          </div>
        }
      </div>
    </div>
  `,
})
export class WhatsAppIntegrationCardComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastService = inject(IntegrationsToastService);

  readonly waEnabled = signal(false);
  readonly waIncomingRfqEnabled = signal(true);
  readonly waFirstInquiryGroupNotificationEnabled = signal(true);
  readonly waDefaultGroupJid = signal<string | null>(null);
  readonly waGroups = signal<WhatsAppGroup[]>([]);
  readonly waGroupsLoading = signal(false);
  readonly waSaving = signal(false);
  readonly waSaveSuccess = signal('');
  readonly waSaveError = signal('');
  readonly waGroupSearch = signal('');
  readonly waGroupDropdownOpen = signal(false);
  readonly filteredWaGroups = computed(() => {
    const term = this.waGroupSearch().toLowerCase().trim();
    const groups = this.waGroups();
    if (!term) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(term));
  });

  readonly waNotificationRules = signal<WhatsAppNotificationRule[]>([]);
  readonly waRulesLoading = signal(false);
  readonly waRulesSaving = signal(false);
  readonly waRulesSaveSuccess = signal('');
  readonly waRulesSaveError = signal('');
  readonly waRulesEditing = signal<string | null>(null);
  readonly waRulesEditTemplate = signal('');
  readonly waRulesEditGroupJid = signal<string | null>(null);

  readonly waTemplatePlaceholder = 'Use {{variable}} for dynamic values. Use {{#variable}}...{{/variable}} for conditional blocks.';
  readonly waTemplateHelp = 'Available: {{orderNumber}}, {{vesselName}}, {{vesselImo}}, {{portName}}, {{customerName}}, {{supplierName}}, {{companyName}}, {{status}}, {{eta}}, {{etd}}, {{products}}, {{poNumber}}, {{notes}}, {{supplierCount}}, {{suppliers}}, {{sentBy}}, {{traderEmail}}, {{currency}}, {{amount}}. Products: {{productCount}}, {{product1}}, {{product1Qty}}, {{product1Unit}}, {{product2}}… (up to 10). Conditionals: {{#eta}}...{{/eta}}';

  ngOnInit(): void {
    this.loadWhatsAppSettings();
  }

  async loadWhatsAppSettings(): Promise<void> {
    try {
      const waRes = await firstValueFrom(
        this.http.get<ApiResponse<WhatsAppSettings>>(`${API}/admin/settings/whatsapp`),
      );
      if (waRes.success) {
        this.waEnabled.set(waRes.data.enabled);
        this.waIncomingRfqEnabled.set(waRes.data.incomingRfqEnabled !== false);
        this.waFirstInquiryGroupNotificationEnabled.set(waRes.data.firstInquiryGroupNotificationEnabled !== false);
        if (waRes.data.enabled) await this.loadWaGroups();
        this.waDefaultGroupJid.set(waRes.data.defaultGroupJid);
        this.syncWaGroupSearchText();
      }
    } catch (err) {
      console.error('Failed to load WhatsApp settings:', err);
    }
  }

  async toggleWhatsApp(): Promise<void> {
    this.waSaving.set(true);
    this.waSaveSuccess.set('');
    this.waSaveError.set('');
    const enabled = !this.waEnabled();

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<WhatsAppSettings>>(`${API}/admin/settings/whatsapp`, { enabled }),
      );
      if (res.success) {
        this.waEnabled.set(res.data.enabled);
        this.waIncomingRfqEnabled.set(res.data.incomingRfqEnabled !== false);
        this.waFirstInquiryGroupNotificationEnabled.set(res.data.firstInquiryGroupNotificationEnabled !== false);
        this.waDefaultGroupJid.set(res.data.defaultGroupJid);
        this.waSaveSuccess.set(enabled ? 'WhatsApp integration enabled.' : 'WhatsApp integration disabled.');
        if (enabled) this.loadWaGroups();
      }
    } catch (err: any) {
      this.waSaveError.set(err?.error?.error ?? 'Failed to update WhatsApp settings.');
    } finally {
      this.waSaving.set(false);
    }
  }

  async toggleWaIncomingRfq(): Promise<void> {
    this.waSaving.set(true);
    this.waSaveSuccess.set('');
    this.waSaveError.set('');
    const incomingRfqEnabled = !this.waIncomingRfqEnabled();

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<WhatsAppSettings>>(`${API}/admin/settings/whatsapp`, { incomingRfqEnabled }),
      );
      if (res.success) {
        this.waEnabled.set(res.data.enabled);
        this.waIncomingRfqEnabled.set(res.data.incomingRfqEnabled !== false);
        this.waFirstInquiryGroupNotificationEnabled.set(res.data.firstInquiryGroupNotificationEnabled !== false);
        this.waDefaultGroupJid.set(res.data.defaultGroupJid);
        this.waSaveSuccess.set(incomingRfqEnabled ? 'Incoming WhatsApp RFQ parsing enabled.' : 'Incoming WhatsApp RFQ parsing disabled.');
      }
    } catch (err: any) {
      this.waSaveError.set(err?.error?.error ?? 'Failed to update WhatsApp RFQ setting.');
    } finally {
      this.waSaving.set(false);
    }
  }

  async toggleWaFirstInquiryGroupNotification(): Promise<void> {
    this.waSaving.set(true);
    this.waSaveSuccess.set('');
    this.waSaveError.set('');
    const firstInquiryGroupNotificationEnabled = !this.waFirstInquiryGroupNotificationEnabled();

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<WhatsAppSettings>>(`${API}/admin/settings/whatsapp`, {
          firstInquiryGroupNotificationEnabled,
        }),
      );
      if (res.success) {
        this.waEnabled.set(res.data.enabled);
        this.waIncomingRfqEnabled.set(res.data.incomingRfqEnabled !== false);
        this.waFirstInquiryGroupNotificationEnabled.set(res.data.firstInquiryGroupNotificationEnabled !== false);
        this.waDefaultGroupJid.set(res.data.defaultGroupJid);
        this.waSaveSuccess.set(firstInquiryGroupNotificationEnabled
          ? 'First inquiry group sharing enabled.'
          : 'First inquiry group sharing disabled.');
      }
    } catch (err: any) {
      this.waSaveError.set(err?.error?.error ?? 'Failed to update inquiry sharing setting.');
    } finally {
      this.waSaving.set(false);
    }
  }

  async onWaGroupChange(jid: string): Promise<void> {
    this.waSaving.set(true);
    this.waSaveSuccess.set('');
    this.waSaveError.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<WhatsAppSettings>>(`${API}/admin/settings/whatsapp`, {
          defaultGroupJid: jid || null,
        }),
      );
      if (res.success) {
        this.waEnabled.set(res.data.enabled);
        this.waIncomingRfqEnabled.set(res.data.incomingRfqEnabled !== false);
        this.waFirstInquiryGroupNotificationEnabled.set(res.data.firstInquiryGroupNotificationEnabled !== false);
        this.waDefaultGroupJid.set(res.data.defaultGroupJid);
        this.syncWaGroupSearchText();
        this.waSaveSuccess.set('Default group updated.');
      }
    } catch (err: any) {
      this.waSaveError.set(err?.error?.error ?? 'Failed to update default group.');
    } finally {
      this.waSaving.set(false);
    }
  }

  selectWaGroup(jid: string, displayName: string): void {
    this.waGroupDropdownOpen.set(false);
    this.waGroupSearch.set(jid ? displayName : '');
    this.onWaGroupChange(jid);
  }

  clearWaGroupSelection(): void {
    this.waGroupSearch.set('');
    this.waGroupDropdownOpen.set(false);
    this.onWaGroupChange('');
  }

  syncWaGroupSearchText(): void {
    const jid = this.waDefaultGroupJid();
    if (!jid) {
      this.waGroupSearch.set('');
      return;
    }
    const g = this.waGroups().find((x) => x.jid === jid);
    this.waGroupSearch.set(g ? `${g.name} (${g.participants})` : '');
  }

  async loadWaGroups(): Promise<void> {
    this.waGroupsLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<WhatsAppGroup[]>>(`${API}/whatsapp/groups`),
      );
      if (res.success) this.waGroups.set(res.data);
    } catch (err) {
      console.error('Failed to load WhatsApp groups:', err);
    } finally {
      this.waGroupsLoading.set(false);
    }
  }

  async loadWaNotificationRules(): Promise<void> {
    this.waRulesLoading.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<WhatsAppNotificationRule[]>>(
          `${API}/admin/settings/whatsapp/notification-rules`,
        ),
      );
      if (res.success) this.waNotificationRules.set(res.data);
    } catch (err) {
      console.error('Failed to load WhatsApp notification rules:', err);
    } finally {
      this.waRulesLoading.set(false);
    }
  }

  async toggleWaNotificationRule(rule: WhatsAppNotificationRule): Promise<void> {
    this.waRulesSaving.set(true);
    this.waRulesSaveSuccess.set('');
    this.waRulesSaveError.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<WhatsAppNotificationRule>>(
          `${API}/admin/settings/whatsapp/notification-rules/${rule.id}`,
          { enabled: !rule.enabled },
        ),
      );
      if (res.success) {
        this.waNotificationRules.update((rules) =>
          rules.map((r) => (r.id === rule.id ? { ...r, enabled: res.data.enabled } : r)),
        );
        this.waRulesSaveSuccess.set(`${this.formatEventType(rule.eventType)} ${res.data.enabled ? 'enabled' : 'disabled'}.`);
      }
    } catch (err: any) {
      this.waRulesSaveError.set(err?.error?.message ?? 'Failed to update rule.');
    } finally {
      this.waRulesSaving.set(false);
    }
  }

  startEditWaRule(rule: WhatsAppNotificationRule): void {
    this.waRulesEditing.set(rule.id);
    this.waRulesEditTemplate.set(rule.messageTemplate);
    this.waRulesEditGroupJid.set(rule.targetGroupJid);
  }

  cancelEditWaRule(): void {
    this.waRulesEditing.set(null);
    this.waRulesEditTemplate.set('');
    this.waRulesEditGroupJid.set(null);
  }

  async saveWaRuleEdit(ruleId: string): Promise<void> {
    this.waRulesSaving.set(true);
    this.waRulesSaveSuccess.set('');
    this.waRulesSaveError.set('');

    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<WhatsAppNotificationRule>>(
          `${API}/admin/settings/whatsapp/notification-rules/${ruleId}`,
          {
            messageTemplate: this.waRulesEditTemplate(),
            targetGroupJid: this.waRulesEditGroupJid(),
          },
        ),
      );
      if (res.success) {
        this.waNotificationRules.update((rules) =>
          rules.map((r) => (r.id === ruleId ? { ...r, messageTemplate: res.data.messageTemplate, targetGroupJid: res.data.targetGroupJid } : r)),
        );
        this.waRulesSaveSuccess.set('Rule updated successfully.');
        this.cancelEditWaRule();
      }
    } catch (err: any) {
      this.waRulesSaveError.set(err?.error?.message ?? 'Failed to save rule.');
    } finally {
      this.waRulesSaving.set(false);
    }
  }

  async testWaRule(rule: WhatsAppNotificationRule): Promise<void> {
    this.waRulesSaveSuccess.set('');
    this.waRulesSaveError.set('');

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<{ sent: boolean }>>(
          `${API}/admin/settings/whatsapp/notification-rules/${rule.id}/test`,
          {},
        ),
      );
      if (res.success && res.data.sent) {
        this.waRulesSaveSuccess.set(`Test message sent for ${this.formatEventType(rule.eventType)}.`);
      } else {
        this.waRulesSaveError.set(res.message ?? 'Test message failed to send.');
      }
    } catch (err: any) {
      this.waRulesSaveError.set(err?.error?.message ?? 'Failed to send test message.');
    }
  }

  formatEventType(eventType: string): string {
    return eventType
      .split('_')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
