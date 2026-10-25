import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CustomIndex } from "../data/indices";
import { getEchoedOwnerToken, getIndicesRequestHeaders, sanitizeIndex } from "./useIndices";
import { LEGACY_REPAIRED_WEIGHT } from "../lib/apiContract";

const here = dirname(fileURLToPath(import.meta.url));
const readHookSrc = () => readFileSync(resolve(here, "useIndices.ts"), "utf8");

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getIndicesRequestHeaders", () => {
  it("does not send an ETag when the corresponding cached response body is unavailable", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue('"old-etag"'),
    });

    expect(getIndicesRequestHeaders(null)).toEqual({});
  });

  it("uses an ETag only with a locally available indices response", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue('"current-etag"'),
    });

    expect(getIndicesRequestHeaders([] as CustomIndex[])).toEqual({
      "If-None-Match": '"current-etag"',
    });
  });

  it("sends no conditional header when the ETag was lost but a body is cached (M-9)", () => {
    // An ETag without its response body makes a valid 304 leave the UI on
    // the fallback list; without an ETag the client takes the full 200.
    vi.stubGlobal("localStorage", {
      getItem: vi.fn().mockReturnValue(null),
    });

    expect(getIndicesRequestHeaders([] as CustomIndex[])).toEqual({});
  });
});

describe("getEchoedOwnerToken (server confirmation gate)", () => {
  it("returns the echoed token", () => {
    expect(getEchoedOwnerToken({ ownerToken: "echo-123" })).toBe("echo-123");
  });

  it.each([[{}], [{ ownerToken: "" }], [{ ownerToken: 42 }], [null], [undefined], [["x"]], ["tok"]])(
    "returns null when the server confirmed nothing: %s",
    (responseData) => {
      expect(getEchoedOwnerToken(responseData)).toBeNull();
    },
  );
});

describe("sanitizeIndex legacy weight repair (M-5)", () => {
  const base = { id: "idx", name: "Index", description: "", baseValue: 1000 };

  it("repairs NULL, zero and negative legacy weights to the single-sourced value", () => {
    for (const weight of [null, 0, -5]) {
      const index = sanitizeIndex({
        ...base,
        basket: [{ ticker: "7203", name: "トヨタ", theme: "自動車", weight }],
      });
      expect(index).not.toBeNull();
      expect(index?.basket[0].weight).toBe(LEGACY_REPAIRED_WEIGHT);
    }
  });

  it("keeps a positive weight, clamped to the contract maximum", () => {
    const index = sanitizeIndex({
      ...base,
      basket: [
        { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 40 },
        { ticker: "AAPL", name: "Apple", theme: "Tech", weight: 250 },
      ],
    });
    expect(index?.basket.map((item) => item.weight)).toEqual([40, 100]);
  });

  it("persists only a server echo and never slides the stored age", () => {
    // The save path must call the confirmed-token persister with the echo:
    // writing the stored fallback (or the caller token) with "now" slid the
    // client-side expiry while the Worker enforces the absolute age.
    const hookSrc = readHookSrc();
    expect(hookSrc).toContain("getEchoedOwnerToken(data)");
    expect(hookSrc).toContain("persistConfirmedOwnerToken(");
    expect(hookSrc).toContain("serverIssuedAtToMs(data?.ownerTokenIssuedAt)");
    expect(hookSrc).not.toContain("saveIndexOwnerToken(savedId, finalToken");
  });

  it("repairs a non-numeric legacy weight instead of displaying NaN", () => {
    const index = sanitizeIndex({
      ...base,
      basket: [{ ticker: "7203", name: "トヨタ", theme: "自動車", weight: "many" }],
    });
    expect(index?.basket[0].weight).toBe(LEGACY_REPAIRED_WEIGHT);
  });
});
