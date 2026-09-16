import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { ArrowLeft, Sliders, Sparkles, Maximize2, Minimize2 } from "lucide-react";
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const pageContainerRef = useRef<HTMLDivElement>(null);

  // Sync with native browser fullscreen changes (e.g. Esc key)
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isCurrentlyFullscreen = Boolean(
        document.fullscreenElement &&
        (document.fullscreenElement === pageContainerRef.current ||
         pageContainerRef.current?.contains(document.fullscreenElement))
      );
      setIsFullscreen(isCurrentlyFullscreen);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!isFullscreen) {
        if (pageContainerRef.current?.requestFullscreen) {
          await pageContainerRef.current.requestFullscreen();
        } else {
          // Fallback if browser Fullscreen API is unavailable or restricted
          setIsFullscreen(true);
        }
      } else {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen();
        } else {
          setIsFullscreen(false);
        }
      }
    } catch {
      // Toggle UI fullscreen class regardless of native permissions
      setIsFullscreen((prev) => !prev);
    }
  }, [isFullscreen]);

  return (
    <motion.div
      ref={pageContainerRef}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className={`index-builder-page ${isFullscreen ? "is-fullscreen" : ""}`}
    >
      {/* Top action / navigation bar */}
      <div className="builder-top-action-bar row space-between flex-wrap">
        <button
          type="button"
          onClick={onBackToDashboard}
          className="btn btn-outline"
          style={{ fontSize: 12, padding: "6px 12px" }}
        >
          <ArrowLeft size={13} /> ダッシュボードへ戻る
        </button>

        <div className="row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span
            className="badge builder-badge-highlight"
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

          {/* Fullscreen Mode Toggle Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`btn btn-sm ${isFullscreen ? "btn-default" : "btn-outline"} builder-fullscreen-btn`}
            title={isFullscreen ? "全画面表示を解除 (Esc)" : "ビルダーを全画面表示に切り替え"}
            aria-label={isFullscreen ? "全画面表示を解除" : "全画面表示に切り替え"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              padding: "5px 10px",
              cursor: "pointer",
            }}
          >
            {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            <span>{isFullscreen ? "全画面解除" : "全画面表示"}</span>
          </button>
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
