// @vitest-environment jsdom
/**
 * DATA-29 follow-up: a payload that marks a quote stale is the owner of that
 * row's provenance. Changing only the LIVE badge left the previous live price
 * on screen (and in the chart popover), so a fully stale payload still showed
 * old market prices without the per-row 参考 disclosure.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TradingViewTickerTape } from "./TradingViewTickerTape";

const jsonResponse = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

const firstRow = () => document.querySelector<HTMLElement>(".tv-ticker-item");

const response = (
  quotes: Array<{
    proName: string;
    formattedPrice: string;
    formattedChange: string;
    formattedChangePercent: string;
    isPositive: boolean;
    stale?: boolean;
  }>,
  allStale?: boolean,
) => ({
  updatedAt: "2026-11-06T00:00:00.000Z",
  quotes,
  ...(allStale ? { allStale: true } : {}),
});

describe("TradingViewTickerTape stale payload ownership", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not claim LIVE for a malformed quote row", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          updatedAt: "2026-11-06T00:00:00.000Z",
          quotes: [
            {
              proName: "INDEX:NKY",
              formattedPrice: "2,801.00",
              formattedChange: "+1.00",
              formattedChangePercent: "+0.04%",
              isPositive: true,
            },
            { proName: "FOREXCOM:DJI" },
          ],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<TradingViewTickerTape />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // The partial row is not a quote: the whole payload is rejected, so the
    // badge remains on 参考値 and no half-applied live map is published.
    expect(document.querySelector(".tv-live-badge")?.textContent).toContain("参考値");
    expect(screen.queryByText("2,801.00")).toBeNull();
  });

  it("drops the previous live map when every quote becomes stale", async () => {
    let phase: "fresh" | "stale" = "fresh";
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            phase === "fresh"
              ? response([
                  {
                    proName: "INDEX:NKY",
                    formattedPrice: "2,801.00",
                    formattedChange: "+1.00",
                    formattedChangePercent: "+0.04%",
                    isPositive: true,
                  },
                ])
              : response(
                  [
                    {
                      proName: "INDEX:NKY",
                      formattedPrice: "2,802.00",
                      formattedChange: "+2.00",
                      formattedChangePercent: "+0.07%",
                      isPositive: true,
                      stale: true,
                    },
                  ],
                  true,
                ),
          ),
        ),
      ),
    );

    render(<TradingViewTickerTape />);

    await waitFor(() => expect(screen.getAllByText("2,801.00").length).toBeGreaterThan(0));
    expect(document.querySelector(".tv-live-badge")?.textContent).toContain("LIVE");

    phase = "stale";
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() =>
      expect(document.querySelector(".tv-live-badge")?.textContent).toContain("参考値"),
    );
    // The stale response did not become a live price, and the previous live
    // value did not survive next to the now-stale row either.
    expect(screen.queryByText("2,801.00")).toBeNull();
    expect(screen.queryByText("2,802.00")).toBeNull();
    const row = firstRow();
    expect(row).not.toBeNull();
    expect(row?.querySelector(".tv-ticker-price.is-reference")).not.toBeNull();
    expect(row?.textContent).toContain("38,980.50");
  });

  it("drops only the symbols a mixed payload marks stale", async () => {
    let phase: "fresh" | "stale" = "fresh";
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          jsonResponse(
            phase === "fresh"
              ? response([
                  {
                    proName: "INDEX:NKY",
                    formattedPrice: "2,801.00",
                    formattedChange: "+1.00",
                    formattedChangePercent: "+0.04%",
                    isPositive: true,
                  },
                  {
                    proName: "FOREXCOM:DJI",
                    formattedPrice: "44,001.00",
                    formattedChange: "+10.00",
                    formattedChangePercent: "+0.02%",
                    isPositive: true,
                  },
                ])
              : response([
                  {
                    proName: "INDEX:NKY",
                    formattedPrice: "2,803.00",
                    formattedChange: "+2.00",
                    formattedChangePercent: "+0.07%",
                    isPositive: true,
                  },
                  {
                    proName: "FOREXCOM:DJI",
                    formattedPrice: "44,002.00",
                    formattedChange: "+11.00",
                    formattedChangePercent: "+0.03%",
                    isPositive: true,
                    stale: true,
                  },
                ]),
          ),
        ),
      ),
    );

    render(<TradingViewTickerTape />);

    await waitFor(() => expect(screen.getAllByText("44,001.00").length).toBeGreaterThan(0));
    expect(document.querySelector(".tv-live-badge")?.textContent).toContain("LIVE");

    phase = "stale";
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() => expect(screen.getAllByText("2,803.00").length).toBeGreaterThan(0));
    expect(document.querySelector(".tv-live-badge")?.textContent).toContain("LIVE");
    // The fresh symbol keeps its live value; the stale symbol returns to its
    // disclosed reference value even though the tape as a whole is still live.
    expect(screen.queryByText("44,001.00")).toBeNull();
    expect(screen.queryByText("44,002.00")).toBeNull();
    const djiRow = Array.from(document.querySelectorAll<HTMLElement>(".tv-ticker-item")).find(
      (item) => item.textContent?.includes("NYダウ"),
    );
    expect(djiRow?.querySelector(".tv-ticker-price.is-reference")).not.toBeNull();
    expect(djiRow?.textContent).toContain("43,825.10");
  });

  it("opens the hover popover with the newest quote, not the one present at hover time", async () => {
    // Held in an object because the resolver is assigned from the fetch mock:
    // a bare `let` is narrowed to its initial null by control-flow analysis.
    const secondRequest: { resolve: ((value: Response) => void) | null } = {
      resolve: null,
    };
    let requestCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        requestCount += 1;
        if (requestCount === 1) {
          return Promise.resolve(
            jsonResponse(
              response([
                {
                  proName: "INDEX:NKY",
                  formattedPrice: "2,801.00",
                  formattedChange: "+1.00",
                  formattedChangePercent: "+0.04%",
                  isPositive: true,
                },
              ]),
            ),
          );
        }
        return new Promise<Response>((resolve) => {
          secondRequest.resolve = resolve;
        });
      }),
    );

    render(<TradingViewTickerTape />);
    await waitFor(() => expect(screen.getAllByText("2,801.00").length).toBeGreaterThan(0));

    // Start the next poll, then hover while it is still in flight. The timer
    // captured this render's callback; a later quote must still win.
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(secondRequest.resolve).not.toBeNull());

    const nikkeiRow = Array.from(document.querySelectorAll<HTMLElement>(".tv-ticker-item")).find(
      (item) => item.textContent?.includes("日経平均"),
    );
    if (!nikkeiRow) throw new Error("Nikkei ticker row was not rendered");
    fireEvent.mouseEnter(nikkeiRow);

    const resolve = secondRequest.resolve;
    if (!resolve) throw new Error("Second quote request was not started");
    resolve(
      jsonResponse(
        response([
          {
            proName: "INDEX:NKY",
            formattedPrice: "2,802.00",
            formattedChange: "+2.00",
            formattedChangePercent: "+0.07%",
            isPositive: true,
          },
        ]),
      ),
    );
    await waitFor(() => expect(screen.getAllByText("2,802.00").length).toBeGreaterThan(0));

    // 1.8s hover delay. The popover must read the live map at open time.
    await waitFor(
      () => {
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        expect(dialog).not.toBeNull();
        if (!dialog) throw new Error("Chart popover did not open");
        expect(within(dialog).getAllByText("2,802.00").length).toBeGreaterThan(0);
        expect(within(dialog).queryByText("2,801.00")).toBeNull();
      },
      { timeout: 3000 },
    );
  });

  it("withdraws previously live prices when a later poll fails", async () => {
    let phase: "fresh" | "offline" = "fresh";
    const requestHeaders: Array<Record<string, string>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
        requestHeaders.push((init?.headers as Record<string, string> | undefined) ?? {});
        if (phase === "offline") return Promise.reject(new Error("network offline"));
        return Promise.resolve(
          new Response(
            JSON.stringify(
              response([
                {
                  proName: "INDEX:NKY",
                  formattedPrice: "2,801.00",
                  formattedChange: "+1.00",
                  formattedChangePercent: "+0.04%",
                  isPositive: true,
                },
              ]),
            ),
            {
              status: 200,
              headers: { "content-type": "application/json", etag: '"tape-v1"' },
            },
          ),
        );
      }),
    );

    render(<TradingViewTickerTape />);

    await waitFor(() => expect(screen.getAllByText("2,801.00").length).toBeGreaterThan(0));
    expect(document.querySelector(".tv-live-badge")?.textContent).toContain("LIVE");

    // The last accepted price is no longer supported by a successful poll. It
    // must not stay on screen as if it were still live.
    phase = "offline";
    document.dispatchEvent(new Event("visibilitychange"));

    await waitFor(() =>
      expect(document.querySelector(".tv-live-badge")?.textContent).toContain("参考値"),
    );
    expect(screen.queryByText("2,801.00")).toBeNull();
    const row = firstRow();
    expect(row).not.toBeNull();
    expect(row?.querySelector(".tv-ticker-price.is-reference")).not.toBeNull();
    expect(row?.textContent).toContain("38,980.50");

    // Recovery must request a full body: the retained ETag belonged to the
    // withdrawn payload, so sending it would earn a 304 and keep the tape on
    // reference values indefinitely.
    phase = "fresh";
    document.dispatchEvent(new Event("visibilitychange"));
    await waitFor(() => expect(screen.getAllByText("2,801.00").length).toBeGreaterThan(0));
    expect(document.querySelector(".tv-live-badge")?.textContent).toContain("LIVE");
    expect(requestHeaders.at(-1)?.["If-None-Match"]).toBeUndefined();
  });
});
