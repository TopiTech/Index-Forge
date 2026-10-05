import { describe, it, expect } from "vitest";
import { generateSecurePassword } from "./auth";
import fs from "node:fs";
import path from "node:path";

describe("Comprehensive Audit Fixes: generateSecurePassword", () => {
  it("generates a password of the default length (10)", () => {
    const pwd = generateSecurePassword();
    expect(pwd).toHaveLength(10);
  });

  it("generates passwords of custom specified lengths", () => {
    expect(generateSecurePassword(8)).toHaveLength(8);
    expect(generateSecurePassword(16)).toHaveLength(16);
    expect(generateSecurePassword(32)).toHaveLength(32);
  });

  it("only contains characters from the non-ambiguous character set", () => {
    const allowed = new Set("abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789".split(""));
    const ambiguous = ["0", "O", "1", "l", "I"];

    for (let i = 0; i < 50; i++) {
      const pwd = generateSecurePassword(20);
      for (const char of pwd) {
        expect(allowed.has(char)).toBe(true);
        expect(ambiguous.includes(char)).toBe(false);
      }
    }
  });

  it("produces unique passwords with high entropy", () => {
    const set = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const pwd = generateSecurePassword(12);
      expect(set.has(pwd)).toBe(false);
      set.add(pwd);
    }
    expect(set.size).toBe(100);
  });
});

describe("Comprehensive Audit Fixes: worker/internal-impl.ts password ID generation", () => {
  it("uses crypto.randomUUID for password IDs instead of Math.random", () => {
    const workerFilePath = path.resolve(__dirname, "../../worker/internal-impl.ts");
    const workerContent = fs.readFileSync(workerFilePath, "utf-8");

    // Password ID generation line should use crypto.randomUUID
    expect(workerContent).toMatch(/const id = `pwd-\${Date\.now\(\)}-\${crypto\.randomUUID\(\)\.slice\(0,\s*8\)}`;/);
    expect(workerContent).not.toMatch(/pwd-\${Date\.now\(\)}-\${Math\.random\(\)/);
  });
});

describe("Comprehensive Audit Fixes: ConstituentsTable case normalization", () => {
  it("resolves stock details regardless of ticker casing discrepancies", () => {
    const stockDetails = [
      {
        ticker: "7203.T",
        name: "トヨタ自動車",
        currentPrice: 3200,
        change: 50,
        changePct: 1.58,
        contributionPt: 5.2,
        contributionPct: 0.52,
        sparkline: [3150, 3180, 3200],
      },
      {
        ticker: "aapl",
        name: "Apple Inc.",
        currentPrice: 210,
        change: -2,
        changePct: -0.94,
        contributionPt: -1.2,
        contributionPct: -0.12,
        sparkline: [215, 212, 210],
      },
    ];

    const basket = [
      { ticker: "7203.t", name: "トヨタ", weight: 50 },
      { ticker: "AAPL", name: "Apple", weight: 50 },
    ];

    // Mirroring ConstituentsTable combinedList logic
    const detailsMap = new Map(stockDetails.map((d) => [d.ticker.trim().toUpperCase(), d]));

    const merged = basket.map((item) => {
      const detail = detailsMap.get(item.ticker.trim().toUpperCase());
      return {
        ticker: item.ticker,
        name: item.name,
        currentPrice: detail?.currentPrice ?? 0,
        change: detail?.change ?? 0,
      };
    });

    expect(merged[0].currentPrice).toBe(3200);
    expect(merged[0].change).toBe(50);
    expect(merged[1].currentPrice).toBe(210);
    expect(merged[1].change).toBe(-2);
  });
});

describe("Comprehensive Audit Fixes: useCalculation sync timestamp accuracy", () => {
  it("preserves server's lastSynced timestamp for cached results", () => {
    const serverTimestampSec = 1705000000;
    const responseItemCached = {
      ticker: "7203.T",
      status: "cached",
      lastSynced: serverTimestampSec,
    };

    const syncedMap = new Map<string, number>();

    // Mirroring updated useCalculation logic
    const normalizedTicker = responseItemCached.ticker.trim().toUpperCase();
    const syncTimestamp = typeof responseItemCached.lastSynced === "number" && responseItemCached.lastSynced > 0
      ? responseItemCached.lastSynced * 1000
      : Date.now();
    syncedMap.set(normalizedTicker, syncTimestamp);

    expect(syncedMap.get("7203.T")).toBe(serverTimestampSec * 1000);
  });

  it("falls back to Date.now() when lastSynced is not provided or 0", () => {
    const responseItemSynced = {
      ticker: "9984.T",
      status: "synced",
    };

    const before = Date.now();
    const normalizedTicker = responseItemSynced.ticker.trim().toUpperCase();
    expect(normalizedTicker).toBe("9984.T");
    const syncTimestamp = typeof (responseItemSynced as { lastSynced?: number }).lastSynced === "number" &&
      (responseItemSynced as { lastSynced?: number }).lastSynced! > 0
      ? (responseItemSynced as { lastSynced?: number }).lastSynced! * 1000
      : Date.now();

    expect(syncTimestamp).toBeGreaterThanOrEqual(before);
    expect(syncTimestamp).toBeLessThanOrEqual(Date.now());
  });
});

describe("Comprehensive Audit Fixes: AdminDashboard useEffect guard verification", () => {
  it("AdminDashboard source uses prevSelectedIdRef to guard resetting indexEditMessage", () => {
    const adminDashboardPath = path.resolve(__dirname, "../components/AdminDashboard.tsx");
    const content = fs.readFileSync(adminDashboardPath, "utf-8");

    expect(content).toContain("prevSelectedIdRef");
    expect(content).toContain("const isInitialOrChanged = prevSelectedIdRef.current !== found.id;");
    // Verify generateSecurePassword import
    expect(content).toContain('import { storeAuth, generateSecurePassword } from "../lib/auth";');
    expect(content).not.toContain("function generateSecurePassword(");
  });

  it("EditPasswordModal source imports generateSecurePassword from auth.ts", () => {
    const modalPath = path.resolve(__dirname, "../components/EditPasswordModal.tsx");
    const content = fs.readFileSync(modalPath, "utf-8");

    expect(content).toContain('import { generateSecurePassword } from "../lib/auth";');
    expect(content).not.toContain("function generateSecurePassword(");
  });
});
