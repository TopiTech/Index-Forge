import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { AVAILABLE_BENCHMARKS } from "../hooks/useBenchmark";

describe("Header, Admin Guard, BTC Benchmark & TradingView Enhancements", () => {
  describe("BTC Benchmark Option", () => {
    it("includes BTC-USD in AVAILABLE_BENCHMARKS with expected properties", () => {
      const btc = AVAILABLE_BENCHMARKS.find((b) => b.symbol === "BTC-USD");
      expect(btc).toBeDefined();
      expect(btc?.shortLabel).toBe("BTC");
      expect(btc?.currency).toBe("USD");
      expect(btc?.label).toContain("ビットコイン");
    });

    it("has 4 benchmarks defined: Nikkei, S&P 500, USD/JPY, and BTC", () => {
      const symbols = AVAILABLE_BENCHMARKS.map((b) => b.symbol);
      expect(symbols).toEqual(["^N225", "^GSPC", "USDJPY=X", "BTC-USD"]);
    });
  });

  describe("Admin Navigation Guard", () => {
    it("guards admin page button with isAdmin in Header.tsx", () => {
      const headerCode = readFileSync(resolve(__dirname, "../components/Header.tsx"), "utf8");
      expect(headerCode).toContain("isAdmin && onNavigateToAdmin");
    });

    it("guards admin page link with isAdmin in Footer.tsx", () => {
      const footerCode = readFileSync(resolve(__dirname, "../components/Footer.tsx"), "utf8");
      expect(footerCode).toContain("const { isAdmin } = useAuth();");
      expect(footerCode).toContain("{isAdmin && (");
      expect(footerCode).toContain("管理者ページ");
    });
  });

  describe("ThemeControls Color Collapsing & Layering", () => {
    it("collapses color options by default and opens on toggle in ThemeControls.tsx", () => {
      const themeControlsCode = readFileSync(
        resolve(__dirname, "../components/ThemeControls.tsx"),
        "utf8",
      );
      expect(themeControlsCode).toContain("const [isOpen, setIsOpen] = useState(false);");
      expect(themeControlsCode).toContain("theme-palette-toggle-btn");
      expect(themeControlsCode).toContain("accent-picker-popover");
    });

    it("ensures .top-header has overflow visible and proper z-index to prevent popover clipping", () => {
      const cssCode = readFileSync(resolve(__dirname, "../index.css"), "utf8");
      expect(cssCode).toContain(".top-header {");
      // Must not be overflow: hidden, which clips the dropdown popover
      expect(cssCode).toMatch(/\.top-header\s*\{[^}]*overflow:\s*visible;/s);
      expect(cssCode).toMatch(/\.top-header\s*\{[^}]*z-index:\s*\d+;/s);
      expect(cssCode).toContain(".accent-picker-popover {");
    });

    it("ensures .top-header z-index is strictly higher than .tradingview-ticker-bar so popovers take mouse clicks", () => {
      const cssCode = readFileSync(resolve(__dirname, "../index.css"), "utf8");
      const headerZMatch = cssCode.match(/\.top-header\s*\{[^}]*z-index:\s*(\d+);/s);
      const tickerZMatch = cssCode.match(/\.tradingview-ticker-bar\s*\{[^}]*z-index:\s*(\d+);/s);

      expect(headerZMatch).not.toBeNull();
      expect(tickerZMatch).not.toBeNull();

      const headerZ = parseInt(headerZMatch![1], 10);
      const tickerZ = parseInt(tickerZMatch![1], 10);

      expect(headerZ).toBeGreaterThan(tickerZ);
    });

    it("ensures .accent-picker-popover has an opaque background and ThemeControls does not override with translucent background", () => {
      const cssCode = readFileSync(resolve(__dirname, "../index.css"), "utf8");
      const themeControlsCode = readFileSync(
        resolve(__dirname, "../components/ThemeControls.tsx"),
        "utf8",
      );

      // CSS must define opaque backgrounds for dark and light themes
      expect(cssCode).toMatch(/:root\[data-theme="dark"\]\s+\.accent-picker-popover\s*\{[^}]*background:\s*#0e1628/s);
      expect(cssCode).toMatch(/:root\[data-theme="light"\]\s+\.accent-picker-popover\s*\{[^}]*background:\s*#ffffff/s);

      // ThemeControls.tsx motion.div should NOT inline override background to translucent var(--bg-card)
      expect(themeControlsCode).not.toContain('background: "var(--bg-card)"');
    });

    it("ensures .accent-option has defined styles with borders to enhance visibility", () => {
      const cssCode = readFileSync(resolve(__dirname, "../index.css"), "utf8");
      expect(cssCode).toContain(".accent-option {");
      expect(cssCode).toMatch(/\.accent-option:not\(\[aria-checked="true"\]\)\s*\{[^}]*border:/s);
    });
  });

  describe("TradingView Ticker Tape Widget", () => {
    it("excludes TOPIX due to TSE licensing restriction and includes global alternatives", () => {
      const tvCode = readFileSync(
        resolve(__dirname, "../components/TradingViewTickerTape.tsx"),
        "utf8",
      );
      // Verify TOPIX is NOT present
      expect(tvCode).not.toContain("INDEX:TOPX");
      expect(tvCode).not.toContain("TVC:TPX");

      // Verify global assets and BTC are present with supported embed symbols
      expect(tvCode).toContain("INDEX:NKY");
      expect(tvCode).toContain("FOREXCOM:DJI");
      expect(tvCode).toContain("FOREXCOM:SPXUSD");
      expect(tvCode).toContain("FOREXCOM:NSXUSD");
      expect(tvCode).toContain("FX_IDC:USDJPY");
      expect(tvCode).toContain("FX_IDC:XAUUSD");
      expect(tvCode).toContain("TVC:USOIL");
      expect(tvCode).toContain("BITSTAMP:BTCUSD");
      expect(tvCode).toContain("BITSTAMP:ETHUSD");
    });

    it("mounts TradingViewTickerTape in App.tsx below Header", () => {
      const appCode = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
      expect(appCode).toContain("<TradingViewTickerTape />");
    });
  });
});
