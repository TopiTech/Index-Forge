// @vitest-environment jsdom
/**
 * UI-1 P1-03: tutorial shortcuts must leave browser/OS shortcuts untouched.
 * Behavior-only: dispatch real keyboard events and observe defaultPrevented
 * plus the tutorial's own visible state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";
import { TutorialPage } from "./TutorialPage";

const { FakeScene } = vi.hoisted(() => {
  class FakeScene {
    setStep(_step: number): void {}
    setReducedMotion(): void {}
    resize(): void {}
    rotateCamera(): void {}
    zoomCamera(): void {}
    resetCamera(): void {}
    toggleAutoRotate(): boolean {
      return false;
    }
    destroy(): void {}
  }
  return { FakeScene };
});

vi.mock("./Tutorial3DScene", () => ({
  Tutorial3DScene: FakeScene,
  isWebGLAvailable: () => true,
}));
vi.mock("../contexts/FreshnessContext", () => ({ useRegisterFreshness: vi.fn() }));

function dispatchKey(key: string, init: KeyboardEventInit = {}): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => cleanup());

describe("TutorialPage modifier keys (P1-03)", () => {
  it("does not swallow Ctrl/Cmd/Alt modified shortcuts", () => {
    render(<TutorialPage onComplete={vi.fn()} onSkip={vi.fn()} />);

    expect(dispatchKey("r", { ctrlKey: true })).toBe(false);
    expect(dispatchKey("r", { metaKey: true })).toBe(false);
    expect(dispatchKey("m", { ctrlKey: true })).toBe(false);
    expect(dispatchKey("ArrowRight", { altKey: true })).toBe(false);
    expect(dispatchKey("Escape", { metaKey: true })).toBe(false);
  });

  it("still handles the unmodified shortcuts and Shift+? help key", () => {
    const onSkip = vi.fn();
    render(<TutorialPage onComplete={vi.fn()} onSkip={onSkip} />);

    expect(dispatchKey("r")).toBe(true);
    expect(dispatchKey("Escape")).toBe(true);
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(dispatchKey("?")).toBe(true);
  });
});
