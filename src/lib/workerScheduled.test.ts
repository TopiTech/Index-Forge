import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import handler, { WorkerScheduledController, WorkerExecutionContext, Env } from "../../worker/internal-impl";

function createMockDb() {
  const executedStatements: { sql: string; params: unknown[] }[] = [];
  const mockDb = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              executedStatements.push({ sql, params });
              return { success: true };
            },
          };
        },
      };
    },
  };
  return { mockDb: mockDb as unknown as Env["DB"], executedStatements };
}

describe("worker scheduled handler", () => {
  it("exports a scheduled handler alongside fetch", () => {
    expect(typeof handler.fetch).toBe("function");
    expect(typeof handler.scheduled).toBe("function");
  });

  it("purges expired security rows across all tables when scheduled fires", async () => {
    const { mockDb, executedStatements } = createMockDb();
    const env: Env = {
      ASSETS: {} as Env["ASSETS"],
      DB: mockDb,
    };

    const scheduledTime = 1700000000000; // ms
    const controller: WorkerScheduledController = {
      scheduledTime,
      cron: "0 3 * * *",
    };

    await handler.scheduled(controller, env);

    const executedTables = executedStatements.map((s) => s.sql);
    expect(executedTables.some((sql) => sql.includes("rate_limits"))).toBe(true);
    expect(executedTables.some((sql) => sql.includes("admin_sessions"))).toBe(true);
    expect(executedTables.some((sql) => sql.includes("admin_login_attempts"))).toBe(true);
    expect(executedTables.some((sql) => sql.includes("sync_quota"))).toBe(true);
  });

  it("delegates to ctx.waitUntil when execution context is provided", async () => {
    const { mockDb } = createMockDb();
    const env: Env = {
      ASSETS: {} as Env["ASSETS"],
      DB: mockDb,
    };

    const waitUntilMock = vi.fn();
    const ctx: WorkerExecutionContext = {
      waitUntil: waitUntilMock,
    };

    const controller: WorkerScheduledController = {
      scheduledTime: Date.now(),
      cron: "0 0 * * *",
    };

    await handler.scheduled(controller, env, ctx);

    expect(waitUntilMock).toHaveBeenCalledTimes(1);
    const passedPromise = waitUntilMock.mock.calls[0][0];
    expect(passedPromise).toBeInstanceOf(Promise);
    await passedPromise;
  });

  it("handles db purge errors gracefully without throwing unhandled exceptions", async () => {
    const failingDb = {
      prepare() {
        return {
          bind() {
            return {
              async run() {
                throw new Error("D1 connection lost");
              },
            };
          },
        };
      },
    } as unknown as Env["DB"];

    const env: Env = {
      ASSETS: {} as Env["ASSETS"],
      DB: failingDb,
    };

    const controller: WorkerScheduledController = {
      scheduledTime: Date.now(),
      cron: "0 3 * * *",
    };

    // Must not throw
    await expect(handler.scheduled(controller, env)).resolves.not.toThrow();
  });

  it("wires the scheduled handler to a cron trigger so the purge actually fires (W-02)", () => {
    // A `scheduled` handler without `triggers.crons` in wrangler.jsonc never
    // fires: the expired security rows were then only purged by the
    // probabilistic per-request cleanup. The config is the artifact Cloudflare
    // consumes, so it is parsed structurally (not pattern-matched) and paired
    // with the handler it must invoke.
    const raw = readFileSync(resolve(process.cwd(), "wrangler.jsonc"), "utf8");
    // wrangler.jsonc is JSONC and its comments are full-line; a trailing
    // comment would fail this parse loudly instead of passing silently.
    const config = JSON.parse(raw.replace(/^\s*\/\/.*$/gm, "")) as {
      triggers?: { crons?: unknown };
    };

    const crons = config.triggers?.crons;
    expect(Array.isArray(crons)).toBe(true);
    const entries = crons as unknown[];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(typeof entry).toBe("string");
      // Standard five-field cron: minute hour day-of-month month day-of-week.
      expect((entry as string).trim().split(/\s+/)).toHaveLength(5);
    }

    // The trigger is only meaningful together with the handler it dispatches.
    expect(typeof handler.scheduled).toBe("function");
  });
});
