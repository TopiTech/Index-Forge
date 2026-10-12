import { beforeEach, describe, it, expect, vi } from "vitest";
import {
    getStockFundamentals,
    fetchMarketOverview,
    resetMarketOverviewEndpointProbe,
    type MarketOverviewData,
} from "./marketDataService";
import {
    getClientIp,
    findPasswordCollision,
    MAX_PASSWORD_COLLISION_VERIFICATIONS,
    hashPassword,
    clearAuthCache,
    resetPasswordTableEnsured,
} from "../../worker/internal";

/**
 * Phase 1 review fixes (plans/phase1-review-and-fix-plan.md):
 * - M1: data authenticity flags (isDemoData, source: "fallback", freshness)
 * - M2: security hardening (getClientIp trust order, findPasswordCollision cap)
 */
describe("Phase1 Review Fixes: Data Authenticity and Security Hardening", () => {
    beforeEach(() => {
        clearAuthCache();
        resetPasswordTableEnsured();
        resetMarketOverviewEndpointProbe();
    });

    describe("M1: pseudo-generated fundamentals are flagged as demo data", () => {
        it("marks unknown tickers (no anchor) with isDemoData: true", () => {
            const result = getStockFundamentals("ZZZZ9");
            expect(result.isDemoData).toBe(true);
        });

        it("does not flag known anchored tickers as demo data", () => {
            // 7203 (Toyota) has a KNOWN_STOCK_ANCHORS entry
            const result = getStockFundamentals("7203");
            expect(result.isDemoData).toBeUndefined();
        });

        it("keeps the generated values deterministic for the same ticker", () => {
            const a = getStockFundamentals("ZZZZ9");
            const b = getStockFundamentals("ZZZZ9");
            expect(a.price).toBe(b.price);
            expect(a.marketCap).toBe(b.marketCap);
        });
    });

    describe("M1: market overview fallback metadata", () => {
        it("returns fallback metadata when the overview endpoint is missing", async () => {
            // No browser fetch available in the test runtime; the service falls back
            // to the static baseline and must disclose that via metadata.
            const data = await fetchMarketOverview();
            expect(data.dataSource).toBe("fallback");
            expect(typeof data.dataAsOf).toBe("string");
            expect(Number.isNaN(Date.parse(data.dataAsOf as string))).toBe(false);
        });

        it("returns live metadata when the endpoint returns valid JSON", async () => {
            const payload: MarketOverviewData = {
                indices: [
                    {
                        symbol: "^GSPC",
                        name: "S&P 500",
                        category: "INDEX",
                        price: 5800,
                        change: 10,
                        changePercent: 0.17,
                        currency: "USD",
                        updatedAt: "-",
                    },
                ],
                forex: [],
                commodities: [],
                crypto: [],
                sectors: [],
                marketBreadth: { gainers: 1, losers: 0, unchanged: 0, sentimentScore: 50 },
                news: [],
            };
            const fetchMock = vi.fn().mockResolvedValue(
                new Response(JSON.stringify(payload), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                }),
            );
            vi.stubGlobal("fetch", fetchMock);
            vi.stubGlobal("window", {});
            try {
                const data = await fetchMarketOverview();
                expect(data.dataSource).toBe("live");
                expect(data.dataAsOf).toBeUndefined();
            } finally {
                vi.unstubAllGlobals();
            }
        });
    });

    describe("M2: getClientIp trusts CF-Connecting-IP over spoofable headers", () => {
        it("prioritizes cf-connecting-ip over x-real-ip and x-forwarded-for", () => {
            const req = new Request("http://localhost/api/test", {
                headers: {
                    "cf-connecting-ip": "1.1.1.1",
                    "x-real-ip": "2.2.2.2",
                    "x-forwarded-for": "3.3.3.3, 4.4.4.4",
                },
            });
            expect(getClientIp(req)).toBe("1.1.1.1");
        });

        it("uses x-real-ip only when cf-connecting-ip is absent", () => {
            const req = new Request("http://localhost/api/test", {
                headers: { "x-real-ip": "2.2.2.2", "x-forwarded-for": "3.3.3.3" },
            });
            expect(getClientIp(req)).toBe("2.2.2.2");
        });

        it("interprets x-forwarded-for as a trusted proxy chain (right-most hop)", () => {
            const req = new Request("http://localhost/api/test", {
                headers: { "x-forwarded-for": "3.3.3.3, 4.4.4.4, 5.5.5.5" },
            });
            expect(getClientIp(req)).toBe("5.5.5.5");
        });

        it("returns unknown when no IP headers are present", () => {
            const req = new Request("http://localhost/api/test");
            expect(getClientIp(req)).toBe("unknown");
        });
    });

    describe("M2: findPasswordCollision caps PBKDF2 verifications", () => {
        it("exposes a positive verification cap constant", () => {
            expect(Number.isInteger(MAX_PASSWORD_COLLISION_VERIFICATIONS)).toBe(true);
            expect(MAX_PASSWORD_COLLISION_VERIFICATIONS).toBeGreaterThan(0);
        });

        it("stops verifying after the cap and reports no collision when the match is beyond it", async () => {
            // Build a table with more rows than the cap; the colliding password is
            // placed on the last row so it can only be found if verification is
            // unbounded.
            const rows = MAX_PASSWORD_COLLISION_VERIFICATIONS + 5;
            const collidingPassword = "collision-target-password";
            const collidingHash = await hashPassword(collidingPassword);
            const otherHash = await hashPassword("some-other-password-1");

            const allRows = Array.from({ length: rows }, (_, i) => ({
                id: `user-${i}`,
                name: `User ${i}`,
                role: "user" as const,
                password_hash: i === rows - 1 ? collidingHash : otherHash,
            }));

            const env = {
                DB: {
                    prepare: vi.fn().mockReturnValue({
                        all: vi.fn().mockResolvedValue({ results: allRows }),
                    }),
                },
                ADMIN_PASSWORD: "",
            } as unknown as Parameters<typeof findPasswordCollision>[0];

            const result = await findPasswordCollision(env, collidingPassword);
            // The collision sits beyond the verification cap, so it must NOT be
            // reported; the cap prevents unbounded CPU cost instead.
            expect(result.hasCollision).toBe(false);
        });

        it("still detects a collision within the cap", async () => {
            const collidingPassword = "in-cap-collision";
            const collidingHash = await hashPassword(collidingPassword);
            const otherHash = await hashPassword("some-other-password-2");

            const allRows = Array.from(
                { length: MAX_PASSWORD_COLLISION_VERIFICATIONS },
                (_, i) => ({
                    id: `user-${i}`,
                    name: `User ${i}`,
                    role: "user" as const,
                    password_hash: i === 0 ? collidingHash : otherHash,
                }),
            );

            const env = {
                DB: {
                    prepare: vi.fn().mockReturnValue({
                        all: vi.fn().mockResolvedValue({ results: allRows }),
                    }),
                },
                ADMIN_PASSWORD: "",
            } as unknown as Parameters<typeof findPasswordCollision>[0];

            const result = await findPasswordCollision(env, collidingPassword);
            expect(result.hasCollision).toBe(true);
            expect(result.collidingId).toBe("user-0");
        });
    });
});
