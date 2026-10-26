// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { downloadBlob } from "./downloadFile";

describe("downloadFile utility", () => {
  const urlApi = URL as unknown as {
    createObjectURL: (obj: Blob) => string;
    revokeObjectURL: (url: string) => void;
  };
  const originalCreateObjectURL = urlApi.createObjectURL;
  const originalRevokeObjectURL = urlApi.revokeObjectURL;

  beforeEach(() => {
    vi.useFakeTimers();
    urlApi.createObjectURL = vi.fn(() => "blob:mock-uuid-url");
    urlApi.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    urlApi.createObjectURL = originalCreateObjectURL;
    urlApi.revokeObjectURL = originalRevokeObjectURL;
  });

  it("safely creates an anchor, clicks it, and revokes the object URL asynchronously after a delay", () => {
    const appendSpy = vi.spyOn(document.body, "appendChild");
    const removeSpy = vi.spyOn(document.body, "removeChild");
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    const testBlob = new Blob(["test content"], { type: "text/plain" });
    const filename = "test_export.csv";

    downloadBlob(testBlob, filename);

    expect(urlApi.createObjectURL).toHaveBeenCalledTimes(1);
    expect(urlApi.createObjectURL).toHaveBeenCalledWith(testBlob);

    expect(appendSpy).toHaveBeenCalledTimes(1);
    const appendedEl = appendSpy.mock.calls[0][0] as HTMLAnchorElement;
    expect(appendedEl.tagName).toBe("A");
    expect(appendedEl.href).toBe("blob:mock-uuid-url");
    expect(appendedEl.download).toBe("test_export.csv");

    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith(appendedEl);

    // Revocation should NOT happen synchronously
    expect(urlApi.revokeObjectURL).not.toHaveBeenCalled();

    // Advance timer past 1000ms
    vi.advanceTimersByTime(1000);

    expect(urlApi.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(urlApi.revokeObjectURL).toHaveBeenCalledWith("blob:mock-uuid-url");

    appendSpy.mockRestore();
    removeSpy.mockRestore();
    clickSpy.mockRestore();
  });
});
