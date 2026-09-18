interface Env {
  ASSETS: Fetcher;
  API_ORIGIN: string;
  SITE_URL: string;
  STUDIO_ALLOWED_EMAIL: string;
  BLOG_ADMIN_TOKEN: string;
}

const apiRoute = /^\/studio-api\/(posts(?:\/[^/]+(?:\/archive)?)?|assets)$/u;

function jsonError(status: number, message: string) {
  return Response.json({ error: { code: 'STUDIO_ERROR', message } }, { status });
}

function isAllowedRoute(pathname: string, method: string) {
  const match = apiRoute.exec(pathname);
  if (!match) return false;
  const target = match[1] ?? '';
  if (target === 'posts') return method === 'GET' || method === 'POST';
  if (target === 'assets') return method === 'POST';
  if (target.endsWith('/archive')) return method === 'POST';
  return method === 'GET' || method === 'PUT' || method === 'DELETE';
}

async function proxyApi(request: Request, env: Env) {
  const incoming = new URL(request.url);
  if (!isAllowedRoute(incoming.pathname, request.method)) return jsonError(404, '工作台接口不存在');
  if (!env.BLOG_ADMIN_TOKEN) return jsonError(503, '工作台尚未配置后台凭据');

  const path = incoming.pathname.replace(/^\/studio-api/u, '/api/v1/admin');
  const target = new URL(`${path}${incoming.search}`, env.API_ORIGIN);
  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${env.BLOG_ADMIN_TOKEN}`,
  });
  const contentType = request.headers.get('Content-Type');
  const fileName = request.headers.get('X-File-Name');
  if (contentType) headers.set('Content-Type', contentType);
  if (fileName) headers.set('X-File-Name', fileName);

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
  });
  const responseHeaders = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
  });
  const requestId = upstream.headers.get('X-Request-Id');
  if (requestId) responseHeaders.set('X-Request-Id', requestId);
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}

function withSecurityHeaders(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('Content-Security-Policy', "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https://yimengweixing-api.yimengweixing-api.workers.dev; object-src 'none'; script-src 'self'; style-src 'self'");
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Referrer-Policy', 'no-referrer');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!ctx.access) return jsonError(401, 'Cloudflare Access 尚未启用');
    const identity = await ctx.access.getIdentity();
    const email = identity?.email?.toLocaleLowerCase('en-US');
    if (!email || email !== env.STUDIO_ALLOWED_EMAIL.toLocaleLowerCase('en-US')) {
      return jsonError(403, '当前账号无权访问写作工作台');
    }

    const url = new URL(request.url);
    if (url.pathname.startsWith('/studio-api/')) return proxyApi(request, env);
    if (request.method !== 'GET' && request.method !== 'HEAD') return jsonError(405, '不支持的请求方法');
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
