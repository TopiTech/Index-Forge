import { describe, it, expect } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { Skeleton, SkeletonCard, SkeletonStatGrid, SkeletonTable, SkeletonChart } from "./Skeleton";
import { EmptyState } from "./EmptyState";
import fs from "fs";
import path from "path";

describe("UI and Responsive Enhancements (Phase 4)", () => {
  describe("Skeleton Loaders", () => {
    it("renders basic Skeleton with shimmer class and aria-hidden", () => {
      const html = renderToString(React.createElement(Skeleton, { width: "120px", height: "20px" }));
      expect(html).toContain("skeleton-shimmer");
      expect(html).toContain("aria-hidden=\"true\"");
      expect(html).toContain("width:120px");
      expect(html).toContain("height:20px");
    });

    it("renders SkeletonCard with accessible status role", () => {
      const html = renderToString(React.createElement(SkeletonCard, { lines: 3 }));
      expect(html).toContain("card");
      expect(html).toContain("role=\"status\"");
      expect(html).toContain("aria-live=\"polite\"");
      expect(html).toContain("skeleton-shimmer");
    });

    it("renders SkeletonStatGrid with requested card count", () => {
      const html = renderToString(React.createElement(SkeletonStatGrid, { count: 4 }));
      expect(html).toContain("grid-responsive");
      expect(html).toContain("role=\"status\"");
      // 4 cards each with 3 skeleton elements = at least 12 skeleton-shimmers
      const matches = html.match(/skeleton-shimmer/g);
      expect(matches && matches.length >= 12).toBe(true);
    });

    it("renders SkeletonTable with specified rows and columns", () => {
      const html = renderToString(React.createElement(SkeletonTable, { rows: 4, columns: 5 }));
      expect(html).toContain("table-container");
      expect(html).toContain("<table");
      expect(html).toContain("<thead");
      expect(html).toContain("<tbody");
      // 4 rows in tbody
      const rowMatches = html.match(/<tr/g);
      // 1 thead tr + 4 tbody tr = 5 trs
      expect(rowMatches?.length).toBe(5);
    });

    it("renders SkeletonChart with bar representations", () => {
      const html = renderToString(React.createElement(SkeletonChart, { height: 250 }));
      expect(html).toContain("role=\"status\"");
      expect(html).toContain("height:250px");
      expect(html).toContain("skeleton-shimmer");
    });
  });

  describe("EmptyState Component Enhancements", () => {
    it("renders with title, description, primary and secondary actions", () => {
      const html = renderToString(
        React.createElement(EmptyState, {
          title: "データがありません",
          description: "条件を変更してお試しください",
          actionLabel: "リセット",
          onAction: () => {},
          secondaryActionLabel: "ヘルプを見る",
          onSecondaryAction: () => {},
        })
      );
      expect(html).toContain("データがありません");
      expect(html).toContain("条件を変更してお試しください");
      expect(html).toContain("リセット");
      expect(html).toContain("ヘルプを見る");
    });
  });

  describe("Sticky Table Columns for Mobile Screens", () => {
    it("ScreenerPage table header and data cell contain table-sticky-col for stock name", () => {
      const screenerPath = path.resolve(__dirname, "ScreenerPage.tsx");
      const screenerCode = fs.readFileSync(screenerPath, "utf-8");

      expect(screenerCode).toContain('renderSortableHeader("銘柄", "name", "left", "table-sticky-col")');
      expect(screenerCode).toContain('<td className="table-sticky-col">');
    });

    it("MarketOverviewPage incorporates Skeleton loading instead of raw spinner", () => {
      const marketPath = path.resolve(__dirname, "MarketOverviewPage.tsx");
      const marketCode = fs.readFileSync(marketPath, "utf-8");

      expect(marketCode).toContain("SkeletonStatGrid");
      expect(marketCode).toContain("SkeletonCard");
      expect(marketCode).toContain("SkeletonTable");
    });
  });
});
