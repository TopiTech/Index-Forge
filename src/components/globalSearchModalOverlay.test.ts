import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const searchModalSource = readFileSync(
  new URL("./GlobalSearchModal.tsx", import.meta.url),
  "utf8"
);
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("GlobalSearchModal overlay and placement regression tests", () => {
  it("renders GlobalSearchModal via createPortal into document.body", () => {
    expect(searchModalSource).toContain('import { createPortal } from "react-dom";');
    expect(searchModalSource).toContain("createPortal(modalContent, document.body)");
  });

  it("uses modal-overlay for fixed viewport positioning and modal-dialog for consistent styling", () => {
    expect(searchModalSource).toContain('className="modal-overlay"');
    expect(searchModalSource).toContain('className="modal-dialog global-search-modal"');
    // Accidental clicks when dragging text should be guarded
    expect(searchModalSource).toContain("isBackdropMouseDownRef");
  });

  it("defines modal-overlay and modal-backdrop as fixed overlays with z-index in CSS", () => {
    expect(cssSource).toMatch(/\.modal-overlay,\s*\.modal-backdrop\s*\{[\s\S]*?position:\s*fixed;/);
    expect(cssSource).toMatch(/\.modal-overlay,\s*\.modal-backdrop\s*\{[\s\S]*?inset:\s*0;/);
    expect(cssSource).toContain(".global-search-modal");
    expect(cssSource).toContain(".global-search-header");
    expect(cssSource).toContain(".global-search-input");
  });

  it("keeps searchModal and overlays outside the app-shell grid in PageLayout", () => {
    // app-shell is a 2-column grid. searchModal should be a sibling to app-shell, not an in-flow grid child
    const pageLayoutMatch = appSource.match(/function PageLayout[\s\S]*?return \([\s\S]*?\n\}/);
    expect(pageLayoutMatch).not.toBeNull();
    const pageLayoutJsx = pageLayoutMatch![0];
    expect(pageLayoutJsx).toMatch(/<\/div>\s*\{overlays\}\s*\{searchModal\}/);
  });
});
