// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { acquireBodyScrollLock } from "./useModalFocus";

afterEach(() => {
  // Every test below balances its acquisitions; the style must stay locked
  // only while a test is still holding it.
  document.body.style.overflow = "";
});

describe("acquireBodyScrollLock (M-10)", () => {
  it("locks on acquire and restores the previous value on release", () => {
    document.body.style.overflow = "auto";
    const release = acquireBodyScrollLock();
    expect(document.body.style.overflow).toBe("hidden");
    release();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("stays locked until the last of several owners releases", () => {
    const releaseFirst = acquireBodyScrollLock();
    const releaseSecond = acquireBodyScrollLock();
    releaseFirst();
    expect(document.body.style.overflow).toBe("hidden");
    releaseSecond();
    expect(document.body.style.overflow).toBe("");
  });

  it("survives a non-nested close order (drawer closes while a modal stays open)", () => {
    // The regression: two independent save/restore owners. A drawer that
    // closed first restored \"\" while the modal was still open (scrolling
    // behind the modal), and the modal close then restored \"hidden\" (page
    // frozen). With one ref-counted owner any order is correct.
    const releaseModal = acquireBodyScrollLock();
    const releaseDrawer = acquireBodyScrollLock();
    releaseDrawer();
    expect(document.body.style.overflow).toBe("hidden");
    releaseModal();
    expect(document.body.style.overflow).toBe("");
  });

  it("tolerates a double release without unlocking someone else's lock", () => {
    const releaseOuter = acquireBodyScrollLock();
    const releaseInner = acquireBodyScrollLock();
    releaseInner();
    releaseInner();
    // Only one release counted: the outer lock is still held.
    expect(document.body.style.overflow).toBe("hidden");
    releaseOuter();
    expect(document.body.style.overflow).toBe("");
  });
});
