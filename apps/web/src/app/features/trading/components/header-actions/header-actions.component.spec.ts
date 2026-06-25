import { TestBed } from '@angular/core/testing';
import { OrderStatus } from '@fueld/types';
import { HeaderActionsComponent } from './header-actions.component';

describe('HeaderActionsComponent', () => {
  async function createComponent(options?: {
    status?: OrderStatus;
    hasPortDocumentationDocuments?: boolean;
    portDocumentationEnabled?: boolean;
    isLight?: boolean;
  }) {
    await TestBed.configureTestingModule({
      imports: [HeaderActionsComponent],
    }).compileComponents();

    const fixture = TestBed.createComponent(HeaderActionsComponent);
    fixture.componentRef.setInput('orderId', 'order-1');
    fixture.componentRef.setInput('status', options?.status ?? OrderStatus.Confirmed);
    fixture.componentRef.setInput('hasPortDocumentationDocuments', options?.hasPortDocumentationDocuments ?? false);
    fixture.componentRef.setInput('portDocumentationEnabled', options?.portDocumentationEnabled ?? false);
    if (options?.isLight) fixture.componentRef.setInput('isLight', true);
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
      portDocumentationEnabled: true,
    });

    expect(component.displayActions().some((action) => action.key === 'send-port-documentation')).toBe(true);
  });

  it('enables Send Port Documentation when feature is enabled even without existing files', async () => {
    const component = await createComponent({
      status: OrderStatus.Confirmed,
      hasPortDocumentationDocuments: false,
      portDocumentationEnabled: true,
    });

    const action = component.displayActions().find((item) => item.key === 'send-port-documentation');

    expect(action).toBeDefined();
    expect(action?.disabled).toBe(false);
  });

  it('hides Send Port Documentation when port documentation is disabled', async () => {
    const component = await createComponent({
      status: OrderStatus.Confirmed,
      hasPortDocumentationDocuments: true,
      portDocumentationEnabled: false,
    });

    expect(component.displayActions().some((action) => action.key === 'send-port-documentation')).toBe(false);
  });

  it('restricts LIGHT users to cancel + mark delivered + convert-to-order only', async () => {
    const component = await createComponent({ status: OrderStatus.Confirmed, isLight: true });
    const keys = component.displayActions().map((a) => a.key);

    expect(keys).toEqual(expect.arrayContaining(['cancel-order', 'mark-delivered']));
    // No financial/email/document actions for LIGHT users.
    expect(keys).not.toContain('send-invoice');
    expect(keys).not.toContain('send-confirmation');
    expect(keys).not.toContain('mark-paid');
    expect(keys).not.toContain('generate-invoice');
  });

  it('shows convert-to-order for LIGHT users on an inquiry', async () => {
    const component = await createComponent({ status: OrderStatus.Inquiry, isLight: true });
    const keys = component.displayActions().map((a) => a.key);

    expect(keys).toContain('convert-to-order');
  });

  it('shows cancel-inquiry (not cancel-order) for LIGHT users on an inquiry', async () => {
    const component = await createComponent({ status: OrderStatus.Inquiry, isLight: true });
    const keys = component.displayActions().map((a) => a.key);

    expect(keys).toContain('cancel-inquiry');
    expect(keys).not.toContain('cancel-order');
    expect(keys).not.toContain('mark-delivered');
  });
});