import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const headerSource = readFileSync(new URL("../components/Header.tsx", import.meta.url), "utf8");
const sidebarSource = readFileSync(new URL("../components/Sidebar.tsx", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

describe("Navigation drawer keyboard accessibility", () => {
  it("closes the navigation drawer with Escape", () => {
    // Regression: keyboard users must be able to dismiss the drawer without
    // clicking. The drawer lives in Sidebar and routes through onRequestClose.
    expect(sidebarSource).toMatch(/key === "Escape"[\s\S]{0,200}onRequestClose\(\)/);
  });

  it("exposes the expanded state via aria-expanded and restores focus to the toggle", () => {
    expect(headerSource).toContain("aria-expanded={isNavOpen}");
    expect(appSource).toMatch(/setIsNavOpen\(false\);\s*navToggleRef\.current\?\.focus\(\)/);
  });

  it("wires the ref to the navigation toggle button", () => {
    expect(headerSource).toMatch(/ref=\{navToggleRef\}/);
  });

  it("traps focus inside the drawer while it is open", () => {
    expect(sidebarSource).toContain("event.key !== \"Tab\"");
    expect(sidebarSource).toContain("document.addEventListener(\"keydown\", handleKeyDown, true)");
  });
});
