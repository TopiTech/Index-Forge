import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPortfolioPositions, hasPersistedPortfolio } from "./portfolioStorage";
import { safeRandomId } from "./randomId";
import { OWNER_TOKEN_PATTERN } from "../../worker/internal";

/**
 * The browser can deny storage access (Safari private mode, blocked cookies,
 * sandboxed iframe) and can withhold `crypto.randomUUID` (any non-secure
 * context). Neither may take the application down or make a feature unusable.
 */
describe("blocked storage", () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  afterEach(() => {
    if (original) {
      Object.defineProperty(globalThis, "localStorage", original);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("does not throw when reading the localStorage getter fails", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });

    expect(() => loadPortfolioPositions()).not.toThrow();
    expect(Array.isArray(loadPortfolioPositions())).toBe(true);
    expect(() => hasPersistedPortfolio()).not.toThrow();
    expect(hasPersistedPortfolio()).toBe(false);
  });
});

describe("safeRandomId", () => {
  it("produces a hex identifier of the requested byte length", () => {
    const id = safeRandomId(24);
    expect(id).toHaveLength(48);
    expect(id).toMatch(/^[0-9a-f]+$/);
  });

  it("produces a value the Worker accepts as an owner token", () => {
    expect(OWNER_TOKEN_PATTERN.test(safeRandomId(24))).toBe(true);
  });

  it("works when crypto.randomUUID is unavailable", () => {
    const cryptoRef = globalThis.crypto as unknown as { randomUUID?: unknown };
    const original = cryptoRef.randomUUID;
    Object.defineProperty(cryptoRef, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    try {
      const id = safeRandomId(24);
      expect(id).toHaveLength(48);
      expect(OWNER_TOKEN_PATTERN.test(id)).toBe(true);
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(cryptoRef, "randomUUID");
      } else {
        Object.defineProperty(cryptoRef, "randomUUID", {
          configurable: true,
          value: original,
        });
      }
    }
  });

  it("returns distinct identifiers", () => {
    const ids = new Set(Array.from({ length: 50 }, () => safeRandomId(16)));
    expect(ids.size).toBe(50);
  });

  it("does not leave an unhandled rejection when the fallback path is taken", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => safeRandomId(8)).not.toThrow();
    spy.mockRestore();
  });
});
