import { describe, it, expect } from "vitest";
import { toYahooSymbol as toYahooSymbolLib } from "./yahooSymbol";
import { toYahooSymbol as toYahooSymbolLegacy } from "./yahooSymbolLegacy";
import { toYahooSymbol as toYahooSymbolWorker } from "../../worker/internal";

describe("toYahooSymbol", () => {
  it("converts Japanese numeric tickers to Tokyo exchange (.T) suffix", () => {
    expect(toYahooSymbolLib("7203")).toBe("7203.T");
    expect(toYahooSymbolLib("9984")).toBe("9984.T");
    expect(toYahooSymbolLib("6857")).toBe("6857.T");
    expect(toYahooSymbolLib("8035")).toBe("8035.T");
  });

  it("leaves already-suffixed Japanese tickers intact", () => {
    expect(toYahooSymbolLib("7203.T")).toBe("7203.T");
    expect(toYahooSymbolLib("9984.T")).toBe("9984.T");
  });

  it("leaves US / global tickers intact without .T suffix", () => {
    expect(toYahooSymbolLib("AAPL")).toBe("AAPL");
    expect(toYahooSymbolLib("NVDA")).toBe("NVDA");
    expect(toYahooSymbolLib("MSFT")).toBe("MSFT");
    expect(toYahooSymbolLib("BRK.B")).toBe("BRK.B");
  });

  it("leaves benchmark indices (^ prefix) and currency pairs (=X suffix) intact", () => {
    expect(toYahooSymbolLib("^N225")).toBe("^N225");
    expect(toYahooSymbolLib("^GSPC")).toBe("^GSPC");
    expect(toYahooSymbolLib("USDJPY=X")).toBe("USDJPY=X");
  });

  it("trims whitespace and converts lowercase tickers to uppercase", () => {
    expect(toYahooSymbolLib("  7203  ")).toBe("7203.T");
    expect(toYahooSymbolLib("aapl")).toBe("AAPL");
    expect(toYahooSymbolLib("  usdjpy=x  ")).toBe("USDJPY=X");
  });

  it("maintains full parity across yahooSymbol, legacy yahuuSymbol re-export, and worker implementation", () => {
    const testCases = ["7203", "9984.T", "AAPL", "BRK.A", "^N225", "USDJPY=X", "  6758  "];
    for (const testCase of testCases) {
      const libVal = toYahooSymbolLib(testCase);
      const legacyVal = toYahooSymbolLegacy(testCase);
      const workerVal = toYahooSymbolWorker(testCase);
      expect(libVal).toBe(workerVal);
      expect(legacyVal).toBe(workerVal);
    }
  });
});
