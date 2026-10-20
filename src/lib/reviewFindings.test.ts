import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  clearMemoryCache,
  hashToken,
  resetPasswordTableEnsured,
  setAllowMemoryCacheInTest,
} from "../../worker/internal";

function statementMock(
  query: string,
  all: () => Promise<{ results: unknown[] }>,
  run: () => Promise<{ meta: { changes: number } }>,
) {
  const statement = {
    bind: vi.fn().mockReturnValue(undefined as never),
    all,
    run,
  };
  statement.bind.mockImplementation(() => statement);
  return statement;
}

describe("review findings regressions", () => {
  beforeEach(() => {
    clearAuthCache();
    clearMemoryCache();
    resetPasswordTableEnsured();
    setAllowMemoryCacheInTest(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails closed when the creator row for an existing index is missing", async () => {
    const batch = vi.fn();
    const ownerHash = await hashToken("owner-token");
    // SEC-08: the ownership row carries the issuance time of the token. A
    // token without one (or with one older than 90 days) is refused as
    // expired, so the fixture has to hold a valid issue time for the caller
    // to reach the quota check at all.
    const issuedAt = Math.floor(Date.now() / 1000);
    const prepare = vi.fn().mockImplementation((query: string) => {
      if (query.includes("SELECT id, owner_token_hash, owner_token_issued_at, creator_id FROM indices")) {
        return statementMock(
          query,
          async () => ({
            results: [
              {
                id: "custom-index",
                owner_token_hash: ownerHash,
                owner_token_issued_at: issuedAt,
                creator_id: "deleted-user",
              },
            ],
          }),
          async () => ({ meta: { changes: 1 } }),
        );
      }
      if (query.includes("SELECT max_stocks FROM access_passwords WHERE id = ?")) {
        return statementMock(
          query,
          async () => ({ results: [] }),
          async () => ({ meta: { changes: 1 } }),
        );
      }
      return statementMock(
        query,
        async () => ({ results: [] }),
        async () => ({ meta: { changes: 1 } }),
      );
    });

    const response = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-owner-token": "owner-token",
        },
        body: JSON.stringify({
          id: "custom-index",
          name: "Updated index",
          basket: [
            { ticker: "7203", name: "Toyota", theme: "Auto", weight: 50 },
            { ticker: "9984", name: "SoftBank", theme: "AI", weight: 50 },
          ],
        }),
      }),
      {
        ASSETS: { fetch: vi.fn() },
        DB: { prepare, batch },
      } as any,
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("作成者の銘柄数上限を確認できない"),
    });
    expect(batch).not.toHaveBeenCalled();
  });

  it("authorizes the owner token when the creator row exists", async () => {
    // Control case for the fail-closed test above: with the very same fixture
    // (valid owner token, valid issue time) the request only fails when the
    // creator row is missing, so the 503 is a quota decision and not an
    // authentication refusal.
    const batch = vi.fn();
    const ownerHash = await hashToken("owner-token");
    const issuedAt = Math.floor(Date.now() / 1000);
    const prepare = vi.fn().mockImplementation((query: string) => {
      if (query.includes("SELECT id, owner_token_hash, owner_token_issued_at, creator_id FROM indices")) {
        return statementMock(
          query,
          async () => ({
            results: [
              {
                id: "custom-index",
                owner_token_hash: ownerHash,
                owner_token_issued_at: issuedAt,
                creator_id: "existing-user",
              },
            ],
          }),
          async () => ({ meta: { changes: 1 } }),
        );
      }
      if (query.includes("SELECT max_stocks FROM access_passwords WHERE id = ?")) {
        return statementMock(
          query,
          async () => ({ results: [{ max_stocks: 10 }] }),
          async () => ({ meta: { changes: 1 } }),
        );
      }
      return statementMock(
        query,
        async () => ({ results: [] }),
        async () => ({ meta: { changes: 1 } }),
      );
    });

    const response = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-owner-token": "owner-token",
        },
        body: JSON.stringify({
          id: "custom-index",
          name: "Updated index",
          basket: [
            { ticker: "7203", name: "Toyota", theme: "Auto", weight: 50 },
            { ticker: "9984", name: "SoftBank", theme: "AI", weight: 50 },
          ],
        }),
      }),
      {
        ASSETS: { fetch: vi.fn() },
        DB: { prepare, batch },
      } as any,
    );

    expect(response.status).toBe(200);
    expect(batch).toHaveBeenCalled();
  });

  it("repairs a missing snapshot cache table after serving fresh Yahoo data", async () => {
    let snapshotInsertAttempts = 0;
    const prepare = vi.fn().mockImplementation((query: string) => {
      const statement = {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockImplementation(async () => {
          if (query.includes("FROM snapshot_cache")) {
            throw new Error("no such table: snapshot_cache");
          }
          return { results: [] };
        }),
        run: vi.fn().mockImplementation(async () => {
          if (query.includes("INSERT OR REPLACE INTO snapshot_cache")) {
            snapshotInsertAttempts += 1;
            if (snapshotInsertAttempts === 1) {
              throw new Error("no such table: snapshot_cache");
            }
          }
          return { meta: { changes: 1 } };
        }),
      };
      return statement;
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          chart: {
            result: [
              {
                timestamp: [
                  Date.parse("2026-09-10T00:00:00Z") / 1000,
                  Date.parse("2026-09-11T00:00:00Z") / 1000,
                ],
                indicators: { quote: [{ close: [100, 110] }] },
              },
            ],
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    try {
      const response = await worker.fetch(
        new Request("http://localhost/api/snapshot?symbol=%5EN225", {
          headers: { "cf-connecting-ip": "10.0.0.1" },
        }),
        {
          ASSETS: { fetch: vi.fn() },
          DB: { prepare, batch: vi.fn() },
        } as any,
      );

      expect(response.status).toBe(200);
      expect((await response.json()).snapshot.current).toBe(110);
      expect(snapshotInsertAttempts).toBe(2);
      expect(prepare).toHaveBeenCalledWith(
        expect.stringContaining("CREATE TABLE IF NOT EXISTS snapshot_cache"),
      );
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
