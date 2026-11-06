// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { render, screen } from "@testing-library/react";
import { ConstituentsTable } from "./ConstituentsTable";
import { ToastProvider } from "./Toast";
import type { BasketItem, StockDetail } from "../types";

vi.mock("framer-motion", () => {
  const MockDiv = ({
    children,
    className,
    style,
    ...rest
  }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement("div", { className, style, ...rest }, children);
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    motion: { div: MockDiv },
  };
});

const MOCK_BASKET: BasketItem[] = [
  { ticker: "NAN_CORP", name: "Corrupted Corp", weight: Number.NaN, theme: "Tech" },
  { ticker: "ZERO_CORP", name: "Zero Corp", weight: 0, theme: "Finance" },
  { ticker: "VALID_CORP", name: "Valid Corp", weight: 30, theme: "Auto" },
];

const MOCK_DETAILS: StockDetail[] = [
  {
    ticker: "NAN_CORP",
    name: "Corrupted Corp",
    theme: "Tech",
    weight: Number.NaN,
    currentPrice: 1000,
    previousPrice: 1000,
    change: 0,
    changePct: Number.NaN,
    contributionPt: Number.NaN,
    contributionPct: Number.NaN,
    sparkline: [1000, 1000],
  },
  {
    ticker: "ZERO_CORP",
    name: "Zero Corp",
    theme: "Finance",
    weight: 0,
    currentPrice: 500,
    previousPrice: 500,
    change: 0,
    changePct: 0,
    contributionPt: -0,
    contributionPct: 0,
    sparkline: [500, 500],
  },
  {
    ticker: "VALID_CORP",
    name: "Valid Corp",
    theme: "Auto",
    weight: 30,
    currentPrice: 2000,
    previousPrice: 1900,
    change: 100,
    changePct: 5.26,
    contributionPt: 1.58,
    contributionPct: 1.58,
    sparkline: [1900, 2000],
  },
];

describe("ConstituentsTable NaN and Zero Safety", () => {
  it("renders safe percentage and point formats when given non-finite inputs", () => {
    const { container } = render(
      createElement(
        ToastProvider,
        null,
        createElement(ConstituentsTable, {
          basket: MOCK_BASKET,
          stockDetails: MOCK_DETAILS,
          selectedTheme: null,
        }),
      ),
    );

    const textContent = container.textContent || "";
    expect(textContent).not.toContain("NaN%");
    expect(textContent).not.toContain("NaN pt");
    expect(textContent).not.toContain("undefined%");
    expect(textContent).not.toContain("undefined pt");

    // Valid stock has proper +1.58 pt
    expect(screen.getAllByText("+1.58 pt").length).toBeGreaterThan(0);

    // Corrupted stock has safe 0.00 pt and 0.00%
    expect(screen.getAllByText("0.00 pt").length).toBeGreaterThan(0);
    expect(screen.getAllByText("0.00%").length).toBeGreaterThan(0);
  });
});
