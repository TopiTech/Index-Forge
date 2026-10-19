/**
 * Regression tests for the validation of persisted index lists and sessions.
 *
 * Both payloads come from browser storage, which is untrusted: a corrupt or
 * hand-edited entry used to be cast straight to the typed model, which made
 * `selectedIndex.basket` undefined and crashed the dashboard while it
 * rendered, and made the UI claim an administrator session that the Worker
 * would reject.
 */
import { describe, expect, it } from "vitest";
import { sanitizeIndex, sanitizeIndexList } from "../hooks/useIndices";
import { sanitizeAuthSession } from "./auth";

describe("sanitizeIndex", () => {
  it("keeps a well-formed index intact", () => {
    const index = sanitizeIndex({
      id: "custom-1",
      name: "テスト指数",
      description: "説明",
      baseValue: 1000,
      sortOrder: 7,
      basket: [{ ticker: "7203", name: "トヨタ", theme: "自動車", weight: 60 }],
    });

    expect(index).not.toBeNull();
    expect(index?.id).toBe("custom-1");
    expect(index?.sortOrder).toBe(7);
    expect(index?.basket).toEqual([
      { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 60 },
    ]);
  });

  it("rejects entries without a usable id", () => {
    expect(sanitizeIndex(null)).toBeNull();
    expect(sanitizeIndex("nope")).toBeNull();
    expect(sanitizeIndex([])).toBeNull();
    expect(sanitizeIndex({ id: 5 })).toBeNull();
    expect(sanitizeIndex({ id: "   " })).toBeNull();
  });

  it("always produces a basket array so consumers can read its length", () => {
    const index = sanitizeIndex({ id: "custom-1" });
    expect(index).not.toBeNull();
    expect(Array.isArray(index?.basket)).toBe(true);
    expect(index?.basket).toEqual([]);
  });

  it("repairs a malformed basket entry instead of dropping the index", () => {
    const index = sanitizeIndex({
      id: "custom-1",
      basket: [
        { ticker: "7203", name: "トヨタ", theme: "自動車", weight: 60 },
        { ticker: "7203", name: "重複", theme: "自動車", weight: 10 },
        { ticker: "", name: "空", theme: "x", weight: 10 },
        null,
      ],
    });

    expect(index?.basket).toHaveLength(1);
    expect(index?.basket[0].ticker).toBe("7203");
  });

  it("keeps a legacy zero weight and repairs a non-numeric one", () => {
    const index = sanitizeIndex({
      id: "custom-1",
      basket: [
        { ticker: "7203", weight: 0 },
        { ticker: "9984", weight: "60" },
      ],
    });

    expect(index?.basket[0].weight).toBe(0);
    expect(index?.basket[1].weight).toBe(1);
  });

  it("normalizes the ticker to upper case and clamps the weight", () => {
    const index = sanitizeIndex({
      id: "custom-1",
      basket: [{ ticker: " aapl ", weight: 500 }],
    });

    expect(index?.basket[0].ticker).toBe("AAPL");
    expect(index?.basket[0].weight).toBe(100);
  });
});

describe("sanitizeIndexList", () => {
  it("drops unusable entries and keeps the rest", () => {
    const list = sanitizeIndexList([
      { id: "a", basket: [{ ticker: "7203", weight: 10 }] },
      null,
      { name: "no id" },
      { id: "b", basket: [{ ticker: "9984", weight: 10 }] },
    ]);

    expect(list?.map((index) => index.id)).toEqual(["a", "b"]);
  });

  it("returns null when nothing usable remains", () => {
    expect(sanitizeIndexList(null)).toBeNull();
    expect(sanitizeIndexList("nope")).toBeNull();
    expect(sanitizeIndexList([])).toBeNull();
    expect(sanitizeIndexList([null, { name: "no id" }])).toBeNull();
  });
});

describe("sanitizeAuthSession", () => {
  it("keeps a well-formed session intact", () => {
    const session = sanitizeAuthSession({
      role: "admin",
      name: "管理者",
      password: "secret",
      maxStocks: null,
      maxIndices: 5,
      id: "admin-master",
    });

    expect(session).toEqual({
      role: "admin",
      name: "管理者",
      password: "secret",
      maxStocks: null,
      maxIndices: 5,
      id: "admin-master",
    });
  });

  it("rejects a payload whose role is not a known role", () => {
    // A role of "admin" without a password would otherwise render the admin
    // surface and send x-admin-key on every request.
    expect(sanitizeAuthSession({ role: "root", password: "x" })).toBeNull();
    expect(sanitizeAuthSession({ role: "admin" })).toBeNull();
    expect(sanitizeAuthSession({ password: "x" })).toBeNull();
  });

  it("rejects non-object payloads", () => {
    expect(sanitizeAuthSession(null)).toBeNull();
    expect(sanitizeAuthSession("admin")).toBeNull();
    expect(sanitizeAuthSession([])).toBeNull();
  });

  it("drops invalid quota values instead of passing them through", () => {
    const session = sanitizeAuthSession({
      role: "user",
      password: "x",
      maxStocks: "5",
      maxIndices: -1,
    });

    expect(session?.maxStocks).toBeNull();
    expect(session?.maxIndices).toBeNull();
  });
});
