import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  clearMemoryCache,
  hashToken,
  isOwnerTokenExpired,
  OWNER_TOKEN_MAX_AGE_SECONDS,
  resetPasswordTableEnsured,
  setAllowMemoryCacheInTest,
} from "../../worker/internal";

/**
 * SEC-08: owner tokens carry an issue date so they can be rotated, but a row
 * that predates the tracking must keep working.
 *
 * The deployment adds `owner_token_issued_at` as a nullable column, so every
 * existing index ends up with `NULL`. Treating "unknown age" as "expired"
 * locked every pre-existing owner out of their own index on the next deploy,
 * so a missing date is grandfathered and the runtime backfill records it.
 */
describe("owner token expiry", () => {
  const now = Math.floor(Date.now() / 1000);

  it("keeps a token whose issue date is unknown (legacy row)", () => {
    expect(isOwnerTokenExpired(null, now)).toBe(false);
  });

  it("keeps a token when the column does not exist at all", () => {
    expect(isOwnerTokenExpired(undefined, now)).toBe(false);
  });

  it("expires a token that is older than the rotation window", () => {
    expect(isOwnerTokenExpired(now - OWNER_TOKEN_MAX_AGE_SECONDS - 1, now)).toBe(true);
  });

  it("keeps a token inside the rotation window", () => {
    expect(isOwnerTokenExpired(now - 60, now)).toBe(false);
  });
});

describe("owner token of a pre-existing index", () => {
  beforeEach(() => {
    clearAuthCache();
    clearMemoryCache();
    resetPasswordTableEnsured();
    setAllowMemoryCacheInTest(false);
  });

  it("still authorizes the owner of an index created before the issue date was tracked", async () => {
    const ownerToken = "legacy-owner-token-abcdefghijklmnop";
    const ownerHash = await hashToken(ownerToken);

    const db = {
      prepare: vi.fn().mockImplementation((query: string) => {
        const stmt = {
          bind: vi.fn().mockImplementation(() => stmt),
          all: vi.fn().mockImplementation(async () => {
            if (
              query.includes("SELECT id, owner_token_hash, owner_token_issued_at, creator_id FROM indices")
            ) {
              return {
                results: [
                  {
                    id: "idx-legacy-1",
                    owner_token_hash: ownerHash,
                    // The row predates issuance tracking: no issue date.
                    owner_token_issued_at: null,
                    creator_id: "user-creator-abc",
                  },
                ],
              };
            }
            if (query.includes("SELECT max_stocks FROM access_passwords WHERE id = ?")) {
              return { results: [{ max_stocks: 5 }] };
            }
            return { results: [] };
          }),
          first: vi.fn().mockImplementation(async () => {
            if (query.includes("SELECT max_stocks FROM access_passwords WHERE id = ?")) {
              return { max_stocks: 5 };
            }
            return null;
          }),
          run: vi.fn().mockResolvedValue({ meta: { changes: 1 } }),
        };
        return stmt;
      }),
      batch: vi.fn().mockResolvedValue([{ meta: { changes: 1 } }]),
    };

    const env = {
      ASSETS: { fetch: vi.fn() },
      DB: db,
      ADMIN_PASSWORD: "test-admin-password",
    };

    const request = new Request("http://localhost/api/indices", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-owner-token": ownerToken,
      },
      body: JSON.stringify({
        id: "idx-legacy-1",
        name: "既存指数の更新",
        description: "発行日が記録されていない指数",
        baseValue: 1000,
        basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
      }),
    });

    const res = await worker.fetch(request, env as never);

    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(String(data.error ?? "")).not.toContain("有効期限");
  });
});
