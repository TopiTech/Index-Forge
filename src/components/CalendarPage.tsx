import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion } from "framer-motion";
import { ArrowRight, Calendar as CalendarIcon, RefreshCw } from "lucide-react";
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

export function CalendarPage({
  onNavigate,
  onOpenStockDetail,
}: CalendarPageProps) {
  const [events, setEvents] = useState<CalendarEvent[]>(UPCOMING_EVENTS);
  const [loading, setLoading] = useState(false);
  const [activeFilter, setActiveFilter] = useState<"ALL" | "MACRO" | "EARNINGS">("ALL");

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadEvents = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    try {
      const data = await fetchUpcomingEvents(forceRefresh);
      if (!mountedRef.current) return;
      if (data && data.length > 0) {
        setEvents(data);
      }
    } finally {
      if (mountedRef.current) {
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
                <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                  <div
                    style={{
                      width: "60px",
                      textAlign: "center",
                      padding: "8px 0",
                      background: isMacro ? "rgba(56, 189, 248, 0.1)" : "rgba(16, 185, 129, 0.1)",
                      borderRadius: "8px",
                      border: `1px solid ${isMacro ? "var(--accent-border)" : "rgba(16, 185, 129, 0.3)"}`,
                    }}
                  >
                    <span
                      className="mono bold"
                      style={{ fontSize: "1.1rem", color: isMacro ? "var(--accent-text)" : "#10b981" }}
                    >
                      {evt.date}
                    </span>
                    <div className="tiny muted mono" style={{ fontSize: "0.68rem" }}>
                      {isMacro ? "マクロ" : "決算"}
                    </div>
                  </div>

                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "3px" }}>
                      <span className="badge badge-default mono tiny">{evt.importance} 重要度</span>
                      {evt.ticker && <span className="badge badge-accent mono tiny">{evt.ticker}</span>}
                    </div>
                    <h3 style={{ fontSize: "1.05rem", fontWeight: 600, margin: 0 }}>
                      {evt.title}
                    </h3>
                  </div>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: "20px" }}>
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
