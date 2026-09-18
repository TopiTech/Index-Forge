import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TUTORIAL_STEPS } from "./tutorialAccessibility";

describe("Tutorial Page Enhancements & Verification", () => {
  const tutorialPageTsx = readFileSync(
    resolve(__dirname, "../components/TutorialPage.tsx"),
    "utf8"
  );
  const canvasTsx = readFileSync(
    resolve(__dirname, "../components/Tutorial3DCanvas.tsx"),
    "utf8"
  );
  const headerTsx = readFileSync(
    resolve(__dirname, "../components/Header.tsx"),
    "utf8"
  );
  const footerTsx = readFileSync(
    resolve(__dirname, "../components/Footer.tsx"),
    "utf8"
  );
  const indexCss = readFileSync(
    resolve(__dirname, "../index.css"),
    "utf8"
  );

  describe("1. Step 1 Prev Button Suppression", () => {
    it("does not render the Prev button on step 1 (!isFirstStep condition)", () => {
      expect(tutorialPageTsx).toContain("{!isFirstStep && (");
      expect(tutorialPageTsx).toMatch(/\{!isFirstStep\s*&&\s*\(\s*<button[^>]*onClick=\{goToPrevStep\}/);
      expect(tutorialPageTsx).not.toMatch(/disabled=\{isFirstStep\}/);
    });

    it("guards keyboard ArrowLeft navigation on the first step", () => {
      expect(tutorialPageTsx).toContain('case "ArrowLeft":');
      expect(tutorialPageTsx).toMatch(/case "ArrowLeft":\s*if\s*\(!isFirstStep/);
    });
  });

  describe("2. Restrained 3D Mentions (Subtle 3D Branding)", () => {
    it("uses restrained 'IndexForge Quick Start' brand title without aggressive 3D suffix", () => {
      expect(tutorialPageTsx).toContain("IndexForge Quick Start");
      expect(tutorialPageTsx).not.toContain("IndexForge 3D Quick Start");
    });

    it("uses restrained '操作チュートリアル' in desktop and mobile header navigation", () => {
      expect(headerTsx).toContain("<span>操作チュートリアル</span>");
      expect(headerTsx).not.toContain("<span>操作チュートリアル (3D)</span>");
      expect(headerTsx).toContain('title="操作チュートリアルガイド"');
      expect(headerTsx).not.toContain('title="3D操作チュートリアルガイド"');
    });

    it("uses restrained '操作チュートリアル' in footer navigation link", () => {
      expect(footerTsx).toContain('label="操作チュートリアル"');
      expect(footerTsx).not.toContain('label="操作チュートリアル (3D)"');
    });

    it("uses concise interactive hint in Tutorial3DCanvas", () => {
      expect(canvasTsx).toContain("ドラッグまたは矢印キーで視点操作 (Ctrl+スクロールでズーム)");
      expect(canvasTsx).not.toContain("3D視点操作");
    });

    it("preserves rich 3D scene descriptions as requested by the user", () => {
      expect(TUTORIAL_STEPS[0].sceneDescription).toContain("3D空間に2つの光る球体クリスタル");
      expect(TUTORIAL_STEPS[1].sceneDescription).toContain("3Dドーナツ");
      expect(TUTORIAL_STEPS[2].sceneDescription).toContain("3Dリスクサーフェス地形メッシュ");
      expect(tutorialPageTsx).toContain("<strong>3Dシーンの解説:</strong>");
    });
  });

  describe("3. Tutorial Finish Button Contrast & Layout Stability", () => {
    it("applies high-contrast white text on the finish button", () => {
      expect(indexCss).toMatch(/\.tutorial-finish-btn\s*\{[^}]*color:\s*#ffffff\s*!important/);
    });

    it("applies right-alignment margin-left: auto so Next button stays right-aligned on step 1", () => {
      expect(indexCss).toMatch(/\.tutorial-next-btn,\s*\.tutorial-finish-btn\s*\{[^}]*margin-left:\s*auto/);
    });

    it("defines .btn-ghost to remove unintended borders on skip button", () => {
      expect(indexCss).toContain(".btn-ghost {");
      expect(indexCss).toMatch(/\.btn-ghost\s*\{[^}]*border-color:\s*transparent\s*!important/);
    });

    it("defines .btn-primary for proper visual hierarchy", () => {
      expect(indexCss).toContain(".btn-primary {");
      expect(indexCss).toMatch(/\.btn-primary:hover\s*\{[^}]*background:\s*var\(--accent-color\)/);
    });
  });
});
