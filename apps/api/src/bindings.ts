export interface Bindings {
  DB: D1Database;
  CACHE: KVNamespace;
  ENVIRONMENT: string;
  API_VERSION: string;
  CORS_ORIGINS: string;
  SITE_URL: string;
  BLOG_ADMIN_TOKEN: string;
}

export interface Variables {
  requestId: string;
}

export type AppEnv = {
  Bindings: Bindings;
  Variables: Variables;
};
