import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildDeleteIndexRequest,
  buildDeleteStockRequest,
  buildSaveIndexRequest,
  resolvePersistedOwnerToken,
} from "../hooks/useIndices";
import { SYSTEM_INDICES as SRC_SYSTEM_INDICES } from "../data/indices";
import { SYSTEM_INDICES as WORKER_SYSTEM_INDICES } from "../../worker/index";

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(here, rel), "utf8");

describe("current review round: ownership token handling (behavioral)", () => {
  it("resolvePersistedOwnerToken keeps only server-confirmed or stored tokens", () => {
    // Server echo (new index creation): persisted.
    expect(resolvePersistedOwnerToken({ ownerToken: "new-token" }, null)).toBe("new-token");
    // Admin editing another user's index: no echo -> caller token cannot be
    // persisted (signature has no caller-token slot), stored value survives.
    expect(resolvePersistedOwnerToken({}, "stored-token")).toBe("stored-token");
    expect(resolvePersistedOwnerToken({ ownerToken: "" }, "stored-token")).toBe(
      "stored-token",
    );
    expect(resolvePersistedOwnerToken({}, null)).toBeNull();
    // Malformed payloads never become tokens.
    expect(resolvePersistedOwnerToken(null, null)).toBeNull();
    expect(resolvePersistedOwnerToken([], "stored-token")).toBe("stored-token");
  });

  it("routes save/delete requests through the header-only builders", () => {
    const hookSrc = readSrc("../hooks/useIndices.ts");
    expect(hookSrc).toContain("buildSaveIndexRequest(newIndex, token");
    expect(hookSrc).toContain("resolvePersistedOwnerToken(data, storedToken)");
    expect(hookSrc).toContain("buildDeleteIndexRequest(");
    expect(hookSrc).toContain("buildDeleteStockRequest(");
    expect(hookSrc).not.toContain('queryParams.set("ownerToken"');
    expect(hookSrc).not.toContain('params.set("ownerToken"');
  });

  it("buildDeleteIndexRequest keeps the token out of the URL", () => {
    const { url, headers } = buildDeleteIndexRequest("test-index-1", "tok_abc123", {});
    expect(url).toContain("id=test-index-1");
    expect(url).not.toContain("ownerToken");
    expect(url).not.toContain("tok_abc123");
    expect(headers["x-owner-token"]).toBe("tok_abc123");
  });

  it("buildDeleteStockRequest keeps the token out of the URL", () => {
    const { url, headers } = buildDeleteStockRequest("test-index-1", "7203", "tok_abc123", {});
    expect(url).toContain("indexId=test-index-1");
    expect(url).toContain("ticker=7203");
    expect(url).not.toContain("ownerToken");
    expect(url).not.toContain("tok_abc123");
    expect(headers["x-owner-token"]).toBe("tok_abc123");
  });

  it("buildSaveIndexRequest sends the token in header and body, never in URL", () => {
    const index = {
      id: "idx-1",
      name: "Test",
      description: "",
      baseValue: 1000,
      basket: [],
    };
    const { headers, body } = buildSaveIndexRequest(index, "tok_abc123", {});
    expect(headers["x-owner-token"]).toBe("tok_abc123");
    expect(JSON.parse(body).ownerToken).toBe("tok_abc123");
  });
});

describe("current review round: TradingView widget script injection", () => {
  it("sets widget config via textContent instead of innerHTML", () => {
    const modal = readSrc("../components/TradingViewChartModal.tsx");
    expect(modal).toContain("script.textContent = JSON.stringify({");
    expect(modal).not.toContain("script.innerHTML = JSON.stringify({");
  });
});

describe("current review round: SYSTEM_INDICES single source of truth", () => {
  it("worker re-exports the shared set instead of a duplicate literal", () => {
    const workerSrc = readSrc("../../worker/index.ts");
    expect(workerSrc).toContain('from "../src/data/indices"');
    expect(workerSrc).toContain("export const SYSTEM_INDICES = SHARED_SYSTEM_INDICES;");
  });

  it("worker and frontend sets stay identical at runtime", () => {
    expect([...WORKER_SYSTEM_INDICES].sort()).toEqual([...SRC_SYSTEM_INDICES].sort());
  });
});
