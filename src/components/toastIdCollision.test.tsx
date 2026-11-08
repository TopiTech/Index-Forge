// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

// Framer Motion's exit animation would keep a removed toast in the DOM and
// make the dismissal assertion depend on animation timing. The behavior under
// test is key identity, so the motion wrapper is reduced to its DOM surface.
vi.mock("framer-motion", async () => {
  const ReactModule = await import("react");
  type MockDivProps = {
    children?: React.ReactNode;
    className?: string;
    role?: string;
    onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
    onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
    onFocus?: React.FocusEventHandler<HTMLDivElement>;
    onBlur?: React.FocusEventHandler<HTMLDivElement>;
  };
  const MockDiv = ({
    children,
    className,
    role,
    onMouseEnter,
    onMouseLeave,
    onFocus,
    onBlur,
  }: MockDivProps) =>
    ReactModule.createElement(
      "div",
      { className, role, onMouseEnter, onMouseLeave, onFocus, onBlur },
      children,
    );
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    motion: { div: MockDiv },
  };
});

function TwoToastTrigger() {
  const { success } = useToast();
  return (
    <button
      type="button"
      onClick={() => {
        // Same millisecond, same message: with `Date.now() + Math.random()`
        // ids a collision merged these into one React key, so dismissing one
        // dismissed both.
        success("保存しました", 0);
        success("保存しました", 0);
      }}
    >
      通知
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("toast id uniqueness (R-1)", () => {
  it("renders two toasts fired in the same millisecond as independent items", () => {
    vi.useFakeTimers();
    // Freeze the wall clock: the old `Date.now()`-prefixed ids were then
    // distinguished only by a 5-char base36 random suffix.
    vi.setSystemTime(1700000000000);
    render(
      <ToastProvider>
        <TwoToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "通知" }));

    const items = document.querySelectorAll(".toast-item");
    expect(items).toHaveLength(2);

    // Dismissing one toast must leave the other one intact.
    const closeButtons = screen.getAllByRole("button", { name: "通知を閉じる" });
    expect(closeButtons).toHaveLength(2);
    fireEvent.click(closeButtons[0]);
    expect(document.querySelectorAll(".toast-item")).toHaveLength(1);
    expect(screen.queryByText("保存しました")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
  });

  it("keeps crypto-backed ids unique across rapid bursts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1700000000000);
    render(
      <ToastProvider>
        <TwoToastTrigger />
      </ToastProvider>,
    );

    for (let i = 0; i < 5; i += 1) {
      fireEvent.click(screen.getByRole("button", { name: "通知" }));
    }
    // 2 toasts per click × 5 clicks, no duration so no auto-dismiss.
    expect(document.querySelectorAll(".toast-item")).toHaveLength(10);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
  });
});
