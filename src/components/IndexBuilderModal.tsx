import React, { useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Sliders } from "lucide-react";
import type { CustomIndex } from "../data/indices";
import { useModalFocus } from "../hooks/useModalFocus";
import { IndexBuilderContent } from "./IndexBuilderContent";

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
  const handleClose = () => {
    onClose();
  };
  useModalFocus(isOpen, dialogRef, handleClose);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 99999,
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
        data-modal-dialog
        ref={dialogRef}
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
            onClick={handleClose}
            aria-label="閉じる"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              padding: 4,
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Modal Content */}
        <IndexBuilderContent
          onSave={onSave}
          onClose={onClose}
          onPreviewInDashboard={onPreviewInDashboard}
          isFullPage={false}
        />
      </motion.div>
    </div>
  );
}
