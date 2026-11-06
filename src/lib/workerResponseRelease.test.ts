import { describe, it, expect, vi } from "vitest";
import { releaseWorkerResponse } from "../../worker/internal";

describe("releaseWorkerResponse", () => {
  it("resolves cleanly when passed null or undefined", async () => {
    await expect(releaseWorkerResponse(null)).resolves.toBeUndefined();
    await expect(releaseWorkerResponse(undefined)).resolves.toBeUndefined();
  });

  it("cancels unconsumed response body stream", async () => {
    const cancelMock = vi.fn().mockResolvedValue(undefined);
    const mockResponse = {
      body: {
        cancel: cancelMock,
      },
      bodyUsed: false,
    } as unknown as Response;

    await releaseWorkerResponse(mockResponse);
    expect(cancelMock).toHaveBeenCalledTimes(1);
  });

  it("does not call cancel if body is null or bodyUsed is true", async () => {
    const cancelMock = vi.fn().mockResolvedValue(undefined);
    const mockUsedResponse = {
      body: {
        cancel: cancelMock,
      },
      bodyUsed: true,
    } as unknown as Response;

    await releaseWorkerResponse(mockUsedResponse);
    expect(cancelMock).not.toHaveBeenCalled();

    const mockNoBodyResponse = {
      body: null,
      bodyUsed: false,
    } as unknown as Response;

    await releaseWorkerResponse(mockNoBodyResponse);
  });

  it("gracefully catches cancellation errors without rejecting", async () => {
    const failingCancel = vi.fn().mockRejectedValue(new Error("Stream already closed"));
    const mockFailingResponse = {
      body: {
        cancel: failingCancel,
      },
      bodyUsed: false,
    } as unknown as Response;

    await expect(releaseWorkerResponse(mockFailingResponse)).resolves.toBeUndefined();
    expect(failingCancel).toHaveBeenCalledTimes(1);
  });
});
