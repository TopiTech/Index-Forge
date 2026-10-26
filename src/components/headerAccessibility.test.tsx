// @vitest-environment jsdom
/**
 * Behavioral replacement for the source-string pins that lived in
 * `src/components/headerAccessibility.test.ts` (drawer keyboard contract).
 *
 * The old suite grepped `Header.tsx` / `Sidebar.tsx` / `App.tsx` for
 * `key === "Escape"`, `aria-expanded={isNavOpen}`, `ref={navToggleRef}` and
 * the Tab-trap listener, so it passed when the attributes were typed but
 * never mounted, and failed on refactors without regressions. These tests
 * render the real `Header` + `Sidebar` through the same wiring `App` uses
 * (open state, toggle ref, close-then-focus restore) and prove the keyboard
 * contract on the live accessibility tree instead:
 *
 * - the toggle exposes the drawer state via `aria-expanded` and controls the
 *   drawer (`aria-controls` matches the drawer id);
 * - Escape closes the drawer and focus returns to the toggle (which proves
 *   the ref is wired to the button);
 * - Tab / Shift+Tab cycle inside the open drawer instead of escaping it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useCallback, useRef, useState } from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { ToastProvider } from "./Toast";

/**
 * Mirrors `App`'s drawer wiring: `isNavOpen` state, the header toggle ref,
 * and `closeNav` (close, then restore focus to the toggle so keyboard users
 * do not lose their place).
 */
function NavHarness() {
  const [isNavOpen, setIsNavOpen] = useState(false);
  const navToggleRef = useRef<HTMLButtonElement>(null);
  const closeNav = useCallback(() => {
    setIsNavOpen(false);
    navToggleRef.current?.focus();
  }, []);

  return (
    <ToastProvider>
      <Header
        isNavOpen={isNavOpen}
        onToggleNav={() => setIsNavOpen((prev) => !prev)}
        navToggleRef={navToggleRef}
      />
      <Sidebar
        currentView="dashboard"
        navigateTo={() => {}}
        isOpen={isNavOpen}
        onRequestClose={closeNav}
      />
    </ToastProvider>
  );
}

function renderHarness() {
  return render(<NavHarness />);
}

function toggleButton(): HTMLButtonElement {
  // The header renders responsive duplicates and the drawer adds its own
  // close buttons, so scope to the toggle wired to the drawer.
  const toggle = document.querySelector<HTMLButtonElement>(
    'button[aria-controls="header-mobile-nav"]',
  );
  expect(toggle).not.toBeNull();
  return toggle!;
}

function openDrawer(): HTMLButtonElement {
  fireEvent.click(toggleButton());
  return screen.getByRole("dialog", { name: "ナビゲーションメニュー" });
}

/** jsdom reports no layout, so every element counts as focusable. */
function stubLayout(): () => void {
  const spy = vi
    .spyOn(window.HTMLElement.prototype, "getClientRects")
    .mockReturnValue([{ x: 0, y: 0 }] as unknown as DOMRectList);
  return () => spy.mockRestore();
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("navigation drawer toggle state", () => {
  it("exposes the drawer state via aria-expanded and controls the drawer", () => {
    renderHarness();

    const toggle = toggleButton();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-controls")).toBe("header-mobile-nav");
    expect(screen.queryByRole("dialog", { name: "ナビゲーションメニュー" })).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("メニューを閉じる");
    const drawer = screen.getByRole("dialog", { name: "ナビゲーションメニュー" });
    expect(drawer.getAttribute("id")).toBe(
      toggle.getAttribute("aria-controls"),
    );
  });
});

describe("navigation drawer keyboard contract", () => {
  it("closes the drawer with Escape and restores focus to the toggle", async () => {
    renderHarness();

    const toggle = toggleButton();
    fireEvent.click(toggle);
    expect(screen.getByRole("dialog", { name: "ナビゲーションメニュー" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });

    // The drawer unmounts after its exit animation; the toggle announces the
    // closed state again.
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "ナビゲーションメニュー" }),
      ).toBeNull(),
    );
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Focus is back on the toggle: the ref is wired to the button and the
    // close path restores it, so keyboard users do not lose their place.
    expect(document.activeElement).toBe(toggle);
  });

  it("cycles Tab focus inside the open drawer instead of escaping it", async () => {
    const restoreLayout = stubLayout();
    try {
      renderHarness();
      const drawer = openDrawer();
      // Let the drawer's initial focus effect settle before driving focus.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const buttons = within(drawer).getAllByRole("button");
      expect(buttons.length).toBeGreaterThan(1);
      const first = buttons[0];
      const last = buttons[buttons.length - 1];

      last.focus();
      fireEvent.keyDown(document, { key: "Tab" });
      expect(document.activeElement).toBe(first);

      fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(last);
    } finally {
      restoreLayout();
    }
  });
});
