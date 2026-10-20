/**
 * Global Vitest setup (wired through `test.setupFiles` in `vite.config.ts`).
 *
 * INFRA-09: React Testing Library's automatic cleanup is registered through the
 * *global* `afterEach`, and this project keeps `globals: false` (every suite
 * imports its hooks from "vitest"). Because that hook never existed, each DOM
 * test file had to remember `cleanup()` itself and a forgotten call leaked
 * mounted trees, portals (modals/toasts render into `document.body`) and event
 * listeners into the next test.
 *
 * The environment choice stays per file: only `.tsx` suites opt into jsdom via a
 * `// @vitest-environment jsdom` docblock, and that remains the source of truth
 * (forcing jsdom globally would slow down the mostly Node suite and would give
 * the Worker tests a DOM they must not depend on). This module therefore runs in
 * the plain Node environment as well and probes for `document` before touching
 * anything DOM-related.
 */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom does not implement ResizeObserver, which the chart library uses to
// size its responsive container. A component that renders a chart therefore
// throws `ResizeObserver is not defined` inside the React commit phase. The
// stub observes nothing; it only has to exist so the render can finish.
if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

afterEach(() => {
  // Node environment (worker, schema, source-contract tests): nothing to clean.
  if (typeof document === "undefined") return;

  // Unmounts every container rendered through RTL in this file.
  cleanup();

  // `cleanup()` only knows about RTL containers. Markup that a component
  // appended straight to `document.body` (portals) or that a test created by
  // hand would otherwise survive into the next test and change its queries.
  if (document.body.childNodes.length > 0) {
    document.body.innerHTML = "";
  }
});
