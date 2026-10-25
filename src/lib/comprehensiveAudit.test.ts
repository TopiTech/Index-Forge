import { beforeEach, describe, it, expect, vi } from "vitest";
import worker from "../../worker/index";
import {
  SYSTEM_INDICES,
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/internal";
import { SYSTEM_INDEX_IDS } from "../data/indices";

const TEST_ADMIN_PASSWORD = "test-admin-secret";

beforeEach(() => {
  clearAuthCache();
  resetPasswordTableEnsured();
});

interface IndexRecord {
  id: string;
  name: string;
  description: string;
  base_value: number;
  owner_token_hash: string | null;
  /** Unix seconds of the last owner-token issue (SEC-08). */
  owner_token_issued_at?: number | null;
  creator_id?: string | null;
  sort_order?: number;
}

interface BasketRecord {
  index_id: string;
  ticker: string;
  name: string;
  weight: number;
  theme: string;
}

/**
 * Split a SQL expression list on the commas that separate the expressions.
 *
 * A comma inside parentheses belongs to its expression (the
 * `COALESCE((SELECT creator_id FROM indices WHERE id = ?), ?)` of the upsert
 * for example) and must not split it.
 */
function splitSqlExpressions(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** Index of a keyword that is not nested inside parentheses. */
function indexOfTopLevelKeyword(text: string, keyword: string): number {
  const upper = text.toUpperCase();
  const needle = keyword.toUpperCase();
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === "(") {
      depth++;
      continue;
    }
    if (ch === ")") {
      depth--;
      continue;
    }
    if (depth !== 0 || !upper.startsWith(needle, i)) continue;
    const before = i === 0 ? " " : text[i - 1];
    const after = text[i + needle.length] ?? " ";
    if (!/[A-Za-z0-9_]/.test(before) && !/[A-Za-z0-9_]/.test(after)) return i;
  }
  return -1;
}

/**
 * Index of the placeholder that carries the value of an upsert expression.
 *
 * The Worker protects the stored metadata with
 * `COALESCE((SELECT creator_id FROM indices WHERE id = ?), ?)`: the placeholder
 * inside the sub-select is the row id, not the value. Only a placeholder
 * outside such a sub-select carries the value.
 */
function valuePlaceholderSlot(expression: string): number {
  const groupIsSelect: boolean[] = [];
  let depth = 0;
  let placeholderIndex = 0;
  let valueSlot = -1;
  for (let i = 0; i < expression.length; i++) {
    const ch = expression[i];
    if (ch === "(") {
      depth++;
      groupIsSelect[depth] = /^\s*SELECT\b/i.test(expression.slice(i + 1));
    } else if (ch === ")") {
      groupIsSelect[depth] = false;
      depth--;
    } else if (ch === "?") {
      if (!groupIsSelect[depth] && valueSlot === -1) valueSlot = placeholderIndex;
      placeholderIndex++;
    }
  }
  return valueSlot;
}

/**
 * Recover the column values of an `INSERT ... INTO indices` statement from
 * its bound parameters.
 *
 * The Worker builds that statement dynamically: every optional column adds a
 * placeholder, and `owner_token_issued_at` added one more. Mapping the values
 * by column name (instead of by a fixed parameter offset) keeps the double
 * correct when the statement gains or loses a column.
 */
function readIndexUpsertValues(query: string, params: unknown[]): Map<string, unknown> {
  const values = new Map<string, unknown>();
  const columnMatch = /INTO indices\s*\(([^)]*)\)/i.exec(query);
  if (!columnMatch) return values;
  const columns = columnMatch[1].split(",").map((column) => column.trim());
  const rest = query.slice(columnMatch.index + columnMatch[0].length);

  let expressions: string[];
  if (/^\s*VALUES/i.test(rest)) {
    const open = rest.indexOf("(");
    const close = rest.lastIndexOf(")");
    expressions = splitSqlExpressions(rest.slice(open + 1, close));
  } else {
    // `INSERT ... SELECT <expressions> [WHERE <guard>]`: the guard of the
    // quota-guarded variant binds extra parameters that belong to no column.
    const body = rest.replace(/^\s*SELECT/i, "");
    const whereAt = indexOfTopLevelKeyword(body, "WHERE");
    expressions = splitSqlExpressions(whereAt === -1 ? body : body.slice(0, whereAt));
  }

  let paramIndex = 0;
  columns.forEach((column, columnIndex) => {
    const expression = expressions[columnIndex] ?? "";
    const placeholders = (expression.match(/\?/g) || []).length;
    const slot = valuePlaceholderSlot(expression);
    if (slot >= 0) values.set(column, params[paramIndex + slot]);
    paramIndex += placeholders;
  });
  return values;
}

function createAuditTestEnv() {
  const indices = new Map<string, IndexRecord>();
  const basketItems: BasketRecord[] = [];

  // Seed default system indices
  for (const sysId of Array.from(SYSTEM_INDICES)) {
    indices.set(sysId, {
      id: sysId,
      name: `System Index ${sysId}`,
      description: "Built-in system index",
      base_value: 1000,
      owner_token_hash: null,
      sort_order: sysId === "nikkei-175" ? 0 : 50,
    });
  }

  const prepare = vi.fn().mockImplementation((query: string) => {
    const executeAll = async (params: unknown[] = []) => {
      if (query.includes("FROM access_passwords WHERE id = 'admin-master'")) {
        return { results: [] };
      }
      if (query.includes("FROM access_passwords")) {
        return { results: [] };
      }
      if (query.includes("FROM indices WHERE id = ?")) {
        const id = params[0] as string;
        const idx = indices.get(id);
        return { results: idx ? [idx] : [] };
      }
      if (query.includes("FROM indices i") && query.includes("LEFT JOIN basket_items b")) {
        const results: any[] = [];
        for (const [id, idx] of indices.entries()) {
          const stocks = basketItems.filter((b) => b.index_id === id);
          if (stocks.length === 0) {
            results.push({
              id: idx.id,
              name: idx.name,
              description: idx.description,
              base_value: idx.base_value,
              sort_order: idx.sort_order ?? 50,
              ticker: null,
              stock_name: null,
              weight: null,
              theme: null,
            });
          } else {
            for (const s of stocks) {
              results.push({
                id: idx.id,
                name: idx.name,
                description: idx.description,
                base_value: idx.base_value,
                sort_order: idx.sort_order ?? 50,
                ticker: s.ticker,
                stock_name: s.name,
                weight: s.weight,
                theme: s.theme,
              });
            }
          }
        }
        return { results };
      }
      if (query.includes("FROM basket_items WHERE index_id = ?")) {
        const indexId = params[0] as string;
        const stocks = basketItems.filter((b) => b.index_id === indexId);
        return { results: stocks };
      }
      if (query.includes("COUNT(*) as cnt FROM basket_items WHERE index_id = ?")) {
        const indexId = params[0] as string;
        const cnt = basketItems.filter((b) => b.index_id === indexId).length;
        return { results: [{ cnt }] };
      }
      return { results: [] };
    };

    const executeRun = async (params: unknown[] = []) => {
      if (query.includes("INTO indices")) {
        // The upsert is built dynamically, so the values are recovered by
        // column name instead of by a fixed parameter offset.
        const values = readIndexUpsertValues(query, params);
        const id = values.get("id") as string;
        const name = values.get("name") as string;
        const description = values.get("description") as string;
        const baseValue = values.get("base_value") as number;
        const hash = (values.get("owner_token_hash") ?? null) as string | null;
        const issuedAt = (values.get("owner_token_issued_at") ?? null) as number | null;
        // `COALESCE((SELECT creator_id FROM indices WHERE id = ?), ?)` keeps the
        // stored creator of an existing index.
        const existingCreatorId = indices.get(id)?.creator_id ?? null;
        const creatorId = existingCreatorId ?? ((values.get("creator_id") ?? null) as string | null);
        // `COALESCE(?, (SELECT sort_order FROM indices WHERE id = ?), 99)` keeps
        // the stored order when the request does not provide one.
        const requestedSortOrder = values.get("sort_order");
        const sortOrder =
          typeof requestedSortOrder === "number"
            ? requestedSortOrder
            : (indices.get(id)?.sort_order ?? 50);
        indices.set(id, {
          id,
          name,
          description,
          base_value: baseValue,
          owner_token_hash: hash || null,
          owner_token_issued_at: issuedAt,
          creator_id: creatorId,
          sort_order: sortOrder,
        });
        return { success: true };
      }
      if (query.includes("DELETE FROM indices WHERE id = ?")) {
        const id = params[0] as string;
        indices.delete(id);
        return { success: true };
      }
      if (query.includes("INTO basket_items")) {
        const [indexId, ticker, name, weight, theme] = params as [string, string, string, number, string];
        const existingIdx = basketItems.findIndex((b) => b.index_id === indexId && b.ticker === ticker);
        if (existingIdx >= 0) {
          basketItems[existingIdx] = { index_id: indexId, ticker, name, weight, theme };
        } else {
          basketItems.push({ index_id: indexId, ticker, name, weight, theme });
        }
        return { success: true };
      }
      if (query.includes("DELETE FROM basket_items WHERE index_id = ? AND ticker = ?")) {
        const [indexId, ticker] = params as [string, string];
        const idx = basketItems.findIndex((b) => b.index_id === indexId && b.ticker === ticker);
        if (idx >= 0) basketItems.splice(idx, 1);
        return { success: true };
      }
      if (query.includes("DELETE FROM basket_items WHERE index_id = ?")) {
        const [indexId] = params as [string];
        for (let i = basketItems.length - 1; i >= 0; i--) {
          if (basketItems[i].index_id === indexId) basketItems.splice(i, 1);
        }
        return { success: true };
      }
      return { success: true };
    };

    return {
      bind: (...params: unknown[]) => ({
        all: () => executeAll(params),
        run: () => executeRun(params),
      }),
      all: () => executeAll([]),
      run: () => executeRun([]),
    };
  });

  return {
    env: {
      ASSETS: {
        fetch: vi.fn().mockResolvedValue(new Response("Asset", { status: 200 })),
      },
      DB: {
        prepare,
        batch: vi.fn().mockImplementation(async (stmts: any[]) => {
          for (const s of stmts) {
            if (typeof s?.run === "function") await s.run();
          }
          return [];
        }),
      },
      ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    },
    indices,
    basketItems,
  };
}

describe("Comprehensive Review & Hardening Audit", () => {
  it("verifies SYSTEM_INDEX_IDS export matches SYSTEM_INDICES set", () => {
    expect(SYSTEM_INDEX_IDS.size).toBe(SYSTEM_INDICES.size);
    for (const id of Array.from(SYSTEM_INDICES)) {
      expect(SYSTEM_INDEX_IDS.has(id)).toBe(true);
    }
  });

  describe("Ownership Protection during Admin Edits", () => {
    it("preserves original creator's owner_token_hash when admin edits custom index", async () => {
      const { env, indices } = createAuditTestEnv();

      // 1. User creates custom index.
      // SEC-04: a newly set owner token has to match
      // `^[A-Za-z0-9_-]{32,256}$`, so the fixture uses a strong token.
      const userToken = "user-secret-token-0123456789abcdef";
      const createReq = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-auth-password": TEST_ADMIN_PASSWORD },
        body: JSON.stringify({
          id: "custom-my-portfolio",
          name: "My Portfolio",
          ownerToken: userToken,
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const createRes = await worker.fetch(createReq, env as any);
      expect(createRes.status).toBe(200);

      const originalHash = indices.get("custom-my-portfolio")?.owner_token_hash;
      expect(originalHash).toBeTruthy();
      // SEC-08: the issuance time is stored next to the hash.
      const originalIssuedAt = indices.get("custom-my-portfolio")?.owner_token_issued_at;
      expect(typeof originalIssuedAt).toBe("number");
      expect(originalIssuedAt as number).toBeGreaterThan(0);

      // 2. Admin edits custom index (with admin auth, without user token)
      const adminEditReq = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "custom-my-portfolio",
          name: "My Portfolio (Admin Reviewed)",
          ownerToken: "admin-generated-token-0123456789abcdef", // Admin UI generated random token
          basket: [
            { ticker: "7203", name: "Toyota", weight: 50 },
            { ticker: "9984", name: "SoftBank", weight: 50 },
          ],
        }),
      });
      const adminEditRes = await worker.fetch(adminEditReq, env as any);
      expect(adminEditRes.status).toBe(200);

      // Verify that the stored owner_token_hash was NOT overwritten with admin's token
      const afterAdminHash = indices.get("custom-my-portfolio")?.owner_token_hash;
      expect(afterAdminHash).toBe(originalHash);
      // The issuance time belongs to the preserved token: resetting it would
      // silently extend the lifetime of an already expired owner token.
      expect(indices.get("custom-my-portfolio")?.owner_token_issued_at).toBe(originalIssuedAt);

      // 3. Original user updates index using their original userToken -> must succeed!
      const userUpdateReq = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-owner-token": userToken,
        },
        body: JSON.stringify({
          id: "custom-my-portfolio",
          name: "My Portfolio (User Follow-up)",
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const userUpdateRes = await worker.fetch(userUpdateReq, env as any);
      expect(userUpdateRes.status).toBe(200);
    });

    it("ensures admin edit on built-in system index leaves owner_token_hash as null", async () => {
      const { env, indices } = createAuditTestEnv();

      // Admin updates system index (nikkei-175)
      const adminEditReq = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "nikkei-175",
          name: "Nikkei 175 Updated",
          ownerToken: "random-uuid-9999",
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const adminEditRes = await worker.fetch(adminEditReq, env as any);
      expect(adminEditRes.status).toBe(200);

      // System index must still have null owner_token_hash
      expect(indices.get("nikkei-175")?.owner_token_hash).toBeNull();

      // Non-admin cannot edit it even with the token that was in admin request
      const nonAdminReq = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-owner-token": "random-uuid-9999",
        },
        body: JSON.stringify({
          id: "nikkei-175",
          name: "Hacked Nikkei",
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const nonAdminRes = await worker.fetch(nonAdminReq, env as any);
      expect(nonAdminRes.status).toBe(403);
    });
  });

  describe("Sort Order Persistence & Fetching", () => {
    it("respects sortOrder on save and returns sortOrder via GET /api/indices", async () => {
      const { env } = createAuditTestEnv();

      const saveReq = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "custom-sorted-index",
          name: "Sorted Index",
          sortOrder: 15,
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const saveRes = await worker.fetch(saveReq, env as any);
      expect(saveRes.status).toBe(200);

      const listReq = new Request("http://localhost/api/indices", { method: "GET" });
      const listRes = await worker.fetch(listReq, env as any);
      expect(listRes.status).toBe(200);
      const listData = await listRes.json();
      const item = listData.find((idx: any) => idx.id === "custom-sorted-index");
      expect(item).toBeDefined();
      expect(item.sortOrder).toBe(15);

      // Subsequent update without specifying sortOrder retains 15
      const updateReq = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "custom-sorted-index",
          name: "Sorted Index Updated",
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const updateRes = await worker.fetch(updateReq, env as any);
      expect(updateRes.status).toBe(200);

      const listReq2 = new Request("http://localhost/api/indices", { method: "GET" });
      const listRes2 = await worker.fetch(listReq2, env as any);
      const listData2 = await listRes2.json();
      const item2 = listData2.find((idx: any) => idx.id === "custom-sorted-index");
      expect(item2.sortOrder).toBe(15);
    });

    it("rejects invalid sortOrder bounds with 400", async () => {
      const { env } = createAuditTestEnv();

      const badReq = new Request("http://localhost/api/indices", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          id: "bad-sort-order",
          name: "Bad Sort",
          sortOrder: -1,
          basket: [{ ticker: "7203", name: "Toyota", weight: 100 }],
        }),
      });
      const badRes = await worker.fetch(badReq, env as any);
      expect(badRes.status).toBe(400);
      const data = await badRes.json();
      expect(data.error).toContain("表示順は0〜9999の数値で指定してください");
    });
  });

  describe("Strict Validation on /api/indices/stock", () => {
    it("rejects invalid or malicious indexId in POST /api/indices/stock", async () => {
      const { env } = createAuditTestEnv();

      // Path traversal or invalid characters in indexId
      const badReq = new Request("http://localhost/api/indices/stock", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
        body: JSON.stringify({
          indexId: "../../../etc/passwd",
          stock: { ticker: "7203", name: "Toyota", weight: 10 },
        }),
      });
      const badRes = await worker.fetch(badReq, env as any);
      expect(badRes.status).toBe(400);
      const data = await badRes.json();
      expect(data.error).toContain("指数IDを指定してください");
    });

    it("rejects invalid indexId or ticker in DELETE /api/indices/stock", async () => {
      const { env } = createAuditTestEnv();

      // Invalid characters in indexId
      const badReq = new Request("http://localhost/api/indices/stock?indexId=bad;drop&ticker=7203", {
        method: "DELETE",
        headers: {
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
      });
      const badRes = await worker.fetch(badReq, env as any);
      expect(badRes.status).toBe(400);
      const data = await badRes.json();
      expect(data.error).toContain("指数IDとティッカーを指定してください");
    });
  });

  describe("System Index Deletion Protection", () => {
    it("rejects DELETE /api/indices on system indices even with admin password", async () => {
      const { env } = createAuditTestEnv();

      const delReq = new Request("http://localhost/api/indices?id=nikkei-175", {
        method: "DELETE",
        headers: {
          "x-auth-password": TEST_ADMIN_PASSWORD,
        },
      });
      const delRes = await worker.fetch(delReq, env as any);
      expect(delRes.status).toBe(403);
      const data = await delRes.json();
      expect(data.error).toContain("組み込みの指数は削除できません");
    });
  });
});
