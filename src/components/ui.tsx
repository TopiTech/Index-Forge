import type { PropsWithChildren, ReactNode } from "react";
import { Search, X } from "lucide-react";

export function Card({
  children,
  className = "",
  style = {},
  role,
}: PropsWithChildren<{ className?: string; style?: React.CSSProperties; role?: React.AriaRole }>) {
  return (
    <div className={`card ${className}`} style={style} role={role}>
      {children}
    </div>
  );
}

export function Badge({
  children,
  variant = "cyan",
  className = "",
  style = {},
  title,
}: PropsWithChildren<{
  variant?: "cyan" | "magenta" | "green" | "muted";
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}>) {
  return (
    <span className={`badge badge-${variant} ${className}`} style={style} title={title}>
      {children}
    </span>
  );
}

export function Tag({
  children,
  variant = "default",
  className = "",
  style = {},
}: PropsWithChildren<{
  variant?: "default" | "cyan" | "theme" | "muted";
  className?: string;
  style?: React.CSSProperties;
}>) {
  const vClass = variant === "theme" ? "tag-theme" : variant === "muted" ? "tag-muted" : "tag";
  return <span className={`${vClass} ${className}`} style={style}>{children}</span>;
}


export function SearchInput({
  value,
  onChange,
  placeholder = "検索...",
  className = "",
  ariaLabel,
}: {
  value: string;
  onChange: (val: string) => void;
  placeholder?: string;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`input-search-wrapper ${className}`}>
      <Search size={15} className="input-search-icon" />
      <input
        type="text"
        className="input-search"
        style={value ? { paddingRight: 32 } : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.stopPropagation();
            onChange("");
          }
        }}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="input-search-clear-btn"
          aria-label="検索キーワードを消去"
          title="検索キーワードを消去"
          style={{
            position: "absolute",
            right: 8,
            top: "50%",
            transform: "translateY(-50%)",
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            transition: "color 0.15s ease",
          }}
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}

export function ButtonGroup<T extends string>({
  items,
  active,
  onChange,
  className = "",
  ariaLabel,
}: {
  items: { label: string; value: T }[];
  active: T;
  onChange: (val: T) => void;
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={`btn-group ${className}`} role="group" aria-label={ariaLabel}>
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          className={`btn-group-item ${active === item.value ? "active" : ""}`}
          onClick={() => onChange(item.value)}
          aria-pressed={active === item.value}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}

export function StatCard({
  label,
  value,
  sub,
  trend,
  icon,
  active = false,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  trend?: { text: string; type: "positive" | "negative" | "neutral" };
  icon?: ReactNode;
  active?: boolean;
}) {
  return (
    <div className={`stat-card ${active ? "active-accent" : ""}`}>
      <div className="stat-header">
        <div className="stat-label">{label}</div>
        {icon && <div className="stat-icon-wrapper">{icon}</div>}
      </div>
      <div className="stat-value-main">{value}</div>
      {(sub || trend) && (
        <div className="stat-sub-row">
          {trend && (
            <span className={`badge-trend ${trend.type}`}>
              {trend.text}
            </span>
          )}
          {sub && <span className="muted tiny">{sub}</span>}
        </div>
      )}
    </div>
  );
}

export function MiniStatCard({
  label,
  value,
  valueColor,
  sub,
  className = "",
}: {
  label: string;
  value: ReactNode;
  valueColor?: string;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mini-stat-card ${className}`}>
      <div className="mini-stat-label">{label}</div>
      <div className="mini-stat-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {sub && <div className="mini-stat-sub">{sub}</div>}
    </div>
  );
}
