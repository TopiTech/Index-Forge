import { beforeEach, describe, it, expect, vi } from "vitest";
import worker from "../../worker/index";
import {
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/internal";
import { normalizeTicker, sanitizeBasketForRequest } from "./indexEngine";
import { asWorkerEnv } from "../test-helpers/env";

const TEST_ADMIN_PASSWORD = "test-admin-password";
const TEST_INDEX_ID = "goal-resolution-index";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

interface PasswordRecord {
  id: string;
  name: string;
  password_hash: string;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices?: number | null;
  is_active: number;
  created_at: number;
  updated_at: number;
}

/**
 * A row of the `basket_items` table as the Worker writes it.
 * `rowid` models the SQLite row identifier the guarded DELETE relies on.
 */
interface BasketRow {
  rowid: number;
  index_id: string;
  ticker: string;
  name: string;
  weight: number;
  theme: string;
}

/**
 * Applies the ticker's comparison semantics of the given SQL statement:
 * `UPPER(ticker) = ?` compares case-insensitively, `ticker = ?` does not.
 */
function matchesTicker(row: BasketRow, ticker: string, query: string): boolean {
  if (query.includes("UPPER(ticker)")) {
    return row.ticker.toUpperCase() === ticker.toUpperCase();
  }
  return row.ticker === ticker;
}

/**
 * Test double for the D1 tables the Worker touches in these scenarios.
 *
 * Only the statements the Worker actually issues are modelled, and each one
 * keeps the *semantics* of the production SQL: a predicate written as
 * `UPPER(ticker) = ?` matches case-insensitively, while a plain
 * `ticker = ?` matches case-sensitively. A regression that makes the Worker
 * case-sensitive therefore shows up as a failing assertion instead of passing
 * silently.
 */
function createTestEnv() {
  const passwords = new Map<string, PasswordRecord>();
  const indices = new Map<string, { id: string }>();
  const basketItems: BasketRow[] = [];
  let nextRowId = 1;

  const executeAll = async (query: string, params: unknown[] = []) => {
    if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
      const master = passwords.get("admin-master");
      return { results: master ? [master] : [] };
    }
    if (query.includes("FROM access_passwords") && query.includes("id != 'admin-master'")) {
      let matches = Array.from(passwords.values()).filter((p) => p.id !== "admin-master");
      if (query.includes("is_active = 1")) {
        matches = matches.filter((p) => p.is_active === 1);
      }
      if (params.length > 0 && typeof params[0] === "string") {
        matches = matches.filter((p) => p.id !== params[0]);
      }
      matches.sort((a, b) => a.created_at - b.created_at);
      return { results: matches };
    }
    if (query.includes("FROM indices WHERE id = ?")) {
      const indexId = params[0] as string;
      const index = indices.get(indexId);
      return { results: index ? [index] : [] };
    }
    if (query.includes("FROM basket_items")) {
      const indexId = params[0] as string;
      const rows = basketItems.filter((b) => b.index_id === indexId);
      if (query.includes("COUNT(*)")) {
        // "SELECT COUNT(*) as cnt FROM basket_items WHERE index_id = ? AND UPPER(ticker) = ?"
        const ticker = typeof params[1] === "string" ? params[1] : undefined;
        const matched = ticker === undefined ? rows : rows.filter((b) => matchesTicker(b, ticker, query));
        return { results: [{ cnt: matched.length }] };
      }
      // "SELECT ticker FROM basket_items WHERE index_id = ?"
      return {
        results: rows.map((row) => ({
          ticker: row.ticker,
          name: row.name,
          weight: row.weight,
          theme: row.theme,
        })),
      };
    }
    return { results: [] };
  };

  const executeRun = async (query: string, params: unknown[] = []) => {
    if (query.includes("INSERT INTO access_passwords") || query.includes("INSERT OR REPLACE INTO access_passwords")) {
      if (query.includes("'admin-master'")) {
        passwords.set("admin-master", {
          id: "admin-master",
          name: "マスター管理者",
          password_hash: params[0] as string,
          role: "admin",
          max_stocks: null,
          is_active: 1,
          created_at: params[1] as number,
          updated_at: params[2] as number,
        });
      } else {
        const id = params[0] as string;
        const name = params[1] as string;
        const hash = params[2] as string;
        const role = params[3] as "admin" | "user";
        const maxStocks = params[4] as number | null;
        let maxIndices: number | null = null;
        let now1: number;
        let now2: number;
        if (params.length >= 8) {
          maxIndices = params[5] as number | null;
          now1 = params[6] as number;
          now2 = params[7] as number;
        } else {
          now1 = params[5] as number;
          now2 = params[6] as number;
        }
        passwords.set(id, {
          id,
          name,
          password_hash: hash,
          role,
          max_stocks: maxStocks,
          max_indices: maxIndices,
          is_active: 1,
          created_at: now1,
          updated_at: now2,
        });
      }
      return { success: true };
    }
    if (query.includes("UPDATE access_passwords")) {
      const targetId = params[params.length - 1] as string;
      const existing = passwords.get(targetId);
      if (existing) {
        if (query.includes("password_hash = ?")) {
          existing.password_hash = params[0] as string;
          existing.updated_at = params[1] as number;
        }
      }
      return { success: true };
    }
    if (query.includes("INSERT OR REPLACE INTO basket_items")) {
      const indexId = params[0] as string;
      const ticker = params[1] as string;
      const name = params[2] as string;
      const weight = params[3] as number;
      const theme = params[4] as string;
      const existing = basketItems.find((b) => b.index_id === indexId && b.ticker === ticker);
      if (existing) {
        existing.name = name;
        existing.weight = weight;
        existing.theme = theme;
        return { success: true, meta: { changes: 1 } };
      }
      basketItems.push({
        rowid: nextRowId++,
        index_id: indexId,
        ticker,
        name,
        weight,
        theme,
      });
      return { success: true, meta: { changes: 1 } };
    }
    if (query.includes("DELETE FROM basket_items") && query.includes("LIMIT 1")) {
      // Guarded single-row delete:
      // "DELETE ... WHERE rowid = (SELECT rowid ... WHERE index_id = ? AND UPPER(ticker) = ?
      //  ORDER BY rowid LIMIT 1) AND (SELECT COUNT(*) ...) > 1"
      const indexId = params[0] as string;
      const ticker = params[1] as string;
      const rows = basketItems.filter((b) => b.index_id === indexId);
      if (rows.length <= 1) return { success: true, meta: { changes: 0 } };
      const target = basketItems.find((b) => b.index_id === indexId && matchesTicker(b, ticker, query));
      if (!target) return { success: true, meta: { changes: 0 } };
      basketItems.splice(basketItems.indexOf(target), 1);
      return { success: true, meta: { changes: 1 } };
    }
    if (query.includes("DELETE FROM basket_items") && query.includes("UPPER(ticker)")) {
      // "DELETE FROM basket_items WHERE index_id = ? AND UPPER(ticker) = ?"
      const indexId = params[0] as string;
      const ticker = params[1] as string;
      let changes = 0;
      for (let i = basketItems.length - 1; i >= 0; i--) {
        const row = basketItems[i];
        if (row.index_id === indexId && matchesTicker(row, ticker, query)) {
          basketItems.splice(i, 1);
          changes += 1;
        }
      }
      return { success: true, meta: { changes } };
    }
    if (query.includes("DELETE FROM basket_items")) {
      // "DELETE FROM basket_items WHERE index_id = ?"
      const indexId = params[0] as string;
      const before = basketItems.length;
      for (let i = basketItems.length - 1; i >= 0; i--) {
        if (basketItems[i].index_id === indexId) basketItems.splice(i, 1);
      }
      return { success: true, meta: { changes: before - basketItems.length } };
    }
    return { success: true };
  };

  const prepare = vi.fn().mockImplementation((query: string) => {
    return {
      bind: (...params: unknown[]) => ({
        all: () => executeAll(query, params),
        run: () => executeRun(query, params),
      }),
      all: () => executeAll(query, []),
      run: () => executeRun(query, []),
    };
  });

  const batch = vi.fn().mockImplementation(async (statements: { run: () => Promise<unknown> }[]) => {
    const results: unknown[] = [];
    for (const statement of statements) {
      results.push(await statement.run());
    }
    return results;
  });

  const env = asWorkerEnv({
    DB: {
      prepare,
      batch,
    },
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
  });

  return {
    env,
    passwords,
    indices,
    basketItems,
    /** Registers an index row so the Worker finds it during an ownership lookup. */
    seedIndex: (indexId: string) => {
      indices.set(indexId, { id: indexId });
    },
    /** Registers a constituent of an index. */
    seedBasketItem: (row: Omit<BasketRow, "rowid">) => {
      basketItems.push({ rowid: nextRowId++, ...row });
    },
  };
}

describe("Comprehensive Goal Resolution: Password Privilege Escalation Protection", () => {
  it("rejects creating a user account whose password matches the env ADMIN_PASSWORD", async () => {
    const { env } = createTestEnv();

    const res = await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "Escalation Candidate",
          password: TEST_ADMIN_PASSWORD,
          role: "user",
        }),
      }),
      env,
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("管理者アカウントと同一のパスワードは設定できません");
  });

  it("rejects updating an existing user password to match admin-master", async () => {
    const { env } = createTestEnv();

    // 1. Create a legitimate user
    const createRes = await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "Standard User",
          password: "legitimate-user-pwd",
          role: "user",
        }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    const userId = created.password.id;

    // 2. Try to update user's password to match admin-master
    const updateRes = await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: userId,
          password: TEST_ADMIN_PASSWORD,
        }),
      }),
      env,
    );

    expect(updateRes.status).toBe(400);
    const data = await updateRes.json();
    expect(data.error).toBe("管理者アカウントと同一のパスワードは設定できません");
  });

  it("rejects updating admin-master password to match an existing user's password", async () => {
    const { env } = createTestEnv();

    // 1. Create a user with password "user-secret-12345"
    const createRes = await worker.fetch(
      new Request("http://localhost/api/admin/passwords", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          name: "Existing User",
          password: "user-secret-12345",
          role: "user",
        }),
      }),
      env,
    );
    expect(createRes.status).toBe(201);

    // 2. Admin tries to change master password to "user-secret-12345"
    const updateAdminRes = await worker.fetch(
      new Request("http://localhost/api/admin/admin-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          newPassword: "user-secret-12345",
        }),
      }),
      env,
    );

    expect(updateAdminRes.status).toBe(400);
    const data = await updateAdminRes.json();
    expect(data.error).toBe("既存のユーザーアカウントで使用されているパスワードは管理者に設定できません");
  });

  it("allows updating admin-master password to a unique new password", async () => {
    const { env } = createTestEnv();

    const updateAdminRes = await worker.fetch(
      new Request("http://localhost/api/admin/admin-password", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          newPassword: "brand-new-admin-password-999",
        }),
      }),
      env,
    );

    expect(updateAdminRes.status).toBe(200);
    const data = await updateAdminRes.json();
    expect(data.ok).toBe(true);
  });
});

describe("Comprehensive Goal Resolution: Ticker Normalization and Casing Consistency", () => {
  it("normalizeTicker trims whitespace and capitalizes tickers", () => {
    expect(normalizeTicker(" aapl ")).toBe("AAPL");
    expect(normalizeTicker("7203")).toBe("7203");
    expect(normalizeTicker("nvda.o")).toBe("NVDA.O");
    expect(normalizeTicker("brk-b")).toBe("BRK-B");
  });

  it("rejects a basket that holds the same ticker in two different casings", async () => {
    const { env } = createTestEnv();

    const res = await worker.fetch(
      new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "case-insensitive-duplicate",
          name: "Case Insensitive Duplicate",
          basket: [
            { ticker: "aapl", name: "Apple", theme: "Tech", weight: 50 },
            { ticker: "AAPL", name: "Apple", theme: "Tech", weight: 50 },
          ],
        }),
      }),
      env,
    );

    expect(res.status).toBe(400);
    const data = await res.json();
    // The Worker upper-cases every ticker before the duplicate check, so the
    // case-variant pair is reported as the duplicate "AAPL".
    expect(data.error).toBe("Duplicate ticker in basket: AAPL");
  });

  it("keeps distinct tickers and drops only the case-insensitive duplicate when a basket is sanitized", () => {
    const result = sanitizeBasketForRequest([
      { ticker: "AAPL", name: "Apple", theme: "Tech", weight: 50 },
      { ticker: "aapl", name: "Apple", theme: "Tech", weight: 50 },
      { ticker: "MSFT", name: "Microsoft", theme: "Tech", weight: 50 },
    ]);

    // "aapl" is the case-insensitive duplicate of "AAPL"; "MSFT" is not one.
    expect(result.basket.map((item) => item.ticker)).toEqual(["AAPL", "MSFT"]);
    expect(result.dropped).toEqual(["AAPL"]);
  });

  it("removes a constituent regardless of the ticker's casing", async () => {
    const { env, seedIndex, seedBasketItem, basketItems } = createTestEnv();
    seedIndex(TEST_INDEX_ID);
    // A legacy lower-case constituent: the Worker has to match it
    // case-insensitively, otherwise the request would silently do nothing.
    seedBasketItem({
      index_id: TEST_INDEX_ID,
      ticker: "aapl",
      name: "Apple",
      theme: "Tech",
      weight: 50,
    });
    seedBasketItem({
      index_id: TEST_INDEX_ID,
      ticker: "MSFT",
      name: "Microsoft",
      theme: "Tech",
      weight: 50,
    });

    const res = await worker.fetch(
      new Request(
        `http://localhost/api/indices/stock?indexId=${TEST_INDEX_ID}&ticker=aapl`,
        {
          method: "DELETE",
          headers: {
            "x-auth-password": TEST_ADMIN_PASSWORD,
          },
        },
      ),
      env,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    // The Worker reports the normalized ticker.
    expect(data.ticker).toBe("AAPL");
    // The legacy "aapl" row is the one that was removed; "MSFT" survives.
    expect(basketItems.map((item) => item.ticker)).toEqual(["MSFT"]);
  });

  it("updates the weight of a constituent regardless of the ticker's casing", async () => {
    const { env, seedIndex, seedBasketItem, basketItems } = createTestEnv();
    seedIndex(TEST_INDEX_ID);
    seedBasketItem({
      index_id: TEST_INDEX_ID,
      ticker: "AAPL",
      name: "Apple",
      theme: "Tech",
      weight: 50,
    });
    seedBasketItem({
      index_id: TEST_INDEX_ID,
      ticker: "MSFT",
      name: "Microsoft",
      theme: "Tech",
      weight: 50,
    });

    const res = await worker.fetch(
      new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          indexId: TEST_INDEX_ID,
          stock: { ticker: "msft", name: "Microsoft", theme: "Tech", weight: 70 },
        }),
      }),
      env,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.ticker).toBe("MSFT");
    // The existing constituent was updated in place: the new weight applies to
    // "MSFT" and no second, duplicate row was created for "msft".
    expect(basketItems).toHaveLength(2);
    expect(basketItems.find((item) => item.ticker === "MSFT")?.weight).toBe(70);
    expect(basketItems.find((item) => item.ticker === "AAPL")?.weight).toBe(50);
  });

  it("normalizes a legacy lower-case constituent when its weight is updated", async () => {
    const { env, seedIndex, seedBasketItem, basketItems } = createTestEnv();
    seedIndex(TEST_INDEX_ID);
    seedBasketItem({
      index_id: TEST_INDEX_ID,
      ticker: "msft",
      name: "Microsoft",
      theme: "Tech",
      weight: 50,
    });
    seedBasketItem({
      index_id: TEST_INDEX_ID,
      ticker: "AAPL",
      name: "Apple",
      theme: "Tech",
      weight: 50,
    });

    const res = await worker.fetch(
      new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          indexId: TEST_INDEX_ID,
          stock: { ticker: "msft", name: "Microsoft", theme: "Tech", weight: 70 },
        }),
      }),
      env,
    );

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.ticker).toBe("MSFT");
    // The legacy row was replaced by the normalized one: exactly two
    // constituents, "MSFT" carrying the new weight.
    expect(basketItems.map((item) => item.ticker).sort()).toEqual(["AAPL", "MSFT"]);
    expect(basketItems.find((item) => item.ticker === "MSFT")?.weight).toBe(70);
    expect(basketItems.find((item) => item.ticker === "AAPL")?.weight).toBe(50);
  });
});
