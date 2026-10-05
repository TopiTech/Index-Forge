import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setMemoryCache,
  getMemoryCache,
  getMemoryCacheEntry,
  clearMemoryCache,
  setAllowMemoryCacheInTest,
} from "../../worker/internal";

/**
 * Regression guard for the in-memory cache test bypass.
 *
 * The bypass used to key off `process.env.NODE_ENV === "test"` only. A shell
 * or CI job that exports `NODE_ENV=production` silently defeated it, so cached
 * responses leaked between cases and tests failed depending on the developer's
 * environment. The bypass must hold regardless of NODE_ENV.
 */
describe("memory cache test bypass is independent of NODE_ENV", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    clearMemoryCache();
    setAllowMemoryCacheInTest(false);
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    clearMemoryCache();
    setAllowMemoryCacheInTest(false);
  });

  it("ignores cached entries while running under a test runner even when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    setMemoryCache("cache-bypass-probe", { value: 1 }, 600);

    expect(getMemoryCache("cache-bypass-probe")).toBeNull();
    expect(getMemoryCacheEntry("cache-bypass-probe")).toBeNull();
  });

  it("ignores cached calculation entries under the same conditions", () => {
    process.env.NODE_ENV = "production";
    setMemoryCache("calc:probe", { value: 2 }, 600);

    expect(getMemoryCache("calc:probe")).toBeNull();
  });

  it("still serves cached entries when explicitly allowed, even with NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    setAllowMemoryCacheInTest(true);
    setMemoryCache("cache-allowed-probe", { value: 3 }, 600);

    expect(getMemoryCache("cache-allowed-probe")).toEqual({ value: 3 });
    expect(getMemoryCacheEntry("cache-allowed-probe")?.data).toEqual({ value: 3 });
  });
});
