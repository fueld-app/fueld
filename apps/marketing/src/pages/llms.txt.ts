import type { APIRoute } from 'astro';
import { siteConfig } from '../config/site';

const body = `# Fueld

Fueld is dedicated bunker trading software focused on data sovereignty, deployment control, and mobile-ready operational workflows.

## Summary
- Dedicated deployment, not a shared multi-tenant data pool.
- Self-hosted, on-premises, or dedicated managed infrastructure.
- Regional hosting choices aligned to policy and customer requirements.
- Mobile-ready workflows spanning inquiry, documents, credit, risk, and reporting.

## Key pages
- / : homepage and primary positioning
- /features/ : product and workflow coverage
- /deployment/ : deployment models and region control
- /privacy/ : privacy and sovereignty framing

## Contact
- Email: ${siteConfig.contactEmail}
- Primary CTA: Netlify-hosted contact form on the homepage
`;

export const GET: APIRoute = () =>
  new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });