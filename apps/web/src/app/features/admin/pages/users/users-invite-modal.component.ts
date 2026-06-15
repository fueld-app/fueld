import {
  Component,
  ChangeDetectionStrategy,
  signal,
  input,
  output,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

interface RoleOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-users-invite-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div
          class="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl"
          (click)="$event.stopPropagation()"
        >
          <h2 class="text-lg font-bold text-gray-900 mb-4">Invite New User</h2>

          @if (success()) {
            <div class="space-y-4">
              <div class="rounded-lg bg-green-50 border border-green-200 p-4">
                <div class="flex items-start gap-3">
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-green-600 mt-0.5 shrink-0" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clip-rule="evenodd" />
                  </svg>
                  <div>
                    <p class="text-sm font-medium text-green-800">Invitation created!</p>
                    <p class="mt-1 text-sm text-green-700">Share this link with <strong>{{ form().email }}</strong> to complete their signup:</p>
                  </div>
                </div>
              </div>

              <div class="flex items-center gap-2">
                <input
                  type="text"
                  [value]="inviteLink()"
                  readonly
                  class="app-input-mono flex-1 bg-gray-50 text-xs text-gray-700"
                />
                <button (click)="copy.emit()" class="app-button-primary shrink-0 px-3 py-2 text-sm">
                  {{ copied() ? 'Copied!' : 'Copy' }}
                </button>
              </div>

              <div class="flex justify-end pt-2">
                <button (click)="close.emit()" class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors">
                  Done
                </button>
              </div>
            </div>
          } @else {
            <div class="space-y-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  [(ngModel)]="formData.name"
                  placeholder="e.g. Jane Smith"
                  class="app-input w-full"
                  (ngModelChange)="onFormChange()"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  [(ngModel)]="formData.email"
                  placeholder="e.g. jane@company.com"
                  class="app-input w-full"
                  (ngModelChange)="onFormChange()"
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">Role</label>
                <select
                  [(ngModel)]="formData.role"
                  class="app-input w-full"
                  (ngModelChange)="onFormChange()"
                >
                  @for (r of roles(); track r.value) {
                    <option [value]="r.value">{{ r.label }}</option>
                  }
                </select>
              </div>

              @if (error()) {
                <div class="rounded-lg bg-red-50 border border-red-200 p-3 text-sm text-red-700">
                  {{ error() }}
                </div>
              }

              <div class="flex justify-end gap-2 pt-2">
                <button (click)="close.emit()" class="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 transition-colors">
                  Cancel
                </button>
                <button (click)="send.emit()" [disabled]="sending()" class="app-button-primary disabled:opacity-50">
                  {{ sending() ? 'Sending…' : 'Send Invite' }}
                </button>
              </div>
            </div>
          }
        </div>
      </div>
    }
  `,
})
export class UsersInviteModalComponent {
  readonly open = input(false);
  readonly success = input(false);
  readonly sending = input(false);
  readonly copied = input(false);
  readonly error = input('');
  readonly inviteLink = input('');
  readonly roles = input<RoleOption[]>([]);
  readonly form = input<{ name: string; email: string; role: string }>({ name: '', email: '', role: '' });
  readonly close = output<void>();
  readonly send = output<void>();
  readonly copy = output<void>();
  readonly formChange = output<{ name: string; email: string; role: string }>();

  formData = { name: '', email: '', role: '' };

  onFormChange(): void {
    this.formChange.emit({ ...this.formData });
  }
}