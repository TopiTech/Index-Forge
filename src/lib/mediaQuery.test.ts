import { describe, it, expect, vi, afterEach } from "vitest";
import {
  getMediaMatches,
  prefersReducedMotion,
  REDUCED_MOTION_QUERY,
  subscribeMediaQuery,
} from "./mediaQuery";

const QUERY = "(max-width: 1080px)";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getMediaMatches", () => {
  it("returns the query result on modern runtimes", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => ({ matches: true })),
    } as unknown as Window);
    expect(getMediaMatches(QUERY)).toBe(true);
  });

  it("degrades to false when matchMedia is missing instead of throwing", () => {
    vi.stubGlobal("window", {} as unknown as Window);
    expect(getMediaMatches(QUERY)).toBe(false);
  });

  it("degrades to false when matchMedia throws instead of throwing", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => {
        throw new Error("denied");
      }),
    } as unknown as Window);
    expect(getMediaMatches(QUERY)).toBe(false);
  });
});

describe("prefersReducedMotion", () => {
  it("queries the OS reduced-motion preference", () => {
    const matchMedia = vi.fn(() => ({ matches: true }));
    vi.stubGlobal("window", { matchMedia } as unknown as Window);

    expect(REDUCED_MOTION_QUERY).toBe("(prefers-reduced-motion: reduce)");
    expect(prefersReducedMotion()).toBe(true);
    expect(matchMedia).toHaveBeenCalledWith(REDUCED_MOTION_QUERY);
  });

  it("reports false when the platform cannot answer", () => {
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => {
        throw new Error("denied");
      }),
    } as unknown as Window);

    expect(prefersReducedMotion()).toBe(false);
  });
});

describe("subscribeMediaQuery", () => {
  it("subscribes via addEventListener and unsubscribes on cleanup", () => {
    const listeners = new Map<string, () => void>();
    const mql = {
      matches: false,
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn((type: string) => {
        listeners.delete(type);
      }),
    };
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => mql),
    } as unknown as Window);

    const seen: boolean[] = [];
    const unsubscribe = subscribeMediaQuery(QUERY, (matches) => {
      seen.push(matches);
    });
    mql.matches = true;
    listeners.get("change")?.();
    expect(seen).toEqual([true]);
    unsubscribe();
    expect(mql.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
  });

  it("falls back to legacy addListener on Safari < 14 runtimes", () => {
    const holder: { legacyListener: (() => void) | null } = { legacyListener: null };
    const mql = {
      matches: true,
      addListener: vi.fn((listener: () => void) => {
        holder.legacyListener = listener;
      }),
      removeListener: vi.fn(),
    };
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => mql),
    } as unknown as Window);

    const seen: boolean[] = [];
    const unsubscribe = subscribeMediaQuery(QUERY, (matches) => {
      seen.push(matches);
    });
    holder.legacyListener?.();
    expect(seen).toEqual([true]);
    unsubscribe();
    expect(mql.removeListener).toHaveBeenCalledWith(expect.any(Function));
  });

  it("returns a no-op cleanup when the platform cannot observe the query", () => {
    vi.stubGlobal("window", {} as unknown as Window);
    const handler = vi.fn();
    const unsubscribe = subscribeMediaQuery(QUERY, handler);
    expect(() => unsubscribe()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });

  it("does not let a throwing consumer break the subscription", () => {
    const listeners = new Map<string, () => void>();
    const mql = {
      matches: true,
      addEventListener: vi.fn((type: string, listener: () => void) => {
        listeners.set(type, listener);
      }),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("window", {
      matchMedia: vi.fn(() => mql),
    } as unknown as Window);

    const unsubscribe = subscribeMediaQuery(QUERY, () => {
      throw new Error("consumer bug");
    });
    expect(() => listeners.get("change")?.()).not.toThrow();
    expect(() => unsubscribe()).not.toThrow();
  });
});
