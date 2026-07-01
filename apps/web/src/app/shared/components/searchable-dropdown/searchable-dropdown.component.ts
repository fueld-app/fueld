import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  ElementRef,
  ViewChild,
  inject,
  OnInit,
  OnDestroy,
  effect,
  HostListener,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

//  Searchable Dropdown — Filterable select with keyboard nav + optional multi-select

export interface DropdownOption {
  value: string;
  label: string;
  actionLabel?: string;
}

@Component({
  selector: 'app-searchable-dropdown',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  host: { class: 'relative block' },
  template: `
    <div class="relative" #trigger>
      @if (multiSelect() && selectedValues().length > 0) {
        <!-- Multi-select: chips + inline input -->
        <div
          class="flex min-h-[38px] flex-wrap items-center gap-1 rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-2 py-1.5 text-sm shadow-sm focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-600/20"
          (click)="onInputClick()"
        >
          @for (chip of selectedChips(); track chip.value) {
            <span class="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-500/15 px-2 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-400">
              {{ chip.label }}
              <button
                type="button"
                (click)="removeValue($event, chip.value)"
                class="text-brand-600 hover:text-brand-800 dark:text-brand-400 dark:hover:text-brand-300"
                aria-label="Remove {{ chip.label }}"
              >
                <svg class="h-3 w-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </span>
          }
          <input
            type="text"
            [value]="searchText()"
            (input)="onSearch($event)"
            (focus)="open()"
            (click)="onInputClick()"
            (keydown.arrowDown)="onArrowDown($event)"
            (keydown.arrowUp)="onArrowUp($event)"
            (keydown.enter)="onEnter($event)"
            (keydown.escape)="close()"
            [placeholder]="selectedValues().length ? '' : placeholder()"
            [attr.aria-expanded]="isOpen()"
            aria-haspopup="listbox"
            role="combobox"
            autocomplete="off"
            class="min-w-[60px] flex-1 border-0 bg-transparent p-0 text-sm outline-none ring-0 placeholder:text-gray-400 dark:placeholder:text-muted"
          />
        </div>
      } @else {
        <!-- Single-select: plain input -->
        <input
          type="text"
          [value]="searchText()"
          (input)="onSearch($event)"
          (focus)="open()"
          (click)="onInputClick()"
          (keydown.arrowDown)="onArrowDown($event)"
          (keydown.arrowUp)="onArrowUp($event)"
          (keydown.enter)="onEnter($event)"
          (keydown.escape)="close()"
          [placeholder]="placeholder()"
          [attr.aria-expanded]="isOpen()"
          aria-haspopup="listbox"
          role="combobox"
          autocomplete="off"
          class="w-full rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
          [class.pr-16]="clearable() && selected()"
          [class.pr-8]="!clearable() || !selected()"
        />
      }
      <!-- Clear button (single-select only) -->
      @if (clearable() && selected() && !multiSelect()) {
        <button
          type="button"
          (click)="clear($event)"
          class="absolute right-7 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 dark:text-muted hover:bg-gray-100 dark:hover:bg-surface-tint-strong hover:text-gray-600 focus:outline-none"
          aria-label="Clear selection"
        >
          <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      }
      <!-- Chevron (single-select only, to avoid overlap with chips) -->
      @if (!multiSelect() || selectedValues().length === 0) {
        <svg
          class="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-muted"
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
        >
          <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
        </svg>
      }
    </div>

    <!-- Dropdown panel (fixed positioning to escape overflow containers) -->
    @if (isOpen()) {
      <ul
        role="listbox"
        [style.top.px]="dropdownTop()"
        [style.left.px]="dropdownLeft()"
        [style.width.px]="dropdownWidth()"
        class="fixed z-[9999] max-h-48 overflow-auto rounded-lg border border-gray-200 dark:border-line bg-white dark:bg-surface py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none"
      >
        @for (opt of filteredOptions(); track opt.value; let i = $index) {
          <li
            role="option"
            [attr.aria-selected]="isOptionSelected(opt)"
            [class.bg-brand-50]="i === highlightIndex()"
            [class.text-brand-700]="i === highlightIndex()"
            [class.font-semibold]="isOptionSelected(opt)"
            class="cursor-pointer px-3 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-surface-tint"
            (mousedown)="onOptionPointerDown($event, opt)"
            (mouseenter)="highlightIndex.set(i)"
          >
            <div class="flex items-center justify-between gap-3">
              <span>{{ opt.label }}</span>
              <div class="flex items-center gap-2">
                @if (opt.actionLabel) {
                  <span class="rounded-full border border-blue-200 dark:border-blue-500/30 bg-blue-50 dark:bg-blue-500/15 px-2 py-0.5 text-[10px] font-semibold text-blue-700 dark:text-blue-400">
                    {{ opt.actionLabel }}
                  </span>
                }
                @if (isOptionSelected(opt)) {
                  <svg class="h-4 w-4 text-brand-600 dark:text-brand-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fill-rule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clip-rule="evenodd" />
                  </svg>
                }
              </div>
            </div>
          </li>
        } @empty {
          @if (loading()) {
            <li class="flex items-center gap-2 px-3 py-2 text-gray-400 dark:text-muted italic">
              <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
              </svg>
              Searching…
            </li>
          } @else if (searchText().length > 0 && searchText().length < minSearchLength()) {
            <li class="px-3 py-2 text-gray-400 dark:text-muted italic">Type at least {{ minSearchLength() }} characters</li>
          } @else {
            <li class="px-3 py-2 text-gray-400 dark:text-muted italic">No results</li>
          }
        }
      </ul>
    }
  `,
})
export class SearchableDropdownComponent implements OnInit, OnDestroy {
  readonly options = input.required<DropdownOption[]>();
  readonly selected = input<string>('');
  /** Label for the currently-selected value, used as fallback when the option isn't in the options list (e.g. async search after refresh). */
  readonly selectedLabel = input<string>('');
  readonly placeholder = input<string>('Select...');
  readonly clearable = input(false);
  /** Minimum characters before emitting searchChange (default 2) */
  readonly minSearchLength = input(2);
  /** Show a loading spinner in the dropdown */
  readonly loading = input(false);
  /** Enable async/typeahead mode — disables local filtering, parent controls options */
  readonly asyncSearch = input(false);
  /** Enable multi-select mode — user can select multiple values shown as chips */
  readonly multiSelect = input(false);
  /** Selected values for multi-select mode */
  readonly selectedValues = input<string[]>([]);
  readonly selectionChange = output<string>();
  /** Emits selected values array in multi-select mode */
  readonly multiSelectionChange = output<string[]>();
  /** Emits search term when user types >= minSearchLength chars. Use for async/typeahead search. */
  readonly searchChange = output<string>();

  private readonly elRef = inject(ElementRef);
  @ViewChild('trigger', { static: true }) triggerRef!: ElementRef<HTMLElement>;

  readonly isOpen = signal(false);
  readonly searchText = signal('');
  readonly highlightIndex = signal(0);
  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // Fixed position values for the dropdown
  readonly dropdownTop = signal(0);
  readonly dropdownLeft = signal(0);
  readonly dropdownWidth = signal(0);
  private readonly minDropdownWidth = 200;
  private readonly dropdownMaxHeight = 192; // max-h-48 = 12rem = 192px

  /** Chips to display for selected values in multi-select mode */
  readonly selectedChips = computed(() => {
    if (!this.multiSelect()) return [];
    const selected = this.selectedValues();
    return this.options()
      .filter((o) => selected.includes(o.value))
      .map((o) => ({ value: o.value, label: o.label }));
  });

  readonly filteredOptions = computed(() => {
    const term = this.searchText().toLowerCase();
    // In async mode, parent controls options — no local filtering
    if (this.asyncSearch()) return this.options();
    if (!term) return this.options();
    return this.options().filter((o) => o.label.toLowerCase().includes(term));
  });

  @HostListener('window:resize')
  onResize(): void {
    if (this.isOpen()) this.close();
  }

  private clickOutside = (e: MouseEvent) => {
    if (!this.elRef.nativeElement.contains(e.target)) this.close();
  };

  // Capture-mode scroll listener catches scroll on ANY element (e.g. overflow-y-auto containers)
  private captureScroll = () => {
    if (this.isOpen()) this.close();
  };

  constructor() {
    effect(() => {
      if (this.isOpen()) return;
      if (this.multiSelect()) return; // In multi-select, search text is managed differently
      const sel = this.selected();
      const match = this.options().find((o) => o.value === sel);
      this.searchText.set(match?.label ?? this.selectedLabel() ?? '');
    });
  }

  ngOnInit(): void {
    document.addEventListener('click', this.clickOutside);
    document.addEventListener('scroll', this.captureScroll, true); // capture = catch all scrollable ancestors
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.clickOutside);
    document.removeEventListener('scroll', this.captureScroll, true);
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
  }

  /** Click on input — reopen dropdown if closed (fixes click-to-reopen when already focused) */
  onInputClick(): void {
    if (!this.isOpen()) this.open();
  }

  open(): void {
    this.updateDropdownPosition();
    this.isOpen.set(true);
    this.searchText.set('');
    this.highlightIndex.set(0);
    // For async search, trigger an initial search so first matches show without typing
    if (this.asyncSearch()) {
      this.searchChange.emit('');
    }
  }

  isOptionSelected(opt: DropdownOption): boolean {
    if (this.multiSelect()) return this.selectedValues().includes(opt.value);
    return opt.value === this.selected();
  }

  private updateDropdownPosition(): void {
    const rect = this.triggerRef.nativeElement.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    const width = Math.max(rect.width, this.minDropdownWidth);

    // Default: position below the input. Flip above if not enough space below.
    let top = rect.bottom + 4; // 4px gap
    if (top + this.dropdownMaxHeight > viewportHeight && rect.top - 4 - this.dropdownMaxHeight > 0) {
      top = rect.top - 4 - this.dropdownMaxHeight;
    }

    // Clamp left so the dropdown doesn't overflow the right edge of the viewport
    let left = rect.left;
    if (left + width > viewportWidth) {
      left = Math.max(0, viewportWidth - width - 8);
    }

    this.dropdownTop.set(top);
    this.dropdownLeft.set(left);
    this.dropdownWidth.set(width);
  }

  close(): void {
    this.isOpen.set(false);
    if (!this.multiSelect()) {
      // Restore display text — fall back to selectedLabel for async fields where options may be empty
      const sel = this.selected();
      const match = this.options().find((o) => o.value === sel);
      this.searchText.set(match?.label ?? this.selectedLabel() ?? '');
    } else {
      this.searchText.set('');
    }
  }

  onSearch(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.searchText.set(val);
    this.highlightIndex.set(0);
    if (!this.isOpen()) this.isOpen.set(true);

    // Emit searchChange for async/typeahead with debounce
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
    if (val.length >= this.minSearchLength()) {
      this.searchDebounceTimer = setTimeout(() => {
        this.searchChange.emit(val);
      }, 300);
    }
  }

  selectOption(opt: DropdownOption): void {
    if (this.multiSelect()) {
      const current = this.selectedValues();
      const isSelected = current.includes(opt.value);
      const next = isSelected
        ? current.filter((v) => v !== opt.value)
        : [...current, opt.value];
      this.multiSelectionChange.emit(next);
      // Keep dropdown open, clear search for next selection
      this.searchText.set('');
      this.highlightIndex.set(0);
      // Re-calculate position since chips may have changed the input height
      this.updateDropdownPosition();
    } else {
      this.searchText.set(opt.label);
      this.selectionChange.emit(opt.value);
      this.isOpen.set(false);
    }
  }

  /** Remove a selected value in multi-select mode (chip X button) */
  removeValue(event: Event, value: string): void {
    event.stopPropagation();
    event.preventDefault();
    const next = this.selectedValues().filter((v) => v !== value);
    this.multiSelectionChange.emit(next);
  }

  onOptionPointerDown(event: MouseEvent, opt: DropdownOption): void {
    event.preventDefault();
    event.stopPropagation();
    this.selectOption(opt);
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

  clear(event: Event): void {
    event.stopPropagation();
    event.preventDefault();
    this.searchText.set('');
    this.selectionChange.emit('');
    this.close();
  }
}