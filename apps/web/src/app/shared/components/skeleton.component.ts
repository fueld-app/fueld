import { Component, ChangeDetectionStrategy, input } from '@angular/core';

// ═══════════════════════════════════════════════════════════════════════
//  Skeleton loading primitives.
//
//  <app-skeleton class="h-4 w-32" />                    — one shimmer block
//  <app-skeleton-table [rows]="8" [cols]="6" />         — full table mimic
//  <app-skeleton-cards [rows]="4" />                    — mobile card list
//
//  Shimmer runs on a muted tint so it works in both themes without config.
// ═══════════════════════════════════════════════════════════════════════

@Component({
  selector: 'app-skeleton',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
  styles: [
    `
      :host {
        display: block;
        border-radius: 0.375rem;
        background: var(--skel-base, rgba(128, 138, 155, 0.16));
        overflow: hidden;
        position: relative;
        min-height: 0.75rem;
      }
      :host::after {
        content: '';
        position: absolute;
        inset: 0;
        transform: translateX(-100%);
        background: linear-gradient(
          90deg,
          transparent,
          var(--skel-shine, rgba(255, 255, 255, 0.14)),
          transparent
        );
        animation: fueld-skel-shimmer 1.4s ease-in-out infinite;
      }
      [data-theme='light'] :host::after {
        --skel-shine: rgba(255, 255, 255, 0.55);
      }
      @keyframes fueld-skel-shimmer {
        100% { transform: translateX(100%); }
      }
      @media (prefers-reduced-motion: reduce) {
        :host::after { animation: none; }
      }
    `,
  ],
})
export class SkeletonComponent {}

@Component({
  selector: 'app-skeleton-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkeletonComponent],
  template: `
    <div class="divide-y divide-gray-100 dark:divide-line">
      @for (row of rowsArr; track $index) {
        <div class="flex items-center gap-4 px-4 py-3" [attr.aria-hidden]="true">
          @for (col of colsArr; track $index) {
            <app-skeleton
              class="h-3.5"
              [style.width.%]="widths[$index % widths.length]"
              [style.max-width.rem]="maxRems[$index % maxRems.length]"
            ></app-skeleton>
          }
          <app-skeleton class="ml-auto h-6 w-16 rounded-md shrink-0"></app-skeleton>
        </div>
      }
    </div>
  `,
})
export class SkeletonTableComponent {
  readonly rows = input(8);
  readonly cols = input(6);

  get rowsArr(): number[] {
    return Array.from({ length: this.rows() });
  }

  get colsArr(): number[] {
    return Array.from({ length: this.cols() });
  }

  // Pseudo-random-ish column widths, stable per column index
  readonly widths = [10, 18, 22, 14, 12, 10, 16, 12, 14, 10];
  readonly maxRems = [8, 12, 14, 10, 9, 8, 11, 9, 10, 8];
}

@Component({
  selector: 'app-skeleton-cards',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [SkeletonComponent],
  template: `
    <div class="space-y-3">
      @for (row of rowsArr; track $index) {
        <div
          class="rounded-xl border border-gray-200 bg-white p-4 dark:border-line dark:bg-surface"
          [attr.aria-hidden]="true"
        >
          <div class="flex items-center justify-between gap-3">
            <app-skeleton class="h-4 w-32"></app-skeleton>
            <app-skeleton class="h-5 w-16 rounded-full"></app-skeleton>
          </div>
          <div class="mt-3 flex items-center gap-2">
            <app-skeleton class="h-3 w-24"></app-skeleton>
            <app-skeleton class="h-3 w-20"></app-skeleton>
            <app-skeleton class="h-3 w-16"></app-skeleton>
          </div>
          <div class="mt-3 flex items-center justify-between">
            <app-skeleton class="h-3 w-40"></app-skeleton>
            <app-skeleton class="h-3 w-14"></app-skeleton>
          </div>
        </div>
      }
    </div>
  `,
})
export class SkeletonCardsComponent {
  readonly rows = input(4);

  get rowsArr(): number[] {
    return Array.from({ length: this.rows() });
  }
}