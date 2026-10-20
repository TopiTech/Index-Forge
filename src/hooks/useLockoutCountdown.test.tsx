// @vitest-environment jsdom
/**
 * Behavioral contract for the shared lockout countdown.
 *
 * The previous implementation lived in three components and used the value it
 * decremented as its own dependency. These tests pin the properties that
 * depended on: one interval per lockout, no drift when ticks are delayed, a
 * single expiry callback, and a garbage `remainingSeconds` that must not keep
 * the user locked forever.
 */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLockoutCountdown } from "./useLockoutCountdown";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function Harness({ seconds, onExpire }: { seconds: number; onExpire?: () => void }) {
  const { isLocked, remainingSeconds, syncLockout, clearLockout } = useLockoutCountdown({ onExpire });
  return (
    <div>
      <span data-testid="locked">{String(isLocked)}</span>
      <span data-testid="remaining">{remainingSeconds}</span>
      <button type="button" onClick={() => syncLockout(true, seconds)}>
        lock
      </button>
      <button type="button" onClick={clearLockout}>
        clear
      </button>
    </div>
  );
}

describe("useLockoutCountdown", () => {
  it("creates one interval per lockout and counts down without recreating it", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    const { getByText, getByTestId } = render(<Harness seconds={3} />);

    fireEvent.click(getByText("lock"));
    expect(getByTestId("locked").textContent).toBe("true");
    expect(getByTestId("remaining").textContent).toBe("3");
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getByTestId("remaining").textContent).toBe("2");
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(getByTestId("remaining").textContent).toBe("1");
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("unlocks once and reports expiry exactly once", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const { getByText, getByTestId } = render(<Harness seconds={2} onExpire={onExpire} />);

    fireEvent.click(getByText("lock"));
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(getByTestId("remaining").textContent).toBe("0");
    expect(getByTestId("locked").textContent).toBe("false");
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stops the countdown when the lock is cleared early", () => {
    vi.useFakeTimers();
    const onExpire = vi.fn();
    const { getByText, getByTestId } = render(<Harness seconds={5} onExpire={onExpire} />);

    fireEvent.click(getByText("lock"));
    fireEvent.click(getByText("clear"));

    expect(getByTestId("locked").textContent).toBe("false");
    expect(getByTestId("remaining").textContent).toBe("0");
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(onExpire).not.toHaveBeenCalled();
  });

  it("does not stay locked on a non-finite server duration", () => {
    const { getByText, getByTestId } = render(<Harness seconds={Number.NaN} />);

    fireEvent.click(getByText("lock"));

    expect(getByTestId("locked").textContent).toBe("false");
    expect(getByTestId("remaining").textContent).toBe("0");
  });
});
