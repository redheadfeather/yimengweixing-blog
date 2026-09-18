import { describe, expect, it, vi } from 'vitest';
import worker from '../src/index';

const assets = { fetch: vi.fn(() => Promise.resolve(new Response('studio'))) } as unknown as Fetcher;
const env = {
  ASSETS: assets,
  API_ORIGIN: 'https://api.example.com',
  SITE_URL: 'https://site.example.com',
  STUDIO_ALLOWED_EMAIL: 'author@example.com',
  BLOG_ADMIN_TOKEN: 'secret',
};

describe('studio access boundary', () => {
  it('rejects requests when Cloudflare Access did not run', async () => {
    const response = await worker.fetch(new Request('https://studio.example.com/'), env, {} as ExecutionContext);
    expect(response.status).toBe(401);
  });

  it('rejects a different authenticated email', async () => {
    const response = await worker.fetch(new Request('https://studio.example.com/'), env, {
      access: { aud: 'test', getIdentity: async () => ({ email: 'other@example.com' }) },
    } as unknown as ExecutionContext);
    expect(response.status).toBe(403);
  });

  it('serves static assets to the configured author', async () => {
    const response = await worker.fetch(new Request('https://studio.example.com/'), env, {
      access: { aud: 'test', getIdentity: async () => ({ email: 'author@example.com' }) },
    } as unknown as ExecutionContext);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('studio');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
  });
});
