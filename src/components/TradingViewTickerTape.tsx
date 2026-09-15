import React, { useEffect, useRef } from "react";
import { useTheme } from "../lib/theme";

export function TradingViewTickerTape() {
  const { theme } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Reset container contents
    container.innerHTML = "";

    const widgetInner = document.createElement("div");
    widgetInner.className = "tradingview-widget-container__widget";
    container.appendChild(widgetInner);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-ticker-tape.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      symbols: [
        { proName: "INDEX:NKY", title: "日経平均" },
        { proName: "FOREXCOM:DJI", title: "NYダウ" },
        { proName: "FOREXCOM:SPXUSD", title: "S&P 500" },
        { proName: "FOREXCOM:NSXUSD", title: "NASDAQ 100" },
        { proName: "FX_IDC:USDJPY", title: "米ドル/円" },
        { proName: "FX_IDC:XAUUSD", title: "金 (Gold)" },
        { proName: "TVC:USOIL", title: "WTI原油" },
        { proName: "BITSTAMP:BTCUSD", title: "ビットコイン" },
        { proName: "BITSTAMP:ETHUSD", title: "イーサリアム" },
      ],
      showSymbolLogo: true,
      isTransparent: false,
      displayMode: "adaptive",
      colorTheme: theme === "light" ? "light" : "dark",
      locale: "ja",
    });

    container.appendChild(script);

    return () => {
      container.innerHTML = "";
    };
  }, [theme]);

  return (
    <div className="tradingview-ticker-bar" aria-label="主要指数マーケットティッカー">
      <div className="tradingview-widget-container" ref={containerRef}>
        <div className="tradingview-widget-container__widget" />
      </div>
    </div>
  );
}
