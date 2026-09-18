import type { ApiSuccess, PostDetail, PostListData, TagSummary } from '@yimengweixing/shared';

export const API_BASE = 'https://yimengweixing-api.yimengweixing-api.workers.dev';

async function request<T>(path: string): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt < 3; attempt += 1) {
		try {
			const response = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
			if (!response.ok) throw new Error(`Content API returned ${response.status}`);
			return ((await response.json()) as ApiSuccess<T>).data;
		} catch (error) {
			lastError = error;
			if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
		}
	}
	throw lastError;
}

export function fetchPosts(options: { q?: string; tag?: string; featured?: boolean; limit?: number } = {}) {
	const params = new URLSearchParams();
	if (options.q) params.set('q', options.q);
	if (options.tag) params.set('tag', options.tag);
	if (options.featured) params.set('featured', 'true');
	params.set('limit', String(options.limit ?? 50));
	return request<PostListData>(`/api/v1/posts?${params}`);
}

export function fetchPost(slug: string) {
	return request<PostDetail>(`/api/v1/posts/${encodeURIComponent(slug)}`);
}

export function fetchTags() {
	return request<TagSummary[]>('/api/v1/tags');
}

export function formatDate(value: string) {
	return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(value));
}

export function tagPath(slug: string) {
	return `/tags/${encodeURIComponent(slug)}/`;
}
