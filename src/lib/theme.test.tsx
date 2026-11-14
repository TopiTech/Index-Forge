// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "./theme";

const THEME_STORAGE_KEY = "custom_stock_index_theme";
const ACCENT_STORAGE_KEY = "custom_stock_index_accent";

let latestControls: ReturnType<typeof useTheme> | null = null;

function ThemeHarness({ label }: { label: string }) {
  const controls = useTheme();
  if (label === "primary") {
    latestControls = controls;
  }
  return (
    <div data-testid={`theme-${label}`}>
      {controls.theme}:{controls.accent}
    </div>
  );
}

describe("useTheme state and cross-tab sync", () => {
  beforeEach(() => {
    localStorage.clear();
    latestControls = null;
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    latestControls = null;
    delete document.documentElement.dataset.theme;
    delete document.documentElement.dataset.accent;
  });

  it("preserves consecutive setTheme and setAccent calls within the same tick", () => {
    render(
      <>
        <ThemeHarness label="primary" />
        <ThemeHarness label="mirror" />
      </>,
    );

    act(() => {
      latestControls!.setTheme("light");
      latestControls!.setAccent("emerald");
    });

    expect(screen.getByTestId("theme-primary").textContent).toBe("light:emerald");
    expect(screen.getByTestId("theme-mirror").textContent).toBe("light:emerald");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.dataset.accent).toBe("emerald");
  });

  it("handles rapid consecutive toggleTheme calls without reading stale closure state", () => {
    render(<ThemeHarness label="primary" />);

    expect(screen.getByTestId("theme-primary").textContent).toBe("dark:cyan");

    act(() => {
      latestControls!.toggleTheme();
      latestControls!.toggleTheme();
    });

    expect(screen.getByTestId("theme-primary").textContent).toBe("dark:cyan");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("resets theme and accent when localStorage.clear() emits a null-key storage event", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    localStorage.setItem(ACCENT_STORAGE_KEY, "violet");

    render(<ThemeHarness label="primary" />);
    expect(screen.getByTestId("theme-primary").textContent).toBe("light:violet");

    localStorage.clear();
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: null }));
    });

    expect(screen.getByTestId("theme-primary").textContent).toBe("dark:cyan");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.dataset.accent).toBe("cyan");
  });
});
