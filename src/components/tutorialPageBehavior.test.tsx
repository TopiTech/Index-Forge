// @vitest-environment jsdom
/**
 * Behavioral replacement for the source-string pins in
 * `src/components/tutorialKeyboardGuard.test.ts` (U-8 P-3) and
 * `src/lib/tutorialPageEnhancements.test.ts` (both deleted alongside this
 * file).
 *
 * The old suites grepped `TutorialPage.tsx` / `Sidebar.tsx` / `Footer.tsx` /
 * `Tutorial3DCanvas.tsx` / `index.css` for handler spellings, class names and
 * Japanese copy, so they passed when the attributes were typed but never ran
 * and failed on refactors without regressions. These drive the real page
 * (with a fake 3D scene in place of WebGL) and assert what the user
 * experiences instead:
 *
 * - keyboard guard: single-letter shortcuts and Space/arrows never fire while
 *   an input, textarea, select or contentEditable has focus (the SELECT
 *   type-ahead regression), while focused buttons keep their native
 *   Enter/Space activation without double-advancing the tutorial;
 * - step navigation: no Prev on step 1, ArrowLeft is a no-op there, Next/Prev
 *   walk the steps, the finish button only appears on the last step;
 * - visible copy: restrained "IndexForge Quick Start" branding, the 3D scene
 *   explanation heading, the canvas hint, and the tutorial labels in the
 *   real Sidebar and Footer (with the aggressive "(3D)" variants absent);
 * - applied styles: the finish button computes white text, Next/Finish stay
 *   right-aligned, the skip button computes a transparent ghost border.
 *
 * The `TUTORIAL_STEPS` scene-description check is a pure data contract and
 * stays a data assertion (same as the batch3 tickers case).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

// The jsdom environment externalizes the Node built-ins, so `fs` cannot be
// imported statically here. The stylesheet is read through
// `process.getBuiltinModule`, which resolves the real `node:fs`.
const nodeFs = process.getBuiltinModule("node:fs") as {
  readFileSync: (path: string, encoding: "utf8") => string;
};
const nodePath = process.getBuiltinModule("node:path") as {
  join: (...parts: string[]) => string;
};
import { TutorialPage } from "./TutorialPage";
import { Sidebar } from "./Sidebar";
import { Footer } from "./Footer";
import { Tutorial3DCanvas } from "./Tutorial3DCanvas";
import { TUTORIAL_STEPS } from "../lib/tutorialAccessibility";

const { FakeScene } = vi.hoisted(() => {
  class FakeScene {
    static instances: FakeScene[] = [];
    constructor(_options: unknown) {
      FakeScene.instances.push(this);
    }
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

vi.mock("../contexts/FreshnessContext", () => ({
  useRegisterFreshness: vi.fn(),
}));

function renderPage(onComplete = vi.fn()) {
  return render(<TutorialPage onComplete={onComplete} onSkip={vi.fn()} />);
}

/** Step progress is exposed as an accessible progressbar label. */
function stepLabel(): string {
  return screen.getByRole("progressbar").getAttribute("aria-label") ?? "";
}

function liveAnnouncement(): string {
  return screen.getByRole("status").textContent ?? "";
}

/** Dispatch a cancelable keydown on `target` and report whether it was swallowed. */
function dispatchKey(target: Element, key: string): boolean {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
}

/**
 * Load the real stylesheet into the test document so `getComputedStyle`
 * resolves the authored cascade (vitest stubs CSS imports, so the page would
 * otherwise compute against the UA stylesheet only). One injection per test
 * keeps suites independent; duplicates are removed first.
 */
function injectAuthorStylesheet(): void {
  document.getElementById("test-author-css")?.remove();
  const css = nodeFs.readFileSync(nodePath.join(process.cwd(), "src/index.css"), "utf8");
  const style = document.createElement("style");
  style.id = "test-author-css";
  style.textContent = css;
  document.head.appendChild(style);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  FakeScene.instances.length = 0;
  vi.restoreAllMocks();
});

describe("tutorial keyboard guard (behavioral)", () => {
  it("ignores shortcuts while an input, textarea, select or contentEditable is focused", () => {
    renderPage();
    expect(stepLabel()).toContain("ステップ 1 /");

    const host = document.createElement("div");
    document.body.appendChild(host);
    try {
      const input = document.createElement("input");
      const textarea = document.createElement("textarea");
      const select = document.createElement("select");
      const option = document.createElement("option");
      option.textContent = "項目";
      select.appendChild(option);
      const editable = document.createElement("div");
      editable.contentEditable = "true";
      host.append(input, textarea, select, editable);

      // jsdom does not implement contentEditable focusability or
      // `isContentEditable`; define the latter so the guard's editable-family
      // branch is exercised instead of silently skipped.
      Object.defineProperty(editable, "isContentEditable", {
        value: true,
        configurable: true,
      });

      for (const target of [input, textarea, select, editable]) {
        target.focus();
        // "m" would toggle reduced motion and Space would toggle auto-rotate
        // behind the user's back; the guard must leave both alone so a
        // focused SELECT keeps its type-ahead and keystrokes.
        expect(dispatchKey(target, "m")).toBe(false);
        expect(dispatchKey(target, " ")).toBe(false);
        expect(dispatchKey(target, "ArrowRight")).toBe(false);
      }

      // Nothing advanced and motion state is untouched.
      expect(stepLabel()).toContain("ステップ 1 /");
      expect(liveAnnouncement()).not.toContain("軽減・静止モード");
    } finally {
      host.remove();
    }
  });

  it("toggles reduced motion with m when no editable control is focused", () => {
    renderPage();
    expect(liveAnnouncement()).not.toContain("軽減・静止モード");

    expect(dispatchKey(document.body, "m")).toBe(true);
    expect(liveAnnouncement()).toContain("軽減・静止モード");
  });

  it("lets a focused button keep native Enter/Space without double-advancing", () => {
    renderPage();
    const next = screen.getByRole("button", { name: "次のステップに進む" });
    next.focus();

    // The global handler carves buttons out: no preventDefault, no advance.
    // (Native activation is the browser's job; jsdom does not synthesize it.)
    expect(dispatchKey(next, "Enter")).toBe(false);
    expect(dispatchKey(next, " ")).toBe(false);
    expect(stepLabel()).toContain("ステップ 1 /");

    fireEvent.click(next);
    expect(stepLabel()).toContain("ステップ 2 /");
  });
});

describe("tutorial step navigation (behavioral)", () => {
  it("shows no Prev on step 1 and ignores ArrowLeft there", () => {
    renderPage();

    expect(screen.queryByRole("button", { name: "前のステップに戻る" })).toBeNull();
    expect(screen.getByRole("button", { name: "次のステップに進む" })).toBeTruthy();

    expect(dispatchKey(document.body, "ArrowLeft")).toBe(false);
    expect(stepLabel()).toContain("ステップ 1 /");
  });

  it("walks forward and back through the steps", () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "次のステップに進む" }));
    expect(stepLabel()).toContain("ステップ 2 /");

    fireEvent.click(screen.getByRole("button", { name: "前のステップに戻る" }));
    expect(stepLabel()).toContain("ステップ 1 /");
  });

  it("advances with ArrowRight when nothing editable is focused", () => {
    renderPage();

    expect(dispatchKey(document.body, "ArrowRight")).toBe(true);
    expect(stepLabel()).toContain("ステップ 2 /");
  });

  it("shows the finish button only on the last step and completes", () => {
    const onComplete = vi.fn();
    renderPage(onComplete);
    const total = TUTORIAL_STEPS.length;

    expect(
      screen.queryByRole("button", { name: "チュートリアルを完了してIndexForgeを開始する" }),
    ).toBeNull();

    for (let i = 1; i < total; i++) {
      fireEvent.click(screen.getByRole("button", { name: "次のステップに進む" }));
    }
    expect(stepLabel()).toContain(`ステップ ${total} /`);

    const finish = screen.getByRole("button", {
      name: "チュートリアルを完了してIndexForgeを開始する",
    });
    fireEvent.click(finish);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });
});

describe("tutorial branding and copy (behavioral)", () => {
  it("uses the restrained Quick Start brand without an aggressive 3D suffix", () => {
    renderPage();

    expect(screen.getByText("IndexForge Quick Start")).toBeTruthy();
    expect(screen.queryByText("IndexForge 3D Quick Start")).toBeNull();
  });

  it("explains the 3D scene and shows the canvas hint", () => {
    renderPage();

    expect(screen.getByText("3Dシーンの解説:")).toBeTruthy();
    expect(
      screen.getByText("ドラッグまたは矢印キーで視点操作 (Ctrl+スクロールでズーム)"),
    ).toBeTruthy();
    expect(screen.queryByText("3D視点操作")).toBeNull();
  });

  it("renders the 3D canvas instead of the 2D fallback when WebGL is available", () => {
    const { container } = render(
      <Tutorial3DCanvas currentStep={2} isReducedMotion={false} isAutoRotatePaused={false} />,
    );
    expect(container.querySelector("canvas")).not.toBeNull();
    expect(FakeScene.instances).toHaveLength(1);
  });

  it("labels the tutorial entry without a (3D) suffix in Sidebar and Footer", () => {
    const { unmount } = render(
      <Sidebar currentView="dashboard" navigateTo={() => {}} isOpen onRequestClose={() => {}} />,
    );
    // The desktop rail and the mobile drawer render the same entries.
    expect(screen.getAllByText("操作チュートリアル")).toHaveLength(2);
    expect(screen.queryByText("操作チュートリアル (3D)")).toBeNull();
    expect(screen.queryByTitle("3D操作チュートリアルガイド")).toBeNull();
    unmount();
    cleanup();

    render(<Footer onNavigate={() => {}} currentView="dashboard" />);
    expect(screen.getByText("操作チュートリアル")).toBeTruthy();
    expect(screen.queryByText("操作チュートリアル (3D)")).toBeNull();
  });

  it("keeps the rich 3D scene descriptions in the step data", () => {
    expect(TUTORIAL_STEPS[0].sceneDescription).toContain("3D空間に2つの光る球体クリスタル");
    expect(TUTORIAL_STEPS[1].sceneDescription).toContain("3Dドーナツ");
    expect(TUTORIAL_STEPS[2].sceneDescription).toContain("3Dリスクサーフェス地形メッシュ");
  });
});

describe("tutorial button styles (behavioral)", () => {
  it("renders the finish button with high-contrast white text", () => {
    injectAuthorStylesheet();
    renderPage();
    const total = TUTORIAL_STEPS.length;
    for (let i = 1; i < total; i++) {
      fireEvent.click(screen.getByRole("button", { name: "次のステップに進む" }));
    }

    const finish = screen.getByRole("button", {
      name: "チュートリアルを完了してIndexForgeを開始する",
    });
    expect(window.getComputedStyle(finish).color).toBe("rgb(255, 255, 255)");
  });

  it("keeps Next right-aligned and the skip button a transparent ghost", () => {
    injectAuthorStylesheet();
    renderPage();

    const next = screen.getByRole("button", { name: "次のステップに進む" });
    expect(window.getComputedStyle(next).marginLeft).toBe("auto");

    const skip = screen.getByRole("button", {
      name: "チュートリアルをスキップしてダッシュボードへ移動",
    });
    const skipBorder = window.getComputedStyle(skip).borderColor;
    expect(["rgba(0, 0, 0, 0)", "transparent"]).toContain(skipBorder);
  });

  it("defines the primary-button hover hierarchy in the parsed cascade", () => {
    // `:hover` cannot be observed in jsdom, so this walks the parsed CSSOM
    // of the real stylesheet instead of grepping its text: the
    // `.btn-primary:hover` rule must exist and paint the accent background.
    injectAuthorStylesheet();
    const rules: CSSRule[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        rules.push(...Array.from(sheet.cssRules));
      } catch {
        // Cross-origin sheets are unreadable; the injected one is same-origin.
      }
    }
    const hover = rules.find(
      (rule) => rule instanceof CSSStyleRule && rule.selectorText === ".btn-primary:hover",
    ) as CSSStyleRule | undefined;
    expect(hover).toBeDefined();
    expect(hover!.style.background).toContain("var(--accent-color)");
  });
});
