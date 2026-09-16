import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const headerSource = readFileSync(new URL("../components/Header.tsx", import.meta.url), "utf8");

describe("Header mobile menu keyboard accessibility", () => {
  it("closes the mobile navigation drawer with Escape", () => {
    // Regression: the sidebar drawer and modals supported Escape, but the
    // mobile navigation drawer in the header did not, leaving keyboard users
    // unable to dismiss it without clicking.
    expect(headerSource).toMatch(/key === "Escape"[\s\S]{0,200}setIsMobileMenuOpen\(false\)/);
  });

  it("exposes the expanded state via aria-expanded and restores focus to the toggle", () => {
    expect(headerSource).toContain("aria-expanded={isMobileMenuOpen}");
    expect(headerSource).toContain("mobileMenuToggleRef.current?.focus()");
  });

  it("wires the ref to the mobile menu toggle button", () => {
    expect(headerSource).toMatch(/ref=\{mobileMenuToggleRef\}/);
  });
});
