import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  model,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { OrderAttachmentDto } from '@fueld/types';

@Component({
  selector: 'app-order-attachments-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="rounded-xl border border-gray-200 bg-white p-5 shadow-sm h-full max-h-[520px] flex flex-col">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-700 uppercase tracking-wider">Attachments</h3>
      </div>
      <div class="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
        <select
          [ngModel]="attachmentType()"
          (ngModelChange)="attachmentType.set($event)"
          class="fueld-select-no-chevron w-full sm:w-40 appearance-none rounded-lg border border-gray-300 px-2 py-1.5 text-sm text-gray-700
                 focus:border-brand-500 focus:ring-1 focus:ring-brand-500 outline-none bg-white"
        >
          @for (type of attachmentTypes(); track type) {
            <option [value]="type">{{ type }}</option>
          }
        </select>
        <input
          #fileInput
          type="file"
          (change)="onFileSelected($event)"
          accept="application/pdf,image/*"
          class="w-full text-sm text-gray-600 file:mr-4 file:rounded-lg file:border-0 file:bg-gray-100
                 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
        />
        <button
          type="button"
          (click)="upload.emit()"
          [disabled]="uploading() || !hasFile()"
          class="inline-flex items-center justify-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold
                 text-white shadow-sm transition-colors hover:bg-brand-700 disabled:opacity-50"
        >
          Upload
        </button>
      </div>
      <div class="mt-4 flex-1 overflow-auto">
        @if (attachments().length === 0) {
          <p class="text-sm text-gray-400">No attachments yet.</p>
        } @else {
          <ul class="divide-y divide-gray-100">
            @for (att of attachments(); track att.id) {
              <li class="flex items-center justify-between py-2 text-sm">
                <div class="flex items-center gap-2 min-w-0">
                  <span class="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-semibold text-gray-600 shrink-0">{{ att.type }}</span>
                  <button
                    type="button"
                    (click)="open.emit(att)"
                    class="text-left text-brand-600 hover:underline truncate"
                  >
                    {{ att.fileName }}
                  </button>
                </div>
                <div class="flex items-center gap-2 shrink-0">
                  <span class="text-xs text-gray-400">{{ formatFileSize(att.fileSize) }}</span>
                  <button
                    type="button"
                    (click)="delete.emit(att)"
                    class="rounded p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                    title="Remove attachment"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd" />
                    </svg>
                  </button>
                </div>
              </li>
            }
          </ul>
        }
      </div>
    </div>
  `,
})
export class OrderAttachmentsCardComponent {
  readonly attachments = input<OrderAttachmentDto[]>([]);
  readonly attachmentTypes = input<string[]>([]);
  readonly attachmentType = model('OTHER');
  readonly uploading = input(false);
  readonly hasFile = input(false);

  readonly upload = output<void>();
  readonly open = output<OrderAttachmentDto>();
  readonly delete = output<OrderAttachmentDto>();
  readonly fileSelected = output<File>();

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    if (file) {
      this.fileSelected.emit(file);
    }
  }

  protected formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
}
