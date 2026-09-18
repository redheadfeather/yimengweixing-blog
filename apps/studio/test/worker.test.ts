import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

function memoryKv() {
  const values = new Map<string, string>();
  return {
    get: vi.fn(async (key: string, type?: string) => {
      const value = values.get(key) ?? null;
      return type === 'json' && value ? JSON.parse(value) : value;
    }),
    put: vi.fn(async (key: string, value: string) => { values.set(key, value); }),
    delete: vi.fn(async (key: string) => { values.delete(key); }),
  } as unknown as KVNamespace;
}

const assets = { fetch: vi.fn(() => Promise.resolve(new Response('studio'))) } as unknown as Fetcher;
const api = { fetch: vi.fn(() => Promise.resolve(Response.json({ data: [] }))) } as unknown as Fetcher;
const env = {
  ASSETS: assets,
  API: api,
  CACHE: memoryKv(),
  SITE_URL: 'https://site.example.com',
  BLOG_ADMIN_TOKEN: 'admin-secret',
  STUDIO_PASSWORD: 'correct-horse-battery-staple',
  SESSION_SIGNING_KEY: 'a-very-long-signing-key-used-only-in-tests',
};
const ctx = {} as ExecutionContext;

function request(path: string, init?: RequestInit) {
  return new Request(`https://studio.example.com${path}`, init);
}

async function login(password = env.STUDIO_PASSWORD) {
  const response = await worker.fetch(request('/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'https://studio.example.com' },
    body: JSON.stringify({ password }),
  }), env, ctx);
  return response;
}

afterEach(() => vi.restoreAllMocks());

describe('studio password sessions', () => {
  it('serves the login shell without a session', async () => {
    const response = await worker.fetch(request('/'), env, ctx);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('studio');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });

  it('reports an unauthenticated status before login', async () => {
    const response = await worker.fetch(request('/auth/status'), env, ctx);
    expect(await response.json()).toMatchObject({ data: { authenticated: false } });
  });

  it('rejects an invalid password and cross-origin login', async () => {
    const wrong = await login('wrong-password');
    const crossOrigin = await worker.fetch(request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' },
      body: JSON.stringify({ password: env.STUDIO_PASSWORD }),
    }), env, ctx);
    expect(wrong.status).toBe(401);
    expect(crossOrigin.status).toBe(403);
  });

  it('issues a secure cookie and accepts it for API requests', async () => {
    const response = await login();
    const setCookie = response.headers.get('set-cookie') ?? '';
    const cookie = setCookie.split(';', 1)[0];
    expect(response.status).toBe(200);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Strict');

    const apiResponse = await worker.fetch(request('/studio-api/posts', {
      headers: { Cookie: cookie, 'X-Studio-Request': '1' },
    }), env, ctx);
    expect(apiResponse.status).toBe(200);
    expect(api.fetch).toHaveBeenCalledOnce();
  });

  it('rejects API requests without session or request marker', async () => {
    const noSession = await worker.fetch(request('/studio-api/posts', {
      headers: { 'X-Studio-Request': '1' },
    }), env, ctx);
    const loginResponse = await login();
    const cookie = (loginResponse.headers.get('set-cookie') ?? '').split(';', 1)[0];
    const noMarker = await worker.fetch(request('/studio-api/posts', { headers: { Cookie: cookie } }), env, ctx);
    expect(noSession.status).toBe(401);
    expect(noMarker.status).toBe(403);
  });
});
