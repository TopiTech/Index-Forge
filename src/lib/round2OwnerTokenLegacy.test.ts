import { beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  clearMemoryCache,
  hashToken,
  isOwnerTokenExpired,
  lookupIndexOwnership,
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

describe("lookupIndexOwnership timestamp normalization (fail closed)", () => {
  const now = Math.floor(Date.now() / 1000);

  function makeLookupDb(row: Record<string, unknown> | null) {
    return {
      prepare: vi.fn().mockImplementation(() => {
        const stmt = {
          bind: vi.fn().mockImplementation(() => stmt),
          all: vi.fn().mockImplementation(async () => ({
            results: row ? [row] : [],
          })),
        };
        return stmt;
      }),
    };
  }

  async function lookupIssuedAt(cell: unknown): Promise<number | null | undefined> {
    const row =
      cell === "__missing__"
        ? { id: "idx-1", owner_token_hash: "h", creator_id: null }
        : { id: "idx-1", owner_token_hash: "h", owner_token_issued_at: cell, creator_id: null };
    const lookup = await lookupIndexOwnership(
      { DB: makeLookupDb(row) } as never,
      "idx-1",
    );
    return lookup.ownerTokenIssuedAt;
  }

  it("maps a corrupted cell to an expired age instead of grandfathering it", async () => {
    // A present-but-unparsable cell used to become `null` ("unknown age",
    // kept working forever). It must fail closed like an outdated timestamp.
    expect(await lookupIssuedAt("corrupted")).toBe(0);
    expect(isOwnerTokenExpired(await lookupIssuedAt("corrupted"), now)).toBe(true);
  });

  it("expires an infinite timestamp instead of keeping it valid forever", async () => {
    expect(isOwnerTokenExpired(await lookupIssuedAt(Number.POSITIVE_INFINITY), now)).toBe(true);
  });

  it("keeps judging a finite non-positive cell as expired", async () => {
    expect(await lookupIssuedAt(-50)).toBe(-50);
    expect(isOwnerTokenExpired(await lookupIssuedAt(-50), now)).toBe(true);
  });

  it("still grandfathers SQL NULL (pre-tracking row)", async () => {
    expect(await lookupIssuedAt(null)).toBeNull();
    expect(isOwnerTokenExpired(await lookupIssuedAt(null), now)).toBe(false);
  });

  it("keeps working when a test double omits the column value", async () => {
    expect(await lookupIssuedAt("__missing__")).toBeUndefined();
    expect(isOwnerTokenExpired(await lookupIssuedAt("__missing__"), now)).toBe(false);
  });

  it("passes a finite issuance time through to the judge", async () => {
    const issued = now - 60;
    expect(await lookupIssuedAt(issued)).toBe(issued);
    expect(isOwnerTokenExpired(await lookupIssuedAt(issued), now)).toBe(false);
    expect(isOwnerTokenExpired(await lookupIssuedAt(now - OWNER_TOKEN_MAX_AGE_SECONDS - 1), now)).toBe(
      true,
    );
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

  it("rejects an edit when the stored issuance cell is corrupted (POST save/judge pair)", async () => {
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
                    // Tampered cell: unreadable age must fail closed, not
                    // inherit the NULL grandfathering.
                    owner_token_issued_at: "not-a-timestamp",
                    creator_id: null,
                  },
                ],
              };
            }
            return { results: [] };
          }),
          first: vi.fn().mockResolvedValue(null),
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
        description: "発行日セルが破損している指数",
        baseValue: 1000,
        basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
      }),
    });

    const res = await worker.fetch(request, env as never);

    expect(res.status).toBe(403);
    const data = (await res.json()) as Record<string, unknown>;
    expect(String(data.error ?? "")).toContain("有効期限");
  });

  it("rejects a delete when the stored issuance cell is corrupted (DELETE save/judge pair)", async () => {
    const ownerToken = "legacy-owner-token-abcdefghijklmnop";
    const ownerHash = await hashToken(ownerToken);

    const db = {
      prepare: vi.fn().mockImplementation(() => {
        const stmt = {
          bind: vi.fn().mockImplementation(() => stmt),
          all: vi.fn().mockImplementation(async () => ({
            results: [
              {
                id: "idx-legacy-2",
                owner_token_hash: ownerHash,
                owner_token_issued_at: "not-a-timestamp",
                creator_id: null,
              },
            ],
          })),
          first: vi.fn().mockResolvedValue(null),
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

    const request = new Request("http://localhost/api/indices?id=idx-legacy-2", {
      method: "DELETE",
      headers: { "x-owner-token": ownerToken },
    });

    const res = await worker.fetch(request, env as never);

    expect(res.status).toBe(403);
    const data = (await res.json()) as Record<string, unknown>;
    expect(String(data.error ?? "")).toContain("有効期限");
  });
});
