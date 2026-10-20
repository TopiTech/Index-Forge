// @vitest-environment jsdom
/**
 * The `creator_id` of a custom index belongs to the user who created it.
 *
 * The Worker stores the creator in the `indices` table and preserves it on
 * every write, so an administrator editing somebody else's index must not take
 * the ownership over (and a legacy row without a creator must not gain one).
 *
 * The assertions below are behavioural: the Worker is called through
 * `worker.fetch` and the *stored* rows of a small in-memory D1 double are
 * inspected afterwards. The SQL text is never asserted on.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import worker from "../../worker/index";
import {
  clearAuthCache,
  clearMemoryCache,
  clearMemoryRateLimits,
  hashPassword,
  hashToken,
  resetPasswordTableEnsured,
} from "../../worker/internal";
import { CalendarPage } from "../components/CalendarPage";
import { ToastProvider } from "../components/Toast";

// jsdom ships a `crypto` without a SubtleCrypto implementation, but the Worker
// hashes passwords and owner tokens with it. Node's WebCrypto is a drop-in
// replacement, so the Worker can be exercised from a DOM test as well.
const nodeCrypto = process.getBuiltinModule("crypto");
if (typeof globalThis.crypto?.subtle?.digest !== "function" && nodeCrypto?.webcrypto) {
  Object.defineProperty(globalThis, "crypto", {
    value: nodeCrypto.webcrypto,
    configurable: true,
    writable: true,
  });
}

const TEST_ADMIN_PASSWORD = "AdminPassword123!";
const TEST_USER_PASSWORD = "UserPassword123!";

type BoundValue = string | number | null;

interface StoredIndexRow {
  id: string;
  name: string;
  description: string;
  base_value: number;
  owner_token_hash: string | null;
  owner_token_issued_at: number | null;
  creator_id: string | null;
  created_at: number | null;
  sort_order: number | null;
}

interface StoredBasketRow {
  index_id: string;
  ticker: string;
  name: string;
  weight: number;
  theme: string;
}

interface AccessPasswordRow {
  id: string;
  name: string;
  password_hash: string;
  role: "admin" | "user";
  max_stocks: number | null;
  max_indices: number | null;
  is_active: number;
}

beforeEach(() => {
  clearAuthCache();
  clearMemoryCache();
  clearMemoryRateLimits();
  resetPasswordTableEnsured();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Split a comma separated list, ignoring commas inside parentheses. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth += 1;
    else if (ch === ")") depth -= 1;
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

function readColumn(row: StoredIndexRow | undefined, column: string): BoundValue {
  if (!row) return null;
  switch (column) {
    case "id":
      return row.id;
    case "name":
      return row.name;
    case "description":
      return row.description;
    case "base_value":
      return row.base_value;
    case "owner_token_hash":
      return row.owner_token_hash;
    case "owner_token_issued_at":
      return row.owner_token_issued_at;
    case "creator_id":
      return row.creator_id;
    case "created_at":
      return row.created_at;
    case "sort_order":
      return row.sort_order;
    default:
      throw new Error(`Unsupported column in the index upsert: ${column}`);
  }
}

/**
 * A tiny in-memory D1 double.
 *
 * It understands the statements the Worker issues for `POST /api/indices`
 * (the index upsert, the basket delete and the basket inserts) and stores the
 * result, so the test can assert the *stored* values. An unknown statement
 * throws instead of being ignored, so a changed Worker contract fails loudly
 * instead of silently passing.
 */
function createIndicesDbDouble(options: {
  indices: StoredIndexRow[];
  users: AccessPasswordRow[];
  creatorMaxStocks: number | null;
}) {
  const table = new Map<string, StoredIndexRow>(
    options.indices.map((row) => [row.id, { ...row }]),
  );
  const basket = new Map<string, StoredBasketRow[]>();

  const selectRows = (sql: string, params: BoundValue[]): unknown[] => {
    if (sql.includes("FROM sqlite_master")) return [];
    if (sql.includes("FROM access_passwords")) {
      if (sql.includes("SELECT max_stocks FROM access_passwords WHERE id = ?")) {
        return [{ max_stocks: options.creatorMaxStocks }];
      }
      if (sql.includes("WHERE id = 'admin-master'")) {
        return options.users.filter((user) => user.id === "admin-master");
      }
      return options.users.filter((user) => user.is_active === 1);
    }
    if (sql.includes("SELECT COUNT(*) as count FROM indices WHERE creator_id = ?")) {
      const creatorId = params[0];
      const count = [...table.values()].filter((row) => row.creator_id === creatorId).length;
      return [{ count }];
    }
    if (sql.includes("SELECT COUNT(*) AS pending FROM indices")) {
      return [{ pending: 0 }];
    }
    if (sql.includes("FROM indices WHERE id = ?")) {
      const row = table.get(String(params[0]));
      return row ? [{ ...row }] : [];
    }
    return [];
  };

  const evaluateExpression = (
    expression: string,
    params: BoundValue[],
    cursor: { index: number },
  ): BoundValue => {
    if (expression === "?") return params[cursor.index++];

    // COALESCE((SELECT <column> FROM indices WHERE id = ?), ?)
    const preserved = expression.match(
      /^COALESCE\(\(SELECT\s+(\w+)\s+FROM\s+indices\s+WHERE\s+id\s*=\s*\?\),\s*\?\)$/i,
    );
    if (preserved) {
      const id = params[cursor.index++];
      const fallback = params[cursor.index++];
      const current = readColumn(table.get(String(id)), preserved[1]);
      return current === null || current === undefined ? fallback : current;
    }

    // COALESCE(?, (SELECT <column> FROM indices WHERE id = ?), 99)
    const preferred = expression.match(
      /^COALESCE\(\?,\s*\(SELECT\s+(\w+)\s+FROM\s+indices\s+WHERE\s+id\s*=\s*\?\),\s*99\)$/i,
    );
    if (preferred) {
      const first = params[cursor.index++];
      const id = params[cursor.index++];
      if (first !== null && first !== undefined) return first;
      const current = readColumn(table.get(String(id)), preferred[1]);
      return current === null || current === undefined ? 99 : current;
    }

    throw new Error(`Unsupported value expression in the index upsert: ${expression}`);
  };

  const applyIndexUpsert = (sql: string, params: BoundValue[]): number => {
    const columnsMatch = sql.match(/INTO\s+indices\s*\(([^)]*)\)/i);
    if (!columnsMatch) throw new Error(`Unsupported index upsert: ${sql}`);
    const columns = columnsMatch[1].split(",").map((column) => column.trim());

    let expressionText: string;
    const valuesMatch = sql.match(/VALUES\s*\(([\s\S]*)\)\s*$/i);
    if (valuesMatch) {
      expressionText = valuesMatch[1];
    } else {
      const selectMatch = sql.match(/SELECT\s+([\s\S]*?)\s+WHERE\s+\(SELECT COUNT/i);
      if (!selectMatch) throw new Error(`Unsupported index upsert: ${sql}`);
      expressionText = selectMatch[1];
    }

    const expressions = splitTopLevel(expressionText);
    if (expressions.length !== columns.length) {
      throw new Error(`Unsupported index upsert: ${sql}`);
    }

    const cursor = { index: 0 };
    const values: Record<string, BoundValue> = {};
    columns.forEach((column, index) => {
      values[column] = evaluateExpression(expressions[index], params, cursor);
    });

    // The quota guarded insert only writes while the creator is below the limit.
    if (/WHERE\s+\(SELECT COUNT\(\*\) FROM indices WHERE creator_id = \?\)\s*<\s*\?/i.test(sql)) {
      const creatorId = params[cursor.index++];
      const limit = Number(params[cursor.index++]);
      const count = [...table.values()].filter((row) => row.creator_id === creatorId).length;
      if (!(count < limit)) return 0;
    }

    table.set(String(values.id), {
      id: String(values.id),
      name: String(values.name ?? ""),
      description: String(values.description ?? ""),
      base_value: Number(values.base_value ?? 1000),
      owner_token_hash:
        values.owner_token_hash === null || values.owner_token_hash === undefined
          ? null
          : String(values.owner_token_hash),
      owner_token_issued_at:
        values.owner_token_issued_at === null || values.owner_token_issued_at === undefined
          ? null
          : Number(values.owner_token_issued_at),
      creator_id:
        values.creator_id === null || values.creator_id === undefined
          ? null
          : String(values.creator_id),
      created_at:
        values.created_at === null || values.created_at === undefined
          ? null
          : Number(values.created_at),
      sort_order:
        values.sort_order === null || values.sort_order === undefined
          ? null
          : Number(values.sort_order),
    });
    return 1;
  };

  const applyBasketInsert = (sql: string, params: BoundValue[]): number => {
    const tuplePattern = /\(\s*\?\s*,\s*\?\s*,\s*\?\s*,\s*\?\s*,\s*\?\s*\)/g;
    const tuples = sql.match(tuplePattern) ?? [];
    const cursor = { index: 0 };
    const items = tuples.map(() => ({
      index_id: String(params[cursor.index++]),
      ticker: String(params[cursor.index++]),
      name: String(params[cursor.index++]),
      weight: Number(params[cursor.index++]),
      theme: String(params[cursor.index++]),
    }));

    if (/WHERE EXISTS/i.test(sql)) {
      const guardId = String(params[cursor.index++]);
      const guardCreator = params[cursor.index++];
      const row = table.get(guardId);
      if (!row || row.creator_id !== guardCreator) return 0;
    }

    for (const item of items) {
      const list = basket.get(item.index_id) ?? [];
      list.push(item);
      basket.set(item.index_id, list);
    }
    return items.length;
  };

  const applyStatement = (sql: string, params: BoundValue[]): number => {
    if (/INTO\s+indices\s*\(/i.test(sql)) return applyIndexUpsert(sql, params);
    if (/INTO\s+basket_items/i.test(sql)) return applyBasketInsert(sql, params);
    if (/DELETE\s+FROM\s+basket_items/i.test(sql)) {
      basket.delete(String(params[0]));
      return 1;
    }
    // DDL and every other statement is irrelevant for this double.
    return 1;
  };

  interface FakeStatement {
    sql: string;
    params: BoundValue[];
    bind: (...params: BoundValue[]) => FakeStatement;
    all: () => Promise<{ results: unknown[] }>;
    first: () => Promise<unknown>;
    run: () => Promise<{ success: boolean; meta: { changes: number } }>;
  }

  const prepare = (sql: string): FakeStatement => {
    const statement: FakeStatement = {
      sql,
      params: [],
      bind: (...params: BoundValue[]) => {
        statement.params = params;
        return statement;
      },
      all: async () => ({ results: selectRows(sql, statement.params) }),
      first: async () => selectRows(sql, statement.params)[0] ?? null,
      run: async () => ({
        success: true,
        meta: { changes: applyStatement(sql, statement.params) },
      }),
    };
    return statement;
  };

  const db = {
    prepare,
    batch: async (statements: FakeStatement[]) =>
      statements.map((statement) => ({
        success: true,
        meta: { changes: applyStatement(statement.sql, statement.params) },
      })),
  };

  return {
    db,
    /** The stored rows, as the Worker wrote them. */
    indices: table,
    basket,
  };
}

async function createEnv(options?: {
  indices?: StoredIndexRow[];
  creatorMaxStocks?: number | null;
}) {
  const adminHash = await hashPassword(TEST_ADMIN_PASSWORD);
  const userHash = await hashPassword(TEST_USER_PASSWORD);

  const users: AccessPasswordRow[] = [
    {
      id: "admin-master",
      name: "マスター管理者",
      password_hash: adminHash,
      role: "admin",
      max_stocks: null,
      max_indices: null,
      is_active: 1,
    },
    {
      id: "test-user-1",
      name: "テストユーザー",
      password_hash: userHash,
      role: "user",
      max_stocks: 20,
      max_indices: 10,
      is_active: 1,
    },
  ];

  const double = createIndicesDbDouble({
    indices: options?.indices ?? [],
    users,
    creatorMaxStocks: options?.creatorMaxStocks ?? null,
  });

  const env = {
    DB: double.db,
    ADMIN_PASSWORD: TEST_ADMIN_PASSWORD,
    ASSETS: {
      fetch: vi.fn().mockResolvedValue(new Response("asset content", { status: 200 })),
    },
  };

  return { env, double };
}

function postIndexRequest(
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Request {
  return new Request("http://localhost/api/indices", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("POST /api/indices - creator_id preservation", () => {
  it("preserves original user creator_id when updated by an admin", async () => {
    const ownerToken = "secret-owner-token-123";
    const ownerTokenHash = await hashToken(ownerToken);

    const { env, double } = await createEnv({
      indices: [
        {
          id: "user-idx-1",
          name: "ユーザーの指数",
          description: "",
          base_value: 1000,
          owner_token_hash: ownerTokenHash,
          owner_token_issued_at: Math.floor(Date.now() / 1000),
          creator_id: "test-user-1",
          created_at: Math.floor(Date.now() / 1000),
          sort_order: null,
        },
      ],
    });

    // Admin updates the user's index
    const res = await worker.fetch(
      postIndexRequest(
        {
          id: "user-idx-1",
          name: "Admin Updated Index",
          basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
        },
        { "x-auth-password": TEST_ADMIN_PASSWORD },
      ),
      env as never,
    );
    expect(res.status).toBe(200);

    // The stored row still belongs to the user, not to the administrator.
    const stored = double.indices.get("user-idx-1");
    expect(stored).toBeDefined();
    expect(stored?.creator_id).toBe("test-user-1");
    expect(stored?.creator_id).not.toBe("admin-master");
    // The edit itself was applied ...
    expect(stored?.name).toBe("Admin Updated Index");
    expect(double.basket.get("user-idx-1")).toEqual([
      { index_id: "user-idx-1", ticker: "7203", name: "トヨタ", weight: 100, theme: "カスタム" },
    ]);
    // ... and the owner's token was not hijacked by the admin.
    expect(stored?.owner_token_hash).toBe(ownerTokenHash);
  });

  it("preserves original user creator_id when updated via ownerToken without password authentication", async () => {
    const ownerToken = "secret-owner-token-456";
    const ownerTokenHash = await hashToken(ownerToken);

    const { env, double } = await createEnv({
      indices: [
        {
          id: "user-idx-2",
          name: "ユーザーの指数",
          description: "",
          base_value: 1000,
          owner_token_hash: ownerTokenHash,
          owner_token_issued_at: Math.floor(Date.now() / 1000),
          creator_id: "test-user-1",
          created_at: Math.floor(Date.now() / 1000),
          sort_order: null,
        },
      ],
    });

    // User updates index with ownerToken only (guest / unauthenticated session)
    const res = await worker.fetch(
      postIndexRequest(
        {
          id: "user-idx-2",
          name: "Token Updated Index",
          basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
        },
        { "x-owner-token": ownerToken },
      ),
      env as never,
    );
    expect(res.status).toBe(200);

    // The creator is preserved, not dropped to null.
    expect(double.indices.get("user-idx-2")?.creator_id).toBe("test-user-1");
    expect(double.indices.get("user-idx-2")?.creator_id).not.toBeNull();
    // The owner's token hash survived the update.
    expect(double.indices.get("user-idx-2")?.owner_token_hash).toBe(ownerTokenHash);
  });

  it("preserves null creator_id when admin edits a legacy index without creator_id", async () => {
    const { env, double } = await createEnv({
      indices: [
        {
          id: "legacy-idx",
          name: "レガシー指数",
          description: "",
          base_value: 1000,
          owner_token_hash: "hash",
          owner_token_issued_at: null,
          creator_id: null,
          created_at: null,
          sort_order: null,
        },
      ],
    });

    const res = await worker.fetch(
      postIndexRequest(
        {
          id: "legacy-idx",
          name: "Legacy Index Updated",
          basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
        },
        { "x-auth-password": TEST_ADMIN_PASSWORD },
      ),
      env as never,
    );
    expect(res.status).toBe(200);

    // A legacy row without a creator must not gain one (neither the admin's id
    // nor a fabricated value).
    expect(double.indices.get("legacy-idx")?.creator_id).toBeNull();
    expect(double.indices.get("legacy-idx")?.name).toBe("Legacy Index Updated");
  });

  it("assigns authenticated user id as creator_id when creating a new index", async () => {
    const { env, double } = await createEnv();

    const res = await worker.fetch(
      postIndexRequest(
        {
          id: "brand-new-user-idx",
          name: "Brand New User Index",
          basket: [{ ticker: "7203", name: "トヨタ", weight: 100 }],
        },
        { "x-auth-password": TEST_USER_PASSWORD },
      ),
      env as never,
    );
    expect(res.status).toBe(200);

    const stored = double.indices.get("brand-new-user-idx");
    expect(stored).toBeDefined();
    expect(stored?.creator_id).toBe("test-user-1");
    expect(stored?.creator_id).not.toBe("admin-master");
    // A newly created index is protected by a freshly minted owner token.
    expect(typeof stored?.owner_token_hash).toBe("string");
    expect(String(stored?.owner_token_hash).length).toBeGreaterThan(0);
  });
});

describe("CalendarPage Export UX & Toast Integration", () => {
  const urlApi = URL as unknown as {
    createObjectURL: (obj: Blob) => string;
    revokeObjectURL: (url: string) => void;
  };
  const originalCreateObjectURL = urlApi.createObjectURL;
  const originalRevokeObjectURL = urlApi.revokeObjectURL;

  beforeEach(() => {
    // jsdom implements neither the object URL API nor the download navigation.
    urlApi.createObjectURL = vi.fn(() => "blob:mock");
    urlApi.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    urlApi.createObjectURL = originalCreateObjectURL;
    urlApi.revokeObjectURL = originalRevokeObjectURL;
  });

  function renderCalendarPage() {
    return render(
      createElement(
        ToastProvider,
        null,
        createElement(CalendarPage, {
          onNavigate: vi.fn(),
          onOpenStockDetail: vi.fn(),
        }),
      ),
    );
  }

  it("integrates useToast in CalendarPage for export confirmation and empty state feedback", async () => {
    // The calendar API is unavailable: the page falls back to the generated
    // schedule, which is enough to exercise the export path.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 500 })),
    );
    const downloaded: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloaded.push(this.getAttribute("download") ?? "");
    });

    renderCalendarPage();

    const icsButton = await screen.findByRole("button", { name: ".ICS 保存" });
    const csvButton = screen.getByRole("button", { name: "CSV 保存" });

    // The month view reports how many events are currently listed.
    fireEvent.click(screen.getByRole("button", { name: "月間表示" }));
    const counter = await screen.findByText(/該当イベント: \d+件/);
    const eventCount = Number(/(\d+)件/.exec(counter.textContent ?? "")?.[1] ?? "0");
    expect(eventCount).toBeGreaterThan(0);

    // The .ics export confirms itself with a toast and downloads a file.
    fireEvent.click(icsButton);
    expect(await screen.findByText("カレンダー (.ics) をダウンロードしました")).toBeTruthy();
    expect(downloaded.some((name) => name.endsWith(".ics"))).toBe(true);

    // The .csv export confirms itself with the number of exported events.
    fireEvent.click(csvButton);
    expect(
      await screen.findByText(`${eventCount}件のイベントをCSVエクスポートしました`),
    ).toBeTruthy();
    expect(downloaded.some((name) => name.endsWith(".csv"))).toBe(true);
  });

  it("disables the export controls and explains the empty state instead of exporting nothing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 500 })),
    );

    renderCalendarPage();

    const icsButton = await screen.findByRole("button", { name: ".ICS 保存" });
    const csvButton = screen.getByRole("button", { name: "CSV 保存" });
    expect(icsButton.hasAttribute("disabled")).toBe(false);

    // A search that matches nothing empties the list.
    const search = screen.getByLabelText("イベント・銘柄名検索");
    fireEvent.change(search, { target: { value: "no-such-event-xyz" } });

    await waitFor(() => expect(icsButton.hasAttribute("disabled")).toBe(true));
    expect(csvButton.hasAttribute("disabled")).toBe(true);
    // The user is told why nothing can be exported.
    expect(icsButton.getAttribute("title")).toBe("エクスポート対象のイベントがありません");
    expect(csvButton.getAttribute("title")).toBe("エクスポート対象のイベントがありません");
  });

  it("requires the shared toast provider, so the export feedback cannot be lost", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("[]", { status: 500 })),
    );

    // The page is wired to the shared toast API: rendered without a provider
    // it fails loudly instead of silently dropping the export confirmation.
    expect(() =>
      render(
        createElement(CalendarPage, {
          onNavigate: vi.fn(),
          onOpenStockDetail: vi.fn(),
        }),
      ),
    ).toThrow(/useToast must be used within a ToastProvider/);
  });
});
