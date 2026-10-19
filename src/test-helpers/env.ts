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
