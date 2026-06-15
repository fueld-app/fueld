import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

@Component({
  selector: 'app-vessel-detail-delete-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
        <div class="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
          <h3 class="text-lg font-semibold text-gray-900">Delete Vessel</h3>
          <p class="mt-2 text-sm text-gray-600">
            Are you sure you want to delete <strong>{{ vesselName() }}</strong>?
          </p>
          @if (error()) {
            <p class="mt-2 text-sm text-red-600">{{ error() }}</p>
          }
          <div class="mt-4 flex justify-end gap-3">
            <button (click)="cancel.emit()" class="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">Cancel</button>
            <button (click)="confirm.emit()" [disabled]="deleting()" class="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50">
              {{ deleting() ? 'Deleting…' : 'Delete' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class VesselDetailDeleteModalComponent {
  readonly open = input(false);
  readonly vesselName = input('');
  readonly deleting = input(false);
  readonly error = input('');
  readonly cancel = output<void>();
  readonly confirm = output<void>();
}