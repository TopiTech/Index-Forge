import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  changeTone,
  formatDrawdownPercent,
  formatSignedAmount,
  formatSignedPercent,
} from "./changeTone";

describe("changeTone: a flat move is neither a gain nor a loss", () => {
  it("treats zero as neutral", () => {
    expect(changeTone(0)).toBe("neutral");
    expect(changeTone(-0)).toBe("neutral");
    expect(changeTone(0, 2)).toBe("neutral");
  });

  it("treats a value that rounds to zero at the given precision as neutral", () => {
    expect(changeTone(0.0001, 2)).toBe("neutral");
    expect(changeTone(-0.0001, 2)).toBe("neutral");
    expect(changeTone(0.04, 1)).toBe("neutral");
    expect(changeTone(0.05, 1)).toBe("positive");
  });

  it("keeps a real move on its side", () => {
    expect(changeTone(1.23, 2)).toBe("positive");
    expect(changeTone(-1.23, 2)).toBe("negative");
  });

  it("treats a non-finite value as neutral", () => {
    expect(changeTone(Number.NaN)).toBe("neutral");
    expect(changeTone(Number.POSITIVE_INFINITY)).toBe("neutral");
    expect(changeTone(undefined)).toBe("neutral");
    expect(changeTone(null)).toBe("neutral");
  });
});

describe("changeTone: the sign follows the tone", () => {
  it("prints a neutral percentage without a sign", () => {
    expect(formatSignedPercent(0)).toBe("0.00%");
    expect(formatSignedPercent(-0)).toBe("0.00%");
    expect(formatSignedPercent(-0.0001)).toBe("0.00%");
  });

  it("prints a signed percentage for a real move", () => {
    expect(formatSignedPercent(1.234)).toBe("+1.23%");
    expect(formatSignedPercent(-1.234)).toBe("-1.23%");
  });

  it("prints a neutral amount without a sign", () => {
    expect(formatSignedAmount(0, (n) => `¥${n}`)).toBe("¥0");
    expect(formatSignedAmount(1234, (n) => `¥${n}`)).toBe("+¥1234");
    // The minus sign belongs to the formatted amount, not to the prefix.
    expect(formatSignedAmount(-1234, (n) => `¥${n}`)).toBe("¥-1234");
  });

  it("prints a drawdown as a magnitude", () => {
    expect(formatDrawdownPercent(0)).toBe("0.0%");
    expect(formatDrawdownPercent(-0.01, 1)).toBe("0.0%");
    expect(formatDrawdownPercent(3.21, 1)).toBe("-3.2%");
  });
});

/**
 * The sign/colour rule used to be re-implemented in every component, so a
 * flat day was shown as a green gain in the constituents table, the stock
 * movers, the theme heatmap, the stats grid and the portfolio KPIs while the
 * market overview and the screener showed it correctly.
 *
 * The components have to keep using the shared helper instead.
 */
describe("changeTone: the components share one sign/colour rule", () => {
  const root = process.cwd();
  const read = (relativePath: string) =>
    readFileSync(resolve(root, relativePath), "utf-8");

  const components = [
    "src/components/ConstituentsTable.tsx",
    "src/components/StockAnalysisPage.tsx",
    "src/components/ThemeHeatmap.tsx",
    "src/components/StatsGrid.tsx",
    "src/components/PortfolioManagerPage.tsx",
  ];

  it.each(components)("%s uses the shared tone helper", (relativePath) => {
    expect(read(relativePath)).toContain('from "./changeTone"');
  });

  it.each(components)("%s does not re-implement the sign rule", (relativePath) => {
    const source = read(relativePath);
    // A local "is it positive" rule for a *displayed* signed value is exactly
    // the duplication that made a flat day look like a gain.
    expect(source).not.toMatch(/changePct\s*>=\s*0\s*\?\s*"positive"/);
    expect(source).not.toMatch(/changePercent\s*>=\s*0\s*\?\s*"positive"/);
    expect(source).not.toMatch(/changePct\s*>=\s*0\s*\?\s*"\+"/);
    expect(source).not.toMatch(/changePercent\s*>=\s*0\s*\?\s*"\+"/);
    expect(source).not.toMatch(/totalProfit\s*>=\s*0/);
    expect(source).not.toMatch(/dailyTotalChange\s*>=\s*0/);
  });
});
