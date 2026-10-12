import { describe, it, expect, vi } from "vitest";
import {
    generateUpcomingEvents,
    UPCOMING_EVENTS,
    fetchUpcomingEvents,
    type CalendarEvent,
} from "./marketDataService";
import {
    upgradeLegacyPasswordHash,
    isModernPasswordHash,
    hashPassword,
    hashToken,
} from "../../worker/internal";

/**
 * Phase 3 residual fixes:
 * - Client-side static calendar fallback (UPCOMING_EVENTS / generateUpcomingEvents)
 *   now carries source: "fallback" so CalendarPage's fallback banner and
 *   "参考値" badge work for client-side fallbacks too.
 * - Legacy unsalted SHA-256 password hash migration visibility: successful
 *   upgrades emit a log line so operators can track migration progress.
 */
describe("Phase3 Residual Fixes: Client Calendar Fallback Metadata and Legacy Hash Migration Visibility", () => {
    describe("client-side static calendar fallback carries source metadata", () => {
        it("marks every generated event as source: fallback", () => {
            const events = generateUpcomingEvents();
            expect(events.length).toBeGreaterThan(0);
            for (const evt of events) {
                expect(evt.source).toBe("fallback");
            }
        });

        it("marks the exported UPCOMING_EVENTS baseline as fallback", () => {
            expect(UPCOMING_EVENTS.length).toBeGreaterThan(0);
            expect(UPCOMING_EVENTS.every((evt) => evt.source === "fallback")).toBe(true);
        });

        it("keeps the fallback flag stable across reference dates", () => {
            const a = generateUpcomingEvents(new Date("2026-01-15T00:00:00Z"));
            const b = generateUpcomingEvents(new Date("2026-06-20T00:00:00Z"));
            expect(a.every((evt) => evt.source === "fallback")).toBe(true);
            expect(b.every((evt) => evt.source === "fallback")).toBe(true);
        });

        it("preserves event shape required by CalendarPage (id/date/type/title/importance)", () => {
            for (const evt of UPCOMING_EVENTS) {
                expect(typeof evt.id).toBe("string");
                expect(typeof evt.date).toBe("string");
                expect(evt.type === "MACRO" || evt.type === "EARNINGS").toBe(true);
                expect(typeof evt.title).toBe("string");
                expect(["HIGH", "MEDIUM", "LOW"]).toContain(evt.importance);
            }
        });

        it("fetchUpcomingEvents falls back to flagged static events when the API is unavailable", async () => {
            // No browser fetch available in the test runtime; the service must
            // return the static baseline whose events are flagged as fallback.
            const events = await fetchUpcomingEvents();
            expect(events.length).toBeGreaterThan(0);
            expect(events.every((evt) => evt.source === "fallback")).toBe(true);
        });

        it("does not flag live API events as fallback", async () => {
            const payload: CalendarEvent[] = [
                {
                    id: "live-event",
                    date: "01/15",
                    type: "MACRO",
                    title: "Live macro event",
                    importance: "HIGH",
                },
            ];
            const fetchMock = vi.fn().mockResolvedValue(
                new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            );
            vi.stubGlobal("fetch", fetchMock);
            vi.stubGlobal("window", {});
            try {
                const events = await fetchUpcomingEvents();
                expect(events).toHaveLength(1);
                expect(events[0].source).toBeUndefined();
            } finally {
                vi.unstubAllGlobals();
            }
        });
    });

    describe("legacy password hash migration visibility", () => {
        it("logs an upgrade line when a legacy hash is migrated", async () => {
            const legacyHash = await hashToken("legacy-password");
            expect(isModernPasswordHash(legacyHash)).toBe(false);

            const runMock = vi.fn().mockResolvedValue({});
            const env = {
                DB: {
                    prepare: vi.fn().mockReturnValue({
                        bind: vi.fn().mockReturnValue({ run: runMock }),
                    }),
                },
            } as unknown as Parameters<typeof upgradeLegacyPasswordHash>[0];

            const infoSpy = vi.spyOn(console, "info").mockImplementation(() => { });
            try {
                await upgradeLegacyPasswordHash(env, "user-legacy", "legacy-password", legacyHash);
                expect(runMock).toHaveBeenCalledTimes(1);
                const logged = infoSpy.mock.calls
                    .map((args) => args.join(" "))
                    .find((line) => line.includes("user-legacy"));
                expect(logged).toBeDefined();
                expect(logged).toContain("PBKDF2");
            } finally {
                infoSpy.mockRestore();
            }
        });

        it("does not log an upgrade line for already-modern hashes", async () => {
            const modernHash = await hashPassword("modern-password");
            expect(isModernPasswordHash(modernHash)).toBe(true);

            const env = {
                DB: {
                    prepare: vi.fn(),
                },
            } as unknown as Parameters<typeof upgradeLegacyPasswordHash>[0];

            const infoSpy = vi.spyOn(console, "info").mockImplementation(() => { });
            try {
                await upgradeLegacyPasswordHash(env, "user-modern", "modern-password", modernHash);
                expect(env.DB.prepare).not.toHaveBeenCalled();
                expect(infoSpy).not.toHaveBeenCalled();
            } finally {
                infoSpy.mockRestore();
            }
        });
    });
});
