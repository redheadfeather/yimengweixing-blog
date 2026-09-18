import { describe, expect, it } from "vitest";
import type { ApiError, ApiSuccess, HealthData } from "@yimengweixing/shared";
import { app } from "../src/app";
import type { Bindings } from "../src/bindings";

const baseEnv = {
  ENVIRONMENT: "test",
  API_VERSION: "0.1.0-test",
  CORS_ORIGINS: "http://localhost:4321",
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
});
