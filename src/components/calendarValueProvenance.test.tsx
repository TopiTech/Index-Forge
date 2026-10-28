// @vitest-environment jsdom
/**
 * N-3 UI 契約: カレンダーの値 (前回値・市場予想・発表結果) は、フィールド単位の
 * 来歴 (fieldProvenance) に応じて「参考値」「推計」バッジで実データと区別される。
 * 来歴の無い値は実データなのでバッジを付けない。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { CalendarPage } from "./CalendarPage";
import { FreshnessProvider } from "../contexts/FreshnessContext";
import { fetchUpcomingEvents, type CalendarEvent } from "../lib/marketDataService";

vi.mock("../lib/marketDataService", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/marketDataService")>();
  return { ...actual, fetchUpcomingEvents: vi.fn() };
});

vi.mock("./Toast", () => ({
  useToast: () => ({
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}));

const fetchEvents = vi.mocked(fetchUpcomingEvents);

function macroEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: "macro-test",
    date: "10/20",
    fullDate: "2026-10-20",
    type: "MACRO",
    title: "検証マクロ指標",
    importance: "HIGH",
    time: "21:30 JST",
    market: "US",
    previous: "0.25%",
    forecast: "0.50%",
    actual: "0.45%",
    fieldProvenance: { previous: "reference", forecast: "estimated" },
    ...overrides,
  };
}

function renderPage() {
  return render(
    <FreshnessProvider>
      <CalendarPage onNavigate={vi.fn()} onOpenStockDetail={vi.fn()} />
    </FreshnessProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CalendarPage field provenance badges (N-3)", () => {
  it("badges reference and estimated values in the list and leaves real values unbadged", async () => {
    fetchEvents.mockResolvedValue([
      macroEvent(),
      macroEvent({
        id: "macro-live",
        title: "実データマクロ指標",
        previous: "2.0%",
        forecast: "2.1%",
        actual: "2.2%",
        fieldProvenance: undefined,
      }),
    ]);

    renderPage();

    await screen.findByText("検証マクロ指標");

    // 参考値 (静的デフォルト) と推計は琥珀バッジで明示される
    const referenceBadge = screen.getByTitle("実データではなく静的な参考デフォルト値です");
    expect(referenceBadge.textContent).toBe("参考値");
    const estimatedBadge = screen.getByTitle("公式実績ではなく推計値です");
    expect(estimatedBadge.textContent).toBe("推計");

    // 来歴の無い値は実データ: その行にバッジは付かない
    const liveRow = screen.getByText("実データマクロ指標").closest("div")?.parentElement;
    expect(liveRow).not.toBeNull();
    expect(within(liveRow as HTMLElement).queryByText("参考値")).toBeNull();
    expect(within(liveRow as HTMLElement).queryByText("推計")).toBeNull();

    // 発表結果 (実データ) にはバッジが付かないため、バッジは合計 2 個のみ
    expect(screen.getAllByTitle(/実データではなく|公式実績ではなく/)).toHaveLength(2);
  });

  it("shows the same provenance badges on the detail modal value rows", async () => {
    fetchEvents.mockResolvedValue([macroEvent()]);

    renderPage();

    const detailButton = await screen.findByRole("button", {
      name: "検証マクロ指標のイベント詳細を表示",
    });
    detailButton.click();

    const dialog = await screen.findByRole("dialog", { name: "イベント詳細" });
    const previousRow = within(dialog).getByText("前回値").parentElement as HTMLElement;
    const forecastRow = within(dialog).getByText("市場予想").parentElement as HTMLElement;
    const actualRow = within(dialog).getByText("発表結果").parentElement as HTMLElement;

    expect(within(previousRow).getByText("参考値")).toBeTruthy();
    expect(within(forecastRow).getByText("推計")).toBeTruthy();
    // 発表結果は実データなのでバッジなし
    expect(within(actualRow).queryByText("参考値")).toBeNull();
    expect(within(actualRow).queryByText("推計")).toBeNull();
  });

  it("renders no provenance badge at all when every value is real data", async () => {
    fetchEvents.mockResolvedValue([
      macroEvent({
        fieldProvenance: undefined,
        previous: "1.0%",
        forecast: "1.1%",
        actual: "1.2%",
      }),
    ]);

    renderPage();

    await screen.findByText("検証マクロ指標");
    await waitFor(() => {
      expect(screen.queryByTitle("実データではなく静的な参考デフォルト値です")).toBeNull();
      expect(screen.queryByTitle("公式実績ではなく推計値です")).toBeNull();
    });
  });
});
