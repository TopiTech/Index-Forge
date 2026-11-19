/**
 * Vite config environment contract (I8).
 *
 * The config function runs before Vite decides whether the build is a
 * production build, so `command === "build"` must force NODE_ENV=production
 * even when an inherited NODE_ENV=test would otherwise produce a dev-style
 * bundle. The VITEST correction for test runs must keep working alongside it.
 */
import { describe, expect, it } from "vitest";
import viteConfig from "../vite.config";

function resolveConfig(command) {
  return viteConfig({ command, mode: command === "build" ? "production" : "test", isSsrBuild: false, isPreview: false });
}

describe("vite config: NODE_ENV contract", () => {
  it("forces production for a build even when NODE_ENV=test is inherited", () => {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "test";
      const config = resolveConfig("build");
      expect(process.env.NODE_ENV).toBe("production");
      expect(config.build?.outDir).toBe("dist");
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
  });

  it("keeps the NODE_ENV=test correction for Vite test runs", () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousVitest = process.env.VITEST;
    try {
      process.env.VITEST = "true";
      process.env.NODE_ENV = "production";
      resolveConfig("serve");
      expect(process.env.NODE_ENV).toBe("test");
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previousNodeEnv;
      if (previousVitest === undefined) delete process.env.VITEST;
      else process.env.VITEST = previousVitest;
    }
  });
});
