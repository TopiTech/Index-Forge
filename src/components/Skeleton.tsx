import React from "react";

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  className?: string;
  style?: React.CSSProperties;
}

export function Skeleton({
  width = "100%",
  height = "16px",
  borderRadius = "6px",
  className = "",
  style = {},
}: SkeletonProps) {
  return (
    <div
      className={`skeleton-shimmer ${className}`}
      style={{
        width,
        height,
        borderRadius,
        ...style,
      }}
      aria-hidden="true"
    />
  );
}

interface SkeletonCardProps {
  lines?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function SkeletonCard({ lines = 3, className = "", style = {} }: SkeletonCardProps) {
  return (
    <div
      className={`card ${className}`}
      style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "10px", ...style }}
      role="status"
      aria-live="polite"
      aria-label="コンテンツを読み込み中..."
    >
      <Skeleton height="20px" width="45%" borderRadius="4px" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="14px"
          width={i === lines - 1 ? "60%" : "95%"}
          borderRadius="4px"
        />
      ))}
    </div>
  );
}

interface SkeletonStatGridProps {
  count?: number;
  className?: string;
}

export function SkeletonStatGrid({ count = 4, className = "" }: SkeletonStatGridProps) {
  return (
    <div
      className={`grid-responsive ${className}`}
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(auto-fit, minmax(200px, 1fr))`,
        gap: "12px",
        marginBottom: "16px",
      }}
      role="status"
      aria-live="polite"
      aria-label="主要指標を読み込み中..."
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="card"
          style={{ padding: "14px 16px", display: "flex", flexDirection: "column", gap: "8px" }}
        >
          <Skeleton height="12px" width="40%" />
          <Skeleton height="24px" width="65%" />
          <Skeleton height="10px" width="30%" />
        </div>
      ))}
    </div>
  );
}

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  className?: string;
}

export function SkeletonTable({ rows = 5, columns = 6, className = "" }: SkeletonTableProps) {
  return (
    <div
      className={`table-container ${className}`}
      role="status"
      aria-live="polite"
      aria-label="テーブルデータを読み込み中..."
      style={{ overflow: "hidden" }}
    >
      <table className="custom-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_, i) => (
              <th key={i} style={{ padding: "10px 12px" }}>
                <Skeleton height="14px" width={`${Math.max(40, 80 - i * 8)}%`} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, rIdx) => (
            <tr key={rIdx}>
              {Array.from({ length: columns }).map((_, cIdx) => (
                <td key={cIdx} style={{ padding: "12px" }}>
                  <Skeleton
                    height="16px"
                    width={cIdx === 0 ? "70%" : cIdx === 1 ? "85%" : "60%"}
                  />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface SkeletonChartProps {
  height?: number | string;
  className?: string;
}

export function SkeletonChart({ height = 280, className = "" }: SkeletonChartProps) {
  return (
    <div
      className={`card ${className}`}
      style={{
        padding: "20px",
        height: typeof height === "number" ? `${height}px` : height,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
      }}
      role="status"
      aria-live="polite"
      aria-label="チャートを読み込み中..."
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <Skeleton height="18px" width="35%" />
        <Skeleton height="24px" width="120px" borderRadius="12px" />
      </div>
      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-end",
          gap: "8px",
          padding: "20px 0 10px",
        }}
      >
        {Array.from({ length: 16 }).map((_, i) => {
          const barHeight = 25 + ((i * 17 + 13) % 65);
          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                height: "100%",
              }}
            >
              <Skeleton
                height={`${barHeight}%`}
                width="100%"
                borderRadius="2px"
                style={{ opacity: 0.3 + (i / 16) * 0.7 }}
              />
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <Skeleton height="12px" width="8%" />
        <Skeleton height="12px" width="8%" />
        <Skeleton height="12px" width="8%" />
        <Skeleton height="12px" width="8%" />
      </div>
    </div>
  );
}
