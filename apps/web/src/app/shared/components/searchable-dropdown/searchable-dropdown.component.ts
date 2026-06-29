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
} from '@angular/core';
import { FormsModule } from '@angular/forms';

// ═══════════════════════════════════════════════════════════════════════
//  Searchable Dropdown — Filterable select with keyboard nav
// ═══════════════════════════════════════════════════════════════════════

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
        class="w-full rounded-lg border border-gray-300 dark:border-line-strong bg-white dark:bg-surface px-3 py-2 text-sm shadow-sm placeholder:text-gray-400 dark:placeholder:text-muted focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
        [class.pr-16]="clearable() && selected()"
        [class.pr-8]="!clearable() || !selected()"
      />
      <!-- Clear button -->
      @if (clearable() && selected()) {
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
      <!-- Chevron -->
      <svg
        class="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-muted"
        xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"
      >
        <path fill-rule="evenodd" d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z" clip-rule="evenodd" />
      </svg>
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
            [attr.aria-selected]="opt.value === selected()"
            [class.bg-brand-50]="i === highlightIndex()"
            [class.text-brand-700]="i === highlightIndex()"
            [class.font-semibold]="opt.value === selected()"
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
                @if (opt.value === selected()) {
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
  readonly selectionChange = output<string>();
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
  private readonly minDropdownWidth = 320;

  readonly filteredOptions = computed(() => {
    const term = this.searchText().toLowerCase();
    // In async mode, parent controls options — no local filtering
    if (this.asyncSearch()) return this.options();
    if (!term) return this.options();
    return this.options().filter((o) => o.label.toLowerCase().includes(term));
  });

  private clickOutside = (e: MouseEvent) => {
    if (!this.elRef.nativeElement.contains(e.target)) this.close();
  };

  constructor() {
    effect(() => {
      if (this.isOpen()) return;
      const sel = this.selected();
      const match = this.options().find((o) => o.value === sel);
      this.searchText.set(match?.label ?? this.selectedLabel() ?? '');
    });
  }

  ngOnInit(): void {
    document.addEventListener('click', this.clickOutside);
  }

  ngOnDestroy(): void {
    document.removeEventListener('click', this.clickOutside);
    if (this.searchDebounceTimer) clearTimeout(this.searchDebounceTimer);
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

  private updateDropdownPosition(): void {
    const rect = this.triggerRef.nativeElement.getBoundingClientRect();
    this.dropdownTop.set(rect.bottom + 4); // 4px gap
    this.dropdownLeft.set(rect.left);
    this.dropdownWidth.set(Math.max(rect.width, this.minDropdownWidth));
  }

  close(): void {
    this.isOpen.set(false);
    // Restore display text — fall back to selectedLabel for async fields where options may be empty
    const sel = this.selected();
    const match = this.options().find((o) => o.value === sel);
    this.searchText.set(match?.label ?? this.selectedLabel() ?? '');
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
    this.searchText.set(opt.label);
    this.selectionChange.emit(opt.value);
    this.isOpen.set(false);
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
