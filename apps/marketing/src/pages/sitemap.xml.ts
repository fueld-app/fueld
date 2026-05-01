import type { APIRoute } from 'astro';

const pages = ['/', '/features/', '/deployment/', '/privacy/'];

export const GET: APIRoute = ({ site }) => {
  const base = site ?? new URL('https://fueld.example.com');
  const lastmod = new Date().toISOString();
  const urls = pages
    .map((path) => {
      const loc = new URL(path, base).toString();
      return `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>`;
    })
    .join('');

  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`,
    {
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
      },
    },
  );
};