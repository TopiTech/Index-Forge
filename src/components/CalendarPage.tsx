import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ArrowRight,
  Calendar as CalendarIcon,
  RefreshCw,
  Download,
  Search,
  List,
  Grid,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  X,
  FileSpreadsheet,
} from "lucide-react";
import {
  fetchUpcomingEvents,
  UPCOMING_EVENTS,
  exportCalendarToIcs,
  exportCalendarToCsv,
  type CalendarEvent,
} from "../lib/marketDataService";
import { normalizeSearchQuery, getUniverseStockByTicker } from "../data/stockUniverse";
import { detectStockCurrency } from "../lib/currency";
import { toSafeDownloadFileName } from "../lib/downloadFileName";
import { ModalBase } from "./ModalBase";
import { useToast } from "./Toast";
import type { PageView } from "../lib/navigation";
import { useRegisterFreshness } from "../contexts/FreshnessContext";

interface CalendarPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
}

export function getEventDayOfWeek(dateStr: string, fullDate?: string): string {
  const days = ["日", "月", "火", "水", "木", "金", "土"];
  const target = fullDate || dateStr;
  if (target) {
    const fullMatch = target.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (fullMatch) {
      const y = parseInt(fullMatch[1], 10);
      const m = parseInt(fullMatch[2], 10);
      const d = parseInt(fullMatch[3], 10);
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
  const shortMatch = dateStr.match(/^(\d{1,2})[-/](\d{1,2})$/);
  if (shortMatch) {
    const m = parseInt(shortMatch[1], 10);
    const d = parseInt(shortMatch[2], 10);
    if (!isNaN(m) && !isNaN(d) && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
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
      if (!isNaN(dateObj.getTime()) && dateObj.getMonth() === m - 1) {
        return days[dateObj.getDay()] || "";
      }
    }
  }
  return "";
}

export function CalendarPage({
  onNavigate,
  onOpenStockDetail,
}: CalendarPageProps) {
  const [events, setEvents] = useState<CalendarEvent[]>(UPCOMING_EVENTS);
  const [loading, setLoading] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(() => Date.now());
  const [activeFilter, setActiveFilter] = useState<"ALL" | "MACRO" | "EARNINGS">("ALL");

  useRegisterFreshness("calendar", {
    loading,
    updatedAt: lastUpdatedAt,
    typeLabel: "経済カレンダー",
  });
  const [importanceFilter, setImportanceFilter] = useState<"ALL" | "HIGH" | "MEDIUM">("ALL");
  const [marketFilter, setMarketFilter] = useState<"ALL" | "JP" | "US">("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"LIST" | "CALENDAR">("LIST");
  const [currentMonthDate, setCurrentMonthDate] = useState(() => new Date());
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [selectedDayOverview, setSelectedDayOverview] = useState<{
    dateStr: string;
    fullDate?: string;
    events: CalendarEvent[];
  } | null>(null);

  const { success: toastSuccess, info: toastInfo } = useToast();

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
        setLastUpdatedAt(Date.now());
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

  // Multi-axis filtering & text search
  const filteredEvents = useMemo(() => {
    const rawQ = searchQuery.trim().toLowerCase();
    const normQ = normalizeSearchQuery(searchQuery);
    const tokens = normQ ? normQ.split(/\s+/).filter(Boolean) : [];

    return events.filter((e) => {
      if (activeFilter !== "ALL" && e.type !== activeFilter) return false;
      if (importanceFilter !== "ALL" && e.importance !== importanceFilter) return false;
      if (marketFilter !== "ALL") {
        const isUS =
          e.market === "US" ||
          (e.ticker ? detectStockCurrency(e.ticker, e.market) === "USD" : false);
        if (marketFilter === "US" && !isUS) return false;
        if (marketFilter === "JP" && isUS) return false;
      }
      if (rawQ) {
        const uStock = e.ticker ? getUniverseStockByTicker(e.ticker) : undefined;
        const titleNorm = normalizeSearchQuery(e.title);
        const titleLower = e.title.toLowerCase();
        const tickerUpper = e.ticker ? e.ticker.toUpperCase() : "";
        const tickerLower = e.ticker ? e.ticker.toLowerCase() : "";
        const compNorm = e.companyName ? normalizeSearchQuery(e.companyName) : "";
        const compLower = e.companyName ? e.companyName.toLowerCase() : "";
        const descNorm = e.description ? normalizeSearchQuery(e.description) : "";
        const descLower = e.description ? e.description.toLowerCase() : "";
        const aliasesNorm = uStock?.normAliases || "";
        const aliasesRaw = uStock?.rawAliasesLower || (uStock?.aliases ? uStock.aliases.toLowerCase() : "");

        const matchesToken = (tok: string): boolean => {
          const tokUpper = tok.toUpperCase();
          const tokLower = tok.toLowerCase();
          return (
            (tickerUpper.length > 0 &&
              (tickerUpper === tokUpper || tickerUpper.includes(tokUpper) || tickerLower.includes(tokLower))) ||
            titleNorm.includes(tok) ||
            titleLower.includes(tokLower) ||
            compNorm.includes(tok) ||
            compLower.includes(tokLower) ||
            descNorm.includes(tok) ||
            descLower.includes(tokLower) ||
            aliasesNorm.includes(tok) ||
            aliasesRaw.includes(tokLower)
          );
        };

        if (tokens.length > 1) {
          if (!tokens.every(matchesToken)) return false;
        } else {
          const match =
            (tickerUpper.length > 0 &&
              (tickerUpper.includes(normQ.toUpperCase()) || tickerLower.includes(rawQ))) ||
            titleNorm.includes(normQ) ||
            titleLower.includes(rawQ) ||
            compNorm.includes(normQ) ||
            compLower.includes(rawQ) ||
            descNorm.includes(normQ) ||
            descLower.includes(rawQ) ||
            aliasesNorm.includes(normQ) ||
            aliasesRaw.includes(rawQ);
          if (!match) return false;
        }
      }
      return true;
    });
  }, [events, activeFilter, importanceFilter, marketFilter, searchQuery]);

  // Export handlers
  const handleExportIcs = () => {
    if (filteredEvents.length === 0) {
      toastInfo("エクスポート対象のイベントがありません");
      return;
    }
    const icsContent = exportCalendarToIcs(filteredEvents);
    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    a.href = url;
    a.download = toSafeDownloadFileName(`indexforge_calendar_${dStr}.ics`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toastSuccess("カレンダー (.ics) をダウンロードしました");
  };

  const handleExportCsv = () => {
    if (filteredEvents.length === 0) {
      toastInfo("エクスポート対象のイベントがありません");
      return;
    }
    const csvContent = exportCalendarToCsv(filteredEvents);
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const d = new Date();
    const dStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    a.href = url;
    a.download = toSafeDownloadFileName(`indexforge_calendar_${dStr}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toastSuccess(`${filteredEvents.length}件のイベントをCSVエクスポートしました`);
  };

  // Month Calendar Navigation & Grid Generation
  const viewYear = currentMonthDate.getFullYear();
  const viewMonth = currentMonthDate.getMonth(); // 0-indexed

  const handlePrevMonth = () => {
    setCurrentMonthDate(new Date(viewYear, viewMonth - 1, 1));
  };
  const handleNextMonth = () => {
    setCurrentMonthDate(new Date(viewYear, viewMonth + 1, 1));
  };
  const handleTodayMonth = () => {
    setCurrentMonthDate(new Date());
  };

  const calendarGrid = useMemo(() => {
    const firstDayOfMonth = new Date(viewYear, viewMonth, 1);
    const startDayOfWeek = (firstDayOfMonth.getDay() + 6) % 7; // 0 = Mon, 6 = Sun
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

    const totalCells = Math.ceil((startDayOfWeek + daysInMonth) / 7) * 7;
    const cells = [];

    const pad = (n: number) => String(n).padStart(2, "0");
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;

    for (let i = 0; i < totalCells; i++) {
      let cellYear = viewYear;
      let cellMonth = viewMonth;
      let cellDay = 1;
      let isCurrentMonth = true;

      if (i < startDayOfWeek) {
        // Prev month
        cellMonth = viewMonth - 1;
        if (cellMonth < 0) {
          cellMonth = 11;
          cellYear -= 1;
        }
        cellDay = daysInPrevMonth - startDayOfWeek + i + 1;
        isCurrentMonth = false;
      } else if (i >= startDayOfWeek + daysInMonth) {
        // Next month
        cellMonth = viewMonth + 1;
        if (cellMonth > 11) {
          cellMonth = 0;
          cellYear += 1;
        }
        cellDay = i - (startDayOfWeek + daysInMonth) + 1;
        isCurrentMonth = false;
      } else {
        // Current month
        cellDay = i - startDayOfWeek + 1;
        isCurrentMonth = true;
      }

      const dateKeyFull = `${cellYear}-${pad(cellMonth + 1)}-${pad(cellDay)}`;
      const dateKeyShort = `${pad(cellMonth + 1)}/${pad(cellDay)}`;
      const isToday = dateKeyFull === todayStr;

      // Find events matching this date
      const cellEvents = filteredEvents.filter((e) => {
        if (e.fullDate) {
          return e.fullDate.startsWith(dateKeyFull);
        }
        if (!e.date) return false;
        if (
          e.date.startsWith(dateKeyFull) ||
          e.date.replace(/\//g, "-").startsWith(dateKeyFull)
        ) {
          return true;
        }
        const parts = e.date.trim().split(/[-/]/);
        if (parts.length === 3) {
          const yNum = parseInt(parts[0], 10);
          const mNum = parseInt(parts[1], 10);
          const dNum = parseInt(parts[2], 10);
          if (!Number.isNaN(yNum) && !Number.isNaN(mNum) && !Number.isNaN(dNum)) {
            return `${yNum}-${pad(mNum)}-${pad(dNum)}` === dateKeyFull;
          }
        }
        if (parts.length !== 2) return false;
        const mNum = parseInt(parts[0], 10);
        const dNum = parseInt(parts[1], 10);
        if (Number.isNaN(mNum) || Number.isNaN(dNum)) return false;
        const normalizedShort = `${pad(mNum)}/${pad(dNum)}`;
        if (normalizedShort !== dateKeyShort) return false;

        let eventYear = today.getFullYear();
        const currentMonth = today.getMonth() + 1;
        if (mNum < currentMonth && currentMonth - mNum >= 6) {
          eventYear += 1;
        } else if (mNum > currentMonth && mNum - currentMonth >= 6) {
          eventYear -= 1;
        }
        return cellYear === eventYear;
      });

      cells.push({
        year: cellYear,
        month: cellMonth,
        day: cellDay,
        isCurrentMonth,
        isToday,
        dateKeyFull,
        events: cellEvents,
      });
    }

    return cells;
  }, [viewYear, viewMonth, filteredEvents]);

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

        {/* Global Toolbar Controls */}
        <div className="calendar-header-actions" style={{ display: "flex", gap: "8px", flexWrap: "wrap", alignItems: "center" }}>
          {/* Dual View Toggle */}
          <div
            role="group"
            aria-label="表示形式切り替え"
            style={{
              display: "flex",
              background: "var(--surface-control)",
              borderRadius: "20px",
              padding: "2px",
              border: "1px solid var(--border-subtle)",
            }}
          >
            <button
              type="button"
              className={`btn btn-xs ${viewMode === "LIST" ? "btn-accent" : "btn-ghost"}`}
              style={{ borderRadius: "18px", padding: "4px 12px", border: "none" }}
              onClick={() => setViewMode("LIST")}
              aria-pressed={viewMode === "LIST"}
              title="リストタイムライン表示"
            >
              <List size={13} style={{ marginRight: 4 }} />
              <span>リスト表示</span>
            </button>
            <button
              type="button"
              className={`btn btn-xs ${viewMode === "CALENDAR" ? "btn-accent" : "btn-ghost"}`}
              style={{ borderRadius: "18px", padding: "4px 12px", border: "none" }}
              onClick={() => setViewMode("CALENDAR")}
              aria-pressed={viewMode === "CALENDAR"}
              title="月間カレンダーグリッド表示"
            >
              <Grid size={13} style={{ marginRight: 4 }} />
              <span>月間表示</span>
            </button>
          </div>

          {/* Refresh Button */}
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

          {/* Export Dropdown / Action Buttons */}
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={handleExportIcs}
            disabled={filteredEvents.length === 0}
            title={
              filteredEvents.length === 0
                ? "エクスポート対象のイベントがありません"
                : "iCalendar (.ics) ファイルをダウンロードして各種カレンダーアプリに追加"
            }
            style={{ borderRadius: "20px", padding: "5px 12px" }}
          >
            <Download size={12} />
            <span>.ICS 保存</span>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={handleExportCsv}
            disabled={filteredEvents.length === 0}
            title={
              filteredEvents.length === 0
                ? "エクスポート対象のイベントがありません"
                : "Excel対応のCSV形式でダウンロード"
            }
            style={{ borderRadius: "20px", padding: "5px 12px" }}
          >
            <FileSpreadsheet size={12} />
            <span>CSV 保存</span>
          </button>

          {/* Navigate to Market */}
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

      {/* Filter and Search Bar */}
      <div
        className="card calendar-filter-bar"
        style={{
          padding: "14px 18px",
          marginBottom: "16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "12px",
          background: "var(--bg-card)",
        }}
      >
        {/* Category Tabs */}
        <div
          role="group"
          aria-label="イベント種別フィルター"
          style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}
        >
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
        </div>

        {/* Secondary Filters & Search Bar */}
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          {/* Market Region Filter */}
          <select
            value={marketFilter}
            onChange={(e) => setMarketFilter(e.target.value as "ALL" | "JP" | "US")}
            className="input input-sm"
            aria-label="市場・地域フィルター"
            style={{ borderRadius: "16px", padding: "4px 10px", fontSize: "0.82rem" }}
          >
            <option value="ALL">全市場・地域</option>
            <option value="JP">国内東証 (TSE)</option>
            <option value="US">米国市場 (US)</option>
          </select>

          {/* Importance Filter */}
          <select
            value={importanceFilter}
            onChange={(e) => setImportanceFilter(e.target.value as "ALL" | "HIGH" | "MEDIUM")}
            className="input input-sm"
            aria-label="重要度フィルター"
            style={{ borderRadius: "16px", padding: "4px 10px", fontSize: "0.82rem" }}
          >
            <option value="ALL">全重要度</option>
            <option value="HIGH">最重要 (HIGH)</option>
            <option value="MEDIUM">標準以上 (MEDIUM+)</option>
          </select>

          {/* Search Box */}
          <div style={{ position: "relative", minWidth: "180px" }}>
            <Search
              size={13}
              style={{
                position: "absolute",
                left: "10px",
                top: "50%",
                transform: "translateY(-50%)",
                color: "var(--text-muted)",
              }}
            />
            <input
              type="text"
              aria-label="イベント・銘柄名検索"
              className="input input-sm"
              placeholder="イベント・銘柄名検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                paddingLeft: "30px",
                borderRadius: "16px",
                width: "100%",
                fontSize: "0.82rem",
              }}
            />
            {searchQuery && (
              <button
                type="button"
                aria-label="検索キーワードを消去"
                onClick={() => setSearchQuery("")}
                style={{
                  position: "absolute",
                  right: "8px",
                  top: "50%",
                  transform: "translateY(-50%)",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                }}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="card" style={{ padding: "20px" }}>
        {/* Dynamic Fallback Notice */}
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

        {/* Empty State */}
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
              {(() => {
                // 実際に絞り込んでいる条件だけを列挙する。ALL 選択時に
                // 「決算発表」と断定する旧メッセージは誤案内だった。
                const activeLabels = [
                  activeFilter === "MACRO"
                    ? "マクロ・中央銀行"
                    : activeFilter === "EARNINGS"
                      ? "主要企業決算"
                      : null,
                  importanceFilter === "HIGH"
                    ? "最重要 (HIGH)"
                    : importanceFilter === "MEDIUM"
                      ? "標準以上 (MEDIUM+)"
                      : null,
                  marketFilter === "JP"
                    ? "国内東証 (TSE)"
                    : marketFilter === "US"
                      ? "米国市場 (US)"
                      : null,
                  searchQuery.trim() ? `検索「${searchQuery.trim()}」` : null,
                ].filter((v): v is string => v !== null);
                return activeLabels.length > 0
                  ? `選択中のフィルター条件（${activeLabels.join(" / ")}）に一致する予定はありません。`
                  : "現在の表示条件に一致する予定はありません。";
              })()}
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
        ) : viewMode === "LIST" ? (
          /* List Timeline View */
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {filteredEvents.map((evt) => {
              const isMacro = evt.type === "MACRO";
              const ticker = evt.ticker;
              return (
                <div
                  key={evt.id}
                  className="calendar-event-item"
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
                        {evt.time && (
                          <span className="tiny muted mono" style={{ display: "inline-flex", alignItems: "center", gap: "3px" }}>
                            <Clock size={11} /> {evt.time}
                          </span>
                        )}
                        {evt.market && (
                          <span className="badge badge-default mono tiny">
                            {evt.market === "US" ? "米国" : "国内東証"}
                          </span>
                        )}
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
                      {evt.description && (
                        <p className="tiny muted" style={{ margin: "4px 0 0", lineHeight: 1.4 }}>
                          {evt.description}
                        </p>
                      )}
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", gap: "14px", flexWrap: "wrap" }}>
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
                    {evt.actual && (
                      <div className="tiny muted">
                        結果: <strong className="mono" style={{ color: "#10b981" }}>{evt.actual}</strong>
                      </div>
                    )}

                    <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                      <button
                        type="button"
                        className="btn btn-xs btn-outline"
                        style={{ borderRadius: "14px", padding: "4px 10px" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedEvent(evt);
                        }}
                        onKeyDown={(e) => {
                          e.stopPropagation();
                        }}
                        aria-label={`${evt.title}のイベント詳細を表示`}
                        title="イベントの詳細情報を表示"
                      >
                        詳細
                      </button>

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
                </div>
              );
            })}
          </div>
        ) : (
          /* Month Grid View */
          <div className="calendar-month-container" tabIndex={0} role="region" aria-label="月間カレンダーグリッド">
            {/* Month Header Controller */}
            <div
              className="calendar-month-header"
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "16px",
                padding: "8px 12px",
                background: "var(--surface-control)",
                borderRadius: "8px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <button
                  type="button"
                  className="btn btn-xs btn-outline"
                  onClick={handlePrevMonth}
                  title="前月へ"
                >
                  <ChevronLeft size={14} />
                  <span>前月</span>
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-outline"
                  onClick={handleTodayMonth}
                  title="当月へジャンプ"
                >
                  今月
                </button>
                <button
                  type="button"
                  className="btn btn-xs btn-outline"
                  onClick={handleNextMonth}
                  title="翌月へ"
                >
                  <span>翌月</span>
                  <ChevronRight size={14} />
                </button>
              </div>

              <div style={{ fontSize: "1.2rem", fontWeight: 700 }} className="mono">
                {viewYear}年 {viewMonth + 1}月
              </div>

              <div className="tiny muted mono">
                該当イベント: {filteredEvents.length}件
              </div>
            </div>

            {/* Weekday Header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: "6px",
                marginBottom: "6px",
                textAlign: "center",
                fontWeight: 600,
                fontSize: "0.85rem",
              }}
            >
              {["月", "火", "水", "木", "金", "土", "日"].map((dayName, idx) => (
                <div
                  key={dayName}
                  style={{
                    padding: "6px 0",
                    color: idx === 5 ? "#38bdf8" : idx === 6 ? "#f43f5e" : "var(--text-secondary)",
                  }}
                >
                  {dayName}
                </div>
              ))}
            </div>

            {/* Calendar Month Grid */}
            <div
              className="calendar-month-grid"
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(7, 1fr)",
                gap: "6px",
              }}
            >
              {calendarGrid.map((cell) => {
                return (
                  <div
                    key={cell.dateKeyFull}
                    style={{
                      minHeight: "88px",
                      padding: "6px 8px",
                      borderRadius: "6px",
                      background: cell.isCurrentMonth
                        ? cell.isToday
                          ? "rgba(56, 189, 248, 0.08)"
                          : "var(--bg-card-hover)"
                        : "rgba(0, 0, 0, 0.15)",
                      border: cell.isToday
                        ? "1px solid var(--accent-border)"
                        : "1px solid var(--border-subtle)",
                      opacity: cell.isCurrentMonth ? 1 : 0.45,
                      display: "flex",
                      flexDirection: "column",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "4px",
                      }}
                    >
                      <span
                        className="mono bold"
                        style={{
                          fontSize: "0.85rem",
                          color: cell.isToday ? "var(--neon-cyan)" : "var(--text-primary)",
                        }}
                      >
                        {cell.day}
                      </span>
                      {cell.isToday && (
                        <span className="badge badge-accent mono" style={{ fontSize: "0.6rem", padding: "1px 4px" }}>
                          TODAY
                        </span>
                      )}
                    </div>

                    {/* Cell Event Badges */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "3px", flex: 1 }}>
                      {cell.events.slice(0, 3).map((evt) => {
                        const isMacro = evt.type === "MACRO";
                        return (
                          <div
                            key={evt.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedEvent(evt)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                setSelectedEvent(evt);
                              }
                            }}
                            title={`${evt.title} (${evt.importance}重要度)`}
                            aria-label={`${evt.title} (${evt.importance}重要度) の詳細を表示`}
                            style={{
                              padding: "2px 5px",
                              borderRadius: "4px",
                              fontSize: "0.68rem",
                              lineHeight: 1.2,
                              whiteSpace: "nowrap",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              cursor: "pointer",
                              background: isMacro ? "rgba(56, 189, 248, 0.15)" : "rgba(16, 185, 129, 0.15)",
                              color: isMacro ? "var(--neon-cyan)" : "var(--neon-green)",
                              border: `1px solid ${isMacro ? "rgba(56, 189, 248, 0.3)" : "rgba(16, 185, 129, 0.3)"}`,
                            }}
                          >
                            {evt.ticker ? `[${evt.ticker}] ` : ""}
                            {evt.title}
                          </div>
                        );
                      })}
                      {cell.events.length > 3 && (
                        <button
                          type="button"
                          className="calendar-more-events-btn tiny mono"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedDayOverview({
                              dateStr: `${cell.day}日`,
                              fullDate: cell.dateKeyFull,
                              events: cell.events,
                            });
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setSelectedDayOverview({
                                dateStr: `${cell.day}日`,
                                fullDate: cell.dateKeyFull,
                                events: cell.events,
                              });
                            }
                          }}
                          aria-label={`${cell.day}日のすべてのイベント (${cell.events.length}件) を表示`}
                          style={{
                            border: "none",
                            background: "rgba(0, 229, 255, 0.12)",
                            color: "var(--neon-cyan)",
                            borderRadius: "4px",
                            padding: "2px 4px",
                            fontSize: "0.65rem",
                            textAlign: "center",
                            cursor: "pointer",
                            width: "100%",
                            fontWeight: 600,
                          }}
                        >
                          +{cell.events.length - 3}件を表示
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Event Detail Modal */}
      {selectedEvent && (
        <ModalBase
          isOpen={Boolean(selectedEvent)}
          onClose={() => setSelectedEvent(null)}
          ariaLabel="イベント詳細"
          title={
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <CalendarIcon size={18} style={{ color: "var(--accent-text)" }} />
              <span>イベント詳細</span>
            </div>
          }
          maxWidth={500}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            {/* Header info */}
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
                <span className={`badge ${selectedEvent.type === "MACRO" ? "badge-accent" : "badge-success"} mono tiny`}>
                  {selectedEvent.type === "MACRO" ? "マクロ経済指標" : "企業決算"}
                </span>
                <span className="badge badge-default mono tiny">
                  {selectedEvent.importance} 重要度
                </span>
                {selectedEvent.market && (
                  <span className="badge badge-default mono tiny">
                    {selectedEvent.market === "US" ? "米国市場" : "国内東証"}
                  </span>
                )}
                {selectedEvent.source === "fallback" && (
                  <span className="badge badge-warning mono tiny">参考値 (推計)</span>
                )}
              </div>
              <h3 style={{ fontSize: "1.2rem", fontWeight: 700, margin: "4px 0" }}>
                {selectedEvent.title}
              </h3>
              {selectedEvent.companyName && (
                <div className="tiny muted">{selectedEvent.companyName}</div>
              )}
            </div>

            {/* Schedule Details */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "10px",
                padding: "12px",
                background: "var(--surface-control)",
                borderRadius: "8px",
              }}
            >
              <div>
                <span className="tiny muted mono block">日程</span>
                <strong className="mono" style={{ fontSize: "0.95rem" }}>
                  {selectedEvent.fullDate || selectedEvent.date}{" "}
                  {getEventDayOfWeek(selectedEvent.date, selectedEvent.fullDate) && `(${getEventDayOfWeek(selectedEvent.date, selectedEvent.fullDate)})`}
                </strong>
              </div>
              <div>
                <span className="tiny muted mono block">発表予定時刻</span>
                <strong className="mono" style={{ fontSize: "0.95rem" }}>
                  {selectedEvent.time || "未定"}
                </strong>
              </div>
            </div>

            {/* Estimates & Forecasts */}
            {(selectedEvent.forecast || selectedEvent.previous || selectedEvent.actual) && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, 1fr)",
                  gap: "10px",
                  padding: "12px",
                  background: "var(--surface-control)",
                  borderRadius: "8px",
                  textAlign: "center",
                }}
              >
                <div>
                  <span className="tiny muted mono block">前回値</span>
                  <div className="mono bold" style={{ fontSize: "1.1rem" }}>
                    {selectedEvent.previous || "--"}
                  </div>
                </div>
                <div>
                  <span className="tiny muted mono block">市場予想</span>
                  <div className="mono bold" style={{ fontSize: "1.1rem", color: "var(--accent-text)" }}>
                    {selectedEvent.forecast || "--"}
                  </div>
                </div>
                <div>
                  <span className="tiny muted mono block">発表結果</span>
                  <div className="mono bold" style={{ fontSize: "1.1rem", color: "#10b981" }}>
                    {selectedEvent.actual || "--"}
                  </div>
                </div>
              </div>
            )}

            {/* Description / Summary */}
            {selectedEvent.description && (
              <div>
                <span className="tiny muted mono block" style={{ marginBottom: "4px" }}>
                  イベント概要・市場の注目点
                </span>
                <p style={{ margin: 0, fontSize: "0.9rem", lineHeight: 1.5, color: "var(--text-secondary)" }}>
                  {selectedEvent.description}
                </p>
              </div>
            )}

            {/* Action buttons */}
            <div
              style={{
                display: "flex",
                justifyContent: "flex-end",
                gap: "8px",
                marginTop: "12px",
                paddingTop: "12px",
                borderTop: "1px solid var(--border-subtle)",
              }}
            >
              <button
                type="button"
                className="btn btn-sm btn-outline"
                onClick={() => {
                  const singleIcs = exportCalendarToIcs([selectedEvent]);
                  const blob = new Blob([singleIcs], { type: "text/calendar;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = toSafeDownloadFileName(`event_${selectedEvent.id}.ics`);
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
              >
                <Download size={13} />
                <span>カレンダーに追加 (.ics)</span>
              </button>

              {selectedEvent.ticker && (
                <button
                  type="button"
                  className="btn btn-sm btn-accent"
                  onClick={() => {
                    const t = selectedEvent.ticker!;
                    setSelectedEvent(null);
                    onOpenStockDetail(t);
                  }}
                >
                  <ExternalLink size={13} />
                  <span>銘柄詳細分析へ</span>
                </button>
              )}
            </div>
          </div>
        </ModalBase>
      )}

      {/* Day Events Overview Modal */}
      {selectedDayOverview && (
        <ModalBase
          isOpen={Boolean(selectedDayOverview)}
          onClose={() => setSelectedDayOverview(null)}
          ariaLabel={`${selectedDayOverview.fullDate || selectedDayOverview.dateStr} のイベント一覧 (${selectedDayOverview.events.length}件)`}
          title={
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <CalendarIcon size={18} style={{ color: "var(--accent-text)" }} />
              <span>
                {selectedDayOverview.fullDate || selectedDayOverview.dateStr}
                {getEventDayOfWeek(selectedDayOverview.dateStr, selectedDayOverview.fullDate)
                  ? ` (${getEventDayOfWeek(selectedDayOverview.dateStr, selectedDayOverview.fullDate)})`
                  : ""}{" "}
                のイベント一覧 ({selectedDayOverview.events.length}件)
              </span>
            </div>
          }
          maxWidth={560}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              maxHeight: "60vh",
              overflowY: "auto",
              paddingRight: "4px",
            }}
          >
            {selectedDayOverview.events.map((evt) => {
              const isMacro = evt.type === "MACRO";
              return (
                <div
                  key={evt.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setSelectedDayOverview(null);
                    setSelectedEvent(evt);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedDayOverview(null);
                      setSelectedEvent(evt);
                    }
                  }}
                  aria-label={`${evt.title} の詳細を表示`}
                  style={{
                    padding: "12px",
                    borderRadius: "8px",
                    background: "var(--bg-card-hover)",
                    border: `1px solid ${isMacro ? "rgba(56, 189, 248, 0.3)" : "rgba(16, 185, 129, 0.3)"}`,
                    cursor: "pointer",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "10px",
                    transition: "border-color 0.15s ease",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        marginBottom: "4px",
                        flexWrap: "wrap",
                      }}
                    >
                      <span
                        className={`badge ${isMacro ? "badge-accent" : "badge-success"} mono tiny`}
                      >
                        {isMacro ? "マクロ指標" : "企業決算"}
                      </span>
                      <span className="badge badge-default mono tiny">{evt.importance}</span>
                      {evt.time && <span className="tiny muted mono">{evt.time}</span>}
                      {evt.ticker && (
                        <span className="badge badge-accent mono tiny">{evt.ticker}</span>
                      )}
                      {evt.source === "fallback" && (
                        <span className="badge badge-warning mono tiny">参考値</span>
                      )}
                    </div>
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: "0.9rem",
                        color: "var(--text-primary)",
                      }}
                    >
                      {evt.title}
                    </div>
                    {evt.companyName && (
                      <div className="tiny muted" style={{ marginTop: "2px" }}>
                        {evt.companyName}
                      </div>
                    )}
                  </div>
                  <ChevronRight size={16} className="muted" style={{ flexShrink: 0 }} />
                </div>
              );
            })}
          </div>
        </ModalBase>
      )}
    </motion.div>
  );
}
