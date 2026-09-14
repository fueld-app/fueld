const siteUrl = (import.meta.env.PUBLIC_SITE_URL ?? 'https://fueld.example.com').replace(/\/$/, '');
const contactEmail = import.meta.env.PUBLIC_CONTACT_EMAIL ?? 'sales@fueld.app';

export const siteConfig = {
  name: 'Fueld',
  legalName: 'Fueld',
  titleSuffix: 'Dedicated bunker trading software',
  description:
    'Dedicated bunker trading software: RFQ to BDN with WhatsApp parsing, open banking, sanctions screening, Platts pricing, QuickBooks reconciliation, and mobile workflows — on infrastructure you control, never a shared SaaS pool.',
  siteUrl,
  socialImage: '/og-card.png',
  nav: [
    { href: '/features/', label: 'Features' },
    { href: '/deployment/', label: 'Deployment' },
    { href: '/privacy/', label: 'Privacy' },
    { href: '/#contact', label: 'Book a demo' },
  ],
  contactEmail,
  address: {
    line1: 'Shoreline 13, Palm Jumeirah',
    line2: 'Dubai, UAE',
  },
};

export const regionOptions = [
  'Northern Europe',
  'Southern Europe',
  'Middle East',
  'Asia-Pacific',
  'North America',
  'Other / To be decided',
];