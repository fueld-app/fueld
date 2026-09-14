import type { APIRoute } from 'astro';
import { siteConfig } from '../config/site';

const body = `# Fueld

Fueld is dedicated bunker trading software focused on data sovereignty, deployment control, and mobile-ready operational workflows.

## Summary
- Dedicated deployment, not a shared multi-tenant data pool.
- Self-hosted, on-premises, or dedicated managed infrastructure.
- Regional hosting choices aligned to policy and customer requirements.
- Mobile-ready workflows spanning inquiry, documents, credit, risk, and reporting.

## What Fueld does
- RFQ to barge dispatch to BDN on one screen — quotes, credit checks, documents, delivery.
- WhatsApp Business and Outlook/Exchange threads parsed into deals, attachments filed to the record.
- Open banking (PSD2) via Enable Banking: bank balances and transactions reconciled to invoices.
- Sanctions screening of counterparties and vessels across OpenSanctions, Seasearcher, and Companies House, with auto-hold and compliance override approval.
- Platts price reports parsed into the price book; formula-priced quotes reprice automatically.
- Vessel intelligence via Lloyd's List Intelligence: positions, characteristics, port calls feed stem planning.
- QuickBooks reconciliation from delivered BDN to paid invoice, with a live bank feed.
- Microsoft 365 SSO (Entra ID) and passkeys — no new passwords to manage.
- Built-in private LLM inside the tenant boundary for drafting, summarising, and extraction.

## Key pages
- / : homepage and primary positioning
- /features/ : product and workflow coverage
- /deployment/ : deployment models and region control
- /privacy/ : privacy and sovereignty framing
- /privacy-policy/ : website privacy policy (legal)
- /terms/ : website terms of use (legal)

## Contact
- Email: ${siteConfig.contactEmail}
- Address: ${siteConfig.address.line1}, ${siteConfig.address.line2}
- Primary CTA: contact form on the homepage
`;

export const GET: APIRoute = () =>
  new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });