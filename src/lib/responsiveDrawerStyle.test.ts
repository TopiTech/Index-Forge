import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Mobile Navigation Drawer & Portrait Responsive Style Hardening", () => {
  const indexCss = fs.readFileSync(
    path.resolve(__dirname, "../index.css"),
    "utf-8"
  );

  it("ensures mobile sidebar drawer has solid opaque background to prevent text pass-through", () => {
    // Must contain .global-sidebar-drawer with solid background
    expect(indexCss).toMatch(/\.global-sidebar-drawer\s*\{[^}]*background:\s*#080d19;/);
    expect(indexCss).toMatch(/\[data-theme="light"\]\s*\.global-sidebar-drawer\s*\{[^}]*background:\s*#ffffff;/);
    // Must have prominent drop-shadow for visual elevation
    expect(indexCss).toMatch(/\.global-sidebar-drawer\s*\{[^}]*box-shadow:[^}]*rgba\(0,\s*0,\s*0/);
  });

  it("ensures sidebar backdrop has backdrop-filter and darkened surface", () => {
    expect(indexCss).toMatch(/\.global-sidebar-backdrop\s*\{[^}]*backdrop-filter:\s*blur\(4px\);/);
    expect(indexCss).toMatch(/\.global-sidebar-backdrop\s*\{[^}]*background:\s*rgba\(4,\s*7,\s*14,\s*0\.82\);/);
  });

  it("includes portrait mobile rules for header brand compaction and chart height", () => {
    expect(indexCss).toContain(".header-brand .header-desc");
    expect(indexCss).toContain(".stock-hero-inner");
    expect(indexCss).toContain(".stock-metrics-grid");
    expect(indexCss).toContain(".stats-grid");
  });
});
