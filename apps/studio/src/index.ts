import { handleAuthRoute, hasValidSession, isSameOrigin, type AuthEnv } from './auth';

interface Env {
  ASSETS: Fetcher;
  API: Fetcher;
  CACHE: KVNamespace;
  SITE_URL: string;
  BLOG_ADMIN_TOKEN: string;
  STUDIO_PASSWORD: string;
  SESSION_SIGNING_KEY: string;
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
  const target = new URL(`${path}${incoming.search}`, 'https://api.internal');
  const headers = new Headers({
    Accept: 'application/json',
    Authorization: `Bearer ${env.BLOG_ADMIN_TOKEN}`,
  });
  const contentType = request.headers.get('Content-Type');
  const fileName = request.headers.get('X-File-Name');
  if (contentType) headers.set('Content-Type', contentType);
  if (fileName) headers.set('X-File-Name', fileName);

  const upstream = await env.API.fetch(target, {
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
    const url = new URL(request.url);
    const authResponse = await handleAuthRoute(request, env as AuthEnv);
    if (authResponse) return authResponse;
    if (url.pathname.startsWith('/studio-api/')) {
      if (request.headers.get('X-Studio-Request') !== '1') return jsonError(403, '缺少工作台请求标记');
      if (!(await hasValidSession(request, env as AuthEnv))) return jsonError(401, '登录已过期，请重新验证');
      if (!['GET', 'HEAD'].includes(request.method) && !isSameOrigin(request)) return jsonError(403, '请求来源无效');
      return proxyApi(request, env);
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return jsonError(405, '不支持的请求方法');
    return withSecurityHeaders(await env.ASSETS.fetch(request));
  },
};
