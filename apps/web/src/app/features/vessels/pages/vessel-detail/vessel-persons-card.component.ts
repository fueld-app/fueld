import { Component, ChangeDetectionStrategy, input, output, signal, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';
import { API } from '@app/core/config/api';

interface VesselPerson {
  id: string;
  name: string;
  title: string;
  phone?: string | null;
  email?: string | null;
}

@Component({
  selector: 'app-vessel-persons-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Crew / Persons</h3>
        <button (click)="toggleAdd()" class="text-xs font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700">
          {{ showAdd() ? 'Cancel' : '+ Add person' }}
        </button>
      </div>

      @if (showAdd()) {
        <div class="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-gray-200 dark:border-line p-3">
          <input [ngModel]="form().name" (ngModelChange)="updateForm('name', $event)" placeholder="Name" class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm" />
          <select [ngModel]="form().title" (ngModelChange)="updateForm('title', $event)" class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm bg-white dark:bg-surface">
            <option value="">Title…</option>
            @for (t of titleOptions(); track t) { <option [value]="t">{{ t }}</option> }
          </select>
          <input [ngModel]="form().phone" (ngModelChange)="updateForm('phone', $event)" placeholder="Phone" class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm" />
          <input [ngModel]="form().email" (ngModelChange)="updateForm('email', $event)" placeholder="Email" class="rounded-lg border border-gray-300 dark:border-line-strong px-3 py-2 text-sm" />
          <button (click)="save()" [disabled]="!form().name.trim() || !form().title.trim()" class="col-span-2 rounded-lg bg-brand-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 hover:bg-brand-800">
            {{ editingId() ? 'Update' : 'Add' }}
          </button>
        </div>
      }

      <div class="mt-3 divide-y divide-gray-100 dark:divide-line">
        @for (p of persons(); track p.id) {
          <div class="flex items-start justify-between gap-3 py-3">
            <div class="min-w-0">
              <div class="text-sm font-medium text-gray-900 dark:text-ink">{{ p.name }} <span class="text-xs text-gray-400 dark:text-muted">· {{ p.title }}</span></div>
              <div class="text-xs text-gray-500 dark:text-muted">
                @if (p.phone) { {{ p.phone }} }
                @if (p.phone && p.email) { · }
                @if (p.email) { {{ p.email }} }
              </div>
            </div>
            <div class="flex gap-2">
              <button (click)="edit(p)" class="text-xs text-brand-600 dark:text-brand-400 hover:underline">Edit</button>
              <button (click)="remove(p.id)" class="text-xs text-red-500 hover:underline">Delete</button>
            </div>
          </div>
        } @empty {
          <p class="py-4 text-center text-sm text-gray-400 dark:text-muted">No persons added yet.</p>
        }
      </div>
    </div>
  `,
})
export class VesselPersonsCardComponent {
  private readonly http = inject(HttpClient);
  readonly vesselId = input.required<string>();
  readonly persons = input<VesselPerson[]>([]);
  readonly titleOptions = input<string[]>(['Captain']);
  readonly personsChange = output<VesselPerson[]>();

  readonly showAdd = signal(false);
  readonly editingId = signal<string | null>(null);
  readonly form = signal<{ name: string; title: string; phone: string; email: string }>({ name: '', title: '', phone: '', email: '' });

  toggleAdd(): void {
    this.showAdd.update((v) => !v);
    this.editingId.set(null);
    this.form.set({ name: '', title: '', phone: '', email: '' });
  }

  edit(p: VesselPerson): void {
    this.editingId.set(p.id);
    this.showAdd.set(true);
    this.form.set({ name: p.name, title: p.title, phone: p.phone ?? '', email: p.email ?? '' });
  }

  updateForm(field: 'name' | 'title' | 'phone' | 'email', value: string): void {
    this.form.update((f) => ({ ...f, [field]: value }));
  }

  async save(): Promise<void> {
    const id = this.vesselId();
    const f = this.form();
    try {
      if (this.editingId()) {
        await firstValueFrom(this.http.patch<ApiResponse<VesselPerson>>(`${API}/vessels/local/${id}/persons/${this.editingId()}`, {
          name: f.name, title: f.title, phone: f.phone || null, email: f.email || null,
        }));
      } else {
        await firstValueFrom(this.http.post<ApiResponse<VesselPerson>>(`${API}/vessels/local/${id}/persons`, {
          name: f.name, title: f.title, phone: f.phone || null, email: f.email || null,
        }));
      }
      await this.reload();
      this.toggleAdd();
    } catch {
      // ignore — card stays editable
    }
  }

  async remove(personId: string): Promise<void> {
    try {
      await firstValueFrom(this.http.delete<ApiResponse<{ id: string }>>(`${API}/vessels/local/${this.vesselId()}/persons/${personId}`));
      await this.reload();
    } catch {
      // ignore
    }
  }

  private async reload(): Promise<void> {
    try {
      const res = await firstValueFrom(this.http.get<ApiResponse<VesselPerson[]>>(`${API}/vessels/local/${this.vesselId()}/persons`));
      if (res.success && res.data) this.personsChange.emit(res.data);
    } catch {
      // ignore
    }
  }
}