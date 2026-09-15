import React from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Sliders, Sparkles } from "lucide-react";
import type { CustomIndex } from "../data/indices";
import { IndexBuilderContent } from "./IndexBuilderContent";
import { Card } from "./ui";

interface IndexBuilderPageProps {
  onBackToDashboard: () => void;
  onSave: (
    index: CustomIndex,
    ownerToken?: string,
  ) => Promise<{ ok: boolean; error?: string; ownerToken?: string }>;
  onPreviewInDashboard?: (index: CustomIndex) => void;
}

export function IndexBuilderPage({
  onBackToDashboard,
  onSave,
  onPreviewInDashboard,
}: IndexBuilderPageProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className="index-builder-page"
      style={{ maxWidth: 1280, margin: "0 auto", padding: "0 16px 40px" }}
    >
      {/* Top action / navigation bar */}
      <div
        className="row space-between"
        style={{ marginBottom: 16, alignItems: "center", flexWrap: "wrap", gap: 10 }}
      >
        <button
          type="button"
          onClick={onBackToDashboard}
          className="btn btn-outline"
          style={{ fontSize: 12, padding: "6px 12px" }}
        >
          <ArrowLeft size={13} /> ダッシュボードへ戻る
        </button>

        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          <span
            className="badge"
            style={{
              background: "rgba(6, 182, 212, 0.15)",
              color: "var(--accent-text)",
              border: "1px solid var(--accent-border)",
              fontSize: 11,
              padding: "4px 10px",
            }}
          >
            <Sparkles size={11} style={{ marginRight: 4 }} />
            リアルタイム・バックテスト計算対応
          </span>
        </div>
      </div>

      {/* Main Builder Card Container */}
      <Card
        className="section"
        style={{
          padding: 0,
          overflow: "hidden",
          border: "1px solid var(--border-cyan)",
          boxShadow: "0 10px 40px rgba(0,0,0,0.5), 0 0 25px rgba(6,182,212,0.15)",
        }}
      >
        {/* Header */}
        <div
          className="row space-between"
          style={{
            padding: "16px 24px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "linear-gradient(90deg, var(--accent-subtle), transparent)",
          }}
        >
          <div className="row" style={{ gap: 10, alignItems: "center" }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: "var(--accent-subtle)",
                border: "1px solid var(--accent-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-text)",
              }}
            >
              <Sliders size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: "1.15rem", margin: 0, fontWeight: 700 }}>
                独自指数ビルダー & リアルタイムシミュレーター
              </h2>
              <p className="muted" style={{ margin: 0, fontSize: 12 }}>
                構成銘柄とウェイトを設定し、未ログインでも自由に過去推移・クオンツリスクをシミュレーションできます。
              </p>
            </div>
          </div>
        </div>

        {/* Content */}
        <IndexBuilderContent
          onSave={onSave}
          onClose={onBackToDashboard}
          onPreviewInDashboard={onPreviewInDashboard}
          isFullPage={true}
        />
      </Card>
    </motion.div>
  );
}
