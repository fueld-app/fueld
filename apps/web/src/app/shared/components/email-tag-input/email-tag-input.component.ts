import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  signal,
  computed,
  ElementRef,
  viewChild,
  inject,
  OnInit,
  OnDestroy,
  effect,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { HttpClient } from '@angular/common/http';
import { Subject, debounceTime, distinctUntilChanged, switchMap, of, takeUntil, catchError } from 'rxjs';
import { API_URL } from '@app/core/config/api';

// ═══════════════════════════════════════════════════════════════════════
//  Email Tag Input — Chip-style input with typeahead contact search
// ═══════════════════════════════════════════════════════════════════════

export interface EmailTag {
  email: string;
  name?: string;
  locked?: boolean; // Locked tags can't be removed (from admin rules)
}

interface ContactSuggestion {
  email: string;
  name: string;
  source: 'contact' | 'company_email';
}

@Component({
  selector: 'app-email-tag-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule],
  template: `
    <div
      class="flex flex-wrap items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-sm transition-colors min-h-[38px] cursor-text"
      [class]="focused() ? 'border-brand-500 ring-2 ring-brand-500/20' : 'border-gray-300'"
      (click)="focusInput()"
    >
      <!-- Tags -->
      @for (tag of tags(); track tag.email) {
        <span
          class="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium max-w-[220px]"
          [class]="tag.locked ? 'bg-blue-100 text-blue-800' : 'bg-gray-100 text-gray-700'"
          [title]="tag.name ? tag.name + ' <' + tag.email + '>' : tag.email"
        >
          <span class="truncate">{{ tag.name || tag.email }}</span>
          @if (!tag.locked && !readonly()) {
            <button
              type="button"
              (click)="removeTag(tag); $event.stopPropagation()"
              class="ml-0.5 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full hover:bg-gray-300 text-gray-500 hover:text-gray-700"
            >
              <svg class="h-2.5 w-2.5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          }
        </span>
      }

      <!-- Text input -->
      @if (!readonly()) {
        <input
          #inputEl
          type="text"
          [placeholder]="tags().length === 0 ? placeholder() : ''"
          [(ngModel)]="inputValue"
          (focus)="onFocus()"
          (blur)="onBlur()"
          (keydown)="onKeydown($event)"
          (input)="onInput($event)"
          class="min-w-[120px] flex-1 border-none bg-transparent p-0 text-sm placeholder:text-gray-400 focus:outline-none focus:ring-0"
        />
      }
    </div>

    <!-- Dropdown suggestions -->
    @if (showDropdown() && suggestions().length > 0) {
      <div class="relative">
        <div class="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          @for (s of suggestions(); track s.email) {
            <button
              type="button"
              (mousedown)="selectSuggestion(s); $event.preventDefault()"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 transition-colors"
            >
              <div class="flex-1 min-w-0">
                <span class="font-medium text-gray-900 truncate">{{ s.name }}</span>
                <span class="text-gray-500 ml-1 truncate">&lt;{{ s.email }}&gt;</span>
              </div>
              <span class="shrink-0 text-xs text-gray-400">{{ s.source === 'contact' ? 'Contact' : 'Email' }}</span>
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class EmailTagInputComponent implements OnInit, OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly destroy$ = new Subject<void>();

  // ── Inputs ──
  /** Order ID for contact search context */
  readonly orderId = input<string>('');
  /** Placeholder text */
  readonly placeholder = input('Add email...');
  /** Read-only mode */
  readonly readonly = input(false);

  // ── Outputs ──
  readonly tagsChange = output<EmailTag[]>();

  // ── State ──
  readonly tags = signal<EmailTag[]>([]);
  readonly focused = signal(false);
  readonly suggestions = signal<ContactSuggestion[]>([]);
  readonly showDropdown = signal(false);
  inputValue = '';

  private readonly inputEl = viewChild<ElementRef<HTMLInputElement>>('inputEl');
  private readonly search$ = new Subject<string>();

  constructor() {
    // Emit whenever tags change
    effect(() => {
      const t = this.tags();
      this.tagsChange.emit(t);
    });
  }

  ngOnInit(): void {
    this.search$
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          const oid = this.orderId();
          if (!oid || q.length < 1) return of([]);
          return this.http.get<{ success: boolean; data: ContactSuggestion[] }>(
            `${API_URL}/orders/${oid}/contacts/search`,
            { params: { q } },
          ).pipe(
            switchMap((res) => of(res.success ? res.data : [])),
            catchError(() => of([] as ContactSuggestion[])),
          );
        }),
        takeUntil(this.destroy$),
      )
      .subscribe((results) => {
        // Filter out already-added emails
        const existing = new Set(this.tags().map((t) => t.email.toLowerCase()));
        this.suggestions.set(results.filter((r) => !existing.has(r.email.toLowerCase())));
      });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  /** Set tags programmatically (from parent) */
  setTags(tags: EmailTag[]): void {
    this.tags.set([...tags]);
  }

  /** Get current emails as string array */
  getEmails(): string[] {
    return this.tags().map((t) => t.email);
  }

  focusInput(): void {
    this.inputEl()?.nativeElement?.focus();
  }

  onFocus(): void {
    this.focused.set(true);
    if (this.inputValue.length > 0) {
      this.showDropdown.set(true);
    }
  }

  onBlur(): void {
    this.focused.set(false);
    // Delay to allow click on suggestion
    setTimeout(() => {
      this.showDropdown.set(false);
      // Commit any typed email on blur
      this.commitInput();
    }, 200);
  }

  onInput(event: Event): void {
    const val = ((event.target as HTMLInputElement).value ?? '').trim();
    this.search$.next(val);
    this.showDropdown.set(val.length > 0);
  }

  onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',' || event.key === 'Tab') {
      event.preventDefault();
      this.commitInput();
    } else if (event.key === 'Backspace' && this.inputValue === '') {
      // Remove last non-locked tag
      const current = this.tags();
      const lastRemovable = [...current].reverse().find((t) => !t.locked);
      if (lastRemovable) {
        this.removeTag(lastRemovable);
      }
    }
  }

  selectSuggestion(s: ContactSuggestion): void {
    this.addTag({ email: s.email, name: s.name });
    this.inputValue = '';
    this.suggestions.set([]);
    this.showDropdown.set(false);
    this.focusInput();
  }

  removeTag(tag: EmailTag): void {
    if (tag.locked) return;
    this.tags.update((tags) => tags.filter((t) => t.email !== tag.email));
  }

  private commitInput(): void {
    const val = this.inputValue.trim().replace(/,$/g, '');
    if (!val) return;

    // Basic email validation
    if (val.includes('@') && val.includes('.')) {
      this.addTag({ email: val });
    }
    this.inputValue = '';
    this.suggestions.set([]);
    this.showDropdown.set(false);
  }

  private addTag(tag: EmailTag): void {
    const exists = this.tags().some((t) => t.email.toLowerCase() === tag.email.toLowerCase());
    if (!exists) {
      this.tags.update((tags) => [...tags, tag]);
    }
  }
}
