import {
  Component,
  ChangeDetectionStrategy,
  input,
  signal,
  OnInit,
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
        <div class="flex items-center gap-1 border-b border-gray-200 overflow-x-auto scrollbar-none">
          @for (tab of visibleTabs(); track tab.id) {
            <button
              type="button"
              (click)="activeTab.set(tab.id)"
              class="whitespace-nowrap px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px"
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
          @if (activeTab() === 'comments') {
            <ng-content select="[tab-comments]" />
          }
          @if (activeTab() === 'activity') {
            <ng-content select="[tab-activity]" />
          }
          @if (activeTab() === 'email') {
            <ng-content select="[tab-email]" />
          }
          @if (activeTab() === 'platts') {
            <ng-content select="[tab-platts]" />
          }
          @if (activeTab() === 'suppliers') {
            <ng-content select="[tab-suppliers]" />
          }
          @if (activeTab() === 'capture') {
            <ng-content select="[tab-capture]" />
          }
        </div>
      </div>
    }
  `,
})
export class OrderSecondaryTabsComponent implements OnInit {
  readonly plattsVisible = input(false);
  readonly emailVisible = input(false);
  readonly activityVisible = input(false);
  readonly commentsVisible = input(false);
  readonly suppliersVisible = input(false);
  readonly captureVisible = input(false);
  readonly defaultTab = input('comments');

  protected readonly activeTab = signal('comments');

  ngOnInit(): void {
    this.activeTab.set(this.defaultTab());
  }

  protected readonly visibleTabs = () => {
    const tabs: OrderSecondaryTab[] = [
      { id: 'comments', label: 'Comments', visible: this.commentsVisible() },
      { id: 'activity', label: 'Activity', visible: this.activityVisible() },
      { id: 'email', label: 'Email History', visible: this.emailVisible() },
      { id: 'platts', label: 'Platts Signals', visible: this.plattsVisible() },
      { id: 'suppliers', label: 'Suppliers', visible: this.suppliersVisible() },
      { id: 'capture', label: 'Manual Capture', visible: this.captureVisible() },
    ];
    const visible = tabs.filter((t) => t.visible);
    if (visible.length > 0 && !visible.some((t) => t.id === this.activeTab())) {
      this.activeTab.set(visible[0]!.id);
    }
    return visible;
  };
}
