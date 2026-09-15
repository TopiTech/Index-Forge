import { useState } from "react";
import { motion } from "framer-motion";
import { TrendingUp, Shield, KeyRound, ShieldCheck, LogIn, Sliders } from "lucide-react";
import { Badge } from "./ui";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "./Toast";
import { ThemeControls } from "./ThemeControls";
import { DataFreshness } from "./DataFreshness";
import { AuthModal } from "./AuthModal";

interface HeaderProps {
  onNavigateToHome?: () => void;
  onNavigateToAdmin?: () => void;
  onNavigateToBuilder?: () => void;
  currentView?: string;
  benchmarkUpdatedAt?: number | null;
  calculationUpdatedAt?: number | null;
  dataLoading?: boolean;
  syncing?: boolean;
  benchmarkStale?: boolean;
}

export function Header({
  onNavigateToHome,
  onNavigateToAdmin,
  onNavigateToBuilder,
  currentView,
  benchmarkUpdatedAt,
  calculationUpdatedAt,
  dataLoading = false,
  syncing = false,
  benchmarkStale = false,
}: HeaderProps) {

  const { session, isAuthenticated, isAdmin, isUser, maxStocks, maxIndices, logout } = useAuth();
  const { success, info } = useToast();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const limitsText =
    isUser && (maxStocks || maxIndices)
      ? `(${[maxStocks ? `${maxStocks}銘柄` : "", maxIndices ? `${maxIndices}指数` : ""].filter(Boolean).join(" / ")}上限)`
      : "";

  const handleLogout = () => {
    logout();
    info("ログアウトしました（閲覧モード）");
  };

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="top-header"
      >
        <div className="row space-between flex-wrap" style={{ gap: 12, alignItems: "center" }}>
          <div
            className={`header-brand row ${onNavigateToHome ? "clickable" : ""}`}
            style={{
              gap: 10,
              alignItems: "center",
              cursor: onNavigateToHome ? "pointer" : "default",
            }}
            onClick={onNavigateToHome}
            role={onNavigateToHome ? "button" : undefined}
            tabIndex={onNavigateToHome ? 0 : undefined}
            onKeyDown={
              onNavigateToHome
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onNavigateToHome();
                    }
                  }
                : undefined
            }
          >
            <div
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                background:
                  "linear-gradient(135deg, var(--accent-subtle) 0%, rgba(139, 92, 246, 0.2) 100%)",
                border: "1px solid var(--accent-border)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--accent-text)",
              }}
              aria-hidden="true"
            >
              <TrendingUp size={16} strokeWidth={2.2} />
            </div>
            <div>
              <h1 style={{ fontSize: "clamp(1.1rem, 2vw, 1.35rem)", margin: 0 }}>
                ORIGINAL INDEX TRACKER
              </h1>
              <p className="muted header-desc" style={{ margin: 0, fontSize: 11, lineHeight: 1.2 }}>
                独自投資戦略・テーマ別ポートフォリオの客観的株価指数化プラットフォーム
              </p>
            </div>
          </div>

          <div className="header-meta row flex-wrap" style={{ gap: 8, alignItems: "center" }}>
            <DataFreshness
              benchmarkUpdatedAt={benchmarkUpdatedAt}
              calculationUpdatedAt={calculationUpdatedAt}
              loading={dataLoading}
              syncing={syncing}
              stale={benchmarkStale}
            />

            {/* Theme & Accent Controls */}
            <ThemeControls />

            {/* Auth status indicator */}
            {isAuthenticated ? (
              <div className="row" style={{ gap: 6, alignItems: "center" }}>
                <Badge variant={isAdmin ? "magenta" : "cyan"}>
                  {isAdmin ? <ShieldCheck size={11} /> : <KeyRound size={11} />}
                  {session?.name} {limitsText}
                </Badge>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="btn btn-sm btn-outline"
                  style={{ padding: "4px 8px", fontSize: 11 }}
                  aria-label="ログアウト"
                >
                  ログアウト
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-sm btn-outline header-login-btn"
                onClick={() => setIsAuthModalOpen(true)}
                title="パスワード認証でログイン"
                aria-label="パスワード認証でログイン"
              >
                <LogIn size={12} style={{ color: "var(--accent-text)" }} />
                <span>ログイン</span>
                <span className="mono tiny muted" style={{ fontSize: 10 }}>
                  (閲覧中)
                </span>
              </button>
            )}

            {/* Index Builder & Simulator button */}
            {onNavigateToBuilder && (
              <button
                type="button"
                onClick={onNavigateToBuilder}
                className={`btn btn-sm ${currentView === "builder" ? "btn-default" : "btn-outline"} builder-nav-btn`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 9px",
                  fontSize: 11,
                  borderColor: currentView === "builder" ? undefined : "var(--accent-border)",
                  color: currentView === "builder" ? undefined : "var(--accent-text)",
                }}
                title="独自指数ビルダー＆シミュレーター（未ログイン利用可能）"
                aria-label="独自指数ビルダー＆シミュレーターへ移動"
              >
                <Sliders size={12} />
                指数ビルダー
              </button>
            )}

            {/* Admin Page button (visible only to authenticated admins) */}
            {isAdmin && onNavigateToAdmin && (
              <button
                type="button"
                onClick={onNavigateToAdmin}
                className="btn btn-sm btn-outline admin-nav-btn"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  padding: "4px 9px",
                  fontSize: 11,
                }}
              >
                <Shield size={12} />
                管理者ページ
              </button>
            )}
          </div>
        </div>
      </motion.header>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onSuccess={() => {
          success("ログインしました");
        }}
        title="ログイン認証"
        description="独自指数の作成や銘柄編集を行うには、パスワードを入力してください。"
      />
    </>
  );
}
