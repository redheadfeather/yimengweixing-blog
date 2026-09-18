export interface ApiMeta {
  requestId: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
  meta: ApiMeta;
}

export interface PostSummary {
  id: number;
  slug: string;
  title: string;
  description: string;
  tags: string[];
  featured: boolean;
  publishedAt: string;
  updatedAt: string;
}

export interface PostDetail extends PostSummary {
  content: string;
  relatedPosts: PostSummary[];
  previousPost: PostSummary | null;
  nextPost: PostSummary | null;
}

export interface PostListData {
  items: PostSummary[];
  nextCursor: string | null;
  total: number;
}

export interface TagSummary {
  name: string;
  slug: string;
  count: number;
}

export interface HealthData {
  service: "yimengweixing-api";
  status: "ok" | "ready";
  environment: string;
  version: string;
}
