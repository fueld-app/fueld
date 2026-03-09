// ═══════════════════════════════════════════════════════════════════════
//  Credit Application — WhatsApp notification helper
// ═══════════════════════════════════════════════════════════════════════

import { getWhatsAppSettings } from '../admin/settings.service';
import { sendWhatsAppGroupMessage } from '../whatsapp/whatsapp.service';
import { getCreditManagerUserIds } from './credit-applications.service';

/**
 * Send a WhatsApp message about a new credit application to the default group.
 * No-ops gracefully when WhatsApp is disabled or no group is configured.
 */
export async function notifyCreditApplicationWhatsApp(message: string): Promise<void> {
  const waSettings = await getWhatsAppSettings();
  if (!waSettings.enabled || !waSettings.defaultGroupJid) return;

  // Use any credit-manager/admin user as the sender (WhatsApp falls back to any connected session)
  const userIds = await getCreditManagerUserIds();
  const senderId = userIds[0];
  if (!senderId) return;

  const result = await sendWhatsAppGroupMessage(senderId, waSettings.defaultGroupJid, `📋 ${message}`);
  if (!result.success) {
    console.warn('[CreditNotifications] WhatsApp group message failed:', result.message);
  }
}
