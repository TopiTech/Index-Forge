import { useRef, type ReactNode } from "react";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";

export interface ModalBaseProps {
  isOpen: boolean;
  onClose: () => void;
  title?: ReactNode;
  icon?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number | string;
  role?: "dialog" | "alertdialog";
  ariaLabel?: string;
  ariaDescribedBy?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  variant?: "default" | "danger";
  showCloseButton?: boolean;
}

export function ModalBase({
  isOpen,
  onClose,
  title,
  icon,
  subtitle,
  children,
  footer,
  maxWidth = 440,
  role = "dialog",
  ariaLabel,
  ariaDescribedBy,
  initialFocusRef,
  variant = "default",
  showCloseButton = true,
}: ModalBaseProps) {
  const internalDialogRef = useRef<HTMLDivElement>(null);
  useModalFocus(isOpen, internalDialogRef, onClose, initialFocusRef);

  if (!isOpen) return null;

  const isDanger = variant === "danger";

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <motion.div
        className={`modal-dialog ${isDanger ? "modal-dialog-danger" : ""}`}
        role={role}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        data-modal-dialog
        ref={internalDialogRef}
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        style={{ maxWidth }}
      >
        {(title || showCloseButton) && (
          <div className={`modal-header ${isDanger ? "modal-header-danger" : ""}`}>
            <div className="modal-title-group">
              {icon && <div className="modal-title-icon">{icon}</div>}
              <div>
                {typeof title === "string" ? <h2 className="modal-title">{title}</h2> : title}
                {subtitle && <div className="modal-subtitle">{subtitle}</div>}
              </div>
            </div>
            {showCloseButton && (
              <button
                type="button"
                className="modal-close-btn"
                onClick={onClose}
                aria-label="閉じる"
              >
                <X size={18} />
              </button>
            )}
          </div>
        )}

        <div className="modal-body">{children}</div>

        {footer && <div className="modal-footer">{footer}</div>}
      </motion.div>
    </div>
  );
}
