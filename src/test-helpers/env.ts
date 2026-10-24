/**
 * Typed adapter for the Worker environment doubles used by the test suite.
 *
 * The doubles intentionally model only the parts of D1 and of the assets
 * binding that a scenario needs, so they cannot satisfy the full `Env`
 * contract structurally. The conversion is confined to this single, documented
 * adapter boundary instead of being repeated at every call site.
 */
import type { Env } from "../../worker/internal";

export interface WorkerEnvDouble {
  DB: unknown;
  ASSETS?: unknown;
  ADMIN_PASSWORD?: string;
  ADMIN_SECRET_CODE?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
}

export function asWorkerEnv(double: WorkerEnvDouble): Env {
  return double as unknown as Env;
}

/** A D1 statement double that accepts binds and answers with no rows. */
export interface StubStatement {
  bind: (...params: unknown[]) => StubStatement;
  all: () => Promise<{ results: unknown[] }>;
  run: () => Promise<{ success: true; meta: { changes: number } }>;
  query: string;
}

/**
 * An empty D1 double: every query succeeds and returns nothing.
 *
 * Endpoints that only need "the database said nothing" (validation, headers,
 * transport errors) can use this instead of re-declaring the same stub.
 */
export function createStubDb(): {
  prepare: (query: string) => StubStatement;
  batch: () => Promise<unknown[]>;
} {
  return {
    prepare: (query: string) => {
      const statement: StubStatement = {
        bind: () => statement,
        all: async () => ({ results: [] }),
        run: async () => ({ success: true, meta: { changes: 1 } }),
        query,
      };
      return statement;
    },
    batch: async () => [],
  };
}

/** A Worker environment backed by {@link createStubDb}. */
export function createStubWorkerEnv(overrides: Partial<WorkerEnvDouble> = {}): Env {
  return asWorkerEnv({
    DB: createStubDb(),
    ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
    ...overrides,
  });
}
