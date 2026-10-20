// @vitest-environment jsdom
/**
 * Regression tests for the global search palette.
 *
 * UI-05 changed the overlay root: overlays are portaled into
 * `document.fullscreenElement ?? document.body` so a native-fullscreen page
 * still shows its dialogs. The portal therefore cannot be proven by grepping
 * the source any more — the interesting part is *where* the DOM node ends up,
 * so the placement assertions below run against the rendered tree.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { GlobalSearchModal } from "./GlobalSearchModal";
import { getOverlayRoot } from "./ModalBase";

// The jsdom environment externalizes the Node built-ins, so `fs`/`path` cannot
// be imported here. The TypeScript sources are read through Vite's `?raw`
// suffix; the stylesheet is read through `process.getBuiltinModule`, which
// resolves the real `node:fs` without a static import.
import searchModalSource from "./GlobalSearchModal.tsx?raw";
import appSource from "../App.tsx?raw";

const nodeFs = process.getBuiltinModule("node:fs") as {
  readFileSync: (path: string, encoding: "utf8") => string;
};
const nodePath = process.getBuiltinModule("node:path") as {
  join: (...parts: string[]) => string;
};
const cssSource = nodeFs.readFileSync(
  nodePath.join(process.cwd(), "src/index.css"),
  "utf8",
);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// jsdom does not implement scrollIntoView, but the palette scrolls the active
// result into view whenever the selection changes.
if (typeof Element.prototype.scrollIntoView !== "function") {
  Element.prototype.scrollIntoView = vi.fn();
}

function renderSearchModal() {
  return render(
    createElement(GlobalSearchModal, {
      isOpen: true,
      onClose: vi.fn(),
      onNavigate: vi.fn(),
    }),
  );
}

/**
 * Pretend the page is in native fullscreen.
 *
 * jsdom does not implement the Fullscreen API, so `document.fullscreenElement`
 * is shadowed with an own property. The property is removed again by the
 * returned restore function.
 */
function stubFullscreenElement(element: HTMLElement): () => void {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => element,
  });
  return () => {
    delete (document as unknown as { fullscreenElement?: unknown }).fullscreenElement;
  };
}

describe("GlobalSearchModal overlay and placement regression tests", () => {
  it("portals the modal outside the React tree into document.body without fullscreen", () => {
    // Without a fullscreen element the overlay root is the document body.
    expect(getOverlayRoot()).toBe(document.body);

    const { container } = renderSearchModal();

    const dialog = document.querySelector<HTMLElement>("[data-modal-dialog]");
    expect(dialog).not.toBeNull();

    // The dialog is rendered through a portal: it is a child of the overlay
    // root, not of the React container the tree was rendered into.
    expect(container.contains(dialog)).toBe(false);
    expect(dialog!.closest(".modal-overlay")).not.toBeNull();
    expect(document.body.contains(dialog)).toBe(true);
    expect(dialog!.closest("body")).toBe(document.body);
    expect(dialog!.parentElement?.parentElement).toBe(document.body);
  });

  it("re-targets the overlay to the fullscreen element when the page enters fullscreen", () => {
    const fullscreenHost = document.createElement("div");
    document.body.appendChild(fullscreenHost);
    const restore = stubFullscreenElement(fullscreenHost);

    try {
      expect(getOverlayRoot()).toBe(fullscreenHost);

      renderSearchModal();
      expect(document.body.querySelector(".modal-overlay")).not.toBeNull();

      // Entering fullscreen re-resolves the overlay root and the dialog moves
      // into the fullscreen subtree, where the browser actually paints it.
      act(() => {
        document.dispatchEvent(new Event("fullscreenchange"));
      });

      const movedDialog = fullscreenHost.querySelector("[data-modal-dialog]");
      expect(movedDialog).not.toBeNull();
      expect(movedDialog!.closest(".modal-overlay")?.parentElement).toBe(fullscreenHost);
      // The dialog is no longer a direct child of the document body.
      expect(document.body.querySelector(":scope > .modal-overlay")).toBeNull();
    } finally {
      restore();
      fullscreenHost.remove();
    }
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

  it("guards keyboard handling against IME composition and empty search results", () => {
    // Guards against premature submission during Japanese IME conversion (Enter / ArrowDown / ArrowUp)
    expect(searchModalSource).toMatch(
      /if \(!isOpen \|\| e\.isComposing \|\| e\.keyCode === 229\) return;/,
    );
    // Guards against empty search result list corrupting selectedIndex to -1
    expect(searchModalSource).toContain("if (filteredResults.length === 0) return;");
  });

  it("provides combobox and listbox ARIA attributes and scrolls active item into view", () => {
    expect(searchModalSource).toContain('role="combobox"');
    expect(searchModalSource).toContain('aria-autocomplete="list"');
    expect(searchModalSource).toContain('aria-controls="global-search-results"');
    expect(searchModalSource).toContain('role="listbox"');
    expect(searchModalSource).toContain('role="option"');
    expect(searchModalSource).toContain('aria-selected={isSelected}');
    expect(searchModalSource).toContain("scrollIntoView({ block: \"nearest\" })");
  });
});
