// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  Tutorial3DScene,
  WebGLUnavailableError,
  createSeededRandom,
  TUTORIAL_SCENE_DEFAULT_SEED,
  isWebGLAvailable,
} from "./Tutorial3DScene";

/**
 * The tutorial scene must decide "can this canvas run the renderer?" before
 * three gets a chance to answer it.
 *
 * three's `WebGLRenderer` is WebGL2-only and logs its own `console.error`
 * before throwing when the context is missing, so a WebGL1-only environment
 * used to reach the renderer and print a scary error even though the caller's
 * 2D fallback handled the failure. The probe below is the root-level answer:
 * WebGL2 on the canvas that will actually be used.
 */
function withContext(
  canvas: HTMLCanvasElement,
  getContext: (contextId: string) => unknown,
): HTMLCanvasElement {
  Object.defineProperty(canvas, "getContext", { value: getContext, configurable: true });
  return canvas;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Tutorial3DScene WebGL availability", () => {
  it("rejects a WebGL1-only canvas instead of passing the old guard", () => {
    const canvas = withContext(document.createElement("canvas"), (contextId) =>
      contextId === "webgl2" ? null : {},
    );

    // The old probe asked for "webgl" and therefore reported this canvas as
    // usable, which is how the renderer came to throw inside three.
    expect(isWebGLAvailable(canvas)).toBe(false);
  });

  it("accepts a canvas that provides a WebGL2 context", () => {
    const canvas = withContext(document.createElement("canvas"), () => ({}));

    expect(isWebGLAvailable(canvas)).toBe(true);
  });

  it("asks for webgl2, not webgl, on the canvas it was given", () => {
    const requested: string[] = [];
    const canvas = withContext(document.createElement("canvas"), (contextId) => {
      requested.push(contextId);
      return null;
    });

    expect(isWebGLAvailable(canvas)).toBe(false);
    expect(requested).toContain("webgl2");
    expect(requested).not.toContain("webgl");
  });

  it("throws WebGLUnavailableError without letting three log an error first", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const canvas = withContext(document.createElement("canvas"), () => null);

    expect(() => new Tutorial3DScene({ canvas, width: 320, height: 260 })).toThrow(
      WebGLUnavailableError,
    );
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("createSeededRandom decorative placement (M-11)", () => {
  it("produces the same sequence for the same seed", () => {
    const a = createSeededRandom(TUTORIAL_SCENE_DEFAULT_SEED);
    const b = createSeededRandom(TUTORIAL_SCENE_DEFAULT_SEED);
    const seqA = Array.from({ length: 100 }, () => a());
    const seqB = Array.from({ length: 100 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different arrangements for different seeds", () => {
    const a = createSeededRandom(1);
    const b = createSeededRandom(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it("stays within [0, 1) so scatter scaling cannot escape its volume", () => {
    const random = createSeededRandom(TUTORIAL_SCENE_DEFAULT_SEED);
    for (let i = 0; i < 1000; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});
