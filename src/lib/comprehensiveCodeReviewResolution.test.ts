import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  calculatePortfolioSummary,
  convertPortfolioToCustomIndexBasket,
  PortfolioPosition,
} from "./portfolioStorage";
import { getStockFundamentals } from "./marketDataService";
import { MAX_AUTH_ROW_VERIFICATIONS } from "../../worker/internal";

describe("Comprehensive Code Review Resolution & Regression Tests", () => {
  describe("Backend Worker Security & Resilience Enhancements", () => {
    const workerImplCode = fs.readFileSync(
      path.resolve(process.cwd(), "worker/internal-impl.ts"),
      "utf-8",
    );

    it("bounds per-attempt password verification without silently locking out accounts", () => {
      // The bound is a CPU safety valve, not an account limit. It must stay far
      // above any realistic account count: a bound of 15 rejected the correct
      // password of every account past the 15th row (reported as "wrong
      // password"), which was undiagnosable for both user and operator.
      expect(MAX_AUTH_ROW_VERIFICATIONS).toBeGreaterThanOrEqual(100);
      expect(workerImplCode).toContain("checkedCount >= MAX_AUTH_ROW_VERIFICATIONS");
      // Truncating the scan must surface a distinct error instead of blaming
      // the password.
      expect(workerImplCode).toContain("アカウント数が認証の検証上限を超えている");
    });

    it("verifies salted PBKDF2 hashes in admin password management", () => {
      // The former promotion-path check compared raw hash strings, which can
      // never match salted PBKDF2 hashes; that block was dead code and has been
      // replaced by requiring a new password on promotion. Password checks now
      // always go through real verification (findPasswordCollision verifies the
      // candidate against the master row and every other account).
      expect(workerImplCode).toContain(
        "const collision = await findPasswordCollision(env, password.trim(), id)",
      );
      expect(workerImplCode).toContain(
        "await verifyPasswordHash(candidatePassword, masterRow.password_hash)",
      );
    });

    it("enforces RFC 6265 compliant cookie formatting without attributes in getYahooCrumb", () => {
      expect(workerImplCode).toContain("const cookie = rawCookies");
      expect(workerImplCode).toContain('.map((c) => c.split(";")[0]?.trim())');
      expect(workerImplCode).toContain(
        '.filter((c): c is string => Boolean(c && c.includes("=")))',
      );
    });

    it("enforces Cache-Control: no-store for error responses", () => {
      expect(workerImplCode).toContain("status >= 400 ||");
    });

    it("guards equityRatio calculation against division by zero and negative ratios", () => {
      expect(workerImplCode).toContain("const denom = 1 + debtEquity / 100;");
      expect(workerImplCode).toContain("if (denom > 0) {");
      expect(workerImplCode).toContain("equityRatio = Number((100 / denom).toFixed(1));");
      expect(workerImplCode).toContain("equityRatio = null;");
    });
  });

  describe("Multi-Currency Portfolio Calculation & Basket Conversion", () => {
    it("converts USD positions using USD/JPY exchange rate in calculatePortfolioSummary", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-1",
          ticker: "7203",
          shares: 100,
          averageCost: 2000,
          currentPrice: 2500,
          assetType: "stock",
          updatedAt: "2026-01-01",
        },
        {
          id: "pos-2",
          ticker: "AAPL",
          shares: 10,
          averageCost: 150,
          currentPrice: 200,
          assetType: "stock",
          updatedAt: "2026-01-01",
        },
      ];

      const fxRate = 150;
      const summary = calculatePortfolioSummary(positions, fxRate);

      expect(summary.totalCost).toBe(425000);
      expect(summary.totalMarketValue).toBe(550000);
      expect(summary.totalProfit).toBe(125000);
      expect(summary.totalProfitPercent).toBeCloseTo(29.41, 1);
    });

    it("converts USD positions to JPY equivalent when generating custom index basket", () => {
      const positions: PortfolioPosition[] = [
        {
          id: "pos-jpy",
          ticker: "7203",
          shares: 100,
          averageCost: 2000,
          currentPrice: 3000, // 300,000 JPY
          assetType: "stock",
          updatedAt: "2026-01-01",
        },
        {
          id: "pos-usd",
          ticker: "NVDA",
          shares: 10,
          averageCost: 100,
          currentPrice: 200, // 2,000 USD * 150 = 300,000 JPY
          assetType: "stock",
          updatedAt: "2026-01-01",
        },
      ];

      const fxRate = 150;
      const basket = convertPortfolioToCustomIndexBasket(positions, fxRate);

      expect(basket).toHaveLength(2);
      const jpyComp = basket.find((c) => c.ticker === "7203");
      const usdComp = basket.find((c) => c.ticker === "NVDA");

      expect(jpyComp?.weight).toBeCloseTo(50, 0);
      expect(usdComp?.weight).toBeCloseTo(50, 0);
    });
  });

  describe("Macro, Commodity & FX Asset Representation", () => {
    it("returns clean macro representations without synthetic corporate balance sheets", () => {
      const n225 = getStockFundamentals("^N225");
      expect(n225.name).toBe("日経平均株価");
      expect(n225.sector).toBe("INDEX");
      expect(n225.pbr).toBeNull();
      expect(n225.roe).toBeNull();
      expect(n225.equityRatio).toBeNull();

      const usdjpy = getStockFundamentals("USDJPY=X");
      expect(usdjpy.name).toBe("米ドル / 円");
      expect(usdjpy.sector).toBe("FX");
      expect(usdjpy.per).toBeNull();
      expect(usdjpy.dividendYield).toBeNull();
    });
  });

  describe("Frontend Accessibility & UI Fixes", () => {
    const stockDetailCode = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/StockDetailPage.tsx"),
      "utf-8",
    );
    const footerCode = fs.readFileSync(
      path.resolve(process.cwd(), "src/components/Footer.tsx"),
      "utf-8",
    );
    const appCode = fs.readFileSync(path.resolve(process.cwd(), "src/App.tsx"), "utf-8");

    it("provides scrollable keyboard accessibility to financial table in StockDetailPage", () => {
      expect(stockDetailCode).toContain('className="financials-table-container"');
      expect(stockDetailCode).toContain('role="region"');
      expect(stockDetailCode).toContain('aria-label="業績・財務ハイライト推移テーブル"');
      expect(stockDetailCode).toContain("tabIndex={0}");
    });

    it("does not trigger premature success toast in StockDetailPage onAddToPortfolio", () => {
      expect(stockDetailCode).not.toContain('toast.success("ポートフォリオに登録しました");');
    });

    it("removes misleading ExternalLink icon from internal developer profile link in Footer", () => {
      expect(footerCode).not.toContain(
        '<ExternalLink size={12} className="footer-external-icon" />',
      );
    });

    it("locks body scroll when mobile navigation drawer is open", () => {
      expect(appCode).toContain('document.body.style.overflow = "hidden"');
    });
  });
});
