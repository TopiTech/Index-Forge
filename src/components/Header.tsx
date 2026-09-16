import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  Shield,
  KeyRound,
  ShieldCheck,
  LogIn,
  Sliders,
  Briefcase,
  FileText,
  Menu,
  X,
  Home,
} from "lucide-react";
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
  onNavigateToPortfolio?: () => void;
  onNavigateToDisclaimer?: () => void;
  currentView?: string;
  benchmarkUpdatedAt?: number | null;
  calculationUpdatedAt?: number | null;
  dataLoading?: boolean;
  syncing?: boolean;
  benchmarkStale?: boolean;
  hasSyncWarning?: boolean;
}

export function Header({
  onNavigateToHome,
  onNavigateToAdmin,
  onNavigateToBuilder,
  onNavigateToPortfolio,
  onNavigateToDisclaimer,
  currentView,
  benchmarkUpdatedAt,
  calculationUpdatedAt,
  dataLoading = false,
  syncing = false,
  benchmarkStale = false,
  hasSyncWarning = false,
}: HeaderProps) {
  const { session, isAuthenticated, isAdmin, isUser, maxStocks, maxIndices, logout } = useAuth();
  const { success, info } = useToast();
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuToggleRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);

  // Close the mobile navigation drawer with Escape, trap focus inside while open,
  // and restore focus to the toggle button on close.
  useEffect(() => {
    if (!isMobileMenuOpen) return;

    const drawer = mobileMenuRef.current;
    const focusableSelector = "button:not([disabled]), a[href]:not([disabled]), [tabindex]:not([tabindex='-1'])";
    const getFocusable = () =>
      drawer ? Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector)).filter((el) => el.getClientRects().length > 0) : [];

    const frame = window.requestAnimationFrame(() => {
      const items = getFocusable();
      if (items.length > 0) items[0].focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsMobileMenuOpen(false);
        mobileMenuToggleRef.current?.focus();
        return;
      }

      if (event.key !== "Tab" || !drawer) return;
      const items = getFocusable();
      if (items.length === 0) return;

      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !drawer.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isMobileMenuOpen]);

  const limitsText =
    isUser && (maxStocks || maxIndices)
      ? `(${[maxStocks ? `${maxStocks}銘柄` : "", maxIndices ? `${maxIndices}指数` : ""].filter(Boolean).join(" / ")}上限)`
      : "";

  const handleLogout = () => {
    logout();
    info("ログアウトしました（閲覧モード）");
  };

  // Item activation closes the drawer and returns focus to the toggle so
  // keyboard users do not lose their place (the Escape path already did).
  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
    mobileMenuToggleRef.current?.focus();
  }, []);

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="top-header"
      >
        <div className="row space-between flex-wrap" style={{ gap: 12, alignItems: "center" }}>
          <a
            className={`header-brand row ${onNavigateToHome ? "clickable" : ""}`}
            href="/"
            style={{
              gap: 10,
              alignItems: "center",
              textDecoration: "none",
              color: "inherit",
              cursor: onNavigateToHome ? "pointer" : "default",
            }}
            onClick={(e) => {
              if (onNavigateToHome) {
                e.preventDefault();
                onNavigateToHome();
                closeMobileMenu();
              }
            }}
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
              <h1 style={{ fontSize: "clamp(1.05rem, 2vw, 1.35rem)", margin: 0 }}>
                IndexForge
              </h1>
              <p className="muted header-desc" style={{ margin: 0, fontSize: 11, lineHeight: 1.2 }}>
                独自投資戦略・テーマ別ポートフォリオの客観的株価指数化プラットフォーム
              </p>
            </div>
          </a>

          <div className="header-meta">
            {/* Status indicators group */}
            <div className="header-meta-group header-meta-status">
              <DataFreshness
                benchmarkUpdatedAt={benchmarkUpdatedAt}
                calculationUpdatedAt={calculationUpdatedAt}
                loading={dataLoading}
                syncing={syncing}
                stale={benchmarkStale}
                hasSyncWarning={hasSyncWarning}
              />
              <ThemeControls />
            </div>

            <div className="header-meta-divider" aria-hidden="true" />

            {/* Actions group */}
            <div className="header-meta-group header-meta-actions">
              {/* Auth status indicator */}
              {isAuthenticated ? (
                <div className="row header-auth-status" style={{ gap: 6, alignItems: "center" }}>
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

              {/* Desktop Nav Items */}
              <div className="header-nav-desktop row" style={{ gap: 6, alignItems: "center" }}>
                {/* Index Builder */}
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
                    <span>指数ビルダー</span>
                  </button>
                )}

                {/* Portfolio */}
                {onNavigateToPortfolio && (
                  <button
                    type="button"
                    onClick={onNavigateToPortfolio}
                    className={`btn btn-sm ${currentView === "portfolio" ? "btn-default" : "btn-outline"} portfolio-nav-btn`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "4px 9px",
                      fontSize: 11,
                    }}
                    title="開発者ポートフォリオ・自己紹介"
                    aria-label="開発者ポートフォリオ・自己紹介へ移動"
                  >
                    <Briefcase size={12} />
                    <span>ポートフォリオ</span>
                  </button>
                )}

                {/* Disclaimer */}
                {onNavigateToDisclaimer && (
                  <button
                    type="button"
                    onClick={onNavigateToDisclaimer}
                    className={`btn btn-sm ${currentView === "disclaimer" ? "btn-default" : "btn-outline"} disclaimer-nav-btn`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 5,
                      padding: "4px 9px",
                      fontSize: 11,
                    }}
                    title="免責事項・利用規約"
                    aria-label="免責事項へ移動"
                  >
                    <FileText size={12} />
                    <span>免責事項</span>
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
                    <span>管理者ページ</span>
                  </button>
                )}
              </div>

              {/* Mobile Menu Toggle Button */}
              <button
                type="button"
                ref={mobileMenuToggleRef}
                className="btn btn-sm btn-outline header-mobile-menu-btn"
                onClick={() => setIsMobileMenuOpen((prev) => !prev)}
                aria-expanded={isMobileMenuOpen}
                aria-controls="header-mobile-nav"
                aria-label={isMobileMenuOpen ? "メニューを閉じる" : "メニューを開く"}
                style={{ padding: "5px 8px", fontSize: 12 }}
              >
                {isMobileMenuOpen ? <X size={15} /> : <Menu size={15} />}
                <span className="header-mobile-menu-label">メニュー</span>
              </button>
            </div>
          </div>
        </div>

        {/* Mobile Navigation Drawer */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.nav
              ref={mobileMenuRef}
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="header-mobile-nav-panel"
              id="header-mobile-nav"
              aria-label="モバイルナビゲーション"
            >
              <div className="header-mobile-nav-links">
                {onNavigateToHome && (
                  <button
                    type="button"
                    className={`header-mobile-nav-item ${currentView === "dashboard" ? "active" : ""}`}
                    onClick={() => {
                      onNavigateToHome();
                      closeMobileMenu();
                    }}
                  >
                    <Home size={16} />
                    <span>ダッシュボード</span>
                  </button>
                )}
                {onNavigateToBuilder && (
                  <button
                    type="button"
                    className={`header-mobile-nav-item ${currentView === "builder" ? "active" : ""}`}
                    onClick={() => {
                      onNavigateToBuilder();
                      closeMobileMenu();
                    }}
                  >
                    <Sliders size={16} />
                    <span>指数ビルダー＆シミュレーター</span>
                  </button>
                )}
                {onNavigateToPortfolio && (
                  <button
                    type="button"
                    className={`header-mobile-nav-item ${currentView === "portfolio" ? "active" : ""}`}
                    onClick={() => {
                      onNavigateToPortfolio();
                      closeMobileMenu();
                    }}
                  >
                    <Briefcase size={16} />
                    <span>ポートフォリオ</span>
                  </button>
                )}
                {onNavigateToDisclaimer && (
                  <button
                    type="button"
                    className={`header-mobile-nav-item ${currentView === "disclaimer" ? "active" : ""}`}
                    onClick={() => {
                      onNavigateToDisclaimer();
                      closeMobileMenu();
                    }}
                  >
                    <FileText size={16} />
                    <span>免責事項</span>
                  </button>
                )}
                {isAdmin && onNavigateToAdmin && (
                  <button
                    type="button"
                    className={`header-mobile-nav-item ${currentView === "admin" ? "active" : ""}`}
                    onClick={() => {
                      onNavigateToAdmin();
                      closeMobileMenu();
                    }}
                  >
                    <Shield size={16} />
                    <span>管理者ページ</span>
                  </button>
                )}
              </div>
            </motion.nav>
          )}
        </AnimatePresence>
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
