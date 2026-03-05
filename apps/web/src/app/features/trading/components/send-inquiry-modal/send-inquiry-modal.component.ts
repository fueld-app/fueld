import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  inject,
  viewChild,
  ElementRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { API_URL } from '@app/core/config/api';

// ═══════════════════════════════════════════════════════════════════════
//  Send Inquiry Modal — Send RFQ emails to multiple port suppliers
// ═══════════════════════════════════════════════════════════════════════

export interface SupplierRow {
  portSupplierId: string;
  supplierId: string;
  supplierName: string;
  contactId: string | null;
  contactName: string | null;
  products: string[];
  note: string | null;
  email: string | null;
  inquiryStatus: string | null;
  inquirySentAt: string | null;
  // UI state
  selected: boolean;
  emailOverride: string;
}

export interface SendInquiryPayload {
  suppliers: Array<{
    supplierId: string;
    supplierName: string;
    email: string;
    contactId?: string;
  }>;
  subject: string;
  htmlBody: string;
}

@Component({
  selector: 'app-send-inquiry-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <!-- Backdrop -->
      <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      >
        <!-- Modal panel -->
        <div
          class="w-full max-w-4xl rounded-2xl bg-white shadow-2xl flex flex-col max-h-[90vh]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inquiry-modal-title"
        >
          <!-- Header -->
          <div class="flex items-center justify-between border-b border-gray-200 px-6 py-4 shrink-0">
            <div>
              <h2 id="inquiry-modal-title" class="text-lg font-semibold text-gray-900">
                Send Inquiry to Suppliers
              </h2>
              <p class="text-sm text-gray-500 mt-0.5">
                Select suppliers at {{ portName() }} to send RFQ emails
              </p>
            </div>
            <button
              (click)="close()"
              class="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              aria-label="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          <!-- Body -->
          <div class="flex-1 overflow-y-auto px-6 py-5 space-y-5">

            <!-- Suppliers list -->
            <div>
              <div class="flex items-center justify-between mb-3">
                <label class="block text-sm font-medium text-gray-700">
                  Suppliers ({{ selectedCount() }}/{{ suppliers().length }} selected)
                </label>
                <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    class="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                    [checked]="allSelected()"
                    [indeterminate]="someSelected() && !allSelected()"
                    (change)="toggleAll()"
                  />
                  Select All
                </label>
              </div>

              @if (loadingSuppliers()) {
                <div class="flex items-center justify-center py-8 text-gray-400">
                  <svg class="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Loading suppliers...
                </div>
              } @else if (suppliers().length === 0) {
                <div class="text-center py-8 text-gray-400 text-sm">
                  No suppliers registered for this port.
                  <br/>
                  Add port suppliers via the Places section.
                </div>
              } @else {
                <div class="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-64 overflow-y-auto">
                  @for (s of suppliers(); track s.supplierId) {
                    <label
                      class="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
                      [class.bg-brand-50]="s.selected"
                      [class.opacity-60]="!s.email && !s.emailOverride"
                    >
                      <input
                        type="checkbox"
                        class="h-4 w-4 mt-0.5 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                        [checked]="s.selected"
                        (change)="toggleSupplier(s)"
                        [disabled]="!s.email && !s.emailOverride"
                      />
                      <div class="flex-1 min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="text-sm font-medium text-gray-900 truncate">{{ s.supplierName }}</span>
                          @if (s.inquiryStatus) {
                            <span class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                              [class]="statusBadgeClass(s.inquiryStatus)">
                              {{ s.inquiryStatus }}
                            </span>
                          }
                        </div>
                        @if (s.contactName) {
                          <div class="text-xs text-gray-500 mt-0.5">{{ s.contactName }}</div>
                        }
                        @if (s.products && s.products.length > 0) {
                          <div class="flex flex-wrap gap-1 mt-1">
                            @for (p of s.products; track p) {
                              <span class="inline-flex items-center rounded-md bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
                                {{ p }}
                              </span>
                            }
                          </div>
                        }
                        <!-- Email field (editable) -->
                        <div class="mt-1">
                          @if (s.email || s.emailOverride) {
                            <input
                              type="email"
                              class="w-full text-xs rounded border-gray-200 bg-gray-50 px-2 py-1 text-gray-600 focus:bg-white focus:border-brand-400 focus:ring-1 focus:ring-brand-300"
                              [value]="s.emailOverride || s.email || ''"
                              (input)="onEmailEdit(s, $event)"
                              (click)="$event.stopPropagation()"
                              placeholder="Email address"
                            />
                          } @else {
                            <span class="text-xs text-red-400">No email on file</span>
                          }
                        </div>
                        @if (s.inquirySentAt) {
                          <div class="text-xs text-gray-400 mt-0.5">
                            Sent {{ formatDate(s.inquirySentAt) }}
                          </div>
                        }
                      </div>
                    </label>
                  }
                </div>
              }
            </div>

            <!-- Subject -->
            <div>
              <label for="inquiry-subject" class="block text-sm font-medium text-gray-700">Subject</label>
              <input
                id="inquiry-subject"
                type="text"
                class="mt-1 block w-full rounded-lg border border-gray-300 px-3.5 py-2.5 text-sm text-gray-900 focus:border-brand-500 focus:ring-1 focus:ring-brand-500"
                [ngModel]="subject()"
                (ngModelChange)="subject.set($event)"
              />
            </div>

            <!-- Body editor -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">Email Body</label>
              <div class="border border-gray-300 rounded-lg overflow-hidden">
                <!-- Toolbar -->
                <div class="flex items-center gap-1 border-b border-gray-200 bg-gray-50 px-2 py-1.5">
                  <button type="button" (click)="execCommand('bold')" class="toolbar-btn" title="Bold">
                    <strong>B</strong>
                  </button>
                  <button type="button" (click)="execCommand('italic')" class="toolbar-btn" title="Italic">
                    <em>I</em>
                  </button>
                  <button type="button" (click)="execCommand('underline')" class="toolbar-btn" title="Underline">
                    <u>U</u>
                  </button>
                  <div class="w-px h-4 bg-gray-300 mx-1"></div>
                  <button type="button" (click)="execCommand('insertUnorderedList')" class="toolbar-btn" title="Bullet list">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M6 4.75A.75.75 0 016.75 4h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 4.75zM6 10a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75A.75.75 0 016 10zm0 5.25a.75.75 0 01.75-.75h10.5a.75.75 0 010 1.5H6.75a.75.75 0 01-.75-.75zM1.99 4.75a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1zm0 5.25a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1zm0 5.25a1 1 0 011-1h.01a1 1 0 010 2h-.01a1 1 0 01-1-1z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
                <!-- Content editable area -->
                <div
                  #bodyEditor
                  contenteditable="true"
                  class="min-h-[200px] max-h-[300px] overflow-y-auto px-4 py-3 text-sm text-gray-900 focus:outline-none"
                  (input)="onBodyInput()"
                ></div>
              </div>
            </div>

            <!-- Email preview (collapsed by default) -->
            @if (htmlBody()) {
              <details class="group">
                <summary class="cursor-pointer text-sm text-gray-500 hover:text-gray-700 select-none">
                  Preview email
                </summary>
                <div class="mt-2 border border-gray-200 rounded-lg overflow-hidden">
                  <iframe
                    class="w-full border-0"
                    style="height: 400px"
                    [srcdoc]="htmlBody()"
                  ></iframe>
                </div>
              </details>
            }
          </div>

          <!-- Footer -->
          <div class="flex items-center justify-between border-t border-gray-200 px-6 py-4 shrink-0 bg-gray-50 rounded-b-2xl">
            <span class="text-sm text-gray-500">
              @if (selectedCount() > 0) {
                {{ selectedCount() }} supplier{{ selectedCount() === 1 ? '' : 's' }} will receive individual emails
              } @else {
                Select at least one supplier to send
              }
            </span>
            <div class="flex items-center gap-3">
              <button
                type="button"
                (click)="close()"
                class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                (click)="send()"
                [disabled]="sending() || selectedCount() === 0 || !subject()"
                class="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-2 text-sm font-semibold text-white
                  hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                @if (sending()) {
                  <svg class="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Sending...
                } @else {
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
                  </svg>
                  Send Inquiry
                }
              </button>
            </div>
          </div>
        </div>
      </div>
    }
  `,
  styles: [`
    .toolbar-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 4px;
      padding: 4px;
      font-size: 14px;
      color: #4b5563;
      min-width: 28px;
      text-align: center;
      cursor: pointer;
      border: none;
      background: transparent;
      transition: background-color 0.15s, color 0.15s;
    }
    .toolbar-btn:hover {
      background-color: #e5e7eb;
      color: #111827;
    }
  `],
})
export class SendInquiryModalComponent {
  private readonly http = inject(HttpClient);

  readonly orderId = input.required<string>();
  readonly portName = input<string>('');

  readonly sendInquiry = output<SendInquiryPayload>();
  readonly closed = output<void>();

  readonly open = signal(false);
  readonly loadingSuppliers = signal(false);
  readonly sending = signal(false);
  readonly suppliers = signal<SupplierRow[]>([]);
  readonly subject = signal('');
  readonly htmlBody = signal('');

  readonly bodyEditor = viewChild<ElementRef<HTMLDivElement>>('bodyEditor');

  readonly selectedCount = computed(() => this.suppliers().filter(s => s.selected).length);
  readonly allSelected = computed(() => {
    const list = this.suppliers().filter(s => s.email || s.emailOverride);
    return list.length > 0 && list.every(s => s.selected);
  });
  readonly someSelected = computed(() => this.suppliers().some(s => s.selected));

  /** Open the modal and load suppliers + email defaults */
  show(): void {
    this.open.set(true);
    this.loadSuppliers();
    this.loadDefaults();
  }

  close(): void {
    this.open.set(false);
    this.sending.set(false);
    this.closed.emit();
  }

  /** Mark sending complete (called from parent after API response) */
  done(): void {
    this.sending.set(false);
  }

  private loadSuppliers(): void {
    this.loadingSuppliers.set(true);
    this.http.get<{ success: boolean; data: any[] }>(`${API_URL}/orders/${this.orderId()}/inquiry/suppliers`)
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.suppliers.set(res.data.map((s: any) => ({
              ...s,
              selected: !s.inquiryStatus && !!s.email,  // pre-select unsent suppliers with email
              emailOverride: '',
            })));
          }
          this.loadingSuppliers.set(false);
        },
        error: () => {
          this.loadingSuppliers.set(false);
        },
      });
  }

  private loadDefaults(): void {
    this.http.post<{ success: boolean; data: any }>(`${API_URL}/orders/${this.orderId()}/inquiry/defaults`, {})
      .subscribe({
        next: (res) => {
          if (res.success && res.data) {
            this.subject.set(res.data.subject ?? '');
            this.htmlBody.set(res.data.htmlBody ?? '');
            // Set the body editor content
            setTimeout(() => {
              const editor = this.bodyEditor()?.nativeElement;
              if (editor) {
                editor.innerHTML = res.data.htmlBody ?? '';
              }
            });
          }
        },
      });
  }

  toggleAll(): void {
    const shouldSelect = !this.allSelected();
    this.suppliers.update(list =>
      list.map(s => ({
        ...s,
        selected: (s.email || s.emailOverride) ? shouldSelect : false,
      })),
    );
  }

  toggleSupplier(supplier: SupplierRow): void {
    this.suppliers.update(list =>
      list.map(s =>
        s.supplierId === supplier.supplierId
          ? { ...s, selected: !s.selected }
          : s,
      ),
    );
  }

  onEmailEdit(supplier: SupplierRow, event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.suppliers.update(list =>
      list.map(s =>
        s.supplierId === supplier.supplierId
          ? { ...s, emailOverride: value }
          : s,
      ),
    );
  }

  onBodyInput(): void {
    const editor = this.bodyEditor()?.nativeElement;
    if (editor) {
      this.htmlBody.set(editor.innerHTML);
    }
  }

  execCommand(command: string): void {
    document.execCommand(command, false);
    this.onBodyInput();
  }

  send(): void {
    const selected = this.suppliers().filter(s => s.selected);
    if (selected.length === 0) return;

    this.sending.set(true);
    this.sendInquiry.emit({
      suppliers: selected.map(s => ({
        supplierId: s.supplierId,
        supplierName: s.supplierName,
        email: s.emailOverride || s.email!,
        contactId: s.contactId ?? undefined,
      })),
      subject: this.subject(),
      htmlBody: this.htmlBody(),
    });
  }

  statusBadgeClass(status: string): string {
    switch (status) {
      case 'SENT': return 'bg-blue-100 text-blue-700';
      case 'QUOTED': return 'bg-green-100 text-green-700';
      case 'DECLINED': return 'bg-red-100 text-red-700';
      case 'NO_REPLY': return 'bg-gray-100 text-gray-500';
      default: return 'bg-gray-100 text-gray-500';
    }
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
}
