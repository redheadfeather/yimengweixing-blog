export interface AuthEnv {
  CACHE: KVNamespace;
  STUDIO_PASSWORD: string;
  SESSION_SIGNING_KEY: string;
}

const encoder = new TextEncoder();
const PRODUCTION_SESSION_COOKIE = '__Host-yimeng_studio';
const LOCAL_SESSION_COOKIE = 'yimeng_studio_local';
const SESSION_SECONDS = 12 * 60 * 60;
const FAILURE_WINDOW_SECONDS = 10 * 60;
const MAX_FAILURES = 5;

interface FailureState {
  count: number;
  blockedUntil: number;
}

function json(status: number, body: unknown, headers?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
  });
}

function error(status: number, message: string, headers?: HeadersInit) {
  return json(status, { error: { code: 'AUTH_ERROR', message } }, headers);
}

function base64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '');
}

function parseCookies(request: Request) {
  const cookies = new Map<string, string>();
  for (const part of (request.headers.get('Cookie') ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    cookies.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return cookies;
}

function sessionCookieName(request: Request) {
  return new URL(request.url).protocol === 'https:' ? PRODUCTION_SESSION_COOKIE : LOCAL_SESSION_COOKIE;
}

async function digest(value: string) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function secureEqual(actual: string, expected: string) {
  const [left, right] = await Promise.all([digest(actual), digest(expected)]);
  let difference = left.length ^ right.length;
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))));
}

async function sessionCookie(secret: string) {
  const expires = Math.floor(Date.now() / 1000) + SESSION_SECONDS;
  const nonce = crypto.randomUUID();
  const payload = `v1.${expires}.${nonce}`;
  return `${payload}.${await sign(payload, secret)}`;
}

export async function hasValidSession(request: Request, env: AuthEnv) {
  if (!env.SESSION_SIGNING_KEY) return false;
  const value = parseCookies(request).get(sessionCookieName(request));
  if (!value) return false;
  const parts = value.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const expires = Number(parts[1]);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(expires) || expires <= now || expires > now + SESSION_SECONDS + 60) return false;
  const payload = parts.slice(0, 3).join('.');
  return secureEqual(parts[3] ?? '', await sign(payload, env.SESSION_SIGNING_KEY));
}

export function isSameOrigin(request: Request) {
  const origin = request.headers.get('Origin');
  return Boolean(origin && origin === new URL(request.url).origin);
}

async function rateLimitKey(request: Request, env: AuthEnv) {
  const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
  return `studio:auth:fail:${base64Url(await digest(`${ip}:${env.SESSION_SIGNING_KEY}`)).slice(0, 32)}`;
}

async function readFailureState(key: string, env: AuthEnv): Promise<FailureState> {
  const stored = await env.CACHE.get(key, 'json') as FailureState | null;
  if (!stored || typeof stored.count !== 'number' || typeof stored.blockedUntil !== 'number') {
    return { count: 0, blockedUntil: 0 };
  }
  return stored;
}

async function login(request: Request, env: AuthEnv) {
  if (!isSameOrigin(request)) return error(403, '请求来源无效');
  if (!env.STUDIO_PASSWORD || !env.SESSION_SIGNING_KEY) return error(503, '工作台认证尚未配置');
  const key = await rateLimitKey(request, env);
  const failures = await readFailureState(key, env);
  const now = Math.floor(Date.now() / 1000);
  if (failures.blockedUntil > now) {
    const retryAfter = failures.blockedUntil - now;
    return error(429, `尝试次数过多，请在 ${Math.ceil(retryAfter / 60)} 分钟后重试`, { 'Retry-After': String(retryAfter) });
  }

  let password = '';
  try {
    const body = await request.json() as { password?: unknown };
    password = typeof body.password === 'string' ? body.password : '';
  } catch {
    return error(400, '请求格式无效');
  }
  if (!password || password.length > 256 || !(await secureEqual(password, env.STUDIO_PASSWORD))) {
    const count = failures.count + 1;
    const blockedUntil = count >= MAX_FAILURES ? now + FAILURE_WINDOW_SECONDS : 0;
    await env.CACHE.put(key, JSON.stringify({ count, blockedUntil }), { expirationTtl: FAILURE_WINDOW_SECONDS });
    return error(401, count >= MAX_FAILURES ? '尝试次数过多，账号已临时锁定' : '访问密码不正确');
  }

  await env.CACHE.delete(key);
  const cookie = await sessionCookie(env.SESSION_SIGNING_KEY);
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json(200, { data: { authenticated: true } }, {
    'Set-Cookie': `${sessionCookieName(request)}=${cookie}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly${secure}; SameSite=Strict`,
  });
}

function logout(request: Request) {
  if (!isSameOrigin(request)) return error(403, '请求来源无效');
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  return json(200, { data: { authenticated: false } }, {
    'Set-Cookie': `${sessionCookieName(request)}=; Path=/; Max-Age=0; HttpOnly${secure}; SameSite=Strict`,
  });
}

export async function handleAuthRoute(request: Request, env: AuthEnv) {
  const url = new URL(request.url);
  if (url.pathname === '/auth/status' && request.method === 'GET') {
    return json(200, { data: { authenticated: await hasValidSession(request, env) } });
  }
  if (url.pathname === '/auth/login' && request.method === 'POST') return login(request, env);
  if (url.pathname === '/auth/logout' && request.method === 'POST') return logout(request);
  if (url.pathname.startsWith('/auth/')) return error(404, '认证接口不存在');
  return null;
}
