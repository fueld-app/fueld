import { Injectable, inject, signal } from '@angular/core';
import { HttpClient, type HttpResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type { ApiResponse } from '@fueld/types';
import { API_URL } from '@app/core/config/api';
import type {
  SendEmailPayload,
  DocumentEmailType,
  SendWhatsAppPayload,
} from '../../components/send-email-modal/send-email-modal.component';
import type { SendInquiryPayload, SendInquiryWhatsAppPayload } from '../../components/send-inquiry-modal/send-inquiry-modal.component';
import type { SendEmailAttachmentOption } from '../../components/send-email-modal/send-email-modal.component';

@Injectable({ providedIn: 'root' })
export class OrderCommunicationService {
  private readonly http = inject(HttpClient);

  readonly waLinked = signal(false);
  readonly emailDocumentType = signal<DocumentEmailType>('INVOICE');
  readonly emailPdfFileName = signal('');

  async checkWhatsAppLinked(): Promise<void> {
    try {
      const res = await firstValueFrom(
        this.http.get<ApiResponse<{ linked: boolean; whatsappEnabled?: boolean }>>(`${API_URL}/whatsapp/status`),
      );
      if (res.success && res.data?.linked && res.data?.whatsappEnabled !== false) {
        this.waLinked.set(true);
      }
    } catch {
      // Not linked — keep default false
    }
  }

  openSendEmailModal(
    docType: DocumentEmailType,
    orderId: string,
    activeOrderSupplierId: string | null,
    emailModal: any,
    orderNumber: string | null,
    showToast: (type: 'success' | 'error', msg: string) => void,
  ): void {
    if (!orderId) return;

    this.emailDocumentType.set(docType);
    const orderSupplierId = docType === 'NOMINATION' ? activeOrderSupplierId : null;

    this.http
      .post<ApiResponse<{
        recipientEmail: string;
        recipientName: string;
        ccEmails: string[];
        bccEmails: string[];
        defaultCcEmails: Array<{ email: string; label: string | null }>;
        defaultBccEmails: Array<{ email: string; label: string | null }>;
        subject: string;
        htmlBody: string;
        senderName: string;
        senderEmail: string;
      }>>(`${API_URL}/orders/${orderId}/email-defaults`, { documentType: docType, orderSupplierId })
      .subscribe({
        next: (res) => {
          if (!res.success || !res.data) {
            showToast('error', 'Failed to load email defaults.');
            return;
          }
          const d = res.data;
          this.emailPdfFileName.set(
            docType === 'PORT_DOCUMENTATION'
              ? ''
              : `${docType}_${orderNumber ?? orderId.slice(0, 8)}.pdf`,
          );

          emailModal?.showWith({
            recipientEmail: d.recipientEmail,
            ccEmails: d.ccEmails,
            bccEmails: d.bccEmails ?? [],
            defaultCcEmails: d.defaultCcEmails ?? [],
            defaultBccEmails: d.defaultBccEmails ?? [],
            subject: d.subject,
            htmlBody: d.htmlBody,
          });
        },
        error: () => {
          showToast('error', 'Failed to load email defaults.');
        },
      });
  }

  onSendEmail(
    payload: SendEmailPayload,
    orderId: string,
    emailModal: any,
    showToast: (type: 'success' | 'error', msg: string) => void,
  ): void {
    if (!orderId) return;

    this.http
      .post<ApiResponse<{ success: boolean; message: string; channel: string; pdfFileName: string }>>(
        `${API_URL}/orders/${orderId}/send-email`,
        {
          documentType: payload.documentType,
          orderSupplierId: payload.orderSupplierId ?? null,
          recipientEmail: payload.recipientEmail,
          ccEmails: payload.ccEmails,
          bccEmails: payload.bccEmails,
          subject: payload.subject,
          htmlBody: payload.htmlBody,
          attachmentIds: payload.attachmentIds,
        },
      )
      .subscribe({
        next: (res) => {
          emailModal?.done();
          const channel = res.data?.channel === 'GRAPH' ? 'via Outlook' : 'via email';
          showToast('success', `${payload.documentType} sent to ${payload.recipientEmail} ${channel}`);
        },
        error: () => {
          emailModal?.done();
          showToast('error', 'Failed to send email. Please check that SMTP is configured in Admin → Settings → Integrations.');
        },
      });
  }

  async onSendInvoiceWhatsApp(
    payload: SendWhatsAppPayload,
    orderId: string,
    orderNumber: string | null,
    activeOrderSupplierId: string | null,
    emailModal: any,
    showToast: (type: 'success' | 'error', msg: string) => void,
  ): Promise<void> {
    if (!orderId) return;

    const pdfEndpoints: Record<DocumentEmailType, string> = {
      OFFER: 'offer',
      CONFIRMATION: 'offer',
      NOMINATION: 'nomination',
      PROFORMA: 'proforma',
      INVOICE: 'invoice',
      PORT_DOCUMENTATION: 'invoice',
    };
    const docLabels: Record<DocumentEmailType, string> = {
      OFFER: 'Offer',
      CONFIRMATION: 'Confirmation',
      NOMINATION: 'Nomination',
      PROFORMA: 'Proforma Invoice',
      INVOICE: 'Invoice',
      PORT_DOCUMENTATION: 'Port Documentation',
    };

    try {
      const nominationQuery = payload.documentType === 'NOMINATION' && activeOrderSupplierId
        ? `?orderSupplierId=${encodeURIComponent(activeOrderSupplierId)}`
        : '';
      const blob = await firstValueFrom(
        this.http.get(`${API_URL}/orders/${orderId}/${pdfEndpoints[payload.documentType]}/pdf${nominationQuery}`, { responseType: 'blob' }),
      );
      const base64 = await this.blobToBase64(blob);
      const orderNum = orderNumber ?? orderId;
      const label = docLabels[payload.documentType];
      const fileName = `${label.replace(/\s+/g, '_')}_${orderNum}.pdf`;

      await firstValueFrom(
        this.http.post<ApiResponse<{ success: boolean }>>(`${API_URL}/whatsapp/send`, {
          phone: payload.phone,
          message: payload.bodyText || `${label} — ${orderNum}`,
          pdfBase64: base64,
          pdfFileName: fileName,
        }),
      );
      emailModal?.waDone();
      showToast('success', `${label} sent via WhatsApp to ${payload.phone}`);
    } catch {
      emailModal?.waDone();
      showToast('error', 'Failed to send via WhatsApp. Is your device linked?');
    }
  }

  async onSendPdfWhatsApp(
    ev: { phone: string; blob: Blob; fileName: string },
    orderNumber: string | null,
    pdfModal: any,
    showToast: (type: 'success' | 'error', msg: string) => void,
  ): Promise<void> {
    try {
      const base64 = await this.blobToBase64(ev.blob);
      await firstValueFrom(
        this.http.post<ApiResponse<{ success: boolean }>>(`${API_URL}/whatsapp/send`, {
          phone: ev.phone,
          message: `${ev.fileName} — Order ${orderNumber ?? ''}`,
          pdfBase64: base64,
          pdfFileName: ev.fileName,
        }),
      );
      pdfModal?.waDone();
      showToast('success', `PDF sent via WhatsApp to ${ev.phone}`);
    } catch {
      pdfModal?.waDone();
      showToast('error', 'Failed to send via WhatsApp. Is your device linked?');
    }
  }

  openSendInquiryModal(
    orderId: string,
    hasLineItems: boolean,
    hasEta: boolean,
    inquiryModal: any,
    showToast: (type: 'success' | 'error', msg: string) => void,
  ): void {
    if (!hasLineItems) {
      showToast('error', 'Add at least one line item before sending inquiries.');
      return;
    }
    if (!hasEta) {
      showToast('error', 'Set an ETA before sending inquiries.');
      return;
    }
    inquiryModal?.show();
  }

  onSendInquiry(
    payload: SendInquiryPayload,
    orderId: string,
    inquiryModal: any,
    showToast: (type: 'success' | 'error', msg: string) => void,
    onSuccess: () => void,
  ): void {
    if (!orderId) return;

    this.http
      .post<{ success: boolean; message: string; data: Array<{ recipientId: string; recipientName: string; email: string; success: boolean; error?: string }> }>(
        `${API_URL}/orders/${orderId}/inquiry/send`,
        {
          suppliers: payload.suppliers,
          recipientEmails: payload.recipientEmails,
          subject: payload.subject,
          htmlBody: payload.htmlBody,
          eta: payload.eta ?? null,
          etd: payload.etd ?? null,
          responseDeadlineAt: payload.responseDeadlineAt,
          reminderEnabled: payload.reminderEnabled ?? false,
        },
      )
      .subscribe({
        next: (res) => {
          inquiryModal?.done();
          if (res.success) {
            const successCount = res.data?.filter((r: any) => r.success).length ?? 0;
            const total = res.data?.length ?? 0;
            showToast('success', `Inquiry sent to ${successCount}/${total} recipients`);
            if (successCount > 0) {
              onSuccess();
              inquiryModal?.close();
            }
          } else {
            showToast('error', res.message || 'Failed to send inquiries');
          }
        },
        error: () => {
          inquiryModal?.done();
          showToast('error', 'Failed to send inquiry emails. Check SMTP settings in Admin.');
        },
      });
  }

  async onSendInquiryWhatsApp(
    payload: SendInquiryWhatsAppPayload,
    orderId: string,
    inquiryModal: any,
    showToast: (type: 'success' | 'error', msg: string) => void,
    onSuccess: () => void,
  ): Promise<void> {
    if (!orderId || payload.recipients.length === 0) return;

    try {
      const res = await firstValueFrom(
        this.http.post<ApiResponse<Array<{ success: boolean }>>>(`${API_URL}/orders/${orderId}/inquiry/send-whatsapp`, {
          recipients: payload.recipients,
          subject: payload.subject,
          eta: payload.eta ?? null,
          etd: payload.etd ?? null,
          responseDeadlineAt: payload.responseDeadlineAt ?? null,
          reminderEnabled: payload.reminderEnabled ?? false,
        }),
      );
      inquiryModal?.waDone();

      if (!res.success) {
        showToast('error', res.message || 'Failed to send inquiry via WhatsApp. Is your device linked?');
        return;
      }

      const successCount = res.data?.filter((result: any) => result.success).length ?? 0;

      if (successCount > 0) {
        showToast('success', `Inquiry sent via WhatsApp to ${successCount}/${payload.recipients.length} recipients`);
        inquiryModal?.close();
        onSuccess();
        return;
      }

      showToast('error', 'Failed to send inquiry via WhatsApp. Is your device linked?');
    } catch {
      inquiryModal?.waDone();
      showToast('error', 'Failed to send inquiry via WhatsApp. Is your device linked?');
    }
  }

  private blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1] ?? result);
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
}