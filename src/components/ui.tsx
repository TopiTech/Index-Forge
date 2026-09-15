import type { PropsWithChildren, ReactNode } from "react";
import { Search } from "lucide-react";

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
}: PropsWithChildren<{
  variant?: "cyan" | "magenta" | "green" | "muted";
  className?: string;
  style?: React.CSSProperties;
}>) {
  return <span className={`badge badge-${variant} ${className}`} style={style}>{children}</span>;
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
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel || placeholder}
      />
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
