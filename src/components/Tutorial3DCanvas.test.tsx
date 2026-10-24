// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

/**
 * The tutorial canvas is the fallback boundary for the 3D scene.
 *
 * Its behaviour is what the reader sees when the GPU path is unavailable or
 * disappears mid-session, so these tests drive the component instead of
 * grepping its source: no WebGL2 → 2D fallback; context lost → the scene is
 * torn down, the event is cancelled and the reconnecting overlay is shown;
 * unmount → the listeners and the scene are released.
 */
const { FakeScene, sceneState } = vi.hoisted(() => {
  interface SceneOptions {
    initialStep?: number;
    isReducedMotion?: boolean;
  }
  class FakeScene {
    static instances: FakeScene[] = [];
    isAutoRotatePaused = false;
    destroyed = false;
    steps: number[] = [];
    constructor(public options: SceneOptions) {
      FakeScene.instances.push(this);
    }
    setStep(step: number) {
      this.steps.push(step);
    }
    setReducedMotion() {}
    resize() {}
    rotateCamera() {}
    zoomCamera() {}
    resetCamera() {}
    toggleAutoRotate() {
      return false;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return { FakeScene, sceneState: { webglAvailable: true } };
});

vi.mock("./Tutorial3DScene", () => ({
  Tutorial3DScene: FakeScene,
  isWebGLAvailable: () => sceneState.webglAvailable,
}));

import { Tutorial3DCanvas } from "./Tutorial3DCanvas";

afterEach(() => {
  FakeScene.instances.length = 0;
  sceneState.webglAvailable = true;
});

function renderCanvas() {
  return render(
    <Tutorial3DCanvas currentStep={2} isReducedMotion={false} isAutoRotatePaused={false} />,
  );
}

function getCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = container.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("canvas was not rendered");
  return canvas;
}

describe("Tutorial3DCanvas", () => {
  it("builds the scene on a WebGL2-capable canvas and syncs the step", () => {
    const { container } = renderCanvas();

    expect(container.querySelector("canvas")).not.toBeNull();
    expect(FakeScene.instances).toHaveLength(1);
    expect(FakeScene.instances[0].steps).toEqual([2]);
    expect(screen.queryByText("2D FALLBACK MODE")).toBeNull();
  });

  it("shows the 2D fallback instead of a canvas when WebGL2 is unavailable", () => {
    sceneState.webglAvailable = false;

    const { container } = renderCanvas();

    expect(container.querySelector("canvas")).toBeNull();
    expect(FakeScene.instances).toHaveLength(0);
    expect(screen.getByText("2D FALLBACK MODE")).toBeTruthy();
    expect(screen.getByRole("img", { name: "グラフィックス代替プレビュー" })).toBeTruthy();
  });

  it("tears the scene down and shows the reconnecting overlay on context loss", () => {
    const { container } = renderCanvas();
    const canvas = getCanvas(container);

    const lost = new Event("webglcontextlost", { cancelable: true });
    act(() => {
      canvas.dispatchEvent(lost);
    });

    expect(lost.defaultPrevented).toBe(true);
    expect(FakeScene.instances[0].destroyed).toBe(true);
    expect(screen.getByText("GPU RECONNECTING")).toBeTruthy();
    expect(screen.getByRole("img", { name: "グラフィックス一時停止" })).toBeTruthy();
    // The canvas is hidden, not removed: the same surface is reused on restore.
    expect(window.getComputedStyle(canvas).display).toBe("none");
  });

  it("rebuilds the scene on the same canvas once the context is restored", () => {
    const { container } = renderCanvas();
    const canvas = getCanvas(container);
    act(() => {
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
    });
    expect(FakeScene.instances).toHaveLength(1);

    act(() => {
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });

    // A second scene is built on the surface that stayed in the DOM, and the
    // overlay is withdrawn once it is live again.
    expect(FakeScene.instances).toHaveLength(2);
    expect(screen.queryByText("GPU RECONNECTING")).toBeNull();
    expect(window.getComputedStyle(canvas).display).not.toBe("none");
  });

  it("restores at the step and motion state the user had reached", () => {
    const { container, rerender } = renderCanvas();
    const canvas = getCanvas(container);
    rerender(
      <Tutorial3DCanvas currentStep={4} isReducedMotion isAutoRotatePaused onToggleAutoRotate={vi.fn()} />
    );

    act(() => {
      canvas.dispatchEvent(new Event("webglcontextlost", { cancelable: true }));
      canvas.dispatchEvent(new Event("webglcontextrestored"));
    });

    const restored = FakeScene.instances[1];
    expect(restored.options.initialStep).toBe(4);
    expect(restored.options.isReducedMotion).toBe(true);
    expect(restored.isAutoRotatePaused).toBe(true);
  });

  it("releases the scene and its listeners on unmount", () => {
    const { container, unmount } = renderCanvas();
    const canvas = getCanvas(container);
    const scene = FakeScene.instances[0];

    unmount();

    expect(scene.destroyed).toBe(true);
    // The listeners are gone: a late event must not reach the destroyed scene.
    const lost = new Event("webglcontextlost", { cancelable: true });
    canvas.dispatchEvent(lost);
    expect(lost.defaultPrevented).toBe(false);
    // A late restore must not build a scene for a component that is gone.
    canvas.dispatchEvent(new Event("webglcontextrestored"));
    expect(FakeScene.instances).toHaveLength(1);
  });
});
