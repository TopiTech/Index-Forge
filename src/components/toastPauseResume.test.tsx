// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToastProvider, useToast } from "./Toast";

// Framer Motion's exit animation would keep the removed toast in the DOM and
// make a timer assertion depend on animation timing. The behavior under test
// is the timer state machine, so the motion wrapper is reduced to its DOM
// surface (className/role/pointer handlers).
vi.mock("framer-motion", async () => {
  const ReactModule = await import("react");
  type MockDivProps = {
    children?: React.ReactNode;
    className?: string;
    role?: string;
    onMouseEnter?: React.MouseEventHandler<HTMLDivElement>;
    onMouseLeave?: React.MouseEventHandler<HTMLDivElement>;
  };
  const MockDiv = ({ children, className, role, onMouseEnter, onMouseLeave }: MockDivProps) =>
    ReactModule.createElement(
      "div",
      { className, role, onMouseEnter, onMouseLeave },
      children,
    );
  return {
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      ReactModule.createElement(ReactModule.Fragment, null, children),
    motion: { div: MockDiv },
  };
});

function ToastTrigger() {
  const { success } = useToast();
  return (
    <button type="button" onClick={() => success("保存しました", 1000)}>
      通知
    </button>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("toast pause/resume timer", () => {
  it("dismisses a toast that is paused after its deadline has already elapsed", () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <ToastTrigger />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "通知" }));

    const message = screen.getByText("保存しました");
    const toast = message.closest(".toast-item");
    expect(toast).not.toBeNull();

    // Move the wall clock past the auto-dismiss deadline without running the
    // pending timer callback. Hovering now pauses the timer with zero time
    // remaining; leaving must dismiss the toast instead of stranding it.
    act(() => {
      vi.advanceTimersByTime(900);
      vi.setSystemTime(Date.now() + 200);
    });
    fireEvent.mouseEnter(toast as HTMLElement);

    // Paused toast must survive the original deadline. If the hover did not
    // pause the timer, it would have been removed here.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByText("保存しました")).not.toBeNull();

    fireEvent.mouseLeave(toast as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.queryByText("保存しました")).toBeNull();
  });
});
