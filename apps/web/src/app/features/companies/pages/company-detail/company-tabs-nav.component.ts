import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface TabDef {
  key: string;
  label: string;
  icon: string;
}

/**
 * Company detail tab navigation.
 *
 * Extracted into its own component so the company-detail-page template
 * contains no <svg> elements. An Angular compiler/renderer quirk marked
 * elements following inline <svg> markup (inside @if/@for control flow)
 * with the SVG namespace in production builds — the router-outlet then
 * created child component hosts as SVGElement, which never lay out
 * (0×0, offsetParent undefined) — the "blank tabs" bug.
 */
@Component({
  selector: 'app-company-tabs-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="mb-6 -mx-4 px-4 md:mx-0 md:px-0">
      <nav
        class="flex gap-1 overflow-x-auto border-b border-gray-200 dark:border-line pb-px scrollbar-hide"
        aria-label="Company sections"
      >
        @for (tab of tabs; track tab.key) {
          <a
            [routerLink]="[tab.key]"
            routerLinkActive
            #rla="routerLinkActive"
            role="tab"
            [attr.aria-selected]="rla.isActive"
            [attr.aria-controls]="'tab-panel-' + tab.key"
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
export class CompanyTabsNavComponent {
  readonly tabs = [
    { key: 'overview', label: 'Overview', icon: 'M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z' },
    { key: 'commercial', label: 'Commercial', icon: 'M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941' },
    { key: 'fleet', label: 'Fleet', icon: 'M6.75 2.994a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM4.094 6.75A3.094 3.094 0 017.188 3.656H9.75a.75.75 0 010 1.5H7.188a1.594 1.594 0 00-1.594 1.594v.469a.75.75 0 01-1.5 0v-.469zM2.25 10.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM2.25 13.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM2.25 16.5a.75.75 0 01.75-.75h6a.75.75 0 010 1.5H3a.75.75 0 01-.75-.75zM13.5 6.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 9.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 12.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75zM13.5 15.75a.75.75 0 01.75-.75h3a.75.75 0 010 1.5h-3a.75.75 0 01-.75-.75z' },
    { key: 'group', label: 'Group', icon: 'M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.072M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z' },
    { key: 'risk', label: 'Risk', icon: 'M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285zm0 13.036h.008v.008H12v-.008z' },
    { key: 'comments', label: 'Comments', icon: 'M7.5 8.25h9m-9 3H12m-9.75 1.5h17.25c.621 0 1.125-.504 1.125-1.125V4.875c0-.621-.504-1.125-1.125-1.125H3.375A1.125 1.125 0 002.25 4.875v10.5c0 .621.504 1.125 1.125 1.125z' },
    { key: 'activity', label: 'Activity', icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z' },
    { key: 'payments', label: 'Payments', icon: 'M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3.75h6a4.5 4.5 0 004.5-4.5V5.25A2.25 2.25 0 0015 3H6a2.25 2.25 0 00-2.25 2.25v11.25A4.5 4.5 0 004.5 21h6z' },
  ] as const;
}