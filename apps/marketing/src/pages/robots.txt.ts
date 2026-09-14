import type { APIRoute } from 'astro';

export const GET: APIRoute = ({ site }) => {
  const base = site ? site.toString().replace(/\/$/, '') : 'https://example.com';
  const body = [`User-agent: *`, `Allow: /`, ``, `Sitemap: ${base}/sitemap.xml`, `# llms.txt: ${base}/llms.txt`].join('\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
};