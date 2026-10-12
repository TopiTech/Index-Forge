import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, ArrowRight, Calendar as CalendarIcon, RefreshCw } from "lucide-react";
import {
  fetchUpcomingEvents,
  UPCOMING_EVENTS,
  type CalendarEvent,
} from "../lib/marketDataService";
import type { PageView } from "../lib/navigation";

interface CalendarPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
}

export function getEventDayOfWeek(dateStr: string, fullDate?: string): string {
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  if (fullDate) {
    const match = fullDate.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (match) {
      const y = parseInt(match[1], 10);
      const m = parseInt(match[2], 10);
      const d = parseInt(match[3], 10);
      if (
        !isNaN(y) &&
        !isNaN(m) &&
        !isNaN(d) &&
        m >= 1 &&
        m <= 12 &&
        d >= 1 &&
        d <= 31
      ) {
        const dObj = new Date(y, m - 1, d);
        if (!isNaN(dObj.getTime()) && dObj.getMonth() === m - 1) {
          return days[dObj.getDay()] || "";
        }
      }
    }
  }
  const parts = dateStr.split("/");
  if (parts.length !== 2) return "";
  const m = parseInt(parts[0], 10);
  const d = parseInt(parts[1], 10);
  if (isNaN(m) || isNaN(d) || m < 1 || m > 12 || d < 1 || d > 31) return "";
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();
  let year = currentYear;
  if (m < currentMonth && currentMonth - m >= 6) {
    year = currentYear + 1;
  } else if (m > currentMonth && m - currentMonth >= 6) {
    year = currentYear - 1;
  }
  const dateObj = new Date(year, m - 1, d);
  if (isNaN(dateObj.getTime()) || dateObj.getMonth() !== m - 1) return "";
  return days[dateObj.getDay()] || "";
}

export function CalendarPage({
  onNavigate,
  onOpenStockDetail,
}: CalendarPageProps) {
  const [events, setEvents] = useState<CalendarEvent[]>(UPCOMING_EVENTS);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"ALL" | "MACRO" | "EARNINGS">("ALL");

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  const loadEvents = useCallback(async (forceRefresh = false) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const data = await fetchUpcomingEvents(forceRefresh);
      if (!mountedRef.current || requestId !== requestIdRef.current) return;
      if (data && data.length > 0) {
        setEvents(data);
      }
    } finally {
      if (mountedRef.current && requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  const filteredEvents =
    activeFilter === "ALL"
      ? events
      : events.filter((e) => e.type === activeFilter);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container calendar-page"
    >
      {/* Top Banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "20px",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span className="badge badge-accent mono tiny">FINANCIAL CALENDAR</span>
            <span className="tiny muted mono">EARNINGS & MACRO SCHEDULE</span>
          </div>
          <h2 className="page-header-title">決算・マクロ経済イベントカレンダー</h2>
          <p className="muted tiny" style={{ margin: "4px 0 0" }}>
            日銀金融政策決定会合、FOMC、米雇用統計、および国内主要企業の決算発表スケジュール
          </p>
        </div>

        <div
          role="group"
          aria-label="イベント種別フィルター"
          style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}
        >
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => void loadEvents(true)}
            disabled={loading}
            title="最新カレンダーを再取得"
            style={{ borderRadius: "20px", padding: "5px 12px" }}
          >
            <RefreshCw size={12} className={loading ? "spin" : ""} />
            <span>更新</span>
          </button>
          {(
            [
              { id: "ALL", label: "全イベント" },
              { id: "MACRO", label: "マクロ・中央銀行" },
              { id: "EARNINGS", label: "主要企業決算" },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              type="button"
              aria-pressed={activeFilter === tab.id}
              className={`btn btn-sm ${activeFilter === tab.id ? "btn-accent" : "btn-ghost"}`}
              onClick={() => setActiveFilter(tab.id)}
              style={{ borderRadius: "20px", padding: "5px 14px" }}
            >
              {tab.label}
            </button>
          ))}
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => onNavigate("market")}
            title="マーケット概況へ移動"
            style={{ borderRadius: "20px", padding: "5px 14px" }}
          >
            マーケット概況へ
          </button>
        </div>
      </div>

      {/* Events Timeline List */}
      <div className="card" style={{ padding: "20px" }}>
        {events.some((evt) => evt.source === "fallback") && (
          <div
            role="note"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: "12px",
              padding: "10px 14px",
              marginBottom: "16px",
              borderRadius: "8px",
              background: "rgba(245, 158, 11, 0.08)",
              border: "1px solid rgba(245, 158, 11, 0.3)",
              fontSize: "0.85rem",
              color: "var(--text-secondary)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <AlertTriangle size={14} style={{ color: "var(--neon-amber)", flexShrink: 0 }} />
              <span>
                {events.every((evt) => evt.source === "fallback") ? (
                  <>
                    実データの取得に失敗したため、<strong>動的フォールバックデータ</strong>を表示しています。日付・予想値は参考値です。
                  </>
                ) : (
                  <>
                    一部のイベント（「参考値」バッジ付き）は実データ取得不可のため、<strong>動的推計データ</strong>を表示しています。
                  </>
                )}
              </span>
            </div>
            <button
              type="button"
              className="btn btn-xs btn-outline"
              onClick={() => void loadEvents(true)}
              disabled={loading}
              style={{ borderRadius: "14px", padding: "3px 10px", fontSize: "0.75rem" }}
            >
              <RefreshCw size={10} className={loading ? "spin" : ""} style={{ marginRight: "4px" }} />
              <span>再取得</span>
            </button>
          </div>
        )}
        {filteredEvents.length === 0 ? (
          <div
            role="status"
            aria-live="polite"
            style={{
              padding: "48px 20px",
              textAlign: "center",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <CalendarIcon size={40} style={{ color: "var(--text-muted)", opacity: 0.6 }} />
            <div style={{ fontWeight: 600, fontSize: "1rem" }}>
              該当するイベントが見つかりませんでした
            </div>
            <p className="tiny muted" style={{ margin: 0, maxWidth: "360px" }}>
              選択中のフィルター条件（{activeFilter === "MACRO" ? "経済指標" : "決算発表"}）に一致する予定はありません。
            </p>
            <button
              type="button"
              className="btn btn-sm btn-outline"
              onClick={() => setActiveFilter("ALL")}
              style={{ marginTop: "8px" }}
            >
              すべてのイベントを表示
            </button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {filteredEvents.map((evt) => {
              const isMacro = evt.type === "MACRO";
              const ticker = evt.ticker;
              return (
                <div
                  key={evt.id}
                  role={ticker ? "button" : undefined}
                  tabIndex={ticker ? 0 : undefined}
                  aria-label={ticker ? `${evt.title} (${ticker}) の詳細を見る` : undefined}
                  style={{
                    padding: "16px",
                    borderRadius: "10px",
                    background: "var(--bg-card-hover)",
                    border: "1px solid var(--border-subtle)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    flexWrap: "wrap",
                    gap: "14px",
                    cursor: ticker ? "pointer" : "default",
                    transition: "border-color 0.15s ease",
                  }}
                  onClick={() => {
                    if (ticker) {
                      onOpenStockDetail(ticker);
                    }
                  }}
                  onKeyDown={
                    ticker
                      ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          onOpenStockDetail(ticker);
                        }
                      }
                      : undefined
                  }
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        width: "68px",
                        flexShrink: 0,
                        textAlign: "center",
                        padding: "8px 0",
                        background: isMacro ? "rgba(56, 189, 248, 0.1)" : "rgba(16, 185, 129, 0.1)",
                        borderRadius: "8px",
                        border: `1px solid ${isMacro ? "var(--accent-border)" : "rgba(16, 185, 129, 0.3)"}`,
                      }}
                    >
                      <span
                        className="mono bold"
                        style={{ fontSize: "1.05rem", color: isMacro ? "var(--accent-text)" : "#10b981" }}
                      >
                        {evt.date}
                      </span>
                      <div className="tiny muted mono" style={{ fontSize: "0.68rem" }}>
                        {getEventDayOfWeek(evt.date, evt.fullDate) ? `(${getEventDayOfWeek(evt.date, evt.fullDate)}) ` : ""}{isMacro ? "マクロ" : "決算"}
                      </div>
                    </div>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px", flexWrap: "wrap" }}>
                        <span className="badge badge-default mono tiny">{evt.importance} 重要度</span>
                        {evt.ticker && <span className="badge badge-accent mono tiny">{evt.ticker}</span>}
                        {evt.source === "fallback" && (
                          <span
                            className="badge mono tiny"
                            title="このイベントは実データではなく静的フォールバックです"
                            style={{
                              background: "rgba(245, 158, 11, 0.12)",
                              border: "1px solid rgba(245, 158, 11, 0.35)",
                              color: "var(--neon-amber)",
                            }}
                          >
                            参考値
                          </span>
                        )}
                      </div>
                      <h3 style={{ fontSize: "1.05rem", fontWeight: 600, margin: 0, wordBreak: "break-word" }}>
                        {evt.title}
                      </h3>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                    {evt.previous && (
                      <div className="tiny muted">
                        前回: <strong className="mono">{evt.previous}</strong>
                      </div>
                    )}
                    {evt.forecast && (
                      <div className="tiny muted">
                        市場予想: <strong className="mono" style={{ color: "var(--accent-text)" }}>{evt.forecast}</strong>
                      </div>
                    )}
                    {evt.ticker && (
                      <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                        <span className="tiny mono" style={{ color: "var(--accent-text)" }}>
                          銘柄分析
                        </span>
                        <ArrowRight size={14} style={{ color: "var(--accent-text)" }} />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </motion.div>
  );
}
