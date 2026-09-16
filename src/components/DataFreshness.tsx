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
  loading?: boolean;
  syncing?: boolean;
  stale?: boolean;
  /** True when the index calculation reported sync warnings (partial data). */
  hasSyncWarning?: boolean;
}

export function DataFreshness({
  benchmarkUpdatedAt,
  calculationUpdatedAt,
  loading = false,
  syncing = false,
  stale = false,
  hasSyncWarning = false,
}: DataFreshnessProps) {
  const timestamps = [benchmarkUpdatedAt, calculationUpdatedAt].filter(
    (timestamp): timestamp is number => typeof timestamp === "number" && Number.isFinite(timestamp),
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
      <span>
        {isUpdating
          ? "データ更新中"
          : stale
            ? "最新データを取得できず、古いキャッシュを表示中"
            : latestUpdatedAt
              ? `最終更新 ${dateFormatter.format(new Date(latestUpdatedAt))} JST${hasSyncWarning ? "(一部銘柄の取得に失敗)" : ""}`
              : "更新情報を取得中"}
      </span>
      <span className="data-freshness-type">日足終値</span>
    </div>
  );
}
