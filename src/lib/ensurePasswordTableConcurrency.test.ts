/**
 * N-8 回帰防止: ensurePasswordTable の in-flight 共有。
 *
 * コールドスタートで並行した複数リクエストがそれぞれプロビジョニング
 * (probe + DDL 一式) を実行していた。実行中のプロビジョニングを Promise で
 * 共有し、1 回だけ実行されることを検証する。冪等性 (二重実行しても壊れない) は
 * 既存の workerResilienceImprovements.test.ts 側で維持されている。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensurePasswordTable,
  resetPasswordTableEnsured,
  getPasswordTableProvisionFailedAt,
  type Env,
} from "../../worker/internal";

type Decision =
  | { kind: "all"; results: unknown[] }
  | { kind: "run"; changes?: number }
  | { kind: "throw"; error: Error };

type Router = (sql: string, params: unknown[]) => Decision | undefined;

/** 各ステートメント完了まで delayMs 待つ DB ダブル (並行性を実際の await で発生させる)。 */
function createMockDb(router: Router = () => undefined, delayMs = 15) {
  const executed: { sql: string; params: unknown[] }[] = [];
  const decide = (sql: string, params: unknown[]): Decision => {
    executed.push({ sql, params });
    return (
      router(sql, params) ??
      (/^\s*(SELECT|PRAGMA|WITH)/i.test(sql) ? { kind: "all", results: [] } : { kind: "run" })
    );
  };
  const delay = () => new Promise((resolve) => setTimeout(resolve, delayMs));
  const makeStatement = (sql: string) => {
    let params: unknown[] = [];
    const statement = {
      bind: (...args: unknown[]) => {
        params = args;
        return statement;
      },
      all: async () => {
        await delay();
        const decision = decide(sql, params);
        if (decision.kind === "throw") throw decision.error;
        return {
          results: decision.kind === "all" ? decision.results : [],
          success: true,
        };
      },
      run: async () => {
        await delay();
        const decision = decide(sql, params);
        if (decision.kind === "throw") throw decision.error;
        return {
          success: true,
          meta: { changes: decision.kind === "run" ? (decision.changes ?? 1) : 1 },
        };
      },
    };
    return statement;
  };
  const db = {
    prepare: (sql: string) => makeStatement(sql),
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true })),
  };
  return { db: db as unknown as Env["DB"], executed };
}

function createMockEnv(db: Env["DB"]): Env {
  return {
    ASSETS: { fetch: async () => new Response(null) } as unknown as Env["ASSETS"],
    DB: db,
  };
}

/** プロビジョニングの実行回数 = スキーマ probe (sqlite_master 問い合わせ) の回数。 */
function provisioningRuns(executed: { sql: string }[]): number {
  return executed.filter((entry) => entry.sql.includes("FROM sqlite_master")).length;
}

describe("ensurePasswordTable in-flight sharing (N-8)", () => {
  beforeEach(() => {
    resetPasswordTableEnsured();
  });

  afterEach(() => {
    resetPasswordTableEnsured();
    vi.restoreAllMocks();
  });

  it("runs one provisioning for concurrent cold-start callers and shares the promise", async () => {
    const { db, executed } = createMockDb();
    const env = createMockEnv(db);

    const first = ensurePasswordTable(env);
    const second = ensurePasswordTable(env);
    const third = ensurePasswordTable(env);

    // in-flight プロミスがそのまま共有される (二重実行の根絶)
    expect(second).toBe(first);
    expect(third).toBe(first);

    await Promise.all([first, second, third]);
    expect(provisioningRuns(executed)).toBe(1);

    // 完了後の呼び出しは ensured 短絡で追加実行しない
    await ensurePasswordTable(env);
    expect(provisioningRuns(executed)).toBe(1);
  });

  it("shares a single failing attempt too and keeps the cooldown latch", async () => {
    const { db, executed } = createMockDb((sql) => {
      if (sql.includes("CREATE TABLE IF NOT EXISTS access_passwords")) {
        return { kind: "throw", error: new Error("D1_SCHEMA_WRITE_FAILED") };
      }
      return undefined;
    });
    const env = createMockEnv(db);

    const first = ensurePasswordTable(env);
    const second = ensurePasswordTable(env);
    expect(second).toBe(first);

    // 失敗しても呼び出し元へは reject しない (従来どおり、ラッチのみ立つ)
    await expect(Promise.all([first, second])).resolves.toBeDefined();
    expect(provisioningRuns(executed)).toBe(1);
    expect(getPasswordTableProvisionFailedAt()).toBeGreaterThan(0);

    // クールダウン内の再呼び出しは実行しない (従来どおり)
    await ensurePasswordTable(env);
    expect(provisioningRuns(executed)).toBe(1);
  });

  it("provisions again after resetPasswordTableEnsured", async () => {
    const { db, executed } = createMockDb();
    const env = createMockEnv(db);

    await ensurePasswordTable(env);
    expect(provisioningRuns(executed)).toBe(1);

    resetPasswordTableEnsured();
    await ensurePasswordTable(env);
    expect(provisioningRuns(executed)).toBe(2);
  });

  it("does not share across a reset while a run is in flight (stale cleanup guard)", async () => {
    const { db, executed } = createMockDb();
    const env = createMockEnv(db);

    const inFlight = ensurePasswordTable(env);
    // テストフックでリセットされても、確定済みの古い実行が新しい in-flight
    // エントリを消さないこと (=== ガード)
    resetPasswordTableEnsured();
    const afterReset = ensurePasswordTable(env);

    await Promise.all([inFlight, afterReset]);
    expect(provisioningRuns(executed)).toBe(2);
  });
});
