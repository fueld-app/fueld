import { TestBed } from '@angular/core/testing';
import { OrderStatus } from '@fueld/types';
import { HeaderActionsComponent } from './header-actions.component';

describe('HeaderActionsComponent', () => {
  async function createComponent(options?: {
    status?: OrderStatus;
    hasPortDocumentationDocuments?: boolean;
  }) {
    await TestBed.configureTestingModule({
      imports: [HeaderActionsComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(HeaderActionsComponent);
    fixture.componentRef.setInput('orderId', 'order-1');
    fixture.componentRef.setInput('status', options?.status ?? OrderStatus.Confirmed);
    fixture.componentRef.setInput('hasPortDocumentationDocuments', options?.hasPortDocumentationDocuments ?? false);
    fixture.detectChanges();

    return fixture.componentInstance;
  }

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('shows Send Port Documentation for non-inquiry orders with port documentation files', async () => {
    const component = await createComponent({
      status: OrderStatus.Confirmed,
      hasPortDocumentationDocuments: true,
    });

    expect(component.displayActions().some((action) => action.key === 'send-port-documentation')).toBe(true);
  });

  it('hides Send Port Documentation when no port documentation files exist', async () => {
    const component = await createComponent({
      status: OrderStatus.Confirmed,
      hasPortDocumentationDocuments: false,
    });

    expect(component.displayActions().some((action) => action.key === 'send-port-documentation')).toBe(false);
  });
});