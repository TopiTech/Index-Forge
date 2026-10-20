import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { X } from "lucide-react";
import { useModalFocus } from "../hooks/useModalFocus";

/**
 * Resolve the DOM node fixed-position overlays must be portaled into.
 *
 * While an element is in native fullscreen the browser only paints that
 * element's subtree, so overlays portaled to `document.body` (modals, toasts,
 * command palette) become invisible. Following the fullscreen element keeps
 * them on screen; `document.body` remains the normal root.
 */
export function getOverlayRoot(): HTMLElement | null {
  if (typeof document === "undefined") return null;
  const fullscreenElement = document.fullscreenElement as HTMLElement | null;
  if (fullscreenElement) return fullscreenElement;
  return document.body ?? null;
}

/**
 * Overlay root that re-resolves on every `fullscreenchange`.
 *
 * Returns `null` during SSR (no `document`), where callers must render the
 * overlay inline instead of portal-ing it anywhere.
 */
export function useOverlayRoot(): HTMLElement | null {
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(() => getOverlayRoot());

  useEffect(() => {
    if (typeof document === "undefined") return;
    const syncOverlayRoot = () => setOverlayRoot(getOverlayRoot());
    // A fullscreen transition can happen between render and effect (e.g. the
    // page loads already fullscreen), so resolve once on mount as well.
    syncOverlayRoot();
    document.addEventListener("fullscreenchange", syncOverlayRoot);
    return () => document.removeEventListener("fullscreenchange", syncOverlayRoot);
  }, []);

  return overlayRoot;
}

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
  ariaLabelledBy?: string;
  ariaDescribedBy?: string;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  variant?: "default" | "danger";
  showCloseButton?: boolean;
  /**
   * Move focus into the dialog when it opens (default `true`). Pointer-driven
   * previews pass `false` so hovering does not steal the caret.
   */
  focusOnOpen?: boolean;
  /**
   * Lock background scrolling while open (default `true`). Non-blocking
   * previews pass `false` so the page keeps scrolling under the pointer.
   */
  lockScroll?: boolean;
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
  ariaLabelledBy,
  ariaDescribedBy,
  initialFocusRef,
  variant = "default",
  showCloseButton = true,
  focusOnOpen = true,
  lockScroll = true,
}: ModalBaseProps) {
  const internalDialogRef = useRef<HTMLDivElement>(null);
  const isBackdropMouseDownRef = useRef(false);
  const generatedTitleId = useId();
  const overlayRoot = useOverlayRoot();
  useModalFocus(isOpen, internalDialogRef, onClose, initialFocusRef, {
    focusOnOpen,
    lockScroll,
  });

  if (!isOpen) return null;

  const isDanger = variant === "danger";
  // A dialog with no accessible name is announced only as "dialog". Callers
  // that pass a plain-string title get it wired to the heading automatically;
  // an explicit ariaLabel/ariaLabelledBy always wins.
  const titleId = `${generatedTitleId}-title`;
  const resolvedLabelledBy =
    ariaLabelledBy ?? (ariaLabel ? undefined : (title ? titleId : undefined));

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isBackdropMouseDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isBackdropMouseDownRef.current && e.target === e.currentTarget) {
      onClose();
    }
    isBackdropMouseDownRef.current = false;
  };

  const modalContent = (
    <div
      className="modal-overlay"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
    >
      <motion.div
        className={`modal-dialog ${isDanger ? "modal-dialog-danger" : ""}`}
        role={role}
        tabIndex={-1}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={resolvedLabelledBy}
        aria-describedby={ariaDescribedBy}
        data-modal-dialog
        ref={internalDialogRef}
        onMouseDown={(e) => e.stopPropagation()}
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
                {typeof title === "string" ? (
                  <h2 className="modal-title" id={titleId}>
                    {title}
                  </h2>
                ) : (
                  <div className="modal-title" id={titleId}>
                    {title}
                  </div>
                )}
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

  return overlayRoot ? createPortal(modalContent, overlayRoot) : modalContent;
}
