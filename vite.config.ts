import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest defaults `NODE_ENV` to "test" only when it is unset
// (`process.env.NODE_ENV ??= "test"` in `prepareVitest`). A shell that
// exports `NODE_ENV=production` therefore survives into the test run.
//
// That matters for *module resolution*, not just for the runtime: Vite
// computes `isProduction = process.env.NODE_ENV === "production"` in
// `resolveConfig`, and in production mode its resolver externalizes Node
// built-ins to the bare `__vite-browser-external` id instead of resolving
// them natively. Vitest then maps that id back to a builtin with
// `toBuiltin()`, which yields the empty specifier `node:` and the suite dies
// with `Cannot find package 'node:'` before a single test runs.
//
// `test.env.NODE_ENV` below cannot prevent this: it is applied to the test
// worker *after* this config file has been evaluated and the Vite server
// created, so Vite has already decided that it is running in production
// mode. The only place that decision can still be influenced is here, at
// the top of the config file, which Vite evaluates before `resolveConfig`
// reads `NODE_ENV`.
//
// `process.env.VITEST` is set by `prepareVitest` before the config file is
// loaded, so it reliably identifies a test run and leaves `vite build` and
// `vite dev` untouched.
if (process.env.VITEST === "true") {
  process.env.NODE_ENV = "test";
}

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    rollupOptions: {
      output: {
        // PERF-01 / PERF-02: the heavyweight, conditionally-needed code must
        // not be reachable from the entry chunk. Vite emits a `modulepreload`
        // link for every chunk that *is* statically reachable from the entry,
        // so the gate for both items is `dist/index.html`: neither the ticker
        // dataset nor the chart library may appear there. CI reports the
        // preloaded byte budget after the build (see .github/workflows/ci.yml);
        // the check can be run locally with:
        //   npm run build && node scripts/check-first-paint.mjs
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("three")) return "three";
            if (id.includes("framer-motion")) return "motion";
            if (id.includes("lucide-react")) return "lucide";
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true,
      },
    },
  },
  test: {
    testTimeout: 10000,
    // INFRA-09: one shared teardown hook instead of a `cleanup()` that every
    // DOM suite has to remember. The setup file is environment-agnostic, so it
    // is safe for the Node-environment suites too.
    //
    // The environment itself stays per file (`// @vitest-environment jsdom` at
    // the top of each `.tsx` suite): Vitest 4 dropped `environmentMatchGlobs`,
    // and splitting the suite into `projects` just to re-derive the same
    // jsdom/Node split would duplicate the `pool` workaround below and change
    // how the shared module graph is resolved.
    setupFiles: ["src/test-helpers/setup.ts"],
    // Vitest only defaults NODE_ENV to "test" when it is unset. A shell that
    // exports NODE_ENV=production would otherwise load React's production
    // build, which does not export `act` and breaks every React test.
    env: {
      NODE_ENV: "test",
    },
    // Include .tsx/.spec and worker tests as well: the toolchain
    // (eslint + tsconfigs) already anticipates .tsx tests, and a .ts-only
    // pattern would silently skip the first real DOM test.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "worker/**/*.{test,spec}.{ts,tsx}"],
    // Windows + vitest 4 default pools (forks/threads) load
    // "@vitest/runner" twice, so the module-scope `runner` is never set and
    // every suite dies with `Cannot read properties of undefined (reading
    // 'config')`. The vmThreads pool shares module state correctly here.
    pool: "vmThreads",
  },
});
