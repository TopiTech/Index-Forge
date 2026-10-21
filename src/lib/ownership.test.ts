import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getIndexOwnerToken,
  isIndexOwner,
  removeIndexOwnerToken,
  saveIndexOwnerToken,
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
