import { describe, expect, it } from "vitest";
import type { ApiError, ApiSuccess, HealthData } from "@yimengweixing/shared";
import { app } from "../src/app";
import type { Bindings } from "../src/bindings";
import { assetIdsFromMarkdown } from "../src/asset-references";

const baseEnv = {
  ENVIRONMENT: "test",
  API_VERSION: "0.2.0-test",
  CORS_ORIGINS: "http://localhost:4321",
  SITE_URL: "https://example.com",
  BLOG_ADMIN_TOKEN: "test-token",
} as Bindings;

describe("API skeleton", () => {
  it("returns service health without touching storage", async () => {
    const response = await app.request("http://localhost/api/v1/health", {}, baseEnv);
    const body = (await response.json()) as ApiSuccess<HealthData>;

    expect(response.status).toBe(200);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(body.data).toMatchObject({
      service: "yimengweixing-api",
      status: "ok",
      environment: "test",
    });
    expect(body.meta.requestId).toBeTypeOf("string");
  });

  it("returns a stable JSON error envelope for unknown routes", async () => {
    const response = await app.request("http://localhost/api/v1/missing", {}, baseEnv);
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
    expect(body.meta.requestId).toBeTypeOf("string");
  });

  it("only permits configured browser origins", async () => {
    const allowed = await app.request(
      "http://localhost/api/v1/health",
      { headers: { Origin: "http://localhost:4321" } },
      baseEnv,
    );
    const denied = await app.request(
      "http://localhost/api/v1/health",
      { headers: { Origin: "https://example.com" } },
      baseEnv,
    );

    expect(allowed.headers.get("access-control-allow-origin")).toBe("http://localhost:4321");
    expect(denied.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("protects every management endpoint with a bearer token", async () => {
    const response = await app.request(
      "http://localhost/api/v1/admin/posts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      baseEnv,
    );
    const body = (await response.json()) as ApiError;

    expect(response.status).toBe(401);
    expect(body.error.code).toBe("UNAUTHORIZED");
  });
});

describe("asset references", () => {
  it("extracts unique managed image ids from Markdown", () => {
    const first = "a".repeat(64);
    const second = "b".repeat(64);
    const content = `![one](https://api.example/api/v1/assets/${first}/one.webp)\n![same](/api/v1/assets/${first}/copy.webp)\n![two](/api/v1/assets/${second}/two.png)`;

    expect(assetIdsFromMarkdown(content)).toEqual([first, second]);
  });
});
