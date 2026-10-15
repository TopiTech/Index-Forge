/**
 * Regression tests for the admin lockout counter's atomicity.
 *
 * `recordAdminLoginFailure` used to SELECT the row, increment it in
 * JavaScript and write the result back. D1 makes each *statement* atomic, not
 * the sequence, so N concurrent wrong guesses all read the same `failed_count`
 * and wrote the same value: a parallel burst counted as one failure and walked
 * past the advertised 5-attempt / 15-minute lockout with far more than five
 * guesses. The increment now happens inside the UPSERT itself.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  ADMIN_LOGIN_MAX_ATTEMPTS,
  checkAdminLoginLockout,
  recordAdminLoginFailure,
  resetPasswordTableEnsured,
} from "../../worker/internal";

interface AttemptRow {
  ip: string;
  failed_count: number;
  last_failed_at: number;
  locked_until: number;
}

/**
 * D1 emulator whose statements yield to the event loop first, which forces
 * concurrent calls to interleave exactly like parallel requests do: every
 * caller's read is resolved before any caller's write lands.
 */
function createAtomicMockEnv() {
  const attempts = new Map<string, AttemptRow>();
  const statements: string[] = [];

  const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  const env = {
    DB: {
      prepare: (query: string) => ({
        bind: (...params: unknown[]) => ({
          all: async () => {
            await tick();
            statements.push(query);
            if (query.includes("FROM admin_login_attempts WHERE ip = ?")) {
              const row = attempts.get(params[0] as string);
              return { results: row ? [row] : [] };
            }
            return { results: [] };
          },
          run: async () => {
            await tick();
            statements.push(query);
            if (query.includes("INSERT INTO admin_login_attempts")) {
              const [ip, now, windowStart, , maxAttempts, lockedUntil] = params as [
                string,
                number,
                number,
                number,
                number,
                number,
              ];
              const existing = attempts.get(ip);
              const withinWindow = existing ? existing.last_failed_at >= windowStart : false;
              const failedCount = existing && withinWindow ? (existing.failed_count || 0) + 1 : 1;
              attempts.set(ip, {
                ip,
                failed_count: failedCount,
                last_failed_at: now,
                locked_until: failedCount >= maxAttempts ? lockedUntil : 0,
              });
            }
            return { meta: { changes: 1 } };
          },
        }),
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 1 } }),
      }),
    },
    attempts,
    statements,
  };
  return env;
}

beforeEach(() => {
  resetPasswordTableEnsured();
});

describe("atomic admin lockout counter", () => {
  it("increments inside SQL instead of a read-modify-write sequence", async () => {
    const env = createAtomicMockEnv();

    await recordAdminLoginFailure(env as never, "198.51.100.1");

    const insert = env.statements.find((s) => s.includes("INSERT INTO admin_login_attempts"));
    expect(insert).toBeDefined();
    expect(insert).toContain("failed_count + 1");
    expect(insert).toContain("ON CONFLICT(ip) DO UPDATE");
    // The pre-fix statement wrote a counter that had been computed in JS from
    // a previously read row.
    expect(insert).not.toContain("excluded.failed_count");
  });

  it("counts concurrent failures independently so a parallel burst cannot skip the lockout", async () => {
    const env = createAtomicMockEnv();
    const ip = "198.51.100.2";

    const results = await Promise.all(
      Array.from({ length: ADMIN_LOGIN_MAX_ATTEMPTS }, () =>
        recordAdminLoginFailure(env as never, ip),
      ),
    );

    // Every attempt is recorded: the counter ends at 5, not at 1 as it did
    // when all callers read the same empty row before writing.
    expect(env.attempts.get(ip)?.failed_count).toBe(ADMIN_LOGIN_MAX_ATTEMPTS);

    const lockout = await checkAdminLoginLockout(env as never, ip);
    expect(lockout.locked).toBe(true);
    expect(lockout.remainingAttempts).toBe(0);
    expect(results.every((r) => typeof r.failedCount === "number")).toBe(true);
  });

  it("restarts the window instead of accumulating stale failures", async () => {
    const env = createAtomicMockEnv();
    const ip = "198.51.100.3";
    const now = Math.floor(Date.now() / 1000);
    env.attempts.set(ip, {
      ip,
      failed_count: 4,
      last_failed_at: now - 3600, // outside the 15-minute window
      locked_until: 0,
    });

    const res = await recordAdminLoginFailure(env as never, ip);

    expect(res.failedCount).toBe(1);
    expect(res.locked).toBe(false);
    expect(res.remainingAttempts).toBe(ADMIN_LOGIN_MAX_ATTEMPTS - 1);
  });
});
