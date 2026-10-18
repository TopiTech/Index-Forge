import { Clock3, Loader2 } from "lucide-react";

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: "Asia/Tokyo",
});

interface DataFreshnessProps {
  benchmarkUpdatedAt?: number | null;
  calculationUpdatedAt?: number | null;
  updatedAt?: number | string | null;
  loading?: boolean;
  syncing?: boolean;
  stale?: boolean;
  /** True when the index calculation reported sync warnings (partial data). */
  hasSyncWarning?: boolean;
  /** Dynamic label for current tab/data type (e.g. "日足終値", "市況サマリー", "銘柄分析") */
  typeLabel?: string;
  /** Optional custom status message */
  customStatusText?: string;
}

export function DataFreshness({
  benchmarkUpdatedAt,
  calculationUpdatedAt,
  updatedAt,
  loading = false,
  syncing = false,
  stale = false,
  hasSyncWarning = false,
  typeLabel = "日足終値",
  customStatusText,
}: DataFreshnessProps) {
  const parsedUpdatedAt =
    typeof updatedAt === "string"
      ? Date.parse(updatedAt)
      : typeof updatedAt === "number" && Number.isFinite(updatedAt) && updatedAt > 0
        ? updatedAt
        : null;

  const validParsedUpdatedAt =
    typeof parsedUpdatedAt === "number" && Number.isFinite(parsedUpdatedAt) && parsedUpdatedAt > 0
      ? parsedUpdatedAt
      : null;

  const timestamps = [benchmarkUpdatedAt, calculationUpdatedAt, validParsedUpdatedAt].filter(
    (timestamp): timestamp is number => typeof timestamp === "number" && Number.isFinite(timestamp) && timestamp > 0,
  );
  const latestUpdatedAt = timestamps.length > 0 ? Math.max(...timestamps) : null;
  const isUpdating = loading || syncing;

  return (
    <div className="data-freshness" role="status" aria-live="polite" aria-label="データ更新状況">
      {isUpdating ? (
        <Loader2 size={13} className="animate-spin" aria-hidden="true" />
      ) : (
        <Clock3 size={13} aria-hidden="true" />
      )}
      {stale ? (
        <span className="provenance-pill provenance-pill-standby" style={{ fontSize: "10px", padding: "1px 6px" }}>
          <span className="pulse-indicator" style={{ width: "4px", height: "4px" }} />
          STANDBY
        </span>
      ) : latestUpdatedAt && !isUpdating ? (
        <span className="provenance-pill provenance-pill-live" style={{ fontSize: "10px", padding: "1px 6px" }}>
          <span className="pulse-indicator" style={{ width: "4px", height: "4px" }} />
          LIVE
        </span>
      ) : null}
      <span className="data-freshness-text">
        {isUpdating
          ? "データ更新中"
          : stale
            ? "最新データを取得できず、古いキャッシュを表示中"
            : latestUpdatedAt
              ? `最終更新 ${dateFormatter.format(new Date(latestUpdatedAt))} JST${hasSyncWarning ? "(一部銘柄の取得に失敗)" : ""}`
              : customStatusText || "最新データ準備完了"}
      </span>
      <span className="data-freshness-type">{typeLabel || "日足終値"}</span>
    </div>
  );
}
