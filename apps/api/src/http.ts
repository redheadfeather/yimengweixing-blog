import type { ApiError, ApiSuccess } from "@yimengweixing/shared";
import type { Context } from "hono";
import type { AppEnv } from "./bindings";

export function ok<T>(c: Context<AppEnv>, data: T, status: 200 | 201 = 200) {
  const body: ApiSuccess<T> = {
    data,
    meta: { requestId: c.get("requestId") },
  };

  return c.json(body, status);
}

export function fail(
  c: Context<AppEnv>,
  status: 400 | 404 | 405 | 500 | 503,
  code: string,
  message: string,
) {
  const body: ApiError = {
    error: { code, message },
    meta: { requestId: c.get("requestId") },
  };

  return c.json(body, status);
}

export function parseLimit(value: string | undefined): number {
  if (!value) return 20;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 20;
  return Math.min(Math.max(parsed, 1), 50);
}

export function decodeCursor(value: string | undefined): number {
  if (!value) return 0;

  try {
    const parsed = Number.parseInt(atob(value), 10);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function encodeCursor(offset: number): string {
  return btoa(String(offset));
}
