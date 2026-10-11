import React, { useState } from "react";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { UPCOMING_EVENTS } from "../lib/marketDataService";
import type { PageView } from "../lib/navigation";

interface CalendarPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
}

export function CalendarPage({
  onNavigate,
  onOpenStockDetail,
}: CalendarPageProps) {
  const [activeFilter, setActiveFilter] = useState<"ALL" | "MACRO" | "EARNINGS">("ALL");

  const filteredEvents =
    activeFilter === "ALL"
      ? UPCOMING_EVENTS
      : UPCOMING_EVENTS.filter((e) => e.type === activeFilter);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container calendar-page"
      style={{ maxWidth: "1280px", margin: "0 auto", padding: "16px 20px 48px" }}
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
          <h2 style={{ fontSize: "1.65rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
            決算・マクロ経済イベントカレンダー
          </h2>
          <p className="muted tiny" style={{ margin: "4px 0 0" }}>
            日銀金融政策決定会合、FOMC、米雇用統計、および国内主要企業の決算発表スケジュール
          </p>
        </div>

        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
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
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {filteredEvents.map((evt) => {
            const isMacro = evt.type === "MACRO";
            return (
              <div
                key={evt.id}
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
                  cursor: evt.ticker ? "pointer" : "default",
                  transition: "border-color 0.15s ease",
                }}
                onClick={() => {
                  if (evt.ticker) {
                    onOpenStockDetail(evt.ticker);
                  }
                }}
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
      </div>
    </motion.div>
  );
}
