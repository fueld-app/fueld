// ═══════════════════════════════════════════════════════════════════════
//  RFQ Parser — Extracts structured RFQ data from incoming messages
//
//  Parses common bunker RFQ patterns from WhatsApp DMs:
//  - Vessel name + IMO
//  - Port / delivery place
//  - Products (VLSFO, LSMGO, MGO, IFO380, etc.)
//  - Quantities
//  - ETA / delivery dates
//
//  Returns null if the message doesn't look like an RFQ.
// ═══════════════════════════════════════════════════════════════════════

export interface ParsedRFQ {
  vesselName: string | null;
  imo: string | null;
  port: string | null;
  products: ParsedProduct[];
  eta: string | null;        // ISO date string if parseable
  rawText: string;
  senderPhone: string;
  senderName: string | null;
  confidence: number;        // 0-1, how likely this is an RFQ
}

export interface ParsedProduct {
  name: string;
  quantity: number | null;
  unit: string;              // MT, CBM, etc.
}

// Common bunker product patterns
const PRODUCT_PATTERNS: Array<{ regex: RegExp; name: string }> = [
  { regex: /\bVLSFO\b/i, name: 'VLSFO' },
  { regex: /\bLSMGO\b/i, name: 'LSMGO' },
  { regex: /\bHSFO\b/i, name: 'HSFO' },
  { regex: /\bIFO\s*380\s*CST\b/i, name: 'IFO380CST' },
  { regex: /\bIFO\s*380\b/i, name: 'IFO380CST' },
  { regex: /\bIFO\s*180\b/i, name: 'IFO180' },
  { regex: /\bMGO\b/i, name: 'MGO' },
  { regex: /\bMDO\b/i, name: 'MDO' },
  { regex: /\bLUBE(?:S)?\b/i, name: 'LUBE' },
  { regex: /\bGAS\s*OIL\b/i, name: 'GASOIL' },
  { regex: /\bULSD\b/i, name: 'ULSD' },
];

// Quantity pattern:  "500 MT", "1,200 CBM", "500mt", etc.
const QTY_REGEX = /([\d,]+(?:\.\d+)?)\s*(MT|CBM|KL|LT|TONS?|TONNES?)\b/gi;

// Vessel name + IMO patterns
const IMO_REGEX = /\bIMO[:\s]*(\d{7})\b/i;
const VESSEL_PATTERNS = [
  /(?:MV|M\/V|MT|M\/T|vessel)[:\s]+["']?([A-Z][A-Za-z0-9\s\-'.]+?)["']?\s*(?:\(|,|–|-|$|\bIMO)/im,
  /(?:vessel|ship|v\/n)[:\s]+["']?([A-Z][A-Za-z0-9\s\-'.]+?)["']?\s*(?:\(|,|–|-|$)/im,
];

// Port / place patterns
const PORT_PATTERNS = [
  /(?:port|place|delivery\s*(?:at|place)?|anchorage|eta\s*(?:at)?)[:\s]+([A-Za-z\s\-',().]+?)(?:\s*(?:on|around|eta|etd|,|\.|\n|$))/im,
  /(?:at|in)\s+(?:port\s+(?:of\s+)?)?([A-Z][A-Za-z\s\-',()]+?)(?:\s+(?:on|around|eta|between|\d)|\s*(?:,|\.|\n|$))/im,
];

// Date patterns (various formats)
const DATE_PATTERNS = [
  /(?:ETA|ETD|delivery\s*date|arrival|around|on)[:\s]+(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/i,
  /(?:ETA|ETD|delivery\s*date|arrival|around|on)[:\s]+(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{2,4})/i,
  /(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/,
];

/**
 * Attempt to extract RFQ fragments from a text message.
 * Returns null if the message doesn't look like an RFQ at all.
 */
export function parseRFQ(
  text: string,
  senderPhone: string,
  senderName: string | null,
): ParsedRFQ | null {
  if (!text || text.length < 15) return null;

  // Detect products
  const products: ParsedProduct[] = [];
  for (const { regex, name } of PRODUCT_PATTERNS) {
    if (regex.test(text)) {
      products.push({ name, quantity: null, unit: 'MT' });
    }
  }

  // Extract quantities near product names
  // Try patterns like "VLSFO 500 MT" or "500 MT VLSFO"
  for (const product of products) {
    const nearbyQtyPattern = new RegExp(
      `${product.name}[:\\s]*([\\d,]+(?:\\.\\d+)?)\\s*(MT|CBM|KL)` +
      `|([\\d,]+(?:\\.\\d+)?)\\s*(MT|CBM|KL)\\s*(?:of\\s+)?${product.name}`,
      'i',
    );
    const qtyMatch = text.match(nearbyQtyPattern);
    if (qtyMatch) {
      const qtyStr = qtyMatch[1] || qtyMatch[3];
      const unit = qtyMatch[2] || qtyMatch[4];
      if (qtyStr) {
        product.quantity = parseFloat(qtyStr.replace(/,/g, ''));
        product.unit = unit?.toUpperCase() ?? 'MT';
      }
    }
  }

  // If no specific product-qty matches, try standalone quantities
  if (products.length > 0 && products.every((p) => p.quantity === null)) {
    const allQty: Array<{ qty: number; unit: string }> = [];
    let m: RegExpExecArray | null;
    const regex = new RegExp(QTY_REGEX.source, QTY_REGEX.flags);
    while ((m = regex.exec(text)) !== null) {
      allQty.push({ qty: parseFloat(m[1].replace(/,/g, '')), unit: m[2].toUpperCase() });
    }
    // Assign quantities to products in order
    for (let i = 0; i < Math.min(products.length, allQty.length); i++) {
      products[i].quantity = allQty[i].qty;
      products[i].unit = allQty[i].unit;
    }
  }

  // Extract vessel
  let vesselName: string | null = null;
  for (const pattern of VESSEL_PATTERNS) {
    const m = text.match(pattern);
    if (m?.[1]) {
      vesselName = m[1].trim().replace(/\s+/g, ' ');
      break;
    }
  }

  // Extract IMO
  const imoMatch = text.match(IMO_REGEX);
  const imo = imoMatch?.[1] ?? null;

  // Extract port
  let port: string | null = null;
  for (const pattern of PORT_PATTERNS) {
    const m = text.match(pattern);
    if (m?.[1]) {
      port = m[1].trim().replace(/\s+/g, ' ');
      // Clean up trailing prepositions
      port = port.replace(/\s+(on|around|between|eta|etd|for)$/i, '').trim();
      if (port.length < 2 || port.length > 60) port = null;
      else break;
    }
  }

  // Extract date
  let eta: string | null = null;
  for (const pattern of DATE_PATTERNS) {
    const m = text.match(pattern);
    if (m?.[1]) {
      try {
        const d = new Date(m[1]);
        if (!isNaN(d.getTime())) {
          eta = d.toISOString();
        }
      } catch {
        // unparseable date — keep null
      }
      break;
    }
  }

  // Calculate confidence score
  let confidence = 0;
  if (products.length > 0) confidence += 0.35;
  if (vesselName) confidence += 0.25;
  if (port) confidence += 0.2;
  if (imo) confidence += 0.1;
  if (eta) confidence += 0.1;

  // Also check for RFQ-like keywords
  const rfqKeywords = /\b(?:enquiry|inquiry|RFQ|request\s+for\s+quot|quotation|quote|bunker|stem|requirement|pls\s+quote|kindly\s+quote|please\s+quote)\b/i;
  if (rfqKeywords.test(text)) confidence += 0.2;

  // Don't return if confidence is too low
  if (confidence < 0.3) return null;

  return {
    vesselName,
    imo,
    port,
    products,
    eta,
    rawText: text,
    senderPhone,
    senderName,
    confidence: Math.min(confidence, 1),
  };
}
