/**
 * Regression tests for the "add stock to my index" feedback path.
 *
 * App.handleAddStockToIndex used to fire the asynchronous add and toast
 * success unconditionally, so a rate-limited or rejected write still told the
 * user the constituent had been stored. The reporting helper now waits for the
 * Worker response, and these tests pin down each outcome.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { reportAddStockResult } from "./addStockFeedback";

function createToasts() {
  return { success: vi.fn(), error: vi.fn() };
}

describe("reportAddStockResult", () => {
  it("reports success only when the Worker confirmed the write", async () => {
    const toasts = createToasts();

    reportAddStockResult(Promise.resolve({ ok: true }), "トヨタ自動車", toasts);
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));

    expect(toasts.success).toHaveBeenCalledWith("「トヨタ自動車」を指数に追加しました");
    expect(toasts.error).not.toHaveBeenCalled();
  });

  it("surfaces the Worker error message when the write failed", async () => {
    const toasts = createToasts();

    reportAddStockResult(
      Promise.resolve({ ok: false, error: "このユーザー用パスワードでは銘柄数を最大10銘柄までに制限されています" }),
      "NVDA",
      toasts,
    );
    await vi.waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));

    expect(toasts.error).toHaveBeenCalledWith(
      "このユーザー用パスワードでは銘柄数を最大10銘柄までに制限されています",
    );
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("falls back to a generic failure message when no error text is returned", async () => {
    const toasts = createToasts();

    reportAddStockResult(Promise.resolve({ ok: false }), "AAPL", toasts);
    await vi.waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));

    expect(toasts.error).toHaveBeenCalledWith("「AAPL」の指数への追加に失敗しました");
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("never reports success when the request itself rejects", async () => {
    const toasts = createToasts();

    reportAddStockResult(Promise.reject(new Error("network down")), "MSFT", toasts);
    await vi.waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));

    expect(toasts.error).toHaveBeenCalledWith("「MSFT」の指数への追加に失敗しました");
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("is awaited by App.handleAddStockToIndex instead of an unconditional success toast", () => {
    const appSource = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");

    expect(appSource).toContain("reportAddStockResult(");
    expect(appSource).toContain("{ success: toastSuccess, error: toastError }");
    // The pre-fix shape: a success toast fired next to a fire-and-forget add.
    expect(appSource).not.toContain("void addStockToIndex(selectedIndex.id");
  });
});
