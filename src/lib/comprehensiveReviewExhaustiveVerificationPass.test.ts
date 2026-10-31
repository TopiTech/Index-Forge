import { describe, it, expect, vi, afterEach } from "vitest";
import {
  sanitizeCalendarEvent,
  isValidCalendarEvent,
} from "./marketDataService";
import { verifyPassword, adminLogin } from "./auth";
import { getEventDayOfWeek } from "../components/CalendarPage";

describe("Comprehensive Review Exhaustive Verification Pass", () => {
  describe("Unit 2: CalendarEvent non-mutating sanitization & validation", () => {
    it("safely sanitizes Object.freeze-d (immutable) event objects without throwing", () => {
      const frozenEvent = Object.freeze({
        id: "evt-frozen-1",
        date: "2026-10-31",
        title: "凍結テストイベント",
        type: "INVALID_TYPE", // should default to EARNINGS
        importance: "INVALID_IMPORTANCE", // should default to MEDIUM
        fieldProvenance: Object.freeze({
          previous: "estimated",
          bogusKey: "malicious",
          forecast: "official",
        }),
      });

      // Must not throw TypeError: Cannot assign to read only property
      expect(() => sanitizeCalendarEvent(frozenEvent)).not.toThrow();
      expect(() => isValidCalendarEvent(frozenEvent)).not.toThrow();

      const sanitized = sanitizeCalendarEvent(frozenEvent);
      expect(sanitized).not.toBeNull();
      expect(sanitized?.type).toBe("EARNINGS");
      expect(sanitized?.importance).toBe("MEDIUM");
      expect(sanitized?.fieldProvenance).toEqual({
        previous: "estimated",
      });

      // Verify the original frozen object was not mutated
      expect((frozenEvent as { type: string }).type).toBe("INVALID_TYPE");
      expect((frozenEvent as { importance: string }).importance).toBe("INVALID_IMPORTANCE");
    });

    it("ensures isValidCalendarEvent is a pure type guard with zero side effects", () => {
      const raw = {
        id: "evt-pure-1",
        date: "2026-11-01",
        title: "純粋性テストイベント",
        type: "MACRO",
        importance: "HIGH",
      };
      const rawSnapshot = JSON.stringify(raw);
      const isValid = isValidCalendarEvent(raw);
      expect(isValid).toBe(true);
      expect(JSON.stringify(raw)).toBe(rawSnapshot);
    });
  });

  describe("Unit 3: Auth AbortSignal cancellation handling", () => {
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.clearAllMocks();
    });

    it("returns '認証がキャンセルされました' when verifyPassword is aborted during network call", async () => {
      const controller = new AbortController();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          controller.abort();
          const error = new DOMException("The user aborted a request.", "AbortError");
          throw error;
        }),
      );

      const result = await verifyPassword("test-password", controller.signal);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("認証がキャンセルされました");
    });

    it("returns '認証がキャンセルされました' when adminLogin is aborted during network call", async () => {
      const controller = new AbortController();
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          controller.abort();
          const error = new DOMException("The operation was aborted.", "AbortError");
          throw error;
        }),
      );

      const result = await adminLogin("admin-pass", "secret", "cf-token", controller.signal);
      expect(result.ok).toBe(false);
      expect(result.error).toBe("認証がキャンセルされました");
    });
  });

  describe("Unit 5: CalendarPage getEventDayOfWeek deterministic UTC calculation", () => {
    it("deterministically calculates the correct day of the week for full dates", () => {
      // 2026-10-31 is Saturday -> "土"
      expect(getEventDayOfWeek("2026-10-31")).toBe("土");
      // 2026-11-01 is Sunday -> "日"
      expect(getEventDayOfWeek("2026-11-01")).toBe("日");
      // 2026-11-02 is Monday -> "月"
      expect(getEventDayOfWeek("2026-11-02")).toBe("月");
      // 2026-11-03 is Tuesday -> "火"
      expect(getEventDayOfWeek("2026-11-03")).toBe("火");
      // 2026-11-04 is Wednesday -> "水"
      expect(getEventDayOfWeek("2026-11-04")).toBe("水");
      // 2026-11-05 is Thursday -> "木"
      expect(getEventDayOfWeek("2026-11-05")).toBe("木");
      // 2026-11-06 is Friday -> "金"
      expect(getEventDayOfWeek("2026-11-06")).toBe("金");
    });

    it("returns empty string for invalid date formats or impossible dates", () => {
      expect(getEventDayOfWeek("invalid-date")).toBe("");
      expect(getEventDayOfWeek("2026-02-31")).toBe("");
      expect(getEventDayOfWeek("")).toBe("");
    });
  });
});
