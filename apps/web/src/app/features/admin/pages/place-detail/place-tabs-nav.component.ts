import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

export interface PlaceTabDef {
  key: string;
  label: string;
  icon: string;
}

/**
 * Place detail tab navigation.
 *
 * Extracted into its own component so the place-detail-page template
 * contains no <svg> elements. An Angular production-build quirk marked
 * elements following inline <svg> markup with the SVG namespace — the
 * router-outlet then created child component hosts as SVGElement, which
 * never lay out (0×0, blank tabs). See company-tabs-nav.component.ts.
 */
@Component({
  selector: 'app-place-tabs-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 -mx-4 px-4 md:mx-0 md:px-0">
      <nav class="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-line pb-px scrollbar-hide" aria-label="Place sections">
        @for (tab of tabs(); track tab.key) {
          <a
            [routerLink]="[tab.key]"
            routerLinkActive
            #rla="routerLinkActive"
            role="tab"
            [attr.aria-selected]="rla.isActive"
            [id]="'tab-' + tab.key"
            class="group inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus:outline-none"
            [class]="rla.isActive
              ? 'border-blue-600 text-blue-700 dark:text-blue-400'
              : 'border-transparent text-gray-500 dark:text-muted hover:border-gray-300 hover:text-gray-700'"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path [attr.d]="tab.icon" />
            </svg>
            {{ tab.label }}
          </a>
        }
      </nav>
    </div>
  `,
})
export class PlaceTabsNavComponent {
  readonly tabs = input.required<readonly PlaceTabDef[]>();
}