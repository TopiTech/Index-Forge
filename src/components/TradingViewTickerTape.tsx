import React, { useState, useRef, useCallback, useEffect } from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { TradingViewChartModal, type PopupSymbolInfo } from "./TradingViewChartModal";

export interface TickerSymbolItem {
  proName: string;
  title: string;
  category: string;
  defaultPrice: string;
  defaultChange: string;
  defaultChangePercent: string;
  isPositive: boolean;
  emoji: string;
}

export const TICKER_SYMBOLS: TickerSymbolItem[] = [
  {
    proName: "INDEX:NKY",
    title: "日経平均",
    category: "INDEX",
    defaultPrice: "38,980.50",
    defaultChange: "+145.20",
    defaultChangePercent: "+0.37%",
    isPositive: true,
    emoji: "🇯🇵",
  },
  {
    proName: "FOREXCOM:DJI",
    title: "NYダウ",
    category: "INDEX",
    defaultPrice: "43,825.10",
    defaultChange: "+210.40",
    defaultChangePercent: "+0.48%",
    isPositive: true,
    emoji: "🇺🇸",
  },
  {
    proName: "FOREXCOM:SPXUSD",
    title: "S&P 500",
    category: "INDEX",
    defaultPrice: "5,860.25",
    defaultChange: "+18.90",
    defaultChangePercent: "+0.32%",
    isPositive: true,
    emoji: "🇺🇸",
  },
  {
    proName: "FOREXCOM:NSXUSD",
    title: "NASDAQ 100",
    category: "INDEX",
    defaultPrice: "20,410.80",
    defaultChange: "+95.30",
    defaultChangePercent: "+0.47%",
    isPositive: true,
    emoji: "💻",
  },
  {
    proName: "FX_IDC:USDJPY",
    title: "米ドル/円",
    category: "FX",
    defaultPrice: "155.20",
    defaultChange: "+0.15",
    defaultChangePercent: "+0.10%",
    isPositive: true,
    emoji: "💵",
  },
  {
    proName: "FX_IDC:XAUUSD",
    title: "金 (Gold)",
    category: "COMMODITY",
    defaultPrice: "2,680.50",
    defaultChange: "-8.40",
    defaultChangePercent: "-0.31%",
    isPositive: false,
    emoji: "🪙",
  },
  {
    proName: "TVC:USOIL",
    title: "WTI原油",
    category: "COMMODITY",
    defaultPrice: "71.45",
    defaultChange: "-0.65",
    defaultChangePercent: "-0.90%",
    isPositive: false,
    emoji: "🛢️",
  },
  {
    proName: "BITSTAMP:BTCUSD",
    title: "ビットコイン",
    category: "CRYPTO",
    defaultPrice: "91,240.00",
    defaultChange: "+1,250.00",
    defaultChangePercent: "+1.39%",
    isPositive: true,
    emoji: "₿",
  },
  {
    proName: "BITSTAMP:ETHUSD",
    title: "イーサリアム",
    category: "CRYPTO",
    defaultPrice: "3,340.50",
    defaultChange: "+45.20",
    defaultChangePercent: "+1.37%",
    isPositive: true,
    emoji: "Ξ",
  },
];

const HOVER_TRIGGER_DELAY_MS = 1800; // ~1.8 seconds delay before popup triggers

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const TSE_OPEN_MINUTES = 9 * 60; // 09:00 JST
const TSE_CLOSE_MINUTES = 15 * 60 + 30; // 15:30 JST

export function isTseMarketOpen(now: Date = new Date()): boolean {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  const day = jst.getUTCDay();
  if (day === 0 || day === 6) return false; // Saturday / Sunday
  const minutes = jst.getUTCHours() * 60 + jst.getUTCMinutes();
  return minutes >= TSE_OPEN_MINUTES && minutes < TSE_CLOSE_MINUTES;
}

export function getTickerPollingInterval(now: Date = new Date()): number {
  // During trading hours: 60 seconds. Outside trading hours (nights, weekends): 15 minutes to conserve quota.
  return isTseMarketOpen(now) ? 60_000 : 15 * 60_000;
}

export interface LiveQuoteItem {
  price: string;
  change: string;
  changePercent: string;
  isPositive: boolean;
}

export function determineTickFlashDirection(
  prevFormattedPrice: string,
  newFormattedPrice: string,
  isPositiveFallback: boolean,
): "up" | "down" {
  const prevNum = parseFloat(prevFormattedPrice.replace(/,/g, ""));
  const newNum = parseFloat(newFormattedPrice.replace(/,/g, ""));
  if (Number.isFinite(prevNum) && Number.isFinite(newNum) && prevNum !== newNum) {
    return newNum > prevNum ? "up" : "down";
  }
  return isPositiveFallback ? "up" : "down";
}

export function TradingViewTickerTape() {
  const [activePopupSymbol, setActivePopupSymbol] = useState<PopupSymbolInfo | null>(null);
  const [hoveredSymbol, setHoveredSymbol] = useState<string | null>(null);
  const [liveQuotes, setLiveQuotes] = useState<Record<string, LiveQuoteItem>>({});
  const [flashItems, setFlashItems] = useState<Record<string, "up" | "down">>({});
  const [isLive, setIsLive] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const etagRef = useRef<string | null>(null);

  // Clear timers on unmount
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }
      if (flashTimerRef.current) {
        clearTimeout(flashTimerRef.current);
      }
    };
  }, []);

  // Fetch real-time market quotes from worker API (with ETag conditional request)
  const fetchQuotes = useCallback(async () => {
    try {
      const headers: Record<string, string> = {};
      if (etagRef.current) {
        headers["If-None-Match"] = etagRef.current;
      }
      const res = await fetch("/api/ticker-prices", { headers });
      if (res.status === 304) {
        // Data has not changed; retain current quotes and save client processing
        return;
      }
      if (!res.ok) return;

      const newEtag = res.headers.get("etag");
      if (newEtag) {
        etagRef.current = newEtag;
      }

      const data = (await res.json()) as {
        updatedAt?: string;
        allStale?: boolean;
        quotes?: {
          proName: string;
          formattedPrice: string;
          formattedChange: string;
          formattedChangePercent: string;
          isPositive: boolean;
          stale?: boolean;
        }[];
      };

      if (Array.isArray(data.quotes) && data.quotes.length > 0) {
        // Quotes flagged stale by the Worker are static/previous fallbacks.
        // Keep them out of the live map so the tape stays in 参考値 mode and
        // the badge never claims LIVE on fully-stale data.
        const freshQuotes = data.quotes.filter((q) => q && !q.stale);
        if (data.allStale || freshQuotes.length === 0) {
          return;
        }
        const quotesToApply = freshQuotes;
        setLiveQuotes((prev) => {
          const next = { ...prev };
          const newFlashes: Record<string, "up" | "down"> = {};

          for (const q of quotesToApply) {
            if (q.proName && q.formattedPrice) {
              const prevItem = prev[q.proName];
              if (prevItem && prevItem.price !== q.formattedPrice) {
                newFlashes[q.proName] = determineTickFlashDirection(
                  prevItem.price,
                  q.formattedPrice,
                  q.isPositive,
                );
              }
              next[q.proName] = {
                price: q.formattedPrice,
                change: q.formattedChange,
                changePercent: q.formattedChangePercent,
                isPositive: q.isPositive,
              };
            }
          }

          if (Object.keys(newFlashes).length > 0) {
            setFlashItems(newFlashes);
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => {
              setFlashItems({});
            }, 800);
          }

          return next;
        });
        setIsLive(true);
      }
    } catch {
      // Gracefully retain existing or default values when offline/error
    }
  }, []);

  // Smart polling: 60s during trading hours, 15m outside trading hours to conserve quota
  useEffect(() => {
    fetchQuotes();

    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const scheduleNext = () => {
      if (cancelled) return;
      const intervalMs = getTickerPollingInterval();
      timer = setTimeout(() => {
        if (!cancelled && typeof document !== "undefined" && document.visibilityState === "visible") {
          fetchQuotes().finally(() => scheduleNext());
        } else {
          scheduleNext();
        }
      }, intervalMs);
    };

    scheduleNext();

    const handleVisibilityChange = () => {
      if (typeof document !== "undefined" && document.visibilityState === "visible") {
        fetchQuotes();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [fetchQuotes]);

  const openChartModal = useCallback(
    (item: TickerSymbolItem) => {
      const live = liveQuotes[item.proName];
      setActivePopupSymbol({
        proName: item.proName,
        title: item.title,
        price: live ? live.price : item.defaultPrice,
        change: live ? live.change : item.defaultChange,
        changePercent: live ? live.changePercent : item.defaultChangePercent,
        isPositive: live ? live.isPositive : item.isPositive,
      });
    },
    [liveQuotes],
  );

  const handleMouseEnter = useCallback(
    (item: TickerSymbolItem) => {
      setHoveredSymbol(item.proName);

      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
      }

      hoverTimerRef.current = setTimeout(() => {
        openChartModal(item);
      }, HOVER_TRIGGER_DELAY_MS);
    },
    [openChartModal],
  );

  const handleMouseLeave = useCallback(
    (item: TickerSymbolItem) => {
      if (hoveredSymbol === item.proName) {
        setHoveredSymbol(null);
      }
      if (hoverTimerRef.current) {
        clearTimeout(hoverTimerRef.current);
        hoverTimerRef.current = null;
      }
    },
    [hoveredSymbol],
  );

  const handleCloseModal = useCallback(() => {
    setActivePopupSymbol(null);
  }, []);

  // Double list to create seamless looping ticker
  const displayItems = [...TICKER_SYMBOLS, ...TICKER_SYMBOLS];

  return (
    <>
      <div
        className="tradingview-ticker-bar"
        aria-label={
          isLive
            ? "主要指数マーケットティッカー(リアルタイム市場データ。ホバーまたはクリックでTradingViewチャートプレビュー)"
            : "主要指数マーケットティッカー(参考値・固定表示。価格の取得待機中。ホバーまたはクリックでTradingViewチャートプレビュー)"
        }
      >
        <div className="tv-interactive-ticker-wrapper">
          <div
            className={`tv-ticker-track ${hoveredSymbol ? "paused" : ""}`}
            role="region"
            aria-live="off"
          >
            {displayItems.map((item, index) => {
              const isItemHovered = hoveredSymbol === item.proName;
              const isDuplicate = index >= TICKER_SYMBOLS.length;
              const live = liveQuotes[item.proName];
              // Offline/pre-fetch: fall back to the static reference value and
              // disclose it as such — it must never read as live market data.
              const isReference = !live;
              const displayPrice = live ? live.price : item.defaultPrice;
              const displayChangePercent = live ? live.changePercent : item.defaultChangePercent;
              const isPositive = live ? live.isPositive : item.isPositive;
              const flashClass = flashItems[item.proName] ? `flash-${flashItems[item.proName]}` : "";

              return (
                <div
                  key={`${item.proName}-${index}`}
                  className={`tv-ticker-item ${isItemHovered ? "is-hovered" : ""} ${flashClass}`}
                  onMouseEnter={() => handleMouseEnter(item)}
                  onMouseLeave={() => handleMouseLeave(item)}
                  onClick={() => openChartModal(item)}
                  title={`${item.title} (${item.proName}) - ホバーまたはクリックでチャート表示`}
                  role={isDuplicate ? undefined : "button"}
                  tabIndex={isDuplicate ? -1 : 0}
                  aria-hidden={isDuplicate ? true : undefined}
                  onKeyDown={(e) => {
                    if (isDuplicate) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openChartModal(item);
                    }
                  }}
                >
                  <span className="tv-ticker-emoji" aria-hidden="true" style={{ fontSize: 13 }}>
                    {item.emoji}
                  </span>
                  <span className="tv-ticker-symbol-title">{item.title}</span>
                  <span
                    className={`tv-ticker-price mono${isReference ? " is-reference" : ""}`}
                    title={
                      isReference
                        ? "参考値(固定表示)です。最新価格はTradingViewチャートで確認できます。クリックまたはホバーでチャート表示"
                        : "市場価格(最新ディレイ含む)。クリックまたはホバーでチャート表示"
                    }
                  >
                    {displayPrice}
                    {isReference && (
                      <span className="tv-ticker-ref-suffix" aria-hidden="true">
                        (参考)
                      </span>
                    )}
                    <span className="sr-only">{isReference ? "(参考値・固定表示)" : ""}</span>
                  </span>
                  <span
                    className={`tv-ticker-change mono ${isPositive ? "positive" : "negative"}`}
                  >
                    {isPositive ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                    {displayChangePercent}
                  </span>

                  {/* Subtle hover progress indicator countdown */}
                  <div
                    className="tv-ticker-hover-progress"
                    style={{
                      width: isItemHovered ? "100%" : "0%",
                      transitionDuration: isItemHovered ? `${HOVER_TRIGGER_DELAY_MS}ms` : "0s",
                    }}
                  />
                </div>
              );
            })}
          </div>

          {/* Right edge: Official TradingView indicator / credit with Live Status */}
          <div
            style={{
              position: "absolute",
              right: 0,
              top: 0,
              bottom: 0,
              background: "linear-gradient(90deg, transparent, rgba(10, 15, 25, 0.95) 30%)",
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 12px 0 24px",
              zIndex: 2,
              pointerEvents: "none",
            }}
          >
            <div
              className="tv-live-badge"
              title={
                isLive
                  ? isTseMarketOpen()
                    ? "市場実データ受信中 (東証取引時間中: 60秒間隔で自動更新)"
                    : "市場実データ受信中 (取引時間外: 15分間隔で自動更新)"
                  : "実データ未受信のため参考値(固定表示)を表示中"
              }
            >
              <span className="tv-live-dot" aria-hidden="true" />
              <span>{isLive ? "LIVE" : "参考値"}</span>
            </div>

            <a
              href="https://jp.tradingview.com/"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                pointerEvents: "auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                textDecoration: "none",
                fontSize: 10,
                color: "var(--text-secondary)",
                padding: "2px 6px",
                borderRadius: 4,
                background: "rgba(255, 255, 255, 0.05)",
                border: "1px solid var(--border-subtle)",
              }}
              title="TradingView Charts & Market Data"
            >
              <span style={{ fontWeight: 700, color: "var(--accent-text)", letterSpacing: 0.5 }}>
                TV
              </span>
              <span className="tiny mono" style={{ fontSize: 9 }}>Charts</span>
            </a>
          </div>
        </div>
      </div>

      {/* Chart Popover Modal */}
      <TradingViewChartModal
        symbol={activePopupSymbol}
        onClose={handleCloseModal}
      />
    </>
  );
}
