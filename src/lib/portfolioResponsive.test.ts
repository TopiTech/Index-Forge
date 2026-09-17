import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Portfolio Page Mobile Responsiveness & Visibility Enhancements", () => {
  const cssCode = readFileSync(resolve(__dirname, "../index.css"), "utf8");
  const portfolioCode = readFileSync(resolve(__dirname, "../components/PortfolioPage.tsx"), "utf8");

  describe("1. Base Grid Responsive Layouts", () => {
    it("ensures .project-features-grid does not use minmax(0, 1fr) which causes 1-char vertical collapse", () => {
      expect(cssCode).not.toMatch(/\.project-features-grid\s*\{[^}]*minmax\(0,\s*1fr\)/s);
      expect(cssCode).toMatch(/\.project-features-grid\s*\{[^}]*grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(\d+px,\s*1fr\)\)/s);
    });

    it("ensures .skills-grid and .social-cards-grid have minimum column widths", () => {
      expect(cssCode).not.toMatch(/\.skills-grid\s*\{[^}]*minmax\(0,\s*1fr\)/s);
      expect(cssCode).not.toMatch(/\.social-cards-grid\s*\{[^}]*minmax\(0,\s*1fr\)/s);
    });
  });

  describe("2. Mobile Media Query (@media max-width: 640px)", () => {
    it("collapses .project-features-grid to 1 single column on mobile viewports", () => {
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.project-features-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
    });

    it("collapses .skills-grid and .social-cards-grid to 1 column on mobile viewports", () => {
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.skills-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.social-cards-grid\s*\{[^}]*grid-template-columns:\s*1fr/s);
    });

    it("stacks .profile-header-content vertically to give ample room to profile bio", () => {
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.profile-header-content\s*\{[^}]*flex-direction:\s*column/s);
    });

    it("optimizes container and card paddings for compact mobile screens", () => {
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.portfolio-page-wrapper\s*\{[^}]*padding:\s*12px/s);
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.profile-hero-card\s*\{[^}]*padding:\s*20px\s*16px/s);
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.project-feature-card\s*\{[^}]*padding:\s*18px\s*14px/s);
    });
  });

  describe("3. Mobile CTA and Social Button Interactivity", () => {
    it("uses portfolio-cta-content and portfolio-cta-buttons classes in PortfolioPage.tsx", () => {
      expect(portfolioCode).toContain("portfolio-cta-content");
      expect(portfolioCode).toContain("portfolio-cta-buttons");
    });

    it("styles mobile CTA buttons to stretch full width for optimal thumb touch targets", () => {
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*640px\)[\s\S]*?\.portfolio-cta-buttons\s+\.btn\s*\{[^}]*width:\s*100%/s);
    });

    it("includes extra mobile optimization (@media max-width: 480px) for social cards", () => {
      expect(cssCode).toContain("@media (max-width: 480px)");
      expect(cssCode).toMatch(/@media\s*\(max-width:\s*480px\)[\s\S]*?\.social-btn-label\s*\{[^}]*width:\s*100%/s);
    });
  });
});
