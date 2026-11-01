// @vitest-environment jsdom
/**
 * End-to-end (component-level) coverage for portfolio CSV import feedback.
 *
 * The importer's `error` field is only useful if the page actually surfaces it.
 * These tests drive the real file input and real `ToastProvider` instead of
 * mocking `useToast`, so a regression that downgrades the skipped-row warning
 * to an invisible/debug-only path fails here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { PortfolioManagerPage } from "./PortfolioManagerPage";
import { ToastProvider } from "./Toast";

const { deserializeSpy } = vi.hoisted(() => ({ deserializeSpy: vi.fn() }));

vi.mock("../lib/indexSerialization", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/indexSerialization")>();
  return {
    ...actual,
    deserializePortfolioFromCsv: (
      ...args: Parameters<typeof actual.deserializePortfolioFromCsv>
    ) => {
      deserializeSpy(...args);
      return actual.deserializePortfolioFromCsv(...args);
    },
  };
});

const { authState } = vi.hoisted(() => ({
  authState: { isAuthenticated: true },
}));

vi.mock("../hooks/useAuth", () => ({
  useAuth: () => ({
    session: authState.isAuthenticated ? { id: "user-1", password: "pw", role: "user" } : null,
    isAuthenticated: authState.isAuthenticated,
    isAdmin: false,
    isUser: authState.isAuthenticated,
    maxStocks: null,
    maxIndices: null,
    loading: false,
    login: vi.fn(async () => ({ ok: true })),
    adminLogin: vi.fn(async () => ({ ok: true })),
    logout: vi.fn(),
    getHeaders: () => ({}),
  }),
}));

const HEADER = "コード,銘柄名,保有株数,取得単価,取得日,メモ";

/**
 * G-5: a controllable FileReader. The component owns at most one import; a
 * second selection must abort the first read and the first callback must be
 * ignored even if it arrives later.
 */
class ControlledFileReader {
  static instances: ControlledFileReader[] = [];
  onload: ((event: { target?: { result?: unknown } }) => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  aborted = false;
  result: string | null = null;

  readAsText(file: File): void {
    ControlledFileReader.instances.push(this);
    this.result = file.name;
  }

  abort(): void {
    this.aborted = true;
    this.onabort?.();
  }

  finish(text: string): void {
    this.result = text;
    this.onload?.({ target: { result: text } });
  }
}

beforeEach(() => {
  ControlledFileReader.instances = [];
});

function renderPage() {
  return render(
    <ToastProvider>
      <PortfolioManagerPage onNavigate={() => {}} onOpenStockDetail={() => {}} />
    </ToastProvider>,
  );
}

function csvFile(csv: string): File {
  return new File([csv], "portfolio.csv", { type: "text/csv" });
}

function uploadFile(file: File): void {
  const input = screen.getByLabelText("ポートフォリオCSVファイルをアップロード");
  fireEvent.change(input, { target: { files: [file] } });
}

function uploadCsv(csv: string): File {
  const file = csvFile(csv);
  uploadFile(file);
  return file;
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  deserializeSpy.mockClear();
  authState.isAuthenticated = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true, stockUniverse: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Portfolio CSV import feedback", () => {
  it("shows a warning toast with the skipped row when valid and invalid rows are mixed", async () => {
    renderPage();

    uploadCsv(
      [
        HEADER,
        '7203,トヨタ自動車,100株,"2,500円",2026-01-01,valid rows with units',
        "6758,ソニーグループ,約100,3000円,2026-01-01,ambiguous value",
      ].join("\n"),
    );

    const warning = await screen.findByText(/1行をスキップしました/);
    expect(warning.textContent).toContain("行: 3");
    expect(warning.textContent).toContain("スキップした行: 3");
    expect(warning.closest(".toast-warning")).not.toBeNull();
    // The valid row was actually imported even though another row failed.
    expect(await screen.findByText(/保有株式一覧 \(1銘柄\)/)).toBeTruthy();
    expect(await screen.findByText(/1件の保有銘柄をCSVからインポートしました/)).toBeTruthy();
  });

  it("shows no warning toast when every row is valid", async () => {
    renderPage();

    uploadCsv(
      [
        HEADER,
        '7203,トヨタ自動車,100株,"2,500円",2026-01-01,valid unit notation',
        '6758,ソニーグループ,50,"8,500円",2026-01-02,valid unit notation',
      ].join("\n"),
    );

    const success = await screen.findByText(/2件の保有銘柄をCSVからインポートしました/);
    expect(success.closest(".toast-success")).not.toBeNull();
    expect(screen.queryByText(/スキップしました/)).toBeNull();
    expect(document.querySelector(".toast-warning")).toBeNull();
  });

  it("aborts the previous read and lets only the latest selection win", async () => {
    vi.stubGlobal("FileReader", ControlledFileReader);
    renderPage();

    const firstCsv = [HEADER, "1111,競合A,10,1000,2026-01-01,first"].join("\n");
    const secondCsv = [HEADER, "2222,最新B,20,2000,2026-01-02,second"].join("\n");
    uploadCsv(firstCsv);
    uploadCsv(secondCsv);

    const [firstReader, secondReader] = ControlledFileReader.instances;
    expect(ControlledFileReader.instances).toHaveLength(2);
    expect(firstReader.aborted).toBe(true);

    // The aborted first read must not overwrite the later selection.
    firstReader.finish(firstCsv);
    secondReader.finish(secondCsv);

    expect(await screen.findByText(/1件の保有銘柄をCSVからインポートしました/)).toBeTruthy();
    expect((await screen.findAllByText(/2222/)).length).toBeGreaterThan(0);
    expect(screen.queryAllByText(/1111/)).toHaveLength(0);
    expect(document.querySelector(".toast-warning")).toBeNull();
  });

  it("clears the input before the read starts so the same file can be reselected", async () => {
    vi.stubGlobal("FileReader", ControlledFileReader);
    renderPage();

    const input = screen.getByLabelText("ポートフォリオCSVファイルをアップロード");
    const valueWrites: string[] = [];
    let inputValue = "C:\\fakepath\\portfolio.csv";
    Object.defineProperty(input, "value", {
      configurable: true,
      get: () => inputValue,
      set: (next: string) => {
        valueWrites.push(next);
        inputValue = next;
      },
    });

    const csv = [HEADER, "1111,競合A,10,1000,2026-01-01,same-file"].join("\n");
    const file = csvFile(csv);
    uploadFile(file);

    // The browser needs an empty value before the read completes; otherwise
    // picking the same path again produces no change event.
    expect(valueWrites).toContain("");
    expect(inputValue).toBe("");

    uploadFile(file);
    expect(ControlledFileReader.instances).toHaveLength(2);
    expect(ControlledFileReader.instances[0].aborted).toBe(true);

    ControlledFileReader.instances[1].finish(csv);
    expect(await screen.findByText(/1件の保有銘柄をCSVからインポートしました/)).toBeTruthy();
  });

  it("does not enter the handler after unmount, so setPositions cannot run", () => {
    vi.stubGlobal("FileReader", ControlledFileReader);
    const { unmount } = renderPage();

    const csv = [HEADER, "1111,競合A,10,1000,2026-01-01,unmounted"].join("\n");
    uploadCsv(csv);
    const [reader] = ControlledFileReader.instances;
    deserializeSpy.mockClear();

    unmount();
    expect(reader.aborted).toBe(true);
    expect(() => reader.finish(csv)).not.toThrow();
    // setPositions is reachable only after this parse in handleImportCsv. If
    // the sequence/mounted guard is removed, the late callback enters the
    // write path and this spy records it.
    expect(deserializeSpy).not.toHaveBeenCalled();
  });
});
