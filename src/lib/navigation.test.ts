import { describe, it, expect } from "vitest";
import { parseViewFromLocation, getViewPath } from "./navigation";

describe("Navigation & View Routing Logic", () => {
  describe("parseViewFromLocation", () => {
    it("defaults to dashboard for root path", () => {
      expect(parseViewFromLocation("/")).toBe("dashboard");
      expect(parseViewFromLocation("")).toBe("dashboard");
    });

    it("parses admin path and search parameter", () => {
      expect(parseViewFromLocation("/admin")).toBe("admin");
      expect(parseViewFromLocation("/", "?page=admin")).toBe("admin");
      expect(parseViewFromLocation("/index.html", "?page=admin")).toBe("admin");
    });

    it("parses portfolio paths and search parameter", () => {
      expect(parseViewFromLocation("/portfolio")).toBe("portfolio");
      expect(parseViewFromLocation("/profile")).toBe("portfolio");
      expect(parseViewFromLocation("/about")).toBe("portfolio");
      expect(parseViewFromLocation("/", "?page=portfolio")).toBe("portfolio");
      expect(parseViewFromLocation("/", "?page=profile")).toBe("portfolio");
    });

    it("parses disclaimer path and search parameter", () => {
      expect(parseViewFromLocation("/disclaimer")).toBe("disclaimer");
      expect(parseViewFromLocation("/", "?page=disclaimer")).toBe("disclaimer");
    });

    it("parses builder path and search parameter", () => {
      expect(parseViewFromLocation("/builder")).toBe("builder");
      expect(parseViewFromLocation("/simulator")).toBe("builder");
      expect(parseViewFromLocation("/", "?page=builder")).toBe("builder");
      expect(parseViewFromLocation("/", "?page=simulator")).toBe("builder");
    });

    it("falls back to dashboard for unknown paths", () => {
      expect(parseViewFromLocation("/unknown-page")).toBe("dashboard");
      expect(parseViewFromLocation("/", "?page=other")).toBe("dashboard");
    });
  });

  describe("getViewPath", () => {
    it("returns correct paths for all views", () => {
      expect(getViewPath("dashboard")).toBe("/");
      expect(getViewPath("admin")).toBe("/admin");
      expect(getViewPath("portfolio")).toBe("/portfolio");
      expect(getViewPath("disclaimer")).toBe("/disclaimer");
      expect(getViewPath("builder")).toBe("/builder");
    });
  });
});

