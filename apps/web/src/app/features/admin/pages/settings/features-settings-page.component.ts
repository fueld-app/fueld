import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';
import { API } from '@app/core/config/api';
import { SettingsToastService } from './settings-toast.service';
import { BrokerDealService } from '@app/core/services/broker-deal.service';
import { ThroughputReportService } from '@app/core/services/throughput-report.service';

@Component({
  selector: 'app-features-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div>
      <div class="mb-6">
        <h1 class="text-2xl font-bold text-gray-900 dark:text-ink">Feature Toggles</h1>
        <p class="mt-1 text-sm text-gray-500 dark:text-muted">
          Enable or disable optional features for your workspace.
        </p>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-12">
          <svg class="h-8 w-8 animate-spin text-brand-600 dark:text-brand-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <div class="space-y-6 max-w-2xl">

          <!-- Photo Gallery -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">📸 Photo Gallery</h3>
                <p class="mt-1 text-xs text-gray-500 dark:text-muted">
                  Upload categorized photos to orders and view them in a gallery on the order detail page.
                </p>
              </div>
              <label class="flex items-center gap-2 cursor-pointer ml-4">
                <input
                  type="checkbox"
                  [ngModel]="photoGalleryEnabled()"
                  (ngModelChange)="photoGalleryEnabled.set($event)"
                  class="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">
                  {{ photoGalleryEnabled() ? 'Enabled' : 'Disabled' }}
                </span>
              </label>
            </div>

            @if (photoGalleryEnabled()) {
              <div class="mt-4 space-y-3 border-t border-gray-100 dark:border-line pt-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Photo Categories</label>
                  <input
                    type="text"
                    [ngModel]="photoCategoriesStr()"
                    (ngModelChange)="photoCategoriesStr.set($event)"
                    placeholder="BEFORE, AFTER, TANK_SEAL, OTHER"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  />
                  <p class="mt-1 text-xs text-gray-400 dark:text-muted">Comma-separated list of category names</p>
                </div>
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Max File Size (MB)</label>
                  <input
                    type="number"
                    [ngModel]="photoMaxFileSizeMb()"
                    (ngModelChange)="photoMaxFileSizeMb.set(+$event)"
                    class="w-24 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  />
                </div>
              </div>
            }
          </div>

          <!-- Throughput Report -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">📊 Throughput / Sales Report</h3>
                <p class="mt-1 text-xs text-gray-500 dark:text-muted">
                  Report showing product/service volumes by time period with Excel export. Replaces manual spreadsheets.
                </p>
              </div>
              <label class="flex items-center gap-2 cursor-pointer ml-4">
                <input
                  type="checkbox"
                  [ngModel]="throughputEnabled()"
                  (ngModelChange)="throughputEnabled.set($event)"
                  class="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">
                  {{ throughputEnabled() ? 'Enabled' : 'Disabled' }}
                </span>
              </label>
            </div>

            @if (throughputEnabled()) {
              <div class="mt-4 space-y-3 border-t border-gray-100 dark:border-line pt-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Default Unit</label>
                  <input
                    type="text"
                    [ngModel]="throughputDefaultUnit()"
                    (ngModelChange)="throughputDefaultUnit.set($event)"
                    class="w-40 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  />
                </div>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    [ngModel]="throughputGroupByCategory()"
                    (ngModelChange)="throughputGroupByCategory.set($event)"
                    class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span class="text-sm text-gray-700 dark:text-ink-dim">Group results by order category</span>
                </label>
              </div>
            }
          </div>

          <!-- Comments Digest -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">📧 Daily Comments Digest</h3>
                <p class="mt-1 text-xs text-gray-500 dark:text-muted">
                  Daily email with full activity rundown (comments + status changes) sent to all team members.
                </p>
              </div>
              <label class="flex items-center gap-2 cursor-pointer ml-4">
                <input
                  type="checkbox"
                  [ngModel]="digestEnabled()"
                  (ngModelChange)="digestEnabled.set($event)"
                  class="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">
                  {{ digestEnabled() ? 'Enabled' : 'Disabled' }}
                </span>
              </label>
            </div>

            @if (digestEnabled()) {
              <div class="mt-4 space-y-3 border-t border-gray-100 dark:border-line pt-4">
                <div class="flex items-center gap-4">
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Send Time (UTC hour)</label>
                    <input
                      type="number"
                      [ngModel]="digestHourUtc()"
                      (ngModelChange)="digestHourUtc.set(+$event)"
                      min="0"
                      max="23"
                      class="w-20 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                    />
                    <span class="ml-2 text-xs text-gray-400 dark:text-muted">{{ digestHourUtc() }}:00 UTC</span>
                  </div>
                </div>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    [ngModel]="digestIncludeActivityLog()"
                    (ngModelChange)="digestIncludeActivityLog.set($event)"
                    class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                  />
                  <span class="text-sm text-gray-700 dark:text-ink-dim">Include activity log (status changes + updates)</span>
                </label>
                <button
                  type="button"
                  (click)="previewDigest()"
                  [disabled]="digestPreviewing()"
                  class="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 transition-colors inline-flex items-center gap-1.5"
                >
                  @if (digestPreviewing()) {
                    <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Loading preview…
                  } @else {
                    Preview Digest
                  }
                </button>
              </div>
            }
          </div>

          <!-- Daily Pricing Email -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <div class="flex items-start justify-between">
              <div>
                <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">⛽ Daily Pricing Email</h3>
                <p class="mt-1 text-xs text-gray-500 dark:text-muted">
                  Daily email with posted fuel prices ($/Gallon) sent to external client contacts.
                </p>
              </div>
              <label class="flex items-center gap-2 cursor-pointer ml-4">
                <input
                  type="checkbox"
                  [ngModel]="pricingEnabled()"
                  (ngModelChange)="pricingEnabled.set($event)"
                  class="h-5 w-5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span class="text-sm font-medium text-gray-700 dark:text-ink-dim">
                  {{ pricingEnabled() ? 'Enabled' : 'Disabled' }}
                </span>
              </label>
            </div>

            @if (pricingEnabled()) {
              <div class="mt-4 space-y-4 border-t border-gray-100 dark:border-line pt-4">
                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Dock / Location</label>
                  <input
                    type="text"
                    [ngModel]="pricingPlaceName()"
                    (ngModelChange)="pricingPlaceName.set($event)"
                    placeholder="e.g. CMF Fuel Dock"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  />
                  <p class="mt-1 text-xs text-gray-400 dark:text-muted">Enter the place name — must match a place in the system</p>
                </div>

                <div class="flex items-center gap-4">
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Send Time (UTC hour)</label>
                    <input
                      type="number"
                      [ngModel]="pricingHourUtc()"
                      (ngModelChange)="pricingHourUtc.set(+$event)"
                      min="0"
                      max="23"
                      class="w-20 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                    />
                    <span class="ml-2 text-xs text-gray-400 dark:text-muted">{{ pricingHourUtc() }}:00 UTC</span>
                  </div>
                  <div>
                    <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Lookback (hours)</label>
                    <input
                      type="number"
                      [ngModel]="pricingLookbackHours()"
                      (ngModelChange)="pricingLookbackHours.set(+$event)"
                      min="1"
                      max="168"
                      class="w-20 rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Email Subject</label>
                  <input
                    type="text"
                    [ngModel]="pricingEmailSubject()"
                    (ngModelChange)="pricingEmailSubject.set($event)"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  />
                </div>

                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Recipient Contacts (from system)</label>
                  @if (customerContacts().length === 0) {
                    <p class="text-xs text-gray-400 dark:text-muted italic">No customer contacts with email addresses found.</p>
                  } @else {
                    <div class="max-h-40 overflow-y-auto rounded-lg border border-gray-200 dark:border-line p-2 space-y-1">
                      @for (contact of customerContacts(); track contact.id) {
                        <label class="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            [checked]="pricingRecipientContactIds().includes(contact.id)"
                            (change)="togglePricingContact(contact.id)"
                            class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                          />
                          <span class="text-sm text-gray-700 dark:text-ink-dim">
                            {{ contact.name }} — {{ contact.companyName }}
                            <span class="text-xs text-gray-400 dark:text-muted">({{ contact.email }})</span>
                          </span>
                        </label>
                      }
                    </div>
                  }
                </div>

                <div>
                  <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Extra Emails (comma-separated)</label>
                  <input
                    type="text"
                    [ngModel]="pricingExtraEmails()"
                    (ngModelChange)="pricingExtraEmails.set($event)"
                    placeholder="extra@example.com, another@example.com"
                    class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                  />
                </div>

                <button
                  type="button"
                  (click)="previewPricing()"
                  [disabled]="pricingPreviewing()"
                  class="text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 transition-colors inline-flex items-center gap-1.5"
                >
                  @if (pricingPreviewing()) {
                    <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                      <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                    </svg>
                    Loading preview…
                  } @else {
                    Preview Pricing Email
                  }
                </button>
              </div>
            }
          </div>

          <!-- QuickBooks Integration -->
          <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
            <h3 class="text-sm font-semibold text-gray-900 dark:text-ink">🔗 QuickBooks Integration</h3>
            <p class="mt-1 text-xs text-gray-500 dark:text-muted">
              Map FUELD products to QuickBooks Items and notify Kathy when invoices are pushed.
            </p>

            <div class="mt-4 space-y-4 border-t border-gray-100 dark:border-line pt-4">
              <div>
                <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-1">Notification Email</label>
                <input
                  type="email"
                  [ngModel]="qbNotifyEmail()"
                  (ngModelChange)="qbNotifyEmail.set($event)"
                  placeholder="backoffice@channeltx.com"
                  class="w-full rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                />
                <p class="mt-1 text-xs text-gray-400 dark:text-muted">Sent when an invoice is pushed to QuickBooks</p>
              </div>

              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  [ngModel]="qbAutoSync()"
                  (ngModelChange)="qbAutoSync.set($event)"
                  class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span class="text-sm text-gray-700 dark:text-ink-dim">Auto-sync invoices to QuickBooks on creation (otherwise use manual Sync button)</span>
              </label>

              <div>
                <label class="block text-xs font-medium text-gray-500 dark:text-muted mb-2">Product Mappings (FUELD → QuickBooks)</label>
                @if (qbItems().length === 0) {
                  <p class="text-xs text-gray-400 dark:text-muted italic">Connect QuickBooks first to load available Items/Services.</p>
                } @else {
                  <div class="max-h-60 overflow-y-auto rounded-lg border border-gray-200 dark:border-line">
                    <table class="w-full text-sm">
                      <thead>
                        <tr class="border-b border-gray-100 dark:border-line bg-gray-50 dark:bg-surface-2 sticky top-0">
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-muted">FUELD Product</th>
                          <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-muted">QuickBooks Item</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-gray-50 dark:divide-line">
                        @for (product of configuredProducts(); track product) {
                          <tr>
                            <td class="px-3 py-2 text-gray-700 dark:text-ink-dim">{{ product }}</td>
                            <td class="px-3 py-2">
                              <select
                                [ngModel]="getMappedItemId(product)"
                                (ngModelChange)="updateProductMapping(product, $event)"
                                class="w-full rounded-md border border-gray-300 dark:border-line-strong px-2 py-1 text-xs focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface"
                              >
                                <option value="">— Not mapped —</option>
                                @for (item of qbItems(); track item.id) {
                                  <option [value]="item.id">{{ item.name }}</option>
                                }
                              </select>
                            </td>
                          </tr>
                        }
                      </tbody>
                    </table>
                  </div>
                }
              </div>
            </div>
          </div>

          <!-- Save button -->
          <div class="flex justify-end">
            <button
              (click)="save()"
              [disabled]="saving()"
              class="rounded-lg bg-brand-700 px-5 py-2.5 text-sm font-medium text-white hover:bg-brand-800 disabled:opacity-50 inline-flex items-center gap-2"
            >
              @if (saving()) {
                <svg class="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                </svg>
                Saving…
              } @else {
                Save Settings
              }
            </button>
          </div>
        </div>
      }
    </div>
  `,
})
export class FeaturesSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly toastSvc = inject(SettingsToastService);
  private readonly brokerDealSvc = inject(BrokerDealService);
  private readonly throughputReportSvc = inject(ThroughputReportService);

  readonly loading = signal(true);
  readonly saving = signal(false);

  // Photo Gallery settings
  readonly photoGalleryEnabled = signal(false);
  readonly photoCategoriesStr = signal('BEFORE, AFTER, TANK_SEAL, OTHER');
  readonly photoMaxFileSizeMb = signal(10);

  // Throughput Report settings
  readonly throughputEnabled = signal(false);
  readonly throughputDefaultUnit = signal('Gallons');
  readonly throughputGroupByCategory = signal(false);

  // Comments Digest settings
  readonly digestEnabled = signal(false);
  readonly digestHourUtc = signal(10);
  readonly digestIncludeActivityLog = signal(true);
  readonly digestPreviewing = signal(false);
  readonly digestPreviewHtml = signal('');

  // Daily Pricing Email settings
  readonly pricingEnabled = signal(false);
  readonly pricingPlaceId = signal<string | null>(null);
  readonly pricingPlaceName = signal<string | null>(null);
  readonly pricingHourUtc = signal(13);
  readonly pricingRecipientContactIds = signal<string[]>([]);
  readonly pricingExtraEmails = signal('');
  readonly pricingLookbackHours = signal(24);
  readonly pricingEmailSubject = signal('CMF Fuel Dock — Posted Prices');
  readonly pricingPreviewing = signal(false);
  readonly customerContacts = signal<Array<{ id: string; name: string; email: string | null; companyName: string }>>([]);

  // QuickBooks settings
  readonly qbNotifyEmail = signal('');
  readonly qbAutoSync = signal(false);
  readonly qbProductMappings = signal<Array<{ productType: string; qbItemId: string; qbItemName: string }>>([]);
  readonly qbItems = signal<Array<{ id: string; name: string; type: string }>>([]);
  readonly configuredProducts = signal<string[]>([]);

  ngOnInit(): void {
    this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [photoRes, throughputRes, digestRes, pricingRes, contactsRes, qbRes, productsRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<{
          enabled: boolean; photoCategories: string[]; maxFileSizeMb: number;
        }>>(`${API}/admin/settings/my-photo-gallery-settings`)),
        firstValueFrom(this.http.get<ApiResponse<{
          enabled: boolean; defaultUnit: string; groupByCategory: boolean;
        }>>(`${API}/admin/settings/my-throughput-report-settings`)),
        firstValueFrom(this.http.get<ApiResponse<{
          enabled: boolean; hourUtc: number; includeActivityLog: boolean; recipientRoles: string[]; extraEmails: string[]; entityTypes: string[];
        }>>(`${API}/admin/settings/my-comments-digest-settings`)),
        firstValueFrom(this.http.get<ApiResponse<{
          enabled: boolean; placeId: string | null; placeName: string | null; hourUtc: number; recipientContactIds: string[]; extraEmails: string[]; lookbackHours: number; emailSubject: string;
        }>>(`${API}/admin/settings/my-daily-pricing-settings`)),
        firstValueFrom(this.http.get<ApiResponse<{ id: string; name: string; email: string | null; companyName: string }[]>>(`${API}/admin/settings/daily-pricing-contacts`)),
        firstValueFrom(this.http.get<ApiResponse<{ notifyEmail: string; autoSyncInvoices: boolean; productMappings: { productType: string; qbItemId: string; qbItemName: string }[] }>>(`${API}/admin/settings/my-quickbooks-settings`)),
        firstValueFrom(this.http.get<ApiResponse<{ products: string[] }>>(`${API}/admin/settings/my-products`)),
      ]);

      // Try to load QB items (may fail if QB not connected)
      try {
        const qbItemsRes = await firstValueFrom(this.http.get<ApiResponse<{ id: string; name: string; type: string }[]>>(`${API}/admin/settings/quickbooks-items`));
        if (qbItemsRes.success && qbItemsRes.data) {
          this.qbItems.set(qbItemsRes.data);
        }
      } catch {
        // QB not connected — items list will be empty
      }

      if (photoRes.success && photoRes.data) {
        this.photoGalleryEnabled.set(photoRes.data.enabled);
        this.photoCategoriesStr.set(photoRes.data.photoCategories.join(', '));
        this.photoMaxFileSizeMb.set(photoRes.data.maxFileSizeMb);
      }
      if (throughputRes.success && throughputRes.data) {
        this.throughputEnabled.set(throughputRes.data.enabled);
        this.throughputDefaultUnit.set(throughputRes.data.defaultUnit);
        this.throughputGroupByCategory.set(throughputRes.data.groupByCategory);
      }
      if (digestRes.success && digestRes.data) {
        this.digestEnabled.set(digestRes.data.enabled);
        this.digestHourUtc.set(digestRes.data.hourUtc);
        this.digestIncludeActivityLog.set(digestRes.data.includeActivityLog);
      }
      if (pricingRes.success && pricingRes.data) {
        this.pricingEnabled.set(pricingRes.data.enabled);
        this.pricingPlaceId.set(pricingRes.data.placeId);
        this.pricingPlaceName.set(pricingRes.data.placeName);
        this.pricingHourUtc.set(pricingRes.data.hourUtc);
        this.pricingRecipientContactIds.set(pricingRes.data.recipientContactIds);
        this.pricingExtraEmails.set((pricingRes.data.extraEmails ?? []).join(', '));
        this.pricingLookbackHours.set(pricingRes.data.lookbackHours);
        this.pricingEmailSubject.set(pricingRes.data.emailSubject);
      }
      if (contactsRes.success && contactsRes.data) {
        this.customerContacts.set(contactsRes.data);
      }
      if (qbRes.success && qbRes.data) {
        this.qbNotifyEmail.set(qbRes.data.notifyEmail ?? '');
        this.qbAutoSync.set(qbRes.data.autoSyncInvoices ?? false);
        this.qbProductMappings.set(qbRes.data.productMappings ?? []);
      }
      if (productsRes.success && productsRes.data) {
        this.configuredProducts.set(productsRes.data.products ?? []);
      }
    } catch {
      this.toastSvc.show('error', 'Failed to load feature settings.');
    } finally {
      this.loading.set(false);
    }
  }

  async save(): Promise<void> {
    this.saving.set(true);
    try {
      const photoCategories = this.photoCategoriesStr()
        .split(',')
        .map((c) => c.trim().toUpperCase())
        .filter((c) => c.length > 0);

      const [photoRes, throughputRes, digestRes, pricingRes, qbRes] = await Promise.all([
        firstValueFrom(this.http.put<ApiResponse<unknown>>(`${API}/admin/settings/photo-gallery`, {
          enabled: this.photoGalleryEnabled(),
          photoCategories: photoCategories.length ? photoCategories : ['BEFORE', 'AFTER', 'TANK_SEAL', 'OTHER'],
          maxFileSizeMb: this.photoMaxFileSizeMb(),
        })),
        firstValueFrom(this.http.put<ApiResponse<unknown>>(`${API}/admin/settings/throughput-report`, {
          enabled: this.throughputEnabled(),
          defaultUnit: this.throughputDefaultUnit(),
          groupByCategory: this.throughputGroupByCategory(),
        })),
        firstValueFrom(this.http.put<ApiResponse<unknown>>(`${API}/admin/settings/comments-digest`, {
          enabled: this.digestEnabled(),
          hourUtc: this.digestHourUtc(),
          recipientRoles: ['ADMIN', 'TRADER', 'TEAMLEAD', 'OPERATIONSMANAGER', 'FINANCE', 'CREDITMANAGER', 'LIGHT'],
          extraEmails: [],
          includeActivityLog: this.digestIncludeActivityLog(),
          entityTypes: [],
        })),
        firstValueFrom(this.http.put<ApiResponse<unknown>>(`${API}/admin/settings/daily-pricing`, {
          enabled: this.pricingEnabled(),
          placeId: this.pricingPlaceId(),
          hourUtc: this.pricingHourUtc(),
          recipientContactIds: this.pricingRecipientContactIds(),
          extraEmails: this.pricingExtraEmails().split(',').map((e) => e.trim()).filter(Boolean),
          lookbackHours: this.pricingLookbackHours(),
          emailSubject: this.pricingEmailSubject(),
        })),
        firstValueFrom(this.http.put<ApiResponse<unknown>>(`${API}/admin/settings/quickbooks-settings`, {
          notifyEmail: this.qbNotifyEmail(),
          autoSyncInvoices: this.qbAutoSync(),
          productMappings: this.qbProductMappings(),
        })),
      ]);

      if (photoRes.success && throughputRes.success && digestRes.success && pricingRes.success && qbRes.success) {
        this.toastSvc.show('success', 'Feature settings saved.');
        // Invalidate cached services so nav menu updates
        this.brokerDealSvc.invalidateCache();
        void this.brokerDealSvc.load();
        this.throughputReportSvc.invalidateCache();
        void this.throughputReportSvc.load();
      } else {
        this.toastSvc.show('error', 'Failed to save some settings.');
      }
    } catch {
      this.toastSvc.show('error', 'Failed to save feature settings.');
    } finally {
      this.saving.set(false);
    }
  }

  async previewDigest(): Promise<void> {
    this.digestPreviewing.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ html: string; entryCount: number; orderCount: number }>>(`${API}/reports/comments-digest/preview`),
      );
      if (res.success && res.data) {
        // Open preview in a new window
        const w = window.open('', '_blank', 'width=700,height=800');
        if (w) {
          w.document.write(res.data.html);
          w.document.close();
        } else {
          this.toastSvc.show('error', 'Popup blocked. Allow popups to preview the digest.');
        }
      } else {
        this.toastSvc.show('error', 'Failed to generate preview.');
      }
    } catch {
      this.toastSvc.show('error', 'Failed to generate preview.');
    } finally {
      this.digestPreviewing.set(false);
    }
  }

  togglePricingContact(contactId: string): void {
    this.pricingRecipientContactIds.update((ids) => {
      if (ids.includes(contactId)) {
        return ids.filter((id) => id !== contactId);
      }
      return [...ids, contactId];
    });
  }

  updateProductMapping(productType: string, qbItemId: string): void {
    const qbItem = this.qbItems().find((i) => i.id === qbItemId);
    this.qbProductMappings.update((mappings) => {
      const existing = mappings.find((m) => m.productType === productType);
      if (existing) {
        return mappings.map((m) =>
          m.productType === productType
            ? { ...m, qbItemId, qbItemName: qbItem?.name ?? '' }
            : m,
        );
      }
      return [...mappings, { productType, qbItemId, qbItemName: qbItem?.name ?? '' }];
    });
  }

  getMappedItemId(productType: string): string {
    return this.qbProductMappings().find((m) => m.productType === productType)?.qbItemId ?? '';
  }

  async previewPricing(): Promise<void> {
    this.pricingPreviewing.set(true);
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ html: string; priceCount: number; recipientCount: number }>>(`${API}/reports/daily-pricing/preview`),
      );
      if (res.success && res.data) {
        const w = window.open('', '_blank', 'width=700,height=800');
        if (w) {
          w.document.write(res.data.html);
          w.document.close();
        } else {
          this.toastSvc.show('error', 'Popup blocked. Allow popups to preview the pricing email.');
        }
      } else {
        this.toastSvc.show('error', 'Failed to generate preview.');
      }
    } catch {
      this.toastSvc.show('error', 'Failed to generate preview.');
    } finally {
      this.pricingPreviewing.set(false);
    }
  }
}