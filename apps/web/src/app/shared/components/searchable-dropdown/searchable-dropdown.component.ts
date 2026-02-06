import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  ElementRef,
  inject,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

// ═══════════════════════════════════════════════════════════════════════
//  Searchable Dropdown — Filterable select with keyboard nav
// ═══════════════════════════════════════════════════════════════════════

export interface DropdownOption {
  value: string;
  label: string;
}

@Component({
  selector: 'app-searchable-dropdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  host: { class: 'relative block' },
  template: `
    <div class="relative">
      <input
        type="text"
        [value]="searchText()"
        (input)="onSearch($event)"
        (focus)="open()"
        (keydown.arrowDown)="onArrowDown($event)"
        (keydown.arrowUp)="onArrowUp($event)"
        (keydown.enter)="onEnter($event)"
        (keydown.escape)="close()"
        [placeholder]="placeholder()"
        [attr.aria-expanded]="isOpen()"
        aria-haspopup="listbox"
        role="combobox"
        autocomplete="off"
        class="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm shadow-sm
               placeholder:text-gray-400 focus:border-brand-500 focus:outline-none
               focus:ring-2 focus:ring-brand-500/20"
      />
      <!-- Chevron -->
      <svg
        class="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
      >
        <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
      </svg>
    </div>

    <!-- Dropdown panel -->
    @if (isOpen()) {
      <ul
        role="listbox"
        class="absolute z-50 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-gray-200
               bg-white py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none"
      >
        @for (opt of filteredOptions(); track opt.value; let i = $index) {
          <li
            role="option"
            [attr.aria-selected]="opt.value === selected()"
            [class.bg-brand-50]="i === highlightIndex()"
            [class.text-brand-700]="i === highlightIndex()"
            [class.font-semibold]="opt.value === selected()"
            class="cursor-pointer px-3 py-2 transition-colors hover:bg-gray-50"
            (click)="selectOption(opt)"
            (mouseenter)="highlightIndex.set(i)"
          >
            {{ opt.label }}
            @if (opt.value === selected()) {
              <svg class="ml-auto inline h-4 w-4 text-brand-600" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd" />
              </svg>
            }
          </li>
        } @empty {
          <li class="px-3 py-2 text-gray-400 italic">No results</li>
        }
      </ul>
    }
  `,
})
export class SearchableDropdownComponent implements OnInit, OnDestroy {
  readonly options = input.required<DropdownOption[]>();
  readonly selected = input<string>('');
  readonly placeholder = input<string>('Select...');
  readonly selectionChange = output<string>();

  private readonly elRef = inject(ElementRef);

  readonly isOpen = signal(false);
  readonly searchText = signal('');
  readonly highlightIndex = signal(0);

  readonly filteredOptions = computed(() => {
    const term = this.searchText().toLowerCase();
    if (!term) return this.options();
    return this.options().filter((o) => o.label.toLowerCase().includes(term));
  });

  private clickOutside = (e: MouseEvent) => {
    if (!this.elRef.nativeElement.contains(e.target)) this.close();
  };

  ngOnInit(): void {
    // Set initial display text from selected value
    const sel = this.selected();
    if (sel) {
      const match = this.options().find((o) => o.value === sel);
      if (match) this.searchText.set(match.label);
    }
    document.addEventListener('click', this.clickOutside);
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.clickOutside);
  }

  open(): void {
    this.isOpen.set(true);
    this.searchText.set('');
    this.highlightIndex.set(0);
  }

  close(): void {
    this.isOpen.set(false);
    // Restore display text
    const sel = this.selected();
    const match = this.options().find((o) => o.value === sel);
    this.searchText.set(match?.label ?? '');
  }

  onSearch(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchText.set(val);
    this.highlightIndex.set(0);
    if (!this.isOpen()) this.isOpen.set(true);
  }

  selectOption(opt: DropdownOption): void {
    this.searchText.set(opt.label);
    this.selectionChange.emit(opt.value);
    this.isOpen.set(false);
  }

  onArrowDown(event: Event): void {
    event.preventDefault();
    const max = this.filteredOptions().length - 1;
    this.highlightIndex.update((i) => Math.min(i + 1, max));
  }

  onArrowUp(event: Event): void {
    event.preventDefault();
    this.highlightIndex.update((i) => Math.max(i - 1, 0));
  }

  onEnter(event: Event): void {
    event.preventDefault();
    const opts = this.filteredOptions();
    const idx = this.highlightIndex();
    if (opts[idx]) this.selectOption(opts[idx]);
  }
}
