// @vitest-environment jsdom
/**
 * Behavioural regressions for C10 (LoadingScreen honours reduced motion,
 * including live preference changes) and C11 (recent searches deduplicated by
 * type + id as rendered in the search list).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { LoadingScreen } from "./LoadingScreen";
import { GlobalSearchModal, RECENT_SEARCHES_STORAGE_KEY } from "./GlobalSearchModal";

interface MotionStub {
  setMatches: (matches: boolean) => void;
  listeners: Set<() => void>;
}

function stubReducedMotion(initial: boolean): MotionStub {
  const listeners = new Set<() => void>();
  const mql = {
    get matches() {
      return current;
    },
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };
  let current = initial;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => mql),
  });
  return {
    listeners,
    setMatches(matches: boolean) {
      current = matches;
      listeners.forEach((listener) => listener());
    },
  };
}

function getSpinner(): HTMLElement {
  const animatedWrapper = screen.getByRole("status").firstElementChild;
  if (!(animatedWrapper instanceof HTMLElement)) throw new Error("spinner not rendered");
  return animatedWrapper;
}

afterEach(() => {
  Reflect.deleteProperty(window, "matchMedia");
  localStorage.clear();
});

describe("C10: LoadingScreen respects prefers-reduced-motion", () => {
  it("does not animate when reduced motion is already requested", async () => {
    stubReducedMotion(true);
    render(<LoadingScreen message="読み込み中" />);
    const spinner = getSpinner();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 250));
    });
    expect(spinner.style.transform).not.toMatch(/rotate\(/);
  });

  it("stops animating when the preference changes while loading", async () => {
    const motion = stubReducedMotion(false);
    render(<LoadingScreen message="読み込み中" />);
    const spinner = getSpinner();
    await waitFor(() => expect(spinner.style.transform).toMatch(/rotate\(/));

    act(() => motion.setMatches(true));
    await waitFor(() => expect(getSpinner().style.transform).not.toMatch(/rotate\(/));
    expect(screen.getByRole("status").textContent).toContain("読み込み中");
  });
});

describe("C8: search option ids are unique per dialog instance", () => {
  it("gives two open search dialogs distinct active-option ids", () => {
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    });
    render(
      <>
        <GlobalSearchModal isOpen onClose={() => {}} onNavigate={() => {}} />
        <GlobalSearchModal isOpen onClose={() => {}} onNavigate={() => {}} />
      </>,
    );

    const comboboxes = screen.getAllByRole("combobox");
    const activeIds = comboboxes.map((input) => input.getAttribute("aria-activedescendant"));
    expect(activeIds[0]).toBeTruthy();
    expect(activeIds[0]).not.toBe(activeIds[1]);
    for (const id of activeIds) {
      expect(document.getElementById(id as string)?.getAttribute("role")).toBe("option");
    }

    const controlledIds = comboboxes.map((input) => input.getAttribute("aria-controls"));
    expect(controlledIds[0]).toBeTruthy();
    expect(controlledIds[0]).not.toBe(controlledIds[1]);
    for (const id of controlledIds) {
      expect(document.getElementById(id as string)?.getAttribute("role")).toBe("listbox");
    }
  });
});

describe("C11: recent searches are unique by type and id in the DOM", () => {
  it("renders one recent row per type+id even with tampered storage duplicates", () => {
    const entry = (id: string, title: string, type: "stock" | "index") => ({
      id,
      title,
      subtitle: `${id} · PRIME`,
      type,
      market: "PRIME",
      timestamp: 1700000000000,
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    });
    localStorage.setItem(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify([
        entry("7203", "トヨタ", "stock"),
        entry("7203", "トヨタ（重複）", "stock"),
        entry("7203", "指数7203", "index"),
        entry("9984", "ソフトバンク", "stock"),
      ]),
    );

    render(
      <GlobalSearchModal isOpen onClose={() => {}} onNavigate={() => {}} />,
    );

    const recentTags = screen.getAllByText("最近閲覧");
    expect(recentTags).toHaveLength(3);
    expect(screen.getByText("トヨタ")).toBeTruthy();
    expect(screen.getByText("指数7203")).toBeTruthy();
    expect(screen.queryByText("トヨタ（重複）")).toBeNull();
  });
});

describe("C7: search options contain no nested interactive controls", () => {
  it("moves row actions out of the listbox options", () => {
    localStorage.setItem(
      RECENT_SEARCHES_STORAGE_KEY,
      JSON.stringify([
        {
          id: "7203",
          title: "トヨタ",
          subtitle: "7203",
          type: "stock",
          market: "PRIME",
          timestamp: Date.now(),
        },
      ]),
    );
    const onAddToWatchlist = vi.fn();
    render(
      <GlobalSearchModal
        isOpen
        onClose={() => {}}
        onNavigate={() => {}}
        onAddToWatchlist={onAddToWatchlist}
      />,
    );

    const options = document.querySelectorAll('[role="option"]');
    expect(options.length).toBeGreaterThan(0);
    options.forEach((option) => expect(option.querySelector("button")).toBeNull());

    const watchButton = screen.getByRole("button", { name: /トヨタをウォッチリストに追加/ });
    fireEvent.click(watchButton);
    expect(onAddToWatchlist).toHaveBeenCalledWith("7203");
  });
});
