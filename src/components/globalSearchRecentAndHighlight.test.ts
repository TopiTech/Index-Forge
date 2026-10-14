import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  getRecentSearches,
  saveRecentSearch,
  clearRecentSearches,
  RECENT_SEARCHES_STORAGE_KEY,
} from "./GlobalSearchModal";

function stubLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  });
  return store;
}

describe("GlobalSearchModal: Recent Searches & Storage", () => {
  beforeEach(() => {
    stubLocalStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns empty array when storage is empty", () => {
    expect(getRecentSearches()).toEqual([]);
  });

  it("saves and retrieves recent searches with timestamps", () => {
    saveRecentSearch({
      id: "7203",
      title: "トヨタ自動車",
      subtitle: "7203 · 東証プライム",
      type: "stock",
      market: "PRIME",
    });

    const recent = getRecentSearches();
    expect(recent.length).toBe(1);
    expect(recent[0].id).toBe("7203");
    expect(recent[0].title).toBe("トヨタ自動車");
    expect(typeof recent[0].timestamp).toBe("number");
  });

  it("deduplicates recent search entries and moves newest to front", () => {
    saveRecentSearch({
      id: "7203",
      title: "トヨタ自動車",
      subtitle: "7203 · 東証プライム",
      type: "stock",
      market: "PRIME",
    });
    saveRecentSearch({
      id: "6758",
      title: "ソニーグループ",
      subtitle: "6758 · 東証プライム",
      type: "stock",
      market: "PRIME",
    });
    // Re-save 7203
    saveRecentSearch({
      id: "7203",
      title: "トヨタ自動車",
      subtitle: "7203 · 東証プライム",
      type: "stock",
      market: "PRIME",
    });

    const recent = getRecentSearches();
    expect(recent.length).toBe(2);
    expect(recent[0].id).toBe("7203");
    expect(recent[1].id).toBe("6758");
  });

  it("caps recent searches to maximum 8 items", () => {
    for (let i = 1; i <= 12; i++) {
      saveRecentSearch({
        id: `TICKER${i}`,
        title: `銘柄 ${i}`,
        subtitle: `TICKER${i}`,
        type: "stock",
        market: "PRIME",
      });
    }

    const recent = getRecentSearches();
    expect(recent.length).toBe(8);
    expect(recent[0].id).toBe("TICKER12");
    expect(recent[7].id).toBe("TICKER5");
  });

  it("clears all recent searches on clearRecentSearches()", () => {
    saveRecentSearch({
      id: "7203",
      title: "トヨタ自動車",
      subtitle: "7203",
      type: "stock",
      market: "PRIME",
    });
    expect(getRecentSearches().length).toBe(1);

    clearRecentSearches();
    expect(getRecentSearches()).toEqual([]);
  });

  it("handles malformed JSON gracefully in storage", () => {
    localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, "invalid-json{{");
    expect(getRecentSearches()).toEqual([]);
  });
});
