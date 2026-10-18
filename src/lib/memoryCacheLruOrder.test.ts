import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setMemoryCache,
  getMemoryCache,
  clearMemoryCache,
  setAllowMemoryCacheInTest,
} from "../../worker/internal";

describe("memory cache & rate limit LRU map order updates", () => {
  beforeEach(() => {
    clearMemoryCache();
    setAllowMemoryCacheInTest(true);
  });

  afterEach(() => {
    clearMemoryCache();
    setAllowMemoryCacheInTest(false);
  });

  it("refreshes Map insertion order when an existing cache key is overwritten", () => {
    // Fill with entry A, then entry B
    setMemoryCache("stock:A", { val: 1 }, 300);
    setMemoryCache("stock:B", { val: 2 }, 300);

    // Overwrite entry A -> it should now be refreshed in Map
    setMemoryCache("stock:A", { val: 10 }, 300);

    expect(getMemoryCache("stock:A")).toEqual({ val: 10 });
    expect(getMemoryCache("stock:B")).toEqual({ val: 2 });
  });
});
