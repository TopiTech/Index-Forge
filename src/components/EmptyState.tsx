import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

interface EmptyStateProps {
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
  icon?: ReactNode;
  compact?: boolean;
  children?: ReactNode;
}

export function EmptyState({
  title,
  description,
  actionLabel,
  onAction,
  secondaryActionLabel,
  onSecondaryAction,
  icon = <Inbox size={22} />,
  compact = false,
  children,
}: EmptyStateProps) {
  return (
    <div className={`empty-state ${compact ? "empty-state-compact" : ""}`} role="status">
      <div className="empty-state-icon" aria-hidden="true">
        {icon}
      </div>
      <div className="empty-state-copy">
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {(actionLabel || secondaryActionLabel) && (
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
          {actionLabel && onAction && (
            <button type="button" className="btn btn-sm btn-default" onClick={onAction}>
              {actionLabel}
            </button>
          )}
          {secondaryActionLabel && onSecondaryAction && (
            <button type="button" className="btn btn-sm btn-outline" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </button>
          )}
        </div>
      )}
      {children}
    </div>
  );
}
