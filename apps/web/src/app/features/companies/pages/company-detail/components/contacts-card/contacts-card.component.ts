import {
  Component, ChangeDetectionStrategy, input, output, signal, inject,
} from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { FormsModule } from '@angular/forms';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse, CompanyContactDto } from '@fueld/types';
import { API } from '@app/core/config/api';

interface VesselAssocTarget { vesselId?: string | null; assocId: string; vesselName?: string | null; role?: string }

@Component({
  selector: 'app-contacts-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white shadow-sm min-[900px]:order-5">
      <div class="border-b border-gray-100 px-5 py-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <h2 class="text-sm font-semibold text-gray-700">Contacts</h2>
          @if (contacts().length) {
            <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">
              {{ contacts().length }}
            </span>
          }
        </div>
        <button
          (click)="openAdd()"
          class="inline-flex items-center gap-1 rounded-md bg-brand-50 px-2 py-1 text-[11px] font-medium text-brand-700 hover:bg-brand-100 transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Add Contact
        </button>
      </div>
      @if (contactsLoading()) {
        <div class="flex items-center justify-center py-8">
          <svg class="h-5 w-5 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
          </svg>
        </div>
      } @else if (contacts().length) {
        <div class="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
          @for (c of contacts(); track c.id) {
            <div class="px-5 py-3 flex items-start justify-between group">
              <div class="flex items-start gap-3 min-w-0">
                <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
                  [class]="c.source === 'seasearcher' ? 'bg-blue-50 text-blue-700' : 'bg-gray-100 text-gray-600'">
                  {{ c.name.charAt(0) }}
                </div>
                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium text-gray-900">{{ c.name }}</span>
                    @if (c.role) {
                      <span class="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600">{{ c.role }}</span>
                    }
                    @if (c.source === 'seasearcher') {
                      <span class="inline-flex items-center rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-600">LLI</span>
                    }
                  </div>
                  <div class="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-gray-500">
                    @if (c.phone) {
                      <span class="inline-flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M2 3a1 1 0 011-1h2.153a1 1 0 01.986.836l.74 4.435a1 1 0 01-.54 1.06l-1.548.773a11.037 11.037 0 006.105 6.105l.774-1.548a1 1 0 011.059-.54l4.435.74a1 1 0 01.836.986V17a1 1 0 01-1 1h-2C7.82 18 2 12.18 2 5V3z" />
                        </svg>
                        {{ c.phone }}
                      </span>
                    }
                    @if (c.fax) {
                      <span class="inline-flex items-center gap-1">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fill-rule="evenodd" d="M5 4v3H4a2 2 0 00-2 2v3a2 2 0 002 2h1v2a2 2 0 002 2h6a2 2 0 002-2v-2h1a2 2 0 002-2V9a2 2 0 00-2-2h-1V4a2 2 0 00-2-2H7a2 2 0 00-2 2zm8 0H7v3h6V4zm0 8H7v4h6v-4z" clip-rule="evenodd" />
                        </svg>
                        {{ c.fax }}
                      </span>
                    }
                    @if (c.email) {
                      <a [href]="'mailto:' + c.email" class="inline-flex items-center gap-1 text-brand-600 hover:text-brand-800">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" />
                          <path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" />
                        </svg>
                        {{ c.email }}
                      </a>
                    }
                  </div>
                  @if (c.notes) {
                    <p class="mt-1 text-xs text-gray-400 italic">{{ c.notes }}</p>
                  }
                </div>
              </div>
              <div class="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                <button (click)="openEdit(c)" class="rounded-md p-1 text-gray-400 hover:text-brand-600 transition-colors" title="Edit">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M17.414 2.586a2 2 0 00-2.828 0L7 10.172V13h2.828l7.586-7.586a2 2 0 000-2.828z" />
                    <path fill-rule="evenodd" d="M2 6a2 2 0 012-2h4a1 1 0 010 2H4v10h10v-4a1 1 0 112 0v4a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" clip-rule="evenodd" />
                  </svg>
                </button>
                <button (click)="confirmDelete(c)" class="rounded-md p-1 text-gray-400 hover:text-red-500 transition-colors" title="Delete">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
                  </svg>
                </button>
              </div>
            </div>
          }
        </div>
      } @else {
        <div class="px-5 py-6 text-center text-sm text-gray-400">No contacts yet. Click "Add Contact" to add one.</div>
      }
    </div>

    <!-- Contact Modal -->
    @if (showModal()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
        <div class="rounded-xl bg-white p-6 shadow-xl w-full max-w-md mx-4" (click)="$event.stopPropagation()">
          <h3 class="text-lg font-semibold text-gray-900">{{ editingId() ? 'Edit' : 'Add' }} Contact</h3>
          @if (formError()) {
            <div class="mt-3 rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">{{ formError() }}</div>
          }
          <div class="mt-4 space-y-3">
            <div>
              <label class="block text-sm font-medium text-gray-700">Name *</label>
              <input type="text" [ngModel]="form().name" (ngModelChange)="updateField('name', $event)"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                placeholder="e.g. John Smith" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700">Role / Job Title</label>
              <input type="text" [ngModel]="form().role" (ngModelChange)="updateField('role', $event)"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                placeholder="e.g. Bunker Manager" />
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-gray-700">Phone</label>
                <input type="text" [ngModel]="form().phone" (ngModelChange)="updateField('phone', $event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  placeholder="+1 905 467 7357" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700">Fax</label>
                <input type="text" [ngModel]="form().fax" (ngModelChange)="updateField('fax', $event)"
                  class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                  placeholder="+1 905 467 7358" />
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700">Email</label>
              <input type="email" [ngModel]="form().email" (ngModelChange)="updateField('email', $event)"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                placeholder="john@example.com" />
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700">Notes</label>
              <textarea [ngModel]="form().notes" (ngModelChange)="updateField('notes', $event)"
                class="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none"
                rows="2" placeholder="Any additional notes..."></textarea>
            </div>
          </div>
          <div class="mt-5 flex justify-end gap-2">
            <button (click)="showModal.set(false)"
              class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button (click)="save()" [disabled]="saving()"
              class="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50">
              @if (saving()) { Saving… } @else { {{ editingId() ? 'Update' : 'Add' }} }
            </button>
          </div>
        </div>
      </div>
    }

    <!-- Delete Contact Confirmation -->
    @if (deleteTarget()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" (click)="deleteTarget.set(null)">
        <div class="rounded-xl bg-white p-6 shadow-xl max-w-sm mx-4" (click)="$event.stopPropagation()">
          <h3 class="text-lg font-semibold text-gray-900">Delete contact?</h3>
          <p class="mt-2 text-sm text-gray-500">Are you sure you want to delete <strong>{{ deleteTarget()!.name }}</strong>?</p>
          <div class="mt-4 flex justify-end gap-2">
            <button (click)="deleteTarget.set(null)"
              class="rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button (click)="executeDelete()"
              class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700">Delete</button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ContactsCardComponent {
  private readonly http = inject(HttpClient);

  readonly contacts = input.required<CompanyContactDto[]>();
  readonly contactsLoading = input<boolean>(false);
  readonly companyId = input.required<string>();

  readonly mutated = output<void>();

  readonly showModal = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly form = signal({ name: '', role: '', phone: '', fax: '', email: '', notes: '' });
  readonly formError = signal('');
  readonly saving = signal(false);
  readonly deleteTarget = signal<CompanyContactDto | null>(null);

  openAdd(): void {
    this.editingId.set(null);
    this.form.set({ name: '', role: '', phone: '', fax: '', email: '', notes: '' });
    this.formError.set('');
    this.showModal.set(true);
  }

  openEdit(c: CompanyContactDto): void {
    this.editingId.set(c.id);
    this.form.set({ name: c.name, role: c.role ?? '', phone: c.phone ?? '', fax: c.fax ?? '', email: c.email ?? '', notes: c.notes ?? '' });
    this.formError.set('');
    this.showModal.set(true);
  }

  updateField(field: string, value: string): void {
    this.form.update(f => ({ ...f, [field]: value }));
  }

  async save(): Promise<void> {
    const f = this.form();
    if (!f.name.trim()) { this.formError.set('Name is required.'); return; }
    this.saving.set(true);
    this.formError.set('');
    try {
      const body = {
        name: f.name.trim(),
        role: f.role.trim() || undefined,
        phone: f.phone.trim() || undefined,
        fax: f.fax.trim() || undefined,
        email: f.email.trim() || undefined,
        notes: f.notes.trim() || undefined,
      };
      if (this.editingId()) {
        await firstValueFrom(this.http.patch(`${API}/companies/contacts/${this.editingId()}`, body));
      } else {
        await firstValueFrom(this.http.post(`${API}/companies/local/${this.companyId()}/contacts`, body));
      }
      this.showModal.set(false);
      this.mutated.emit();
    } catch (err: any) {
      this.formError.set(err?.error?.message ?? 'Failed to save contact.');
    } finally {
      this.saving.set(false);
    }
  }

  confirmDelete(c: CompanyContactDto): void {
    this.deleteTarget.set(c);
  }

  async executeDelete(): Promise<void> {
    const t = this.deleteTarget();
    if (!t) return;
    try {
      await firstValueFrom(this.http.delete(`${API}/companies/contacts/${t.id}`));
      this.deleteTarget.set(null);
      this.mutated.emit();
    } catch {
      // ignore
    }
  }
}
