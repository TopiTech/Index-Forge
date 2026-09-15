import { useRef } from "react";
import { AlertTriangle, AlertCircle } from "lucide-react";
import { ModalBase } from "./ModalBase";

interface ConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "primary" | "warning";
  loading?: boolean;
}

export function ConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = "実行する",
  cancelText = "キャンセル",
  variant = "danger",
  loading = false,
}: ConfirmModalProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);
  const cancelBtnRef = useRef<HTMLButtonElement>(null);
  const handleClose = () => {
    if (!loading) onClose();
  };

  const isDanger = variant === "danger";

  return (
    <ModalBase
      isOpen={isOpen}
      onClose={handleClose}
      role="alertdialog"
      ariaLabel={title}
      ariaDescribedBy="confirm-modal-description"
      maxWidth={420}
      variant={isDanger ? "danger" : "default"}
      initialFocusRef={isDanger ? cancelBtnRef : confirmBtnRef}
      icon={
        isDanger ? (
          <AlertTriangle size={18} style={{ color: "var(--neon-red)" }} />
        ) : (
          <AlertCircle size={18} style={{ color: "var(--accent-text)" }} />
        )
      }
      title={<h2 id="confirm-modal-title" className="modal-title">{title}</h2>}
      footer={
        <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
          <button
            ref={cancelBtnRef}
            type="button"
            className="btn btn-sm btn-outline"
            onClick={handleClose}
            disabled={loading}
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            className={`btn btn-sm ${isDanger ? "btn-danger" : "btn-default"}`}
            onClick={async () => {
              await onConfirm();
            }}
            disabled={loading}
            style={{
              background: isDanger ? "var(--neon-red)" : undefined,
              color: isDanger ? "#ffffff" : undefined,
              border: "none",
            }}
          >
            {loading ? "処理中..." : confirmText}
          </button>
        </div>
      }
    >
      <p
        id="confirm-modal-description"
        style={{
          fontSize: 13,
          margin: 0,
          lineHeight: 1.6,
          color: "var(--text-primary)",
          whiteSpace: "pre-line",
        }}
      >
        {description}
      </p>
    </ModalBase>
  );
}
