// Optional: your own free CORS proxy for RSS feeds, on Cloudflare Workers.
//
// Some sites don't let browser apps read their feeds directly. Letterbox then
// goes through a proxy. The default is a free public one; if you'd rather run
// your own:
//   1. Sign up at https://dash.cloudflare.com (free), Workers & Pages → Create → Worker.
//   2. Replace the example code with this file and Deploy.
//   3. In Letterbox Settings → RSS, set the proxy to:
//        https://<your-worker>.<you>.workers.dev/?url=
//
// ALLOWED_ORIGINS stops other websites from using your proxy.

const ALLOWED_ORIGINS = [
  'https://aleminopuy.github.io',
  'http://localhost:8000',
];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      Vary: 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (!ALLOWED_ORIGINS.includes(origin)) return new Response('Forbidden', { status: 403, headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    if (!target || !/^https?:\/\//i.test(target)) return new Response('Missing ?url=', { status: 400, headers: cors });

    const upstream = await fetch(target, {
      headers: { 'User-Agent': 'Letterbox RSS reader', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8, */*;q=0.5' },
      cf: { cacheTtl: 600 },
    });
    const headers = new Headers(cors);
    headers.set('Content-Type', upstream.headers.get('Content-Type') || 'text/plain');
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
