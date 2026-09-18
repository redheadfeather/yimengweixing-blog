import type { HealthData } from "@yimengweixing/shared";
import { Hono } from "hono";
import type { AppEnv } from "./bindings";
import { createPost, deletePost, requireAdmin, updatePost } from "./admin";
import { deleteAsset, getAsset, uploadAsset } from "./assets";
import { rssFeed, sitemap } from "./feeds";
import { fail, ok } from "./http";
import { getPost, listPosts, listTags } from "./posts";

export const app = new Hono<AppEnv>();

app.use("*", async (c, next) => {
  const requestId = c.req.header("CF-Ray") ?? crypto.randomUUID();
  c.set("requestId", requestId);
  await next();
  c.header("X-Request-Id", requestId);
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
});

app.use("/api/*", async (c, next) => {
  const origin = c.req.header("Origin");
  const allowedOrigins = c.env.CORS_ORIGINS.split(",").map((item) => item.trim());
  const allowedOrigin = origin && allowedOrigins.includes(origin) ? origin : null;

  if (c.req.method === "OPTIONS") {
    if (!allowedOrigin) return c.body(null, 204);
    c.header("Access-Control-Allow-Origin", allowedOrigin);
    c.header("Access-Control-Allow-Methods", "GET,HEAD,POST,PUT,DELETE,OPTIONS");
    c.header("Access-Control-Allow-Headers", "Content-Type,Authorization,X-File-Name");
    c.header("Access-Control-Max-Age", "86400");
    c.header("Vary", "Origin");
    return c.body(null, 204);
  }

  await next();
  if (allowedOrigin) {
    c.header("Access-Control-Allow-Origin", allowedOrigin);
    c.header("Vary", "Origin");
  }
});

app.get("/api/v1/health", (c) => {
  const data: HealthData = {
    service: "yimengweixing-api",
    status: "ok",
    environment: c.env.ENVIRONMENT,
    version: c.env.API_VERSION,
  };
  return ok(c, data);
});

app.get("/api/v1/ready", async (c) => {
  try {
    await Promise.all([
      c.env.DB.prepare("SELECT 1 AS ok").first(),
      c.env.CACHE.get("system:readiness"),
    ]);
    const data: HealthData = {
      service: "yimengweixing-api",
      status: "ready",
      environment: c.env.ENVIRONMENT,
      version: c.env.API_VERSION,
    };
    return ok(c, data);
  } catch (error) {
    console.error("Readiness check failed", error);
    return fail(c, 503, "SERVICE_NOT_READY", "数据库或缓存暂不可用");
  }
});

app.get("/api/v1/posts", listPosts);
app.get("/api/v1/posts/:slug", getPost);
app.get("/api/v1/tags", listTags);
app.get("/api/v1/assets/:id/:fileName", getAsset);

app.use("/api/v1/admin/*", requireAdmin);
app.post("/api/v1/admin/posts", createPost);
app.put("/api/v1/admin/posts/:slug", updatePost);
app.delete("/api/v1/admin/posts/:slug", deletePost);
app.post("/api/v1/admin/assets", uploadAsset);
app.delete("/api/v1/admin/assets/:id", deleteAsset);
app.get("/rss.xml", rssFeed);
app.get("/sitemap.xml", sitemap);

app.notFound((c) => fail(c, 404, "NOT_FOUND", "接口不存在"));

app.onError((error, c) => {
  console.error("Unhandled API error", error);
  return fail(c, 500, "INTERNAL_ERROR", "服务暂时不可用");
});
