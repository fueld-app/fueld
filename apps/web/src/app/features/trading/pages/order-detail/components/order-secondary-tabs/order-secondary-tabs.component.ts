import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
} from '@angular/core';

export interface OrderSecondaryTab {
  id: string;
  label: string;
  visible: boolean;
}

@Component({
  selector: 'app-order-secondary-tabs',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visibleTabs().length > 0) {
      <div class="mt-6">
        <!-- Tab bar -->
        <div class="flex items-center gap-1 border-b border-gray-200">
          @for (tab of visibleTabs(); track tab.id) {
            <button
              type="button"
              (click)="activeTab.set(tab.id)"
              class="px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px"
              [class]="activeTab() === tab.id
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'"
            >
              {{ tab.label }}
            </button>
          }
        </div>

        <!-- Tab content -->
        <div class="mt-4">
          @if (activeTab() === 'platts') {
            <ng-content select="[tab-platts]" />
          }
          @if (activeTab() === 'email') {
            <ng-content select="[tab-email]" />
          }
          @if (activeTab() === 'activity') {
            <ng-content select="[tab-activity]" />
          }
          @if (activeTab() === 'comments') {
            <ng-content select="[tab-comments]" />
          }
        </div>
      </div>
    }
  `,
})
export class OrderSecondaryTabsComponent {
  readonly plattsVisible = input(false);
  readonly emailVisible = input(false);
  readonly activityVisible = input(true);
  readonly commentsVisible = input(false);

  protected readonly activeTab = signal('activity');

  protected readonly visibleTabs = () => {
    const tabs: OrderSecondaryTab[] = [
      { id: 'platts', label: 'Platts Signals', visible: this.plattsVisible() },
      { id: 'email', label: 'Email History', visible: this.emailVisible() },
      { id: 'activity', label: 'Activity', visible: this.activityVisible() },
      { id: 'comments', label: 'Comments', visible: this.commentsVisible() },
    ];
    const visible = tabs.filter((t) => t.visible);
    // Set default active tab to first visible one
    if (visible.length > 0 && !visible.some((t) => t.id === this.activeTab())) {
      this.activeTab.set(visible[0]!.id);
    }
    return visible;
  };
}
