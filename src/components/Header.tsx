import { useState } from "react";
import { motion } from "framer-motion";
import {
  TrendingUp,
  KeyRound,
  ShieldCheck,
  LogIn,
  Menu,
  X,
  Search,
} from "lucide-react";
import { Badge } from "./ui";
import { useAuth } from "../hooks/useAuth";
import { useToast } from "./Toast";
import { ThemeControls } from "./ThemeControls";
import { DataFreshness } from "./DataFreshness";
import { AuthModal } from "./AuthModal";
import type { TabFreshness } from "../contexts/FreshnessContext";

/**
 * The header's data-freshness props are the freshness registry's vocabulary.
 *
 * The header used to declare its own names (`dataLoading`, `benchmarkStale`)
 * while the registry (`TabFreshness`) used `loading` / `stale`. Because both
 * sets of properties are optional booleans, TypeScript accepted the mismatch
 * silently: `useActiveFreshness(currentView, headerProps)` read `loading` and
 * `stale` from an object that only had `dataLoading` / `benchmarkStale`, so
 * both resolved to `undefined` and the header always reported "not loading"
 * and "not stale" — the LIVE badge was shown even when the Worker had served
 * an old snapshot.
 *
 * Extending the shared vocabulary removes the second spelling entirely. The
 * two `never` properties below make the compiler reject the old names, so the
 * mismatch cannot come back.
 */
export interface HeaderProps extends Partial<TabFreshness> {
  onNavigateToHome?: () => void;
  onOpenSearch?: () => void;
  onSearchHover?: () => void;
  /** Mobile navigation drawer state, owned by the shared page layout. */
  isNavOpen?: boolean;
  onToggleNav?: () => void;
  navToggleRef?: React.RefObject<HTMLButtonElement | null>;
  isAuthModalOpen?: boolean;
  onOpenAuthModal?: () => void;
  onCloseAuthModal?: () => void;
  /** @deprecated Renamed to `loading`. Kept only to reject the old name. */
  dataLoading?: never;
  /** @deprecated Renamed to `stale`. Kept only to reject the old name. */
  benchmarkStale?: never;
}

/**
 * Platform header. Navigation lives in the global sidebar; the header keeps
 * only brand, search, data freshness, theme and account controls.
 */
export function Header({
  onNavigateToHome,
  onOpenSearch,
  onSearchHover,
  isNavOpen = false,
  onToggleNav,
  navToggleRef,
  benchmarkUpdatedAt,
  calculationUpdatedAt,
  updatedAt,
  loading = false,
  syncing = false,
  stale = false,
  hasSyncWarning = false,
  typeLabel,
  customStatusText,
  isAuthModalOpen: isAuthModalOpenProp,
  onOpenAuthModal,
  onCloseAuthModal,
}: HeaderProps) {
  const { session, isAuthenticated, isAdmin, isUser, maxStocks, maxIndices, logout } = useAuth();
  const { info } = useToast();
  const [internalAuthModalOpen, setInternalAuthModalOpen] = useState(false);
  const isAuthModalOpen = isAuthModalOpenProp !== undefined ? isAuthModalOpenProp : internalAuthModalOpen;
  const openAuthModal = onOpenAuthModal ?? (() => setInternalAuthModalOpen(true));
  const closeAuthModal = onCloseAuthModal ?? (() => setInternalAuthModalOpen(false));

  const limitsText =
    isUser && (maxStocks || maxIndices)
      ? `(${[maxStocks ? `${maxStocks}銘柄` : "", maxIndices ? `${maxIndices}指数` : ""].filter(Boolean).join(" / ")}上限)`
      : "";

  const handleLogout = () => {
    logout();
    info("ログアウトしました(閲覧モード)");
  };

  return (
    <>
      <motion.header
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="top-header"
      >
        <div className="header-inner-row">
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
              }
            }}
          >
            <div className="header-brand-mark" aria-hidden="true">
              <TrendingUp size={16} strokeWidth={2.2} />
            </div>
            <div className="header-brand-text">
              <span className="header-brand-name">IndexForge</span>
              <p className="muted header-desc">統合投資情報プラットフォーム</p>
            </div>
          </a>

          {/* Quick Search Trigger (Desktop) */}
          {onOpenSearch && (
            <button
              type="button"
              className="header-search-btn"
              onClick={onOpenSearch}
              onMouseEnter={onSearchHover}
              onFocus={onSearchHover}
              title="銘柄・指数をクイック検索 (⌘K / Ctrl+K)"
              aria-label="検索モーダルを開く"
            >
              <Search size={13} className="muted" />
              <span className="header-search-text">銘柄・コード検索...</span>
              <kbd className="header-search-kbd mono tiny">⌘K</kbd>
            </button>
          )}

          <div className="header-meta">
            {/* Quick search button for mobile */}
            {onOpenSearch && (
              <button
                type="button"
                className="btn btn-sm btn-ghost header-mobile-search-btn"
                onClick={onOpenSearch}
                onMouseEnter={onSearchHover}
                onTouchStart={onSearchHover}
                title="検索"
                aria-label="検索モーダルを開く"
              >
                <Search size={15} />
              </button>
            )}

            {/* Status indicators group (Desktop only) */}
            <div className="header-meta-group header-meta-status header-status-desktop">
              <DataFreshness
                benchmarkUpdatedAt={benchmarkUpdatedAt}
                calculationUpdatedAt={calculationUpdatedAt}
                updatedAt={updatedAt}
                loading={loading}
                syncing={syncing}
                stale={stale}
                hasSyncWarning={hasSyncWarning}
                typeLabel={typeLabel}
                customStatusText={customStatusText}
              />
              <ThemeControls />
            </div>

            {/* Mobile quick theme control */}
            <div className="header-meta-group header-status-mobile">
              <ThemeControls />
            </div>

            <div className="header-meta-divider" aria-hidden="true" />

            {/* Actions group */}
            <div className="header-meta-group header-meta-actions">
              {/* Auth status indicator */}
              <div className="header-auth-desktop">
                {isAuthenticated ? (
                  <div className="row header-auth-status" style={{ gap: 6, alignItems: "center" }}>
                    <Badge
                      variant={isAdmin ? "magenta" : "cyan"}
                      title={limitsText ? `${session?.name} ${limitsText}` : session?.name}
                    >
                      {isAdmin ? <ShieldCheck size={11} /> : <KeyRound size={11} />}
                      <span className="header-user-name">{session?.name}</span>
                      {limitsText && <span className="header-user-limits">{limitsText}</span>}
                    </Badge>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost header-logout-btn"
                      onClick={handleLogout}
                      title="ログアウト(閲覧モードに戻る)"
                      aria-label="ログアウト"
                    >
                      <LogIn size={13} style={{ transform: "scaleX(-1)" }} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline header-login-btn"
                    onClick={openAuthModal}
                    title="パスワード認証でログイン"
                    aria-label="パスワード認証でログイン"
                  >
                    <LogIn size={12} style={{ color: "var(--accent-text)" }} />
                    <span className="header-login-label">ログイン</span>
                  </button>
                )}
              </div>

              {/* Mobile Navigation Toggle (drives the global sidebar drawer) */}
              <button
                type="button"
                className="btn btn-sm btn-outline header-mobile-menu-btn"
                ref={navToggleRef}
                onClick={onToggleNav}
                aria-expanded={isNavOpen}
                aria-controls="header-mobile-nav"
                aria-label={isNavOpen ? "メニューを閉じる" : "メニューを開く"}
              >
                {isNavOpen ? <X size={15} /> : <Menu size={15} />}
                <span className="header-mobile-menu-label">メニュー</span>
              </button>
            </div>
          </div>
        </div>
      </motion.header>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={closeAuthModal}
        onSuccess={() => {
          info("ログインしました");
        }}
        title="ログイン認証"
        description="独自指数の作成や銘柄編集を行うには、パスワードを入力してください。"
      />
    </>
  );
}
