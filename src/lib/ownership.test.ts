import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getIndexOwnerToken,
  isIndexOwner,
  OWNER_TOKEN_MAX_AGE_MS,
  persistConfirmedOwnerToken,
  removeIndexOwnerToken,
  saveIndexOwnerToken,
  serverIssuedAtToMs,
} from "./ownership";

const STORAGE_KEY = "custom_index_owners";

type Store = Record<string, string>;

function makeStorage(initial: Store = {}) {
  const backing = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key: string) => (backing.has(key) ? (backing.get(key) as string) : null),
    setItem: (key: string, value: string) => void backing.set(key, value),
    removeItem: (key: string) => void backing.delete(key),
    clear: () => void backing.clear(),
  };
}

describe("ownership store robustness", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores and retrieves an owner token", () => {
    saveIndexOwnerToken("idx-1", "token-a");
    expect(getIndexOwnerToken("idx-1")).toBe("token-a");
    expect(isIndexOwner("idx-1")).toBe(true);
    expect(isIndexOwner("idx-other")).toBe(false);
  });

  it("removes an owner token", () => {
    saveIndexOwnerToken("idx-1", "token-a");
    removeIndexOwnerToken("idx-1");
    expect(getIndexOwnerToken("idx-1")).toBeNull();
    expect(isIndexOwner("idx-1")).toBe(false);
  });

  it.each([
    ["null literal", "null"],
    ["number literal", "42"],
    ["array literal", '["a"]'],
    ["malformed JSON", "{not json"],
  ])("degrades to an empty store on %s", (_label, raw) => {
    vi.stubGlobal("localStorage", makeStorage({ [STORAGE_KEY]: raw }));
    expect(getIndexOwnerToken("idx-1")).toBeNull();
    expect(isIndexOwner("idx-1")).toBe(false);
  });

  it("ignores non-string and prototype-polluting entries in a corrupted store", () => {
    const corrupted = JSON.stringify({
      "idx-safe": "token-ok",
      "idx-num": 123,
      __proto__: "token-evil",
    });
    vi.stubGlobal("localStorage", makeStorage({ [STORAGE_KEY]: corrupted }));
    expect(getIndexOwnerToken("idx-safe")).toBe("token-ok");
    expect(getIndexOwnerToken("idx-num")).toBeNull();
    expect(getIndexOwnerToken("__proto__")).toBeNull();
  });

  it("survives a localStorage that throws on read", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
      removeItem: () => {},
      clear: () => {},
    });
    expect(getIndexOwnerToken("idx-1")).toBeNull();
    expect(isIndexOwner("idx-1")).toBe(false);
  });

  it("prunes an entry older than the 90-day window on read", () => {
    const expiredAt = Date.now() - OWNER_TOKEN_MAX_AGE_MS - 1000;
    saveIndexOwnerToken("idx-old", "token-old", expiredAt);
    expect(getIndexOwnerToken("idx-old")).toBeNull();
    expect(isIndexOwner("idx-old")).toBe(false);
  });

  it("survives when accessing the localStorage getter itself throws SecurityError", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("Access to Storage is denied for this document", "SecurityError");
      },
    });
    expect(() => saveIndexOwnerToken("idx-1", "token-a")).not.toThrow();
    expect(() => getIndexOwnerToken("idx-1")).not.toThrow();
    expect(getIndexOwnerToken("idx-1")).toBeNull();
    expect(isIndexOwner("idx-1")).toBe(false);
    expect(() => removeIndexOwnerToken("idx-1")).not.toThrow();
  });
});

describe("serverIssuedAtToMs (single API-boundary conversion)", () => {
  const nowSeconds = Math.floor(Date.now() / 1000);

  it("scales Worker seconds up to milliseconds", () => {
    expect(serverIssuedAtToMs(nowSeconds)).toBe(nowSeconds * 1000);
  });

  it("passes millisecond values through unchanged", () => {
    const nowMs = Date.now();
    expect(serverIssuedAtToMs(nowMs)).toBe(nowMs);
  });

  it.each([[0], [-5], [Number.NaN], [Number.POSITIVE_INFINITY], ["123"], [null], [undefined]])(
    "reports %s as no usable age instead of guessing one",
    (value) => {
      expect(serverIssuedAtToMs(value)).toBeUndefined();
    },
  );
});

describe("persistConfirmedOwnerToken (no sliding expiry)", () => {
  function readRawIssuedAt(indexId: string): number | undefined {
    const raw = (globalThis as { localStorage: Storage }).localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Record<string, { issuedAt?: unknown }>;
    const issuedAt = parsed[indexId]?.issuedAt;
    return typeof issuedAt === "number" ? issuedAt : undefined;
  }

  beforeEach(() => {
    vi.stubGlobal("localStorage", makeStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("stores a confirmed token with the server-supplied seconds age", () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    persistConfirmedOwnerToken("idx-1", "token-new", serverIssuedAtToMs(nowSeconds));
    expect(getIndexOwnerToken("idx-1")).toBe("token-new");
    expect(readRawIssuedAt("idx-1")).toBe(nowSeconds * 1000);
  });

  it("keeps the stored age when the echo carries no issuance time", () => {
    // The Worker preserves the original issuance time on edit, so an echo
    // without `ownerTokenIssuedAt` must not reset the age to now: that would
    // slide the client-side expiry while the Worker enforces the original
    // absolute window and answers 403.
    const storedAt = Date.now() - 60_000;
    saveIndexOwnerToken("idx-1", "token-same", storedAt);
    persistConfirmedOwnerToken("idx-1", "token-same", undefined);
    expect(getIndexOwnerToken("idx-1")).toBe("token-same");
    expect(readRawIssuedAt("idx-1")).toBe(storedAt);
  });

  it("keeps the stored age when the echoed age is unusable", () => {
    const storedAt = Date.now() - 60_000;
    saveIndexOwnerToken("idx-1", "token-same", storedAt);
    persistConfirmedOwnerToken("idx-1", "token-same", serverIssuedAtToMs("garbage"));
    expect(getIndexOwnerToken("idx-1")).toBe("token-same");
    expect(readRawIssuedAt("idx-1")).toBe(storedAt);
  });

  it("stores a brand-new confirmed token without an age as issued now", () => {
    const before = Date.now();
    persistConfirmedOwnerToken("idx-new", "token-brand-new");
    const after = Date.now();
    expect(getIndexOwnerToken("idx-new")).toBe("token-brand-new");
    const issuedAt = readRawIssuedAt("idx-new");
    expect(issuedAt).toBeGreaterThanOrEqual(before);
    expect(issuedAt).toBeLessThanOrEqual(after);
  });

  it("replaces a different stored token with the confirmed one", () => {
    saveIndexOwnerToken("idx-1", "token-old", Date.now() - 60_000);
    const confirmedAt = Math.floor(Date.now() / 1000) - 30;
    persistConfirmedOwnerToken("idx-1", "token-confirmed", serverIssuedAtToMs(confirmedAt));
    expect(getIndexOwnerToken("idx-1")).toBe("token-confirmed");
    expect(readRawIssuedAt("idx-1")).toBe(confirmedAt * 1000);
  });

  it("ignores empty ids and tokens without touching the store", () => {
    persistConfirmedOwnerToken("", "token-x");
    persistConfirmedOwnerToken("idx-1", "");
    expect((globalThis as { localStorage: Storage }).localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});
