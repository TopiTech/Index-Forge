// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import React, { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { ThemeHeatmap } from "./ThemeHeatmap";
import type { StockDetail } from "../types";

vi.mock("framer-motion", () => {
  const MockDiv = ({
    children,
    className,
    role,
    style,
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
    onFocus,
    onBlur,
    onKeyDown,
    tabIndex,
    ...rest
  }: React.HTMLAttributes<HTMLDivElement>) =>
    React.createElement(
      "div",
      {
        className,
        role,
        style,
        onMouseEnter,
        onMouseMove,
        onMouseLeave,
        onFocus,
        onBlur,
        onKeyDown,
        tabIndex,
        ...rest,
      },
      children,
    );
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    motion: { div: MockDiv },
  };
});

const MOCK_STOCK_NAN: StockDetail = {
  ticker: "ALPH",
  name: "Alpha Corp",
  theme: "AI",
  weight: Number.NaN,
  currentPrice: 1500,
  previousPrice: 1500,
  change: 0,
  changePct: Number.NaN,
  contributionPt: Number.NaN,
  contributionPct: Number.NaN,
  sparkline: [1500, 1500],
};

const MOCK_STOCK_NORMAL: StockDetail = {
  ticker: "7203",
  name: "Toyota",
  theme: "Auto",
  weight: 25.5,
  currentPrice: 2800,
  previousPrice: 2750,
  change: 50,
  changePct: 1.82,
  contributionPt: 0.45,
  contributionPct: 0.45,
  sparkline: [2750, 2800],
};

describe("ThemeHeatmap NaN Safety and Accessibility", () => {
  it("renders without NaN artefacts when stock weight and contribution points are non-finite", () => {
    const onSelectTheme = vi.fn();
    const { container } = render(
      createElement(ThemeHeatmap, {
        stockDetails: [MOCK_STOCK_NAN, MOCK_STOCK_NORMAL],
        selectedTheme: null,
        onSelectTheme,
      }),
    );

    const textContent = container.textContent || "";
    expect(textContent).not.toContain("NaN%");
    expect(textContent).not.toContain("NaN pt");
    expect(textContent).not.toContain("undefined");

    const nanTile = screen.getByRole("button", { name: /Alpha Corp/ });
    expect(nanTile.getAttribute("aria-label")).toContain("構成比: 0.0%");
  });

  it("dismisses tooltip on Escape key without losing tile focus", () => {
    const onSelectTheme = vi.fn();
    render(
      createElement(ThemeHeatmap, {
        stockDetails: [MOCK_STOCK_NORMAL],
        selectedTheme: null,
        onSelectTheme,
      }),
    );

    const tile = screen.getByRole("button", { name: /Toyota/ });

    // Focus tile to trigger tooltip
    fireEvent.focus(tile);
    expect(screen.getByText("指数寄与度")).toBeDefined();

    // Press Escape to dismiss tooltip
    fireEvent.keyDown(tile, { key: "Escape" });
    expect(screen.queryByText("指数寄与度")).toBeNull();
  });
});

