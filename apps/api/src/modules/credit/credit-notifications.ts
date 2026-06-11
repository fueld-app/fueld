// ═══════════════════════════════════════════════════════════════════════
//  Credit Application — WhatsApp notification helper
// ═══════════════════════════════════════════════════════════════════════

import { sendTemplatedGroupMessage } from '../whatsapp/whatsapp.service';

/**
 * Send a WhatsApp message about a credit application event to the default group.
 * Uses configurable notification rules. No-ops gracefully when rule is missing or disabled.
 */
export async function notifyCreditApplicationWhatsApp(
  tenantId: string,
  eventType: 'credit_application_submitted' | 'credit_application_processed',
  context: Record<string, string | number | undefined>,
): Promise<void> {
  const result = await sendTemplatedGroupMessage(tenantId, eventType, context);
  if (!result.success) {
    console.warn('[CreditNotifications] WhatsApp group message failed:', result.message);
  }
}
