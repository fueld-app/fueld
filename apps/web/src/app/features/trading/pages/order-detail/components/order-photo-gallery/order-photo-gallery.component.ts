import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  model,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import type { OrderAttachmentDto } from '@fueld/types';
import { API_URL } from '@app/core/config/api';
import { compressImages } from '@app/shared/utils/image-compress';

@Component({
  selector: 'app-order-photo-gallery',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div class="rounded-xl border border-gray-200 dark:border-line bg-white dark:bg-surface p-5 shadow-sm">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-gray-700 dark:text-ink-dim uppercase tracking-wider">Photos</h3>
        <span class="text-xs text-gray-400 dark:text-muted">{{ photos().length }} photo{{ photos().length === 1 ? '' : 's' }}</span>
      </div>

      <!-- Drag-and-drop zone + upload bar -->
      <div
        class="mt-3 rounded-lg border-2 border-dashed transition-colors p-4"
        [class]="dragActive()
          ? 'border-brand-500 bg-brand-50 dark:bg-brand-700/10'
          : 'border-gray-300 dark:border-line-strong'"
        (dragover)="onDragOver($event)"
        (dragleave)="onDragLeave($event)"
        (drop)="onDrop($event)"
      >
        <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
          <select
            [ngModel]="uploadCategory()"
            (ngModelChange)="uploadCategory.set($event)"
            class="fueld-select-no-chevron w-full sm:w-40 appearance-none rounded-lg border border-gray-300 dark:border-line-strong px-2 py-1.5 text-sm text-gray-700 dark:text-ink-dim focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none bg-white dark:bg-surface"
            title="Select photo category"
          >
            @for (cat of photoCategories(); track cat) {
              <option [value]="cat">{{ cat }}</option>
            }
          </select>
          <input
            #fileInput
            type="file"
            multiple
            (change)="onFileSelected($event)"
            accept="image/jpeg,image/png,image/webp,image/heic"
            class="w-full text-sm text-gray-600 dark:text-ink-dim file:mr-4 file:rounded-lg file:border-0 file:bg-gray-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
          />
          <button
            type="button"
            (click)="upload.emit()"
            [disabled]="uploading() || compressing() || !hasFile()"
            class="inline-flex items-center justify-center rounded-lg bg-brand-700 px-4 py-2 text-sm font-semibold
                   text-white shadow-sm transition-colors hover:bg-brand-800 disabled:opacity-50 whitespace-nowrap"
          >
            @if (uploading()) {
              <svg class="h-4 w-4 animate-spin mr-1.5" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              {{ uploadProgress() || 'Uploading…' }}
            } @else if (compressing()) {
              <svg class="h-4 w-4 animate-spin mr-1.5" viewBox="0 0 24 24" fill="none">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Compressing…
            } @else {
              Upload {{ pendingCount() > 1 ? pendingCount() + ' Photos' : 'Photo' }}
            }
          </button>
        </div>

        @if (dragActive()) {
          <p class="mt-2 text-center text-sm text-brand-600 dark:text-brand-400 font-medium">
            Drop photos here to upload
          </p>
        } @else {
          <p class="mt-2 text-center text-xs text-gray-400 dark:text-muted">
            Drag & drop photos here, or click to select · Max {{ maxFileSizeMb() }} MB per photo · Images auto-compressed to 1920px JPEG
          </p>
        }
      </div>

      <!-- Photo grid -->
      <div class="mt-4">
        @if (photos().length === 0) {
          <p class="text-sm text-gray-400 dark:text-muted">No photos uploaded yet.</p>
        } @else {
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            @for (photo of photos(); track photo.id) {
              <div class="group relative overflow-hidden rounded-lg border border-gray-200 dark:border-line">
                <!-- Thumbnail -->
                <button
                  type="button"
                  (click)="openLightbox(photo)"
                  class="block w-full aspect-square overflow-hidden bg-gray-100 dark:bg-surface-dark"
                >
                  <img
                    [src]="getThumbUrl(photo)"
                    [alt]="photo.fileName"
                    class="w-full h-full object-cover transition-transform group-hover:scale-105"
                    loading="lazy"
                  />
                </button>

                <!-- Category badge -->
                <div class="absolute top-1 left-1">
                  <select
                    [ngModel]="photo.category"
                    (ngModelChange)="categoryChange.emit({ photo, category: $event })"
                    class="fueld-select-no-chevron appearance-none rounded-md border border-gray-300 dark:border-line-strong px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 dark:text-ink-dim bg-white/90 dark:bg-surface/90 backdrop-blur-sm focus:border-brand-600 focus:ring-1 focus:ring-brand-600 outline-none"
                    [title]="'Photo category (currently ' + (photo.category ?? 'NONE') + ')'"
                  >
                    <option [value]="">NONE</option>
                    @for (cat of photoCategories(); track cat) {
                      <option [value]="cat">{{ cat }}</option>
                    }
                  </select>
                </div>

                <!-- Delete button -->
                <button
                  type="button"
                  (click)="delete.emit(photo)"
                  class="absolute top-1 right-1 rounded p-1 text-white bg-black/40 hover:bg-red-500/80 transition-colors opacity-0 group-hover:opacity-100"
                  title="Delete photo"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fill-rule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clip-rule="evenodd" />
                  </svg>
                </button>

                <!-- File name -->
                <div class="px-1.5 py-1 text-[10px] text-gray-500 dark:text-muted truncate" [title]="photo.fileName">
                  {{ photo.fileName }}
                </div>
              </div>
            }
          </div>
        }
      </div>

      <!-- Lightbox modal -->
      @if (lightboxPhoto()) {
        <div
          class="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          (click)="closeLightbox()"
        >
          <div class="relative max-w-[90vw] max-h-[90vh]" (click)="$event.stopPropagation()">
            <button
              type="button"
              (click)="closeLightbox()"
              class="absolute -top-2 -right-2 z-10 rounded-full bg-white text-gray-700 p-1.5 shadow-lg hover:bg-gray-100"
              title="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
            <img
              [src]="getFullUrl(lightboxPhoto()!)"
              [alt]="lightboxPhoto()!.fileName"
              class="max-w-[90vw] max-h-[90vh] rounded-lg object-contain"
            />
            <div class="mt-2 text-center text-sm text-white/80">
              {{ lightboxPhoto()!.fileName }}
              @if (lightboxPhoto()!.category) {
                <span class="ml-2 inline-block rounded bg-brand-600 px-2 py-0.5 text-xs font-semibold">{{ lightboxPhoto()!.category }}</span>
              }
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class OrderPhotoGalleryComponent {
  readonly photos = input<OrderAttachmentDto[]>([]);
  readonly photoCategories = input<string[]>(['BEFORE', 'AFTER', 'TANK_SEAL', 'OTHER']);
  readonly uploading = input(false);
  readonly uploadProgress = input('');
  readonly hasFile = input(false);
  readonly maxFileSizeMb = input(10);

  readonly uploadCategory = model('BEFORE');
  readonly upload = output<void>();
  readonly open = output<OrderAttachmentDto>();
  readonly delete = output<OrderAttachmentDto>();
  readonly categoryChange = output<{ photo: OrderAttachmentDto; category: string }>();
  readonly fileSelected = output<File[]>();

  readonly lightboxPhoto = signal<OrderAttachmentDto | null>(null);
  readonly dragActive = signal(false);
  readonly compressing = signal(false);
  readonly pendingCount = signal(0);

  protected onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    if (input.files && input.files.length > 0) {
      void this.processFiles(Array.from(input.files));
    }
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragActive.set(true);
  }

  protected onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragActive.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.dragActive.set(false);
    if (event.dataTransfer?.files && event.dataTransfer.files.length > 0) {
      const imageFiles = Array.from(event.dataTransfer.files).filter((f) =>
        f.type.startsWith('image/') || f.type === 'image/heic' || f.type === 'image/heif',
      );
      if (imageFiles.length > 0) {
        void this.processFiles(imageFiles);
      }
    }
  }

  private async processFiles(files: File[]): Promise<void> {
    this.compressing.set(true);
    this.pendingCount.set(files.length);
    try {
      const compressed = await compressImages(files);
      this.fileSelected.emit(compressed);
    } finally {
      this.compressing.set(false);
    }
  }

  protected getThumbUrl(photo: OrderAttachmentDto): string {
    return photo.filePath.startsWith('http') ? photo.filePath : `${API_URL}${photo.filePath}`;
  }

  protected getFullUrl(photo: OrderAttachmentDto): string {
    return photo.filePath.startsWith('http') ? photo.filePath : `${API_URL}${photo.filePath}`;
  }

  protected openLightbox(photo: OrderAttachmentDto): void {
    this.lightboxPhoto.set(photo);
  }

  protected closeLightbox(): void {
    this.lightboxPhoto.set(null);
  }
}