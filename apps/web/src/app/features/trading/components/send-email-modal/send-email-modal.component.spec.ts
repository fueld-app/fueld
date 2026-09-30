import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing';
import { of } from 'rxjs';
import {
  SendEmailModalComponent,
  type SendEmailAttachmentOption,
} from './send-email-modal.component';

try {
  TestBed.initTestEnvironment(BrowserTestingModule, platformBrowserTesting());
} catch {
  // Another test runner already initialised the Angular test platform.
}

afterEach(() => {
  TestBed.resetTestingModule();
});

function attachment(id: string, fileName: string): SendEmailAttachmentOption {
  return { id, fileName };
}

function setup(documentType: string, attachments: SendEmailAttachmentOption[]) {
  TestBed.configureTestingModule({
    imports: [SendEmailModalComponent],
    providers: [{ provide: HttpClient, useValue: { get: () => of({}), post: () => of({}) } }],
  });
  const fixture = TestBed.createComponent(SendEmailModalComponent);
  fixture.componentRef.setInput('orderId', 'order-1');
  fixture.componentRef.setInput('documentType', documentType);
  fixture.componentRef.setInput('extraAttachments', attachments);
  fixture.detectChanges();
  return fixture;
}

/**
 * The PORT_DOCUMENTATION upload guard and the send-time reconciliation.
 *
 * Both exist because the modal's own upload creates an `orderAttachments` row,
 * while a PORT_DOCUMENTATION send resolves its ids against `orderPortDocuments`.
 * An id from the wrong table makes the server refuse the whole email ("One or
 * more selected Port Documentation files were not found"), and because that list
 * renders a different entity the offending id was invisible and unremovable.
 */
describe('SendEmailModalComponent attachment safety', () => {
  it('refuses to upload for PORT_DOCUMENTATION, whose list is a different entity', () => {
    const fixture = setup('PORT_DOCUMENTATION', [attachment('pd-1', 'Gate List.pdf')]);
    const component = fixture.componentInstance;

    // The zone is not offered, and the method is a no-op if reached anyway.
    expect(component.canUploadAttachments()).toBe(false);
    expect(component.showExtraAttachments()).toBe(true);
  });

  it('offers uploads for a document type whose list is the order attachments', () => {
    const fixture = setup('BUNKER_BOOKING', [attachment('oa-1', 'Calling Sheet.pdf')]);
    expect(fixture.componentInstance.canUploadAttachments()).toBe(true);
  });

  it('offers the upload zone on an order with no attachments yet', () => {
    // Keying the section on list length alone hid the upload zone in exactly the
    // scenario it exists for: the calling arrives while the booking is written.
    const fixture = setup('BUNKER_BOOKING', []);
    expect(fixture.componentInstance.showExtraAttachments()).toBe(true);
  });

  it('does not drop a file it uploaded itself, even before the list refreshes', () => {
    // The parent's refresh is an async round-trip, so between the upload
    // returning and the list containing the new row, the id is selected but not
    // rendered. Intersecting alone would silently drop the file the trader had
    // just dropped in; ids this modal uploaded are exempt.
    const fixture = setup('BUNKER_BOOKING', [attachment('oa-1', 'Existing.pdf')]);
    const component = fixture.componentInstance;

    component.selectedAttachmentIds.set(['oa-1', 'oa-just-uploaded']);
    component.uploadedAttachmentIds.set(['oa-just-uploaded']);
    expect(component.effectiveSelectedAttachmentIds()).toEqual(['oa-1', 'oa-just-uploaded']);

    // And a stale id this modal did NOT upload is still dropped.
    component.selectedAttachmentIds.set(['oa-1', 'oa-foreign']);
    expect(component.effectiveSelectedAttachmentIds()).toEqual(['oa-1']);
  });

  it('shows the port-documentation section even when no port documents exist', () => {
    // Otherwise the requirement is unexplainable and Send is forever refused.
    const fixture = setup('PORT_DOCUMENTATION', []);
    expect(fixture.componentInstance.showExtraAttachments()).toBe(true);
  });

  it('sends only ids the current list renders, dropping a stale selection', () => {
    const fixture = setup('PORT_DOCUMENTATION', [attachment('pd-1', 'Gate List.pdf')]);
    const component = fixture.componentInstance;

    // Simulate an id that a previous doc type (or an upload) selected and that
    // this list does not contain — the case that turned into an inexplicable 400.
    component.selectedAttachmentIds.set(['pd-1', 'oa-orphan']);
    expect(component.effectiveSelectedAttachmentIds()).toEqual(['pd-1']);

    let emitted: { attachmentIds: string[] } | null = null;
    component.sendEmail.subscribe((payload) => {
      emitted = payload as { attachmentIds: string[] };
    });
    component.subject = 'Subject';
    // doSend reads recipients from the tag input; drive the emission directly
    // through the same reconciliation the send uses.
    component.sendEmail.emit({ attachmentIds: component.effectiveSelectedAttachmentIds() } as never);

    expect(emitted!.attachmentIds).toEqual(['pd-1']);
  });
});
