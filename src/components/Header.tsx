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
  ChevronDown,
  Compass,
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
  onNavigateToTutorial?: () => void;
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
  onNavigateToTutorial,
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
  const [isDesktopMenuOpen, setIsDesktopMenuOpen] = useState(false);
  const mobileMenuToggleRef = useRef<HTMLButtonElement>(null);
  const mobileMenuRef = useRef<HTMLElement>(null);
  const desktopMenuToggleRef = useRef<HTMLButtonElement>(null);
  const desktopMenuRef = useRef<HTMLDivElement>(null);

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

  const closeDesktopMenu = useCallback(() => {
    setIsDesktopMenuOpen(false);
    desktopMenuToggleRef.current?.focus();
  }, []);

  // Close the desktop dropdown on outside click or Escape key
  useEffect(() => {
    if (!isDesktopMenuOpen) return;

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        desktopMenuRef.current &&
        !desktopMenuRef.current.contains(target) &&
        desktopMenuToggleRef.current &&
        !desktopMenuToggleRef.current.contains(target)
      ) {
        setIsDesktopMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDesktopMenu();
      }
    };

    document.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [isDesktopMenuOpen, closeDesktopMenu]);

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
              flexShrink: 0,
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
                flexShrink: 0,
              }}
              aria-hidden="true"
            >
              <TrendingUp size={16} strokeWidth={2.2} />
            </div>
            <div className="header-brand-text">
              <h1 style={{ fontSize: "clamp(1.05rem, 2vw, 1.35rem)", margin: 0 }}>
                IndexForge
              </h1>
              <p className="muted header-desc" style={{ margin: 0, fontSize: 11, lineHeight: 1.2 }}>
                独自投資戦略・テーマ別ポートフォリオの客観的株価指数化プラットフォーム
              </p>
            </div>
          </a>

          <div className="header-meta">
            {/* Status indicators group (Desktop only) */}
            <div className="header-meta-group header-meta-status header-status-desktop">
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

            {/* Mobile quick theme control */}
            <div className="header-meta-group header-status-mobile">
              <ThemeControls />
            </div>

            <div className="header-meta-divider" aria-hidden="true" />

            {/* Actions group */}
            <div className="header-meta-group header-meta-actions">
              {/* Auth status indicator (Desktop) */}
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
              </div>

              {/* Desktop Menu Toggle Button */}
              <div className="header-desktop-menu-wrapper">
                <button
                  type="button"
                  ref={desktopMenuToggleRef}
                  className="btn btn-sm btn-outline header-desktop-menu-btn"
                  onClick={() => setIsDesktopMenuOpen((prev) => !prev)}
                  aria-expanded={isDesktopMenuOpen}
                  aria-controls="header-desktop-dropdown"
                  aria-label={isDesktopMenuOpen ? "メニューを閉じる" : "メニューを開く"}
                >
                  <Menu size={14} />
                  <span>メニュー</span>
                  <ChevronDown
                    size={12}
                    style={{
                      transition: "transform 0.2s ease",
                      transform: isDesktopMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                    }}
                  />
                </button>

                {/* Desktop Dropdown Panel */}
                <AnimatePresence>
                  {isDesktopMenuOpen && (
                    <motion.div
                      ref={desktopMenuRef}
                      initial={{ opacity: 0, y: -8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.96 }}
                      transition={{ duration: 0.15, ease: "easeOut" }}
                      className="header-desktop-dropdown"
                      id="header-desktop-dropdown"
                      role="menu"
                      aria-label="ナビゲーションメニュー"
                    >
                      {onNavigateToHome && (
                        <button
                          type="button"
                          role="menuitem"
                          className={`header-desktop-dropdown-item ${currentView === "dashboard" ? "active" : ""}`}
                          onClick={() => {
                            onNavigateToHome();
                            closeDesktopMenu();
                          }}
                          title="ダッシュボード"
                          aria-label="ダッシュボードへ移動"
                        >
                          <Home size={15} />
                          <span>ダッシュボード</span>
                        </button>
                      )}
                      {onNavigateToBuilder && (
                        <button
                          type="button"
                          role="menuitem"
                          className={`header-desktop-dropdown-item ${currentView === "builder" ? "active" : ""}`}
                          onClick={() => {
                            onNavigateToBuilder();
                            closeDesktopMenu();
                          }}
                          title="指数ビルダー"
                          aria-label="指数ビルダーへ移動"
                        >
                          <Sliders size={15} />
                          <span>指数ビルダー</span>
                        </button>
                      )}
                      {onNavigateToPortfolio && (
                        <button
                          type="button"
                          role="menuitem"
                          className={`header-desktop-dropdown-item ${currentView === "portfolio" ? "active" : ""}`}
                          onClick={() => {
                            onNavigateToPortfolio();
                            closeDesktopMenu();
                          }}
                          title="開発者ポートフォリオ・自己紹介"
                          aria-label="開発者ポートフォリオ・自己紹介へ移動"
                        >
                          <Briefcase size={15} />
                          <span>ポートフォリオ</span>
                        </button>
                      )}
                      {onNavigateToDisclaimer && (
                        <button
                          type="button"
                          role="menuitem"
                          className={`header-desktop-dropdown-item ${currentView === "disclaimer" ? "active" : ""}`}
                          onClick={() => {
                            onNavigateToDisclaimer();
                            closeDesktopMenu();
                          }}
                          title="免責事項・利用規約"
                          aria-label="免責事項へ移動"
                        >
                          <FileText size={15} />
                          <span>免責事項</span>
                        </button>
                      )}
                      {onNavigateToTutorial && (
                        <button
                          type="button"
                          role="menuitem"
                          className={`header-desktop-dropdown-item ${currentView === "tutorial" ? "active" : ""}`}
                          onClick={() => {
                            onNavigateToTutorial();
                            closeDesktopMenu();
                          }}
                          title="操作チュートリアルガイド"
                          aria-label="操作チュートリアルへ移動"
                        >
                          <Compass size={15} />
                          <span>操作チュートリアル</span>
                        </button>
                      )}
                      {isAdmin && onNavigateToAdmin && (
                        <button
                          type="button"
                          role="menuitem"
                          className={`header-desktop-dropdown-item ${currentView === "admin" ? "active" : ""}`}
                          onClick={() => {
                            onNavigateToAdmin();
                            closeDesktopMenu();
                          }}
                          title="管理者ページ"
                          aria-label="管理者ページへ移動"
                        >
                          <Shield size={15} />
                          <span>管理者ページ</span>
                        </button>
                      )}
                      {isAuthenticated && (
                        <>
                          <div className="header-desktop-dropdown-divider" aria-hidden="true" />
                          <button
                            type="button"
                            role="menuitem"
                            className="header-desktop-dropdown-item header-desktop-dropdown-logout"
                            onClick={() => {
                              handleLogout();
                              closeDesktopMenu();
                            }}
                          >
                            <LogIn size={15} style={{ transform: "scaleX(-1)" }} />
                            <span>ログアウト</span>
                          </button>
                        </>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
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
              {/* Mobile Data Freshness Header */}
              <div className="header-mobile-meta-section">
                <DataFreshness
                  benchmarkUpdatedAt={benchmarkUpdatedAt}
                  calculationUpdatedAt={calculationUpdatedAt}
                  loading={dataLoading}
                  syncing={syncing}
                  stale={benchmarkStale}
                  hasSyncWarning={hasSyncWarning}
                />
              </div>

              {/* Mobile Auth Bar */}
              <div className="header-mobile-auth-section">
                {isAuthenticated ? (
                  <div className="row space-between" style={{ alignItems: "center", width: "100%" }}>
                    <Badge variant={isAdmin ? "magenta" : "cyan"}>
                      {isAdmin ? <ShieldCheck size={12} /> : <KeyRound size={12} />}
                      <span>{session?.name}</span>
                      {limitsText && <span style={{ opacity: 0.85, fontSize: 10 }}>{limitsText}</span>}
                    </Badge>
                    <button
                      type="button"
                      onClick={() => {
                        handleLogout();
                        closeMobileMenu();
                      }}
                      className="btn btn-sm btn-outline"
                      style={{ padding: "5px 10px", fontSize: 11 }}
                    >
                      ログアウト
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="btn btn-sm btn-outline"
                    style={{ width: "100%", justifyContent: "center", gap: 6, padding: "8px 12px" }}
                    onClick={() => {
                      setIsAuthModalOpen(true);
                      closeMobileMenu();
                    }}
                  >
                    <LogIn size={14} style={{ color: "var(--accent-text)" }} />
                    <span>パスワード認証でログイン</span>
                  </button>
                )}
              </div>

              <div className="header-mobile-nav-links">
                {onNavigateToHome && (
                  <button
                    type="button"
                    className={`header-mobile-nav-item ${currentView === "dashboard" ? "active" : ""}`}
                    onClick={() => {
                      onNavigateToHome();
                      closeMobileMenu();
                    }}
                    title="ダッシュボード"
                    aria-label="ダッシュボードへ移動"
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
                    title="指数ビルダー＆シミュレーター"
                    aria-label="指数ビルダー＆シミュレーターへ移動"
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
                    title="開発者ポートフォリオ・自己紹介"
                    aria-label="開発者ポートフォリオ・自己紹介へ移動"
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
                    title="免責事項・利用規約"
                    aria-label="免責事項へ移動"
                  >
                    <FileText size={16} />
                    <span>免責事項</span>
                  </button>
                )}
                {onNavigateToTutorial && (
                  <button
                    type="button"
                    className={`header-mobile-nav-item ${currentView === "tutorial" ? "active" : ""}`}
                    onClick={() => {
                      onNavigateToTutorial();
                      closeMobileMenu();
                    }}
                    title="操作チュートリアルガイド"
                    aria-label="操作チュートリアルへ移動"
                  >
                    <Compass size={16} />
                    <span>操作チュートリアル</span>
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
                    title="管理者ページ"
                    aria-label="管理者ページへ移動"
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
