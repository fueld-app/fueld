const siteUrl = (import.meta.env.PUBLIC_SITE_URL ?? 'https://fueld.example.com').replace(/\/$/, '');
const contactEmail = import.meta.env.PUBLIC_CONTACT_EMAIL ?? 'sales@fueld.com';

export const siteConfig = {
  name: 'Fueld',
  legalName: 'Fueld',
  titleSuffix: 'Dedicated bunker trading software',
  description:
    'Dedicated bunker trading software for teams that need data sovereignty, regional hosting control, and mobile-ready workflows without multi-tenant compromise.',
  siteUrl,
  socialImage: '/og-card.svg',
  nav: [
    { href: '/features/', label: 'Features' },
    { href: '/deployment/', label: 'Deployment' },
    { href: '/privacy/', label: 'Privacy' },
    { href: '/#contact', label: 'Book a meeting' },
  ],
  contactEmail,
};

export const regionOptions = [
  'Northern Europe',
  'Southern Europe',
  'Middle East',
  'Asia-Pacific',
  'North America',
  'Other / To be decided',
];