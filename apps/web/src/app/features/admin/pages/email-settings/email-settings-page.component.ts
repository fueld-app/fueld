import {
  Component,
  ChangeDetectionStrategy,
  signal,
  inject,
  type OnInit,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, OwnCompanyDto } from '@fueld/types';
import { API } from '@app/core/config/api';

// ═══════════════════════════════════════════════════════════════════════
//  Admin  ›  Email Settings  —  Templates & CC/BCC Rules
// ═══════════════════════════════════════════════════════════════════════

type DocumentType = 'OFFER' | 'CONFIRMATION' | 'NOMINATION' | 'PROFORMA' | 'INVOICE';

interface EmailTemplate {
  id: string;
  documentType: DocumentType;
  subjectTemplate: string;
  bodyTemplate: string;
}

interface EmailRule {
  id: string;
  ownCompanyId: string | null;
  documentType: DocumentType | null;
  ruleType: 'CC' | 'BCC';
  email: string;
  label: string | null;
}

interface TemplateVariable {
  key: string;
  label: string;
  example: string;
}

const DOC_TYPES: DocumentType[] = ['OFFER', 'CONFIRMATION', 'NOMINATION', 'PROFORMA', 'INVOICE'];

const DOC_LABELS: Record<DocumentType, string> = {
  OFFER: 'Offer',
  CONFIRMATION: 'Confirmation',
  NOMINATION: 'Nomination',
  PROFORMA: 'Proforma Invoice',
  INVOICE: 'Invoice',
};

@Component({
  selector: 'app-email-settings-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="space-y-8">
      <!-- Page header -->
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Email Settings</h1>
        <p class="mt-1 text-sm text-gray-500">Configure email templates and default CC/BCC rules for outgoing documents.</p>
      </div>

      @if (loading()) {
        <div class="flex items-center justify-center py-20">
          <svg class="h-8 w-8 animate-spin text-brand-600" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else {
        <!-- ═══════════════ Email Templates ═══════════════ -->

        <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div class="border-b border-gray-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-gray-900">Email Templates</h2>
            <p class="mt-0.5 text-sm text-gray-500">
              Define default subject line and body for each document type. Use
              <code class="rounded bg-gray-100 px-1 py-0.5 text-xs font-mono text-brand-700" [textContent]="lbrace + lbrace + 'variable' + rbrace + rbrace"></code>
              placeholders.
            </p>
          </div>

          <!-- Template variables reference -->
          <div class="border-b border-gray-100 bg-gray-50/70 px-6 py-3">
            <details>
              <summary class="cursor-pointer text-sm font-medium text-gray-600 select-none">
                Available template variables
              </summary>
              <div class="mt-2 grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
                @for (v of templateVariables(); track v.key) {
                  <div class="flex items-baseline gap-2">
                    <code class="font-mono text-xs text-brand-700 shrink-0" [textContent]="wrapVar(v.key)"></code>
                    <span class="text-gray-400 text-xs truncate">{{ v.label }}</span>
                  </div>
                }
              </div>
            </details>
          </div>

          <!-- One section per document type -->
          @for (docType of docTypes; track docType) {
            <div class="border-b border-gray-100 last:border-b-0">
              <div class="px-6 py-4">
                <div class="flex items-center justify-between mb-3">
                  <h3 class="text-sm font-semibold text-gray-800">{{ docLabels[docType] }}</h3>
                  @if (getTemplate(docType)) {
                    <button
                      type="button"
                      (click)="deleteTemplate(docType)"
                      class="text-xs text-red-500 hover:text-red-700 font-medium"
                    >
                      Remove template
                    </button>
                  }
                </div>

                <div class="space-y-3">
                  <!-- Subject -->
                  <div>
                    <label class="block text-xs font-medium text-gray-500 mb-1">Subject template</label>
                    <input
                      type="text"
                      [ngModel]="getSubject(docType)"
                      (ngModelChange)="setSubject(docType, $event)"
                      [placeholder]="'e.g. ' + '{{' + 'documentLabel' + '}}' + ' — ' + '{{' + 'vesselName' + '}}' + ' — ' + '{{' + 'portName' + '}}'"
                      class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm
                             placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                             focus:ring-2 focus:ring-brand-500/20"
                    />
                  </div>

                  <!-- Body -->
                  <div>
                    <label class="block text-xs font-medium text-gray-500 mb-1">Body template (HTML)</label>
                    <textarea
                      [ngModel]="getBody(docType)"
                      (ngModelChange)="setBody(docType, $event)"
                      rows="5"
                      [placeholder]="'<p>Dear Customer,</p><p>Please find attached the ' + '{{' + 'documentLabel' + '}}' + ' for ' + '{{' + 'vesselName' + '}}' + ' at ' + '{{' + 'portName' + '}}' + '.</p>'"
                      class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm font-mono
                             placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                             focus:ring-2 focus:ring-brand-500/20"
                    ></textarea>
                  </div>

                  <!-- Save button per template -->
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      (click)="saveTemplate(docType)"
                      [disabled]="savingTemplate() === docType"
                      class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm
                             font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
                    >
                      @if (savingTemplate() === docType) {
                        <svg class="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                        </svg>
                      }
                      Save
                    </button>
                    @if (savedTemplate() === docType) {
                      <span class="text-xs text-green-600 font-medium">✓ Saved</span>
                    }
                  </div>
                </div>
              </div>
            </div>
          }
        </div>

        <!-- ═══════════════ CC / BCC Rules ═══════════════ -->

        <div class="rounded-xl border border-gray-200 bg-white shadow-sm">
          <div class="border-b border-gray-200 px-6 py-4">
            <h2 class="text-lg font-semibold text-gray-900">Default CC / BCC Rules</h2>
            <p class="mt-0.5 text-sm text-gray-500">
              Automatically add CC or BCC recipients when sending emails. Rules can be scoped
              to a specific own company and/or document type, or apply globally.
            </p>
          </div>

          <!-- Existing rules table -->
          <div class="overflow-x-auto">
            <table class="w-full text-sm text-left">
              <thead class="bg-gray-50 text-xs text-gray-500 uppercase tracking-wider">
                <tr>
                  <th class="px-6 py-3">Type</th>
                  <th class="px-6 py-3">Email</th>
                  <th class="px-6 py-3">Label</th>
                  <th class="px-6 py-3">Own Company</th>
                  <th class="px-6 py-3">Document Type</th>
                  <th class="px-6 py-3"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-gray-100">
                @for (rule of rules(); track rule.id) {
                  <tr class="hover:bg-gray-50/50">
                    <td class="px-6 py-3">
                      <span
                        class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        [class]="rule.ruleType === 'CC'
                          ? 'bg-blue-50 text-blue-700'
                          : 'bg-amber-50 text-amber-700'"
                      >
                        {{ rule.ruleType }}
                      </span>
                    </td>
                    <td class="px-6 py-3 font-mono text-xs">{{ rule.email }}</td>
                    <td class="px-6 py-3 text-gray-500">{{ rule.label || '—' }}</td>
                    <td class="px-6 py-3 text-gray-500">{{ getCompanyName(rule.ownCompanyId) }}</td>
                    <td class="px-6 py-3 text-gray-500">{{ rule.documentType ? docLabels[rule.documentType] : 'All' }}</td>
                    <td class="px-6 py-3 text-right">
                      <button
                        type="button"
                        (click)="deleteRule(rule.id)"
                        class="text-red-400 hover:text-red-600"
                        title="Delete rule"
                      >
                        <svg class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd" />
                        </svg>
                      </button>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="6" class="px-6 py-8 text-center text-gray-400">
                      No rules configured yet. Add one below.
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>

          <!-- Add new rule -->
          <div class="border-t border-gray-200 bg-gray-50/50 px-6 py-4">
            <h3 class="text-sm font-medium text-gray-700 mb-3">Add rule</h3>
            <div class="flex flex-wrap items-end gap-3">
              <!-- Rule type -->
              <div>
                <label class="block text-xs font-medium text-gray-500 mb-1">Type</label>
                <select
                  [(ngModel)]="newRule.ruleType"
                  class="rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm
                         focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="CC">CC</option>
                  <option value="BCC">BCC</option>
                </select>
              </div>

              <!-- Email -->
              <div class="flex-1 min-w-[200px]">
                <label class="block text-xs font-medium text-gray-500 mb-1">Email</label>
                <input
                  type="email"
                  [(ngModel)]="newRule.email"
                  placeholder="person@example.com"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm
                         placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                         focus:ring-2 focus:ring-brand-500/20"
                />
              </div>

              <!-- Label -->
              <div class="min-w-[150px]">
                <label class="block text-xs font-medium text-gray-500 mb-1">Label <span class="text-gray-400">(optional)</span></label>
                <input
                  type="text"
                  [(ngModel)]="newRule.label"
                  placeholder="e.g. Finance"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm
                         placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
                         focus:ring-2 focus:ring-brand-500/20"
                />
              </div>

              <!-- Own Company -->
              <div class="min-w-[180px]">
                <label class="block text-xs font-medium text-gray-500 mb-1">Own Company <span class="text-gray-400">(optional)</span></label>
                <select
                  [(ngModel)]="newRule.ownCompanyId"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm
                         focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">All companies</option>
                  @for (c of ownCompanies(); track c.id) {
                    <option [value]="c.id">{{ c.name }}</option>
                  }
                </select>
              </div>

              <!-- Document Type -->
              <div class="min-w-[160px]">
                <label class="block text-xs font-medium text-gray-500 mb-1">Document Type <span class="text-gray-400">(optional)</span></label>
                <select
                  [(ngModel)]="newRule.documentType"
                  class="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm
                         focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  <option value="">All types</option>
                  @for (dt of docTypes; track dt) {
                    <option [value]="dt">{{ docLabels[dt] }}</option>
                  }
                </select>
              </div>

              <!-- Add button -->
              <button
                type="button"
                (click)="addRule()"
                [disabled]="addingRule() || !newRule.email"
                class="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm
                       font-medium text-white shadow-sm hover:bg-brand-700 disabled:opacity-50 transition-colors"
              >
                @if (addingRule()) {
                  <svg class="h-3.5 w-3.5 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                  </svg>
                }
                Add Rule
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class EmailSettingsPageComponent implements OnInit {
  private readonly http = inject(HttpClient);

  // ── State ──
  readonly loading = signal(true);
  readonly templates = signal<EmailTemplate[]>([]);
  readonly rules = signal<EmailRule[]>([]);
  readonly ownCompanies = signal<OwnCompanyDto[]>([]);
  readonly templateVariables = signal<TemplateVariable[]>([]);
  readonly savingTemplate = signal<DocumentType | null>(null);
  readonly savedTemplate = signal<DocumentType | null>(null);
  readonly addingRule = signal(false);

  readonly docTypes = DOC_TYPES;
  readonly docLabels = DOC_LABELS;

  // Editable form state per document type
  private readonly editSubjects = new Map<DocumentType, string>();
  private readonly editBodies = new Map<DocumentType, string>();

  // New rule form
  newRule = {
    ruleType: 'CC' as 'CC' | 'BCC',
    email: '',
    label: '',
    ownCompanyId: '',
    documentType: '',
  };

  // Template display helpers (Angular can't render literal {{ in templates)
  readonly lbrace = '{';
  readonly rbrace = '}';
  wrapVar(v: string): string {
    return `{{${v}}}`;
  }

  async ngOnInit(): Promise<void> {
    await this.loadAll();
  }

  // ── Load all data ──

  private async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      const [templatesRes, rulesRes, companiesRes, varsRes] = await Promise.all([
        firstValueFrom(this.http.get<ApiResponse<EmailTemplate[]>>(`${API}/admin/settings/email-templates`)),
        firstValueFrom(this.http.get<ApiResponse<EmailRule[]>>(`${API}/admin/settings/email-rules`)),
        firstValueFrom(this.http.get<ApiResponse<OwnCompanyDto[]>>(`${API}/companies/own`)),
        firstValueFrom(this.http.get<ApiResponse<TemplateVariable[]>>(`${API}/admin/settings/email-templates/variables`)),
      ]);

      if (templatesRes.success) {
        this.templates.set(templatesRes.data ?? []);
        for (const t of templatesRes.data ?? []) {
          this.editSubjects.set(t.documentType, t.subjectTemplate);
          this.editBodies.set(t.documentType, t.bodyTemplate);
        }
      }
      if (rulesRes.success) this.rules.set(rulesRes.data ?? []);
      if (companiesRes.success) this.ownCompanies.set(companiesRes.data ?? []);
      if (varsRes.success) this.templateVariables.set(varsRes.data ?? []);
    } catch {
      // silent
    } finally {
      this.loading.set(false);
    }
  }

  // ── Template helpers ──

  getTemplate(docType: DocumentType): EmailTemplate | undefined {
    return this.templates().find((t) => t.documentType === docType);
  }

  getSubject(docType: DocumentType): string {
    return this.editSubjects.get(docType) ?? '';
  }

  setSubject(docType: DocumentType, value: string): void {
    this.editSubjects.set(docType, value);
  }

  getBody(docType: DocumentType): string {
    return this.editBodies.get(docType) ?? '';
  }

  setBody(docType: DocumentType, value: string): void {
    this.editBodies.set(docType, value);
  }

  async saveTemplate(docType: DocumentType): Promise<void> {
    this.savingTemplate.set(docType);
    this.savedTemplate.set(null);
    try {
      const res = await firstValueFrom(
        this.http.put<ApiResponse<EmailTemplate>>(`${API}/admin/settings/email-templates/${docType}`, {
          subjectTemplate: this.editSubjects.get(docType) ?? '',
          bodyTemplate: this.editBodies.get(docType) ?? '',
        }),
      );
      if (res.success && res.data) {
        const list = this.templates().filter((t) => t.documentType !== docType);
        list.push(res.data);
        this.templates.set(list);
        this.savedTemplate.set(docType);
        setTimeout(() => {
          if (this.savedTemplate() === docType) this.savedTemplate.set(null);
        }, 3000);
      }
    } catch {
      // silent
    } finally {
      this.savingTemplate.set(null);
    }
  }

  async deleteTemplate(docType: DocumentType): Promise<void> {
    if (!confirm(`Remove the ${DOC_LABELS[docType]} template? The default system format will be used.`)) return;
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<void>>(`${API}/admin/settings/email-templates/${docType}`),
      );
      this.templates.set(this.templates().filter((t) => t.documentType !== docType));
      this.editSubjects.delete(docType);
      this.editBodies.delete(docType);
    } catch {
      // silent
    }
  }

  // ── Rule helpers ──

  getCompanyName(id: string | null): string {
    if (!id) return 'All';
    return this.ownCompanies().find((c) => c.id === id)?.name ?? 'Unknown';
  }

  async addRule(): Promise<void> {
    if (!this.newRule.email) return;
    this.addingRule.set(true);
    try {
      const body: Record<string, unknown> = {
        ruleType: this.newRule.ruleType,
        email: this.newRule.email,
      };
      if (this.newRule.label) body['label'] = this.newRule.label;
      if (this.newRule.ownCompanyId) body['ownCompanyId'] = this.newRule.ownCompanyId;
      if (this.newRule.documentType) body['documentType'] = this.newRule.documentType;

      const res = await firstValueFrom(
        this.http.post<ApiResponse<EmailRule>>(`${API}/admin/settings/email-rules`, body),
      );
      if (res.success && res.data) {
        this.rules.set([...this.rules(), res.data]);
        this.newRule = { ruleType: 'CC', email: '', label: '', ownCompanyId: '', documentType: '' };
      }
    } catch {
      // silent
    } finally {
      this.addingRule.set(false);
    }
  }

  async deleteRule(ruleId: string): Promise<void> {
    if (!confirm('Delete this rule?')) return;
    try {
      await firstValueFrom(
        this.http.delete<ApiResponse<void>>(`${API}/admin/settings/email-rules/${ruleId}`),
      );
      this.rules.set(this.rules().filter((r) => r.id !== ruleId));
    } catch {
      // silent
    }
  }
}
