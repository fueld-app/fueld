import { Component, ChangeDetectionStrategy, input, output } from '@angular/core';

@Component({
  selector: 'app-attachment-types-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="app-panel">
      <div class="app-panel-header app-panel-header--indigo">
        <div class="app-panel-icon-shell app-panel-icon-shell--rounded app-panel-icon-shell--indigo">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-indigo-600" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10.362 1.093a1 1 0 00-.724 0l-7 2.625A1 1 0 002 4.655v5.69a1 1 0 00.638.937l7 2.625a1 1 0 00.724 0l7-2.625A1 1 0 0018 10.345v-5.69a1 1 0 00-.638-.937l-7-2.625zM10 3.12L4.052 5.35 10 7.58l5.948-2.23L10 3.12z" clip-rule="evenodd" />
            <path d="M3 11.38l6 2.25v5.25l-6-2.25v-5.25zM11 18.88v-5.25l6-2.25v5.25l-6 2.25z" />
          </svg>
        </div>
        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-semibold text-gray-900">Attachment Types</h3>
          <p class="text-xs text-gray-500">Configure which attachment types can be selected when uploading order/inquiry attachments.</p>
        </div>
      </div>

      <div class="app-panel-body space-y-3 flex-1 min-h-0 overflow-y-auto">
        @for (type of types(); track $index; let i = $index) {
          <div class="flex items-center gap-2">
            <div class="flex flex-col gap-0.5 shrink-0">
              <button (click)="moveUp.emit(i)" [disabled]="i === 0" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move up">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clip-rule="evenodd" /></svg>
              </button>
              <button (click)="moveDown.emit(i)" [disabled]="i === types().length - 1" class="text-gray-400 hover:text-gray-600 disabled:opacity-30 transition-colors" title="Move down">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" /></svg>
              </button>
            </div>
            <input
              type="text"
              [value]="type"
              (input)="typeChange.emit({ index: i, value: ($any($event.target).value) })"
              class="app-input-mono-uppercase flex-1"
            />
            <button
              (click)="remove.emit(i)"
              [disabled]="types().length <= 1 || type === 'BDR'"
              class="rounded-md p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 transition-colors shrink-0"
              [title]="type === 'BDR' ? 'BDR is a core type and cannot be removed' : 'Remove type'"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>
          </div>
        }
        <button (click)="add.emit()" class="app-button-add">
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
            <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
          </svg>
          Add Type
        </button>

        <div class="flex items-center gap-3 pt-2">
          <button (click)="save.emit()" [disabled]="saving()" class="app-button-primary">
            {{ saving() ? 'Saving…' : 'Save Types' }}
          </button>
          @if (saved()) {
            <span class="text-sm text-green-600 flex items-center gap-1">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clip-rule="evenodd" />
              </svg>
              Saved
            </span>
          }
        </div>
      </div>
    </div>
  `,
})
export class AttachmentTypesCardComponent {
  readonly types = input<string[]>([]);
  readonly saving = input(false);
  readonly saved = input(false);
  readonly moveUp = output<number>();
  readonly moveDown = output<number>();
  readonly typeChange = output<{ index: number; value: string }>();
  readonly remove = output<number>();
  readonly add = output<void>();
  readonly save = output<void>();
}