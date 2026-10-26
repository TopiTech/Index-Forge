// @vitest-environment jsdom
/**
 * Regression test for the unvalidated recent-search storage reader.
 *
 * Every other browser-storage reader in the codebase validates on read
 * (`sanitizePosition`, `sanitizeAuthSession`, `parseLocalSyncCache`, the
 * calendar cache filter). `getRecentSearches` used to blind-cast the parsed
 * payload, so a hand-edited entry such as `{ title: {} }` flowed into the
 * result list and crashed the modal render. Malformed entries must be
 * dropped; valid ones (including the subtitle-less shape) survive.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getRecentSearches,
  RECENT_SEARCHES_STORAGE_KEY,
  sanitizeRecentSearchItem,
  saveRecentSearch,
} from "./GlobalSearchModal";

const validItem = {
  id: "7203",
  title: "トヨタ自動車",
  subtitle: "7203 ・ PRIME",
  type: "stock" as const,
  market: "PRIME" as const,
  timestamp: 1700000000000,
};

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
});

describe("sanitizeRecentSearchItem", () => {
  it("accepts a well-formed entry unchanged", () => {
    expect(sanitizeRecentSearchItem({ ...validItem })).toEqual(validItem);
  });

  it("coerces a missing subtitle to an empty string", () => {
    const { subtitle: _dropped, ...withoutSubtitle } = validItem;
    expect(sanitizeRecentSearchItem(withoutSubtitle)).toEqual({ ...validItem, subtitle: "" });
  });

  it("drops entries with missing or mistyped required fields", () => {
    expect(sanitizeRecentSearchItem(null)).toBeNull();
    expect(sanitizeRecentSearchItem([])).toBeNull();
    expect(sanitizeRecentSearchItem("7203")).toBeNull();
    expect(sanitizeRecentSearchItem({ ...validItem, id: "" })).toBeNull();
    expect(sanitizeRecentSearchItem({ ...validItem, id: 7203 })).toBeNull();
    expect(sanitizeRecentSearchItem({ ...validItem, title: "" })).toBeNull();
    // An object title is what crashed the render (React child error).
    expect(sanitizeRecentSearchItem({ ...validItem, title: {} })).toBeNull();
    expect(sanitizeRecentSearchItem({ ...validItem, type: "etf" })).toBeNull();
    expect(sanitizeRecentSearchItem({ ...validItem, market: "" })).toBeNull();
    expect(sanitizeRecentSearchItem({ ...validItem, market: 123 })).toBeNull();
    expect(sanitizeRecentSearchItem({ ...validItem, timestamp: Number.NaN })).toBeNull();
    expect(sanitizeRecentSearchItem({ ...validItem, timestamp: "now" })).toBeNull();
  });
});

describe("getRecentSearches storage hardening", () => {
  it("returns [] for missing, corrupt or non-array payloads", () => {
    expect(getRecentSearches()).toEqual([]);
    localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, "invalid-json{{");
    expect(getRecentSearches()).toEqual([]);
    localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify({ id: "7203" }));
    expect(getRecentSearches()).toEqual([]);
    localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify("7203"));
    expect(getRecentSearches()).toEqual([]);
  });

  it("keeps valid entries and drops tampered ones", () => {
    localStorage.setItem(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify([
        validItem,
        { ...validItem, id: "9984", title: "ソフトバンクグループ" },
        { id: "bad", title: {}, type: "stock", market: "PRIME", timestamp: 1 },
        { id: "", title: "x", type: "stock", market: "PRIME", timestamp: 1 },
        null,
        42,
      ]),
    );
    const items = getRecentSearches();
    expect(items.map((item) => item.id)).toEqual(["7203", "9984"]);
  });

  it("caps the list at 8 entries", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      ...validItem,
      id: `id-${i}`,
      title: `title-${i}`,
    }));
    localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(many));
    expect(getRecentSearches()).toHaveLength(8);
  });

  it("round-trips through saveRecentSearch", () => {
    saveRecentSearch({
      id: "7203",
      title: "トヨタ自動車",
      subtitle: "7203 ・ PRIME",
      type: "stock",
      market: "PRIME",
    });
    const items = getRecentSearches();
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: "7203", title: "トヨタ自動車" });
  });
});
