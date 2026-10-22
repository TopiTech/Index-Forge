import React, { Suspense, lazy, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { RefreshCw, X, Sliders } from "lucide-react";
import type { CustomIndex } from "../data/indices";
import { useModalFocus } from "../hooks/useModalFocus";
import { useOverlayRoot } from "./ModalBase";

// The builder body pulls in recharts (via SimulationPreview), which must not
// be part of the first paint. The dialog shell below is tiny, so it stays
// static and the heavy form arrives on demand.
const IndexBuilderContent = lazy(() =>
  import("./IndexBuilderContent").then((m) => ({ default: m.IndexBuilderContent })),
);

export interface IndexBuilderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (
    index: CustomIndex,
    ownerToken?: string,
  ) => Promise<{ ok: boolean; error?: string; ownerToken?: string }>;
  onPreviewInDashboard?: (index: CustomIndex) => void;
}

export function IndexBuilderModal({
  isOpen,
  onClose,
  onSave,
  onPreviewInDashboard,
}: IndexBuilderModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const isBackdropMouseDownRef = useRef(false);
  const overlayRoot = useOverlayRoot();
  // Lifted from the builder body: the basket lives in the form, so a dismissal
  // while the save request is in flight loses everything the user configured.
  const [isSaving, setIsSaving] = useState(false);

  const requestClose = useCallback(() => {
    if (isSaving) return;
    onClose();
  }, [isSaving, onClose]);

  useModalFocus(isOpen, dialogRef, requestClose);

  if (!isOpen) return null;

  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    isBackdropMouseDownRef.current = e.target === e.currentTarget;
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isBackdropMouseDownRef.current && e.target === e.currentTarget) {
      requestClose();
    }
    isBackdropMouseDownRef.current = false;
  };

  const modalContent = (
    <div
      className="modal-overlay"
      onMouseDown={handleBackdropMouseDown}
      onClick={handleBackdropClick}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal-overlay)" as unknown as number,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "var(--surface-overlay)",
        backdropFilter: "blur(8px)",
        padding: 16,
      }}
    >
      <motion.div
        className="modal-dialog builder-modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="modal-builder-title"
        aria-describedby="modal-builder-description"
        aria-busy={isSaving || undefined}
        data-modal-dialog
        ref={dialogRef}
        onMouseDown={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        style={{
          width: "100%",
          maxWidth: 1180,
          maxHeight: "92vh",
          backgroundColor: "var(--bg-surface)",
          border: "1px solid var(--border-cyan)",
          borderRadius: 14,
          boxShadow: "0 20px 60px rgba(0,0,0,0.8), 0 0 35px rgba(6,182,212,0.25)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Modal Header */}
        <div
          className="row space-between"
          style={{
            padding: "14px 22px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "linear-gradient(90deg, var(--accent-subtle), transparent)",
          }}
        >
          <div className="row" style={{ gap: 8, alignItems: "center" }}>
            <Sliders size={18} style={{ color: "var(--accent-text)" }} />
            <div>
              <h2 id="modal-builder-title" style={{ fontSize: 16, margin: 0 }}>
                独自指数ビルダー & リアルタイムシミュレーター
              </h2>
              <p id="modal-builder-description" className="modal-subtitle" style={{ margin: 0, fontSize: 11 }}>
                構成銘柄とウェイトを設定して、バックテスト推移を即時シミュレーション（ゲスト利用可能）
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={requestClose}
            aria-label="閉じる"
            disabled={isSaving}
            title={isSaving ? "保存中は閉じられません" : "閉じる"}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: isSaving ? "not-allowed" : "pointer",
              opacity: isSaving ? 0.5 : 1,
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Content */}
        <Suspense
          fallback={
            <div
              role="status"
              aria-live="polite"
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                minHeight: 320,
                padding: 24,
              }}
            >
              <RefreshCw size={20} className="animate-spin muted" aria-hidden="true" />
              <span className="muted tiny mono">ビルダーを読み込み中...</span>
            </div>
          }
        >
          <IndexBuilderContent
            onSave={onSave}
            // Successful saves close the dialog from inside the form; only the
            // Escape/backdrop/close-button paths go through the busy guard.
            onClose={onClose}
            onPreviewInDashboard={onPreviewInDashboard}
            isFullPage={false}
            onSavingChange={setIsSaving}
          />
        </Suspense>
      </motion.div>
    </div>
  );

  return overlayRoot ? createPortal(modalContent, overlayRoot) : modalContent;
}
