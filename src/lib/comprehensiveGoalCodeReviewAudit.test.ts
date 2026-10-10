import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import worker from "../../worker/index";
import {
  formatTickerChange,
  formatTickerChangePercent,
  matchesIfNoneMatch,
  getClientIp,
  clearAuthCache,
  resetPasswordTableEnsured,
} from "../../worker/internal";

describe("comprehensiveGoalCodeReviewAudit", () => {
  describe("formatTickerChange & formatTickerChangePercent zero-rounding and sign accuracy", () => {
    it("formats tiny negative values rounded to 0.00 without negative sign", () => {
      expect(formatTickerChange(-0.001)).toBe("0.00");
      expect(formatTickerChange(-0.0049)).toBe("0.00");
      expect(formatTickerChangePercent(-0.001)).toBe("0.00%");
      expect(formatTickerChangePercent(-0.0049)).toBe("0.00%");
    });

    it("handles negative zero (-0) cleanly without negative sign", () => {
      expect(formatTickerChange(-0)).toBe("0.00");
      expect(formatTickerChangePercent(-0)).toBe("0.00%");
      expect(formatTickerChange(0)).toBe("0.00");
      expect(formatTickerChangePercent(0)).toBe("0.00%");
    });

    it("formats normal positive and negative numbers correctly with sign prefixes", () => {
      expect(formatTickerChange(12.3456)).toBe("+12.35");
      expect(formatTickerChange(-12.3456)).toBe("-12.35");
      expect(formatTickerChangePercent(5.5)).toBe("+5.50%");
      expect(formatTickerChangePercent(-5.5)).toBe("-5.50%");
      expect(formatTickerChange(0.01)).toBe("+0.01");
      expect(formatTickerChange(-0.01)).toBe("-0.01");
    });

    it("handles null, undefined, and NaN gracefully by falling back to 0.00 / 0.00%", () => {
      expect(formatTickerChange(null as unknown as number)).toBe("0.00");
      expect(formatTickerChange(undefined as unknown as number)).toBe("0.00");
      expect(formatTickerChange(Number.NaN)).toBe("0.00");
      expect(formatTickerChangePercent(null as unknown as number)).toBe("0.00%");
      expect(formatTickerChangePercent(undefined as unknown as number)).toBe("0.00%");
      expect(formatTickerChangePercent(Number.NaN)).toBe("0.00%");
    });
  });

  describe("matchesIfNoneMatch RFC 7232/9110 conditional request validation", () => {
    it("returns true for wildcard asterisk *", () => {
      expect(matchesIfNoneMatch("*", '"any-etag"')).toBe(true);
      expect(matchesIfNoneMatch(" * ", 'W/"any-etag"')).toBe(true);
      expect(matchesIfNoneMatch("*", "")).toBe(false);
    });

    it("handles missing or empty headers safely", () => {
      expect(matchesIfNoneMatch(null, '"test"')).toBe(false);
      expect(matchesIfNoneMatch(undefined, '"test"')).toBe(false);
      expect(matchesIfNoneMatch("", '"test"')).toBe(false);
      expect(matchesIfNoneMatch('""', '"test"')).toBe(false);
    });

    it("accurately compares strong and weak ETags equivalence (weak comparison rule)", () => {
      expect(matchesIfNoneMatch('"etag-123"', '"etag-123"')).toBe(true);
      expect(matchesIfNoneMatch('W/"etag-123"', '"etag-123"')).toBe(true);
      expect(matchesIfNoneMatch('"etag-123"', 'W/"etag-123"')).toBe(true);
      expect(matchesIfNoneMatch('W/"etag-123"', 'W/"etag-123"')).toBe(true);
      expect(matchesIfNoneMatch('etag-123', '"etag-123"')).toBe(true);
      expect(matchesIfNoneMatch('"etag-123"', 'etag-123')).toBe(true);
    });

    it("handles multiple comma-separated ETags and whitespace", () => {
      const header = ' "other-etag" , W/"etag-123" , "something-else" ';
      expect(matchesIfNoneMatch(header, '"etag-123"')).toBe(true);
      expect(matchesIfNoneMatch(header, '"not-found"')).toBe(false);
    });
  });

  describe("getClientIp fallback resolution", () => {
    it("prioritizes cf-connecting-ip", () => {
      const req = new Request("http://localhost/api/test", {
        headers: {
          "cf-connecting-ip": "1.1.1.1",
          "x-real-ip": "2.2.2.2",
          "x-forwarded-for": "3.3.3.3, 4.4.4.4",
        },
      });
      expect(getClientIp(req)).toBe("1.1.1.1");
    });

    it("falls back to x-real-ip when cf-connecting-ip is absent", () => {
      const req = new Request("http://localhost/api/test", {
        headers: {
          "x-real-ip": "2.2.2.2",
          "x-forwarded-for": "3.3.3.3, 4.4.4.4",
        },
      });
      expect(getClientIp(req)).toBe("2.2.2.2");
    });

    it("falls back to the first IP of x-forwarded-for when direct headers are absent", () => {
      const req = new Request("http://localhost/api/test", {
        headers: {
          "x-forwarded-for": "  3.3.3.3 , 4.4.4.4  ",
        },
      });
      expect(getClientIp(req)).toBe("3.3.3.3");
    });

    it("returns unknown when no client IP header is present", () => {
      const req = new Request("http://localhost/api/test");
      expect(getClientIp(req)).toBe("unknown");
    });
  });

  describe("ConfirmModal accessibility structure", () => {
    it("passes plain string title to ModalBase without nesting redundant <h2> tags", () => {
      const confirmModalSource = readFileSync(
        new URL("../components/ConfirmModal.tsx", import.meta.url),
        "utf8",
      );
      // title should be passed directly to ModalBase
      expect(confirmModalSource).toMatch(/<ModalBase[\s\S]*?title=\{title\}/);
      // should not render a nested <h2> inside ConfirmModal
      expect(confirmModalSource).not.toMatch(/<h2[^>]*>/);
    });
  });

  describe("Worker conditional ETag responses with weak ETags", () => {
    beforeEach(() => {
      clearAuthCache();
      resetPasswordTableEnsured();
    });

    it("returns 304 Not Modified when client sends weak ETag for /api/indices", async () => {
      const executeQuery = async () => ({ results: [] });
      const env = {
        DB: {
          prepare: () => ({
            bind: () => ({
              all: executeQuery,
              run: async () => ({ success: true }),
            }),
            all: executeQuery,
            run: async () => ({ success: true }),
          }),
        },
      } as unknown as Parameters<typeof worker.fetch>[1];

      // First request to get the ETag
      const res1 = await worker.fetch(
        new Request("http://localhost/api/indices"),
        env,
      );
      expect(res1.status).toBe(200);
      const etag = res1.headers.get("ETag");
      expect(etag).toBeTruthy();

      // Second request with weak ETag version W/<etag>
      const res2 = await worker.fetch(
        new Request("http://localhost/api/indices", {
          headers: {
            "If-None-Match": `W/${etag}`,
          },
        }),
        env,
      );
      expect(res2.status).toBe(304);

      // Third request with comma-separated list including the ETag
      const res3 = await worker.fetch(
        new Request("http://localhost/api/indices", {
          headers: {
            "If-None-Match": `"stale-etag", ${etag}`,
          },
        }),
        env,
      );
      expect(res3.status).toBe(304);
    });
  });
});
