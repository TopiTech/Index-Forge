import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion } from "framer-motion";
import {
  Briefcase,
  TrendingUp,
  TrendingDown,
  Plus,
  Trash2,
  Sparkles,
  BookmarkPlus,
  Check,
  Lock,
  KeyRound,
  Eye,
  EyeOff,
  ArrowLeft,
  AlertCircle,
  RefreshCw,
  Download,
  Upload,
  PieChart,
  Coins,
  Shield,
  User,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { ModalBase } from "./ModalBase";
import { TurnstileWidget, type TurnstileWidgetRef } from "./TurnstileWidget";
import { getTurnstileConfig } from "../lib/auth";
import {
  loadPortfolioPositions,
  savePortfolioPositions,
  loadWatchlist,
  saveWatchlist,
  hasPersistedPortfolio,
  hasPersistedWatchlist,
  calculatePortfolioSummary,
  convertPortfolioToCustomIndexBasket,
  type PortfolioPosition,
} from "../lib/portfolioStorage";
import {
  serializePortfolioToCsv,
  deserializePortfolioFromCsv,
  calculateDiversificationScore,
} from "../lib/indexSerialization";
import { toSafeDownloadFileName } from "../lib/downloadFileName";
import {
  getStockFundamentals,
  fetchStockFundamentals,
  type StockQuoteFundamentals,
} from "../lib/marketDataService";
import { POPULAR_STOCKS, PRESET_STOCKS, searchPopularStocks } from "../data/popularStocks";
import { DEFAULT_USD_JPY_RATE } from "../data/marketConstants";
import { getStockCurrency } from "../lib/currency";
import type { PageView } from "../lib/navigation";
import { useToast } from "./Toast";

interface PortfolioManagerPageProps {
  onNavigate: (view: PageView, searchParams?: string) => void;
  onOpenStockDetail: (ticker: string) => void;
  onConvertAndCreateCustomIndex?: (
    basket: { ticker: string; name: string; theme: string; weight: number }[],
  ) => void;
}

const SECTOR_COLORS = [
  "#00e5ff",
  "#a855f7",
  "#10b981",
  "#f59e0b",
  "#ec4899",
  "#3b82f6",
  "#14b8a6",
  "#8b5cf6",
  "#f97316",
  "#64748b",
];

export function PortfolioManagerPage({
  onNavigate,
  onOpenStockDetail,
  onConvertAndCreateCustomIndex,
}: PortfolioManagerPageProps) {
  const { isAuthenticated, login, adminLogin, loading: authLoading } = useAuth();
  const [positions, setPositions] = useState<PortfolioPosition[]>(() =>
    isAuthenticated ? loadPortfolioPositions() : [],
  );
  const [watchlist, setWatchlist] = useState<string[]>(() =>
    isAuthenticated ? loadWatchlist() : [],
  );
  const [liveQuotes, setLiveQuotes] = useState<Map<string, StockQuoteFundamentals>>(new Map());
  // Live USD/JPY rate for the JPY valuation of USD positions. Kept out of
  // liveQuotes so the summary never picks up a demo/reference FX price from
  // the map; when unset the summary keeps its documented fallback constant.
  const [usdJpyRate, setUsdJpyRate] = useState<number | undefined>(undefined);
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<"HOLDINGS" | "WATCHLIST">("HOLDINGS");
  // The preset portfolio/watchlist is a first-visit preview. Persisting it
  // before the user edits the lists would silently store holdings they never
  // entered, so the save effects stay disabled until the first user edit.
  const positionsPersistedRef = useRef(hasPersistedPortfolio());
  const watchlistPersistedRef = useRef(hasPersistedWatchlist());
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { success, info } = useToast();

  // Auth gate inline login state
  const [authMode, setAuthMode] = useState<"admin" | "user">("admin");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [authSecretCode, setAuthSecretCode] = useState("");
  const [showSecretCode, setShowSecretCode] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("1x00000000000000000000AA");
  const [isLocked, setIsLocked] = useState(false);
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState(0);
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [isSubmittingAuth, setIsSubmittingAuth] = useState(false);
  const turnstileRef = useRef<TurnstileWidgetRef>(null);

  // New position form state
  const [newTicker, setNewTicker] = useState("7203");
  const [newName, setNewName] = useState("トヨタ自動車");
  const [newShares, setNewShares] = useState("100");
  const [newAverageCost, setNewAverageCost] = useState("2500");
  const [addError, setAddError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
    };
  }, []);

  // Fetch Turnstile config and lockout state if unauthenticated
  useEffect(() => {
    if (isAuthenticated) return;
    let isMounted = true;
    getTurnstileConfig().then((cfg) => {
      if (!isMounted) return;
      if (cfg.siteKey) setTurnstileSiteKey(cfg.siteKey);
      if (cfg.lockout) {
        setIsLocked(cfg.lockout.locked);
        setLockoutRemainingSeconds(cfg.lockout.remainingSeconds);
        setRemainingAttempts(cfg.lockout.remainingAttempts);
      }
    });
    return () => {
      isMounted = false;
    };
  }, [isAuthenticated]);

  // Lockout countdown timer
  useEffect(() => {
    if (!isLocked || lockoutRemainingSeconds <= 0) return;
    const timer = setInterval(() => {
      setLockoutRemainingSeconds((prev) => {
        if (prev <= 1) {
          setIsLocked(false);
          setAuthError(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [isLocked, lockoutRemainingSeconds]);

  // Synchronize positions & watchlist immediately when auth transition occurs
  // during render to prevent overwriting saved data with unauthenticated empty arrays
  const prevAuthRef = useRef(isAuthenticated);
  if (!prevAuthRef.current && isAuthenticated) {
    prevAuthRef.current = true;
    setPositions(loadPortfolioPositions());
    setWatchlist(loadWatchlist());
  } else if (prevAuthRef.current && !isAuthenticated) {
    prevAuthRef.current = false;
    setPositions([]);
    setWatchlist([]);
  }

  // Synchronize positions & watchlist when auth state changes
  useEffect(() => {
    if (isAuthenticated) {
      setPositions(loadPortfolioPositions());
      setWatchlist(loadWatchlist());
    } else {
      setPositions([]);
      setWatchlist([]);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && positionsPersistedRef.current) {
      savePortfolioPositions(positions);
    }
  }, [positions, isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && watchlistPersistedRef.current) {
      saveWatchlist(watchlist);
    }
  }, [watchlist, isAuthenticated]);

  const handleInlineLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = authPassword.trim();

    if (authMode === "admin") {
      if (isLocked) {
        setAuthError(`アカウントが一時ロックされています。残り約${Math.ceil(lockoutRemainingSeconds / 60)}分後に再試行してください。`);
        return;
      }
      if (!trimmed) {
        setAuthError("管理者パスワードを入力してください");
        return;
      }
      if (!authSecretCode.trim()) {
        setAuthError("秘密の暗号を入力してください（ひらがな・カタカナも入力可能です）");
        return;
      }
      if (!turnstileToken.trim()) {
        setAuthError("Turnstile認証（ロボット確認）を完了してください");
        return;
      }

      setAuthError(null);
      setIsSubmittingAuth(true);
      const res = await adminLogin(
        trimmed,
        authSecretCode.normalize("NFC").trim(),
        turnstileToken.trim(),
      );
      if (!mountedRef.current) return;
      setIsSubmittingAuth(false);

      if (res.ok) {
        setPositions(loadPortfolioPositions());
        setWatchlist(loadWatchlist());
        setAuthPassword("");
        setAuthSecretCode("");
        setTurnstileToken("");
        success("管理者としてログインしました。ポートフォリオ管理機能をご利用いただけます。");
      } else {
        if (res.locked) {
          setIsLocked(true);
          setLockoutRemainingSeconds(res.remainingSeconds || 900);
          setRemainingAttempts(0);
        } else if (typeof res.remainingAttempts === "number") {
          setRemainingAttempts(res.remainingAttempts);
        }
        setAuthError(res.error || "管理者認証に失敗しました");
        if (turnstileRef.current) {
          turnstileRef.current.reset();
          setTurnstileToken("");
        }
      }
    } else {
      if (!trimmed) {
        setAuthError("パスワードを入力してください");
        return;
      }

      setAuthError(null);
      setIsSubmittingAuth(true);
      const res = await login(trimmed);
      if (!mountedRef.current) return;
      setIsSubmittingAuth(false);
      if (res.ok) {
        setPositions(loadPortfolioPositions());
        setWatchlist(loadWatchlist());
        setAuthPassword("");
        success("ログインしました。ポートフォリオ管理機能をご利用いただけます。");
      } else {
        setAuthError(res.error || "パスワードが正しくありません");
      }
    }
  };

  const loadLiveQuotes = useCallback(
    async (forceRefresh = false) => {
      const needsUsdJpy = positions.some((p) => getStockCurrency(p.ticker) === "$");
      const allTickers = Array.from(
        new Set([
          ...positions.map((p) => p.ticker),
          ...watchlist,
          // Only fetched when a USD position exists: the JPY totals otherwise
          // silently used a hardcoded FX constant instead of the live rate.
          ...(needsUsdJpy ? ["USDJPY=X"] : []),
        ]),
      );
      if (allTickers.length === 0) return;
      const requestId = ++requestIdRef.current;
      setRefreshing(true);
      try {
        const entries = await Promise.all(
          allTickers.map(async (ticker) => {
            try {
              const data = await fetchStockFundamentals(ticker, forceRefresh);
              return [ticker.toUpperCase(), data] as const;
            } catch {
              return null;
            }
          }),
        );
        if (!mountedRef.current || requestId !== requestIdRef.current) return;
        setLiveQuotes((prev) => {
          const next = new Map(prev);
          for (const entry of entries) {
            if (entry && entry[0] !== "USDJPY=X") {
              next.set(entry[0], entry[1]);
            }
          }
          return next;
        });
        const fxEntry = entries.find((entry) => entry && entry[0] === "USDJPY=X");
        if (
          fxEntry &&
          !fxEntry[1].isDemoData &&
          Number.isFinite(fxEntry[1].price) &&
          fxEntry[1].price > 0
        ) {
          setUsdJpyRate(fxEntry[1].price);
        }
      } finally {
        if (mountedRef.current && requestId === requestIdRef.current) {
          setRefreshing(false);
        }
      }
    },
    [positions, watchlist],
  );

  useEffect(() => {
    if (isAuthenticated) {
      void loadLiveQuotes();
    }
  }, [isAuthenticated, loadLiveQuotes]);

  const summary = calculatePortfolioSummary(positions, liveQuotes, usdJpyRate);
  const isTotalProfitPositive = summary.totalProfit >= 0;
  const isDailyProfitPositive = summary.dailyTotalChange >= 0;

  const handleAddPosition = (e: React.FormEvent) => {
    e.preventDefault();
    const ticker = newTicker.trim().toUpperCase();
    const shares = parseFloat(newShares);
    const avgCost = parseFloat(newAverageCost);

    if (!ticker) {
      setAddError("銘柄コードを入力してください");
      return;
    }
    if (!/^[A-Za-z0-9.-]{1,20}$/.test(ticker)) {
      setAddError("銘柄コードは英数字、ハイフン、ピリオド（最大20文字）で入力してください (例: 7203, AAPL)");
      return;
    }
    if (isNaN(shares) || shares <= 0) {
      setAddError("保有株数は正の数値を入力してください");
      return;
    }
    if (isNaN(avgCost) || avgCost <= 0) {
      setAddError("平均取得単価は正の数値を入力してください");
      return;
    }

    const fund = getStockFundamentals(ticker);
    const resolvedName = newName.trim() || fund.name || ticker;

    const newPos: PortfolioPosition = {
      id: `pos-${Date.now()}`,
      ticker,
      name: resolvedName,
      shares,
      averageCost: avgCost,
      acquiredAt: new Date().toISOString().split("T")[0],
    };

    setAddError(null);
    const isFirstPersist = !positionsPersistedRef.current;
    positionsPersistedRef.current = true;
    setPositions((prev) => (isFirstPersist ? [newPos] : [...prev, newPos]));
    setIsAddModalOpen(false);
    success(`「${resolvedName} (${ticker})」を保有ポートフォリオに追加しました`);
  };

  const handleDeletePosition = (id: string, name: string) => {
    positionsPersistedRef.current = true;
    setPositions((prev) => prev.filter((p) => p.id !== id));
    info(`「${name}」をポートフォリオから削除しました`);
  };

  const handleRemoveFromWatchlist = (ticker: string) => {
    watchlistPersistedRef.current = true;
    setWatchlist((prev) => prev.filter((t) => t !== ticker));
    info(`「${ticker}」をウォッチリストから削除しました`);
  };

  const handleConvertToCustomIndex = () => {
    const basket = convertPortfolioToCustomIndexBasket(positions, usdJpyRate);
    if (basket.length === 0) return;

    if (onConvertAndCreateCustomIndex) {
      onConvertAndCreateCustomIndex(basket);
    } else {
      onNavigate("builder");
    }
    success(`保有ポートフォリオ（${basket.length}銘柄）を指数ビルダーに一括エクスポートしました！`);
  };

  const handleExportCsv = () => {
    if (positions.length === 0) {
      info("エクスポートする保有銘柄がありません");
      return;
    }
    const csv = serializePortfolioToCsv(positions);
    // Excelでの文字化け防止のためUTF-8 BOMを付与
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = toSafeDownloadFileName(
      `indexforge_portfolio_${new Date().toISOString().split("T")[0]}.csv`,
      "portfolio.csv",
    );
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    success("ポートフォリオ（CSV形式）をダウンロードしました");
  };

  const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;
      try {
        const res = deserializePortfolioFromCsv(content);
        if (!res.ok) {
          info(res.error || "有効な保有銘柄データが見つかりませんでした");
          return;
        }
        if (res.data.length === 0) {
          info("有効な保有銘柄データが見つかりませんでした");
          return;
        }
        positionsPersistedRef.current = true;
        setPositions(res.data);
        success(`${res.data.length}件の保有銘柄をCSVからインポートしました`);
      } catch {
        info("CSVファイルの読み込みまたは解析に失敗しました");
      } finally {
        if (fileInputRef.current) {
          fileInputRef.current.value = "";
        }
      }
    };
    reader.readAsText(file, "UTF-8");
  };

  const sectorAllocation = useMemo(() => {
    if (summary.positions.length === 0 || summary.totalMarketValue === 0) return [];
    const sectorMap = new Map<string, { name: string; valueJpy: number; count: number }>();
    for (const pos of summary.positions) {
      const sec = pos.sector?.trim() || pos.theme?.trim() || "その他";
      const existing = sectorMap.get(sec) || { name: sec, valueJpy: 0, count: 0 };
      existing.valueJpy += pos.marketValueJpy ?? pos.marketValue;
      existing.count += 1;
      sectorMap.set(sec, existing);
    }
    const total = summary.totalMarketValue;
    return Array.from(sectorMap.values())
      .map((item) => ({
        ...item,
        percent: Number(((item.valueJpy / total) * 100).toFixed(1)),
      }))
      .sort((a, b) => b.valueJpy - a.valueJpy);
  }, [summary.positions, summary.totalMarketValue]);

  const diversification = useMemo(() => {
    return calculateDiversificationScore(
      summary.positions.map((p) => p.weightPercent),
    );
  }, [summary.positions]);

  if (!isAuthenticated) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
        className="page-container portfolio-manager-page portfolio-auth-gate"
      >
        {/* Subpage Top Bar */}
        <div
          className="subpage-nav-bar"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "24px",
          }}
        >
          <button
            type="button"
            onClick={() => onNavigate("dashboard")}
            className="btn btn-default subpage-back-btn"
            aria-label="ダッシュボードへ戻る"
          >
            <ArrowLeft size={16} />
            <span>ダッシュボードに戻る</span>
          </button>
          <span className="mono tiny muted uppercase">ASSET MANAGEMENT · LOGIN REQUIRED</span>
        </div>

        {/* Hero Header */}
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              marginBottom: "8px",
            }}
          >
            <span className="badge badge-accent mono tiny">
              <Lock size={12} /> AUTH REQUIRED
            </span>
            <span className="tiny muted mono">MEMBERS ONLY</span>
          </div>
          <h1 className="page-header-title" style={{ fontSize: "1.9rem", margin: "4px 0 8px" }}>
            マイ・ポートフォリオ & ウォッチリスト
          </h1>
          <p
            className="muted"
            style={{ maxWidth: "620px", margin: "0 auto", fontSize: "0.95rem", lineHeight: 1.6 }}
          >
            実際の保有株式の損益・利回り管理、ウォッチリスト、および保有資産に基づく客観的カスタム指数バックテストはログインユーザー限定の機能です。
          </p>
        </div>

        {/* Login Form Card */}
        <div style={{ maxWidth: "480px", margin: "0 auto 40px" }}>
          <div
            className="card portfolio-gate-card"
            style={{
              padding: "32px 28px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border-cyan)",
              borderRadius: "16px",
              boxShadow: "0 20px 50px rgba(0, 0, 0, 0.4), 0 0 30px rgba(0, 229, 255, 0.12)",
            }}
          >
            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <div
                style={{
                  width: "56px",
                  height: "56px",
                  margin: "0 auto 14px",
                  borderRadius: "50%",
                  background: "rgba(0, 229, 255, 0.12)",
                  border: "1px solid var(--border-cyan)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Lock size={26} style={{ color: "var(--neon-cyan)" }} />
              </div>
              <h2 style={{ fontSize: "1.25rem", fontWeight: 700, margin: "0 0 6px" }}>
                ポートフォリオのロック解除
              </h2>
              <p className="tiny muted" style={{ margin: 0 }}>
                パスワードを入力してポートフォリオ管理機能を開始してください
              </p>
            </div>

            {/* Mode Selector Tabs */}
            <div
              role="tablist"
              aria-label="認証モード切替"
              style={{
                display: "flex",
                gap: 6,
                padding: 4,
                background: "rgba(15, 23, 42, 0.6)",
                borderRadius: 10,
                border: "1px solid var(--border-subtle)",
                marginBottom: 20,
              }}
            >
              <button
                type="button"
                role="tab"
                aria-selected={authMode === "admin"}
                onClick={() => {
                  setAuthMode("admin");
                  setAuthError(null);
                }}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  transition: "all 0.15s ease",
                  background: authMode === "admin" ? "var(--bg-card-hover, rgba(0, 229, 255, 0.15))" : "transparent",
                  color: authMode === "admin" ? "var(--neon-cyan, #00e5ff)" : "var(--text-muted)",
                  boxShadow: authMode === "admin" ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
                }}
              >
                <Shield size={14} />
                管理者ログイン
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={authMode === "user"}
                onClick={() => {
                  setAuthMode("user");
                  setAuthError(null);
                }}
                style={{
                  flex: 1,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 6,
                  padding: "8px 12px",
                  borderRadius: 8,
                  border: "none",
                  cursor: "pointer",
                  fontSize: 13,
                  fontWeight: 600,
                  transition: "all 0.15s ease",
                  background: authMode === "user" ? "var(--bg-card-hover, rgba(255, 255, 255, 0.1))" : "transparent",
                  color: authMode === "user" ? "var(--text-primary)" : "var(--text-muted)",
                  boxShadow: authMode === "user" ? "0 1px 3px rgba(0,0,0,0.3)" : "none",
                }}
              >
                <User size={14} />
                一般ユーザー
              </button>
            </div>

            {/* Lockout Warning */}
            {isLocked && (
              <div
                role="alert"
                aria-live="assertive"
                className="row"
                style={{
                  gap: 8,
                  padding: "10px 14px",
                  background: "rgba(255, 51, 102, 0.2)",
                  border: "1px solid var(--neon-red)",
                  borderRadius: "8px",
                  color: "var(--neon-red)",
                  fontSize: "12px",
                  marginBottom: "18px",
                }}
              >
                <Lock size={16} style={{ flexShrink: 0 }} />
                <div>
                  <strong>セキュリティロック発動中</strong>
                  <div style={{ marginTop: 2 }}>
                    試行上限超過のため一時ロックされています。
                    残り約{Math.ceil(lockoutRemainingSeconds / 60)}分（{lockoutRemainingSeconds}秒）後に再試行できます。
                  </div>
                </div>
              </div>
            )}

            {authError && !isLocked && (
              <div
                role="alert"
                aria-live="assertive"
                className="row"
                style={{
                  gap: 8,
                  padding: "10px 14px",
                  background: "rgba(255, 51, 102, 0.15)",
                  border: "1px solid var(--neon-red)",
                  borderRadius: "8px",
                  color: "var(--neon-red)",
                  fontSize: "13px",
                  marginBottom: "18px",
                }}
              >
                <AlertCircle size={16} style={{ flexShrink: 0 }} />
                <span>{authError}</span>
              </div>
            )}

            <form onSubmit={handleInlineLogin}>
              <div style={{ marginBottom: "18px" }}>
                <label
                  htmlFor="portfolio-auth-input"
                  style={{
                    display: "block",
                    fontSize: "12px",
                    fontWeight: 600,
                    color: "var(--text-secondary)",
                    marginBottom: "6px",
                  }}
                >
                  {authMode === "admin" ? "管理者パスワード" : "アクセスパスワード"} <span style={{ color: "var(--neon-red)" }}>*必須</span>
                </label>
                <div style={{ position: "relative" }}>
                  <input
                    id="portfolio-auth-input"
                    type={showPassword ? "text" : "password"}
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder={authMode === "admin" ? "管理者パスワード" : "ユーザーまたは管理者パスワード"}
                    autoComplete="current-password"
                    disabled={isSubmittingAuth || authLoading || isLocked}
                    style={{
                      width: "100%",
                      padding: "11px 44px 11px 14px",
                      background: "var(--bg-input)",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: "8px",
                      color: "var(--text-primary)",
                      fontSize: "14px",
                      boxSizing: "border-box",
                    }}
                  />
                  <button
                    type="button"
                    className="password-visibility-btn"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? "パスワードを隠す" : "パスワードを表示"}
                    aria-pressed={showPassword}
                    style={{
                      position: "absolute",
                      right: "10px",
                      top: "50%",
                      transform: "translateY(-50%)",
                      background: "transparent",
                      border: "none",
                      color: "var(--text-secondary)",
                      cursor: "pointer",
                      padding: "4px",
                      display: "flex",
                      alignItems: "center",
                    }}
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <p className="tiny muted" style={{ margin: "6px 0 0", fontSize: "11px" }}>
                  {authMode === "admin"
                    ? "※ マスター管理者のパスワードを入力してください"
                    : "※ 管理者パスワード、または管理者が発行したユーザーパスワードを入力してください"}
                </p>
              </div>

              {/* Admin-only fields: Secret Code + Turnstile */}
              {authMode === "admin" && (
                <>
                  <div style={{ marginBottom: "18px" }}>
                    <label
                      htmlFor="portfolio-secret-code-input"
                      style={{
                        display: "block",
                        fontSize: "12px",
                        fontWeight: 600,
                        color: "var(--text-secondary)",
                        marginBottom: "6px",
                      }}
                    >
                      秘密の暗号 (Admin Secret Code) <span style={{ color: "var(--neon-red)" }}>*必須</span>
                    </label>
                    <div style={{ position: "relative" }}>
                      <input
                        id="portfolio-secret-code-input"
                        type="text"
                        inputMode="text"
                        lang="ja"
                        autoComplete="off"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck="false"
                        value={authSecretCode}
                        onChange={(e) => setAuthSecretCode(e.target.value)}
                        placeholder="ひらがな・カタカナ・英数字・記号で入力"
                        disabled={isSubmittingAuth || authLoading || isLocked}
                        style={{
                          width: "100%",
                          padding: "11px 44px 11px 14px",
                          background: "var(--bg-input)",
                          border: "1px solid var(--border-subtle)",
                          borderRadius: "8px",
                          color: "var(--text-primary)",
                          fontSize: "14px",
                          boxSizing: "border-box",
                          WebkitTextSecurity: showSecretCode ? "none" : "disc",
                        } as React.CSSProperties}
                      />
                      <button
                        type="button"
                        className="password-visibility-btn"
                        onClick={() => setShowSecretCode(!showSecretCode)}
                        aria-label={showSecretCode ? "秘密の暗号を隠す" : "秘密の暗号を表示"}
                        aria-pressed={showSecretCode}
                        style={{
                          position: "absolute",
                          right: "10px",
                          top: "50%",
                          transform: "translateY(-50%)",
                          background: "transparent",
                          border: "none",
                          color: "var(--text-secondary)",
                          cursor: "pointer",
                          padding: "4px",
                          display: "flex",
                          alignItems: "center",
                        }}
                      >
                        {showSecretCode ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    <div className="tiny muted" style={{ margin: "6px 0 0", fontSize: "11px", lineHeight: 1.4 }}>
                      ※ ひらがな・カタカナ・漢字・英数記号も自由に入力できます（全角・半角完全対応）。
                      {remainingAttempts !== null && (
                        <span style={{ marginLeft: 6, color: remainingAttempts <= 2 ? "var(--neon-red)" : "inherit" }}>
                          (残り試行可能回数: {remainingAttempts}回)
                        </span>
                      )}
                    </div>
                  </div>

                  {!isLocked && (
                    <div style={{ marginBottom: "18px" }}>
                      <label
                        style={{
                          display: "block",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: "var(--text-secondary)",
                          marginBottom: "4px",
                        }}
                      >
                        ロボット検証 (Turnstile) <span style={{ color: "var(--neon-red)" }}>*必須</span>
                      </label>
                      <TurnstileWidget
                        ref={turnstileRef}
                        siteKey={turnstileSiteKey}
                        onVerify={(token) => {
                          setTurnstileToken(token);
                          setAuthError(null);
                        }}
                        onError={(err) => {
                          setAuthError(err || "セキュリティ認証エラーが発生しました");
                        }}
                        onExpire={() => {
                          setTurnstileToken("");
                        }}
                      />
                    </div>
                  )}
                </>
              )}

              <div style={{ display: "flex", gap: "10px", marginTop: "24px" }}>
                <button
                  type="button"
                  onClick={() => onNavigate("dashboard")}
                  className="btn btn-default"
                  style={{ flex: 1 }}
                >
                  ダッシュボードへ戻る
                </button>
                <button
                  type="submit"
                  className="btn btn-accent"
                  style={{
                    flex: 2,
                    display: "inline-flex",
                    justifyContent: "center",
                    alignItems: "center",
                    gap: "6px",
                    background: authMode === "admin" ? "var(--neon-cyan, #00e5ff)" : undefined,
                    color: authMode === "admin" ? "#0a0e17" : undefined,
                    fontWeight: 600,
                  }}
                  disabled={
                    isSubmittingAuth ||
                    authLoading ||
                    isLocked ||
                    !authPassword.trim() ||
                    (authMode === "admin" && (!authSecretCode.trim() || !turnstileToken.trim()))
                  }
                >
                  <KeyRound size={15} />
                  <span>
                    {isSubmittingAuth || authLoading ? "認証中..." : "ログインして利用開始"}
                  </span>
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Feature Highlights Grid */}
        <div style={{ maxWidth: "900px", margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: "18px" }}>
            <span className="mono tiny muted uppercase">FEATURE HIGHLIGHTS</span>
            <h3 style={{ fontSize: "1.1rem", margin: "4px 0 0" }}>ログインで利用可能になる機能</h3>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: "16px",
            }}
          >
            <div className="card" style={{ padding: "20px 22px" }}>
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}
              >
                <div
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    background: "rgba(0, 229, 255, 0.12)",
                    color: "var(--neon-cyan)",
                    display: "flex",
                  }}
                >
                  <Briefcase size={20} />
                </div>
                <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
                  リアルタイム損益・利回り管理
                </h4>
              </div>
              <p className="tiny muted" style={{ margin: 0, lineHeight: 1.6 }}>
                保有株数や取得単価を登録し、時価評価額、トータル損益、本日前日比損益および年間予想配当金をリアルタイムで一元管理できます。
              </p>
            </div>

            <div className="card" style={{ padding: "20px 22px" }}>
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}
              >
                <div
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    background: "rgba(168, 85, 247, 0.12)",
                    color: "var(--neon-magenta)",
                    display: "flex",
                  }}
                >
                  <Sparkles size={20} />
                </div>
                <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
                  ワンクリック指数化バックテスト
                </h4>
              </div>
              <p className="tiny muted" style={{ margin: 0, lineHeight: 1.6 }}>
                保有株式の時価評価額比率からオリジナルカスタム指数を瞬時に自動生成し、日経平均やS&P
                500との客観的なリスク・リターン比較を実行できます。
              </p>
            </div>

            <div className="card" style={{ padding: "20px 22px" }}>
              <div
                style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "10px" }}
              >
                <div
                  style={{
                    padding: "8px",
                    borderRadius: "8px",
                    background: "rgba(16, 185, 129, 0.12)",
                    color: "var(--neon-green)",
                    display: "flex",
                  }}
                >
                  <BookmarkPlus size={20} />
                </div>
                <h4 style={{ margin: 0, fontSize: "1rem", fontWeight: 600 }}>
                  銘柄監視ウォッチリスト
                </h4>
              </div>
              <p className="tiny muted" style={{ margin: 0, lineHeight: 1.6 }}>
                気になる銘柄を登録して株価や前日比騰落率を素早く確認でき、財務指標やインタラクティブチャート分析へシームレスにアクセスできます。
              </p>
            </div>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="page-container portfolio-manager-page"
    >
      {/* Top Banner */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: "24px",
          flexWrap: "wrap",
          gap: "16px",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
            <span className="badge badge-accent mono tiny">ASSET & WATCHLIST TRACKER</span>
            <span className="tiny muted mono">REAL PORTFOLIO MANAGEMENT</span>
          </div>
          <h2 className="page-header-title">マイ・ポートフォリオ & ウォッチリスト</h2>
          <p className="muted tiny" style={{ margin: "4px 0 0" }}>
            実際の保有株式の損益・利回り管理と、ワンクリックでの客観的カスタム指数バックテスト
          </p>
        </div>

        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => void loadLiveQuotes(true)}
            disabled={refreshing}
            title="最新の株価・損益を再取得"
          >
            <RefreshCw size={13} className={refreshing ? "spin" : ""} />
            <span>更新</span>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={handleExportCsv}
            disabled={positions.length === 0}
            title="ポートフォリオ保有銘柄をCSV形式でダウンロード"
          >
            <Download size={13} />
            <span>CSV出力</span>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => fileInputRef.current?.click()}
            title="CSV形式のポートフォリオファイルをインポート"
          >
            <Upload size={13} />
            <span>CSV取込</span>
          </button>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportCsv}
            accept=".csv,text/csv"
            style={{ display: "none" }}
            aria-label="ポートフォリオCSVファイルをアップロード"
          />
          <button
            type="button"
            className="btn btn-sm btn-accent"
            onClick={handleConvertToCustomIndex}
            title="保有株の評価額比率でオリジナル指数を即座に作成し、ベンチマーク比較バックテストを実行"
          >
            <Sparkles size={14} />
            <span>★ ワンクリックで指数化</span>
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            onClick={() => setIsAddModalOpen(true)}
          >
            <Plus size={14} />
            <span>保有銘柄を追加</span>
          </button>
        </div>
      </div>

      {/* Sample Portfolio Preview Notice */}
      {!hasPersistedPortfolio() && positions.length > 0 && (
        <div
          role="note"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "12px",
            padding: "10px 16px",
            marginBottom: "16px",
            borderRadius: "8px",
            background: "rgba(0, 229, 255, 0.08)",
            border: "1px solid var(--border-cyan)",
            fontSize: "0.85rem",
            color: "var(--accent-text)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Sparkles size={16} style={{ flexShrink: 0 }} />
            <span>
              現在<strong>サンプルポートフォリオ（参考例）</strong>を表示しています。銘柄の追加・削除やCSV取込を行うと、あなた専用のマイポートフォリオに自動保存されます。
            </span>
          </div>
          <button
            type="button"
            className="btn btn-xs btn-outline"
            onClick={() => {
              positionsPersistedRef.current = true;
              setPositions([]);
              info("サンプルポートフォリオをクリアしました");
            }}
          >
            <span>クリアして新規作成</span>
          </button>
        </div>
      )}

      {/* FX Rate & Currency Conversion Notice */}
      <div
        className="card"
        style={{
          padding: "10px 16px",
          marginBottom: "16px",
          background: "rgba(0, 229, 255, 0.04)",
          border: "1px solid var(--border-cyan)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "8px",
          fontSize: "0.85rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Coins size={16} style={{ color: "var(--accent-text)" }} />
          <span>
            為替換算基準レート:{" "}
            <strong className="mono" style={{ color: "var(--neon-cyan)" }}>
              1 USD = {usdJpyRate ? usdJpyRate.toFixed(2) : DEFAULT_USD_JPY_RATE.toFixed(2)} JPY
            </strong>{" "}
            <span className="tiny muted">
              {usdJpyRate ? "(リアルタイム為替市場レート適用)" : "(基準参考レート)"}
            </span>
          </span>
        </div>
        <span className="tiny muted">
          ※ 米国株（USD）は為替レートに基づき円換算され、ポートフォリオ全体の円評価額・損益に合算されます
        </span>
      </div>

      {/* Financial Summary KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
          gap: "12px",
          marginBottom: "24px",
        }}
      >
        <div className="card" style={{ padding: "16px 18px" }}>
          <span className="tiny muted mono uppercase">総評価額 (現在価値)</span>
          <div className="mono bold" style={{ fontSize: "1.6rem", marginTop: 4 }}>
            ¥{summary.totalMarketValue.toLocaleString()}
          </div>
          <span className="tiny muted">取得総額: ¥{summary.totalCost.toLocaleString()}</span>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <span className="tiny muted mono uppercase">トータル含み損益</span>
          <div
            className="mono bold"
            style={{
              fontSize: "1.6rem",
              marginTop: 4,
              color: isTotalProfitPositive ? "var(--color-positive)" : "var(--color-negative)",
            }}
          >
            {isTotalProfitPositive ? "+" : ""}¥{summary.totalProfit.toLocaleString()}
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: "0.85rem",
              fontWeight: 600,
              color: isTotalProfitPositive ? "var(--color-positive)" : "var(--color-negative)",
            }}
            className="mono"
          >
            {isTotalProfitPositive ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            <span>
              {isTotalProfitPositive ? "+" : ""}
              {summary.totalProfitPercent.toFixed(2)}%
            </span>
          </div>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <span className="tiny muted mono uppercase">前日比 損益</span>
          <div
            className="mono bold"
            style={{
              fontSize: "1.6rem",
              marginTop: 4,
              color: isDailyProfitPositive ? "var(--color-positive)" : "var(--color-negative)",
            }}
          >
            {isDailyProfitPositive ? "+" : ""}¥{summary.dailyTotalChange.toLocaleString()}
          </div>
          <span className="tiny muted">本日の保有資産変動</span>
        </div>

        <div className="card" style={{ padding: "16px 18px" }}>
          <span className="tiny muted mono uppercase">年間予想配当金合計</span>
          <div className="mono bold" style={{ fontSize: "1.6rem", marginTop: 4, color: "var(--neon-green)" }}>
            ¥{summary.totalAnnualDividend.toLocaleString()}
          </div>
          <span className="tiny muted mono" style={{ color: "var(--accent-text)" }}>
            ポートフォリオ利回り: {summary.dividendYield.toFixed(2)}%
          </span>
        </div>
      </div>

      {/* Sector Allocation & Diversification Overview */}
      {positions.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
            gap: "12px",
            marginBottom: "24px",
          }}
        >
          {/* Sector Allocation Card */}
          <div className="card" style={{ padding: "16px 18px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <PieChart size={16} style={{ color: "var(--accent-text)" }} />
                <span className="tiny bold uppercase">業種・セクター配分比率</span>
              </div>
              <div
                className={`mono tiny ${
                  diversification.level === "HIGH"
                    ? "badge-diversification-high"
                    : diversification.level === "MODERATE"
                      ? "badge-diversification-mod"
                      : "badge-diversification-conc"
                }`}
                style={{ padding: "2px 8px", borderRadius: "12px" }}
                title={`HHI指数: ${diversification.hhi} - ${diversification.label}`}
              >
                HHI: {diversification.hhi} · {diversification.label}
              </div>
            </div>

            {/* Stacked Percentage Bar */}
            <div
              style={{
                height: "10px",
                width: "100%",
                background: "var(--surface-control)",
                borderRadius: "5px",
                overflow: "hidden",
                display: "flex",
                marginBottom: "12px",
              }}
            >
              {sectorAllocation.map((sec, idx) => (
                <div
                  key={sec.name}
                  style={{
                    width: `${sec.percent}%`,
                    backgroundColor: SECTOR_COLORS[idx % SECTOR_COLORS.length],
                  }}
                  title={`${sec.name}: ${sec.percent}% (¥${sec.valueJpy.toLocaleString()})`}
                />
              ))}
            </div>

            {/* Sector Tags Grid */}
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              {sectorAllocation.map((sec, idx) => (
                <div
                  key={sec.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    background: "var(--bg-input)",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: SECTOR_COLORS[idx % SECTOR_COLORS.length],
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontWeight: 500 }}>{sec.name}</span>
                  <span className="mono bold tabular-nums" style={{ color: "var(--accent-text)" }}>
                    {sec.percent}%
                  </span>
                  <span className="tiny muted mono tabular-nums">
                    (¥{sec.valueJpy.toLocaleString()})
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Dividend Projection Card */}
          <div className="card" style={{ padding: "16px 18px" }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: "12px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Coins size={16} style={{ color: "var(--neon-green)" }} />
                <span className="tiny bold uppercase">インカム & 年間配当受取予測</span>
              </div>
              <span className="tiny mono" style={{ color: "var(--accent-text)" }}>
                利回り: {summary.dividendYield.toFixed(2)}%
              </span>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "12px" }}>
              <div style={{ padding: "10px", background: "var(--bg-input)", borderRadius: "8px" }}>
                <div className="tiny muted uppercase mono">年間予想受取総額</div>
                <div className="mono bold tabular-nums" style={{ fontSize: "1.25rem", color: "var(--neon-green)", marginTop: "2px" }}>
                  ¥{summary.totalAnnualDividend.toLocaleString()}
                </div>
              </div>
              <div style={{ padding: "10px", background: "var(--bg-input)", borderRadius: "8px" }}>
                <div className="tiny muted uppercase mono">月平均換算 (目安)</div>
                <div className="mono bold tabular-nums" style={{ fontSize: "1.25rem", marginTop: "2px" }}>
                  ¥{Math.round(summary.totalAnnualDividend / 12).toLocaleString()}
                </div>
              </div>
            </div>

            <div className="tiny muted" style={{ lineHeight: 1.5 }}>
              ※ 保有株数と直近配当（DPS）実績に基づく年間税引前受取概算です。為替レート（USD/JPY）はリアルタイム取得値に連動します。
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "16px",
          borderBottom: "1px solid var(--border-subtle)",
          paddingBottom: "8px",
        }}
      >
        <button
          type="button"
          className={`btn btn-sm ${activeTab === "HOLDINGS" ? "btn-accent" : "btn-ghost"}`}
          onClick={() => setActiveTab("HOLDINGS")}
        >
          <Briefcase size={14} />
          <span>保有株式一覧 ({positions.length}銘柄)</span>
        </button>
        <button
          type="button"
          className={`btn btn-sm ${activeTab === "WATCHLIST" ? "btn-accent" : "btn-ghost"}`}
          onClick={() => setActiveTab("WATCHLIST")}
        >
          <BookmarkPlus size={14} />
          <span>監視中ウォッチリスト ({watchlist.length}銘柄)</span>
        </button>
      </div>

      {/* Tab 1: Holdings Table */}
      {activeTab === "HOLDINGS" && (
        <div className="card" style={{ padding: "20px" }}>
          {positions.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 20px" }}>
              <Briefcase size={36} className="muted" style={{ marginBottom: 12 }} />
              <p style={{ fontWeight: 600 }}>登録された保有銘柄がありません</p>
              <button
                type="button"
                className="btn btn-sm btn-accent"
                onClick={() => setIsAddModalOpen(true)}
                style={{ marginTop: 12 }}
              >
                最初の保有株を登録する
              </button>
            </div>
          ) : (
            <div tabIndex={0} role="region" aria-label="保有銘柄一覧テーブル" style={{ overflowX: "auto" }}>
              <table className="constituents-table" style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }} className="table-sticky-col">銘柄</th>
                    <th style={{ textAlign: "right" }} className="tabular-nums">保有株数</th>
                    <th style={{ textAlign: "right" }} className="tabular-nums">取得単価</th>
                    <th style={{ textAlign: "right" }} className="tabular-nums">現在値</th>
                    <th style={{ textAlign: "right" }} className="tabular-nums">評価額</th>
                    <th style={{ textAlign: "right" }} className="tabular-nums">含み損益</th>
                    <th style={{ textAlign: "right" }} className="tabular-nums">損益率</th>
                    <th style={{ textAlign: "right" }} className="tabular-nums">構成比</th>
                    <th style={{ textAlign: "center" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.positions.map((p) => {
                    const isProfit = p.unrealizedProfit >= 0;
                    const curr = getStockCurrency(p.ticker);
                    return (
                      <tr key={p.id}>
                        <td className="table-sticky-col">
                          <div
                            role="button"
                            tabIndex={0}
                            style={{ cursor: "pointer" }}
                            onClick={() => onOpenStockDetail(p.ticker)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                onOpenStockDetail(p.ticker);
                              }
                            }}
                            title="銘柄詳細を見る"
                            aria-label={`${p.name} (${p.ticker}) の詳細を見る`}
                          >
                            <span style={{ fontWeight: 600, color: "var(--accent-text)" }}>
                              {p.name}
                            </span>
                            <div className="tiny muted mono">
                              {p.ticker} · {p.theme}
                            </div>
                          </div>
                        </td>
                        <td style={{ textAlign: "right" }} className="mono tabular-nums">
                          {p.shares.toLocaleString()}株
                        </td>
                        <td style={{ textAlign: "right" }} className="mono tabular-nums">
                          {curr}
                          {p.averageCost.toLocaleString("en-US", {
                            minimumFractionDigits: curr === "$" ? 2 : 0,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td style={{ textAlign: "right" }} className="mono bold tabular-nums">
                          {curr}
                          {p.currentPrice.toLocaleString("en-US", {
                            minimumFractionDigits: curr === "$" ? 2 : 0,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td style={{ textAlign: "right" }} className="mono bold tabular-nums">
                          {curr}
                          {p.marketValue.toLocaleString("en-US", {
                            minimumFractionDigits: curr === "$" ? 2 : 0,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: isProfit ? "var(--color-positive)" : "var(--color-negative)",
                          }}
                          className="mono bold tabular-nums"
                        >
                          {isProfit ? "+" : ""}
                          {curr}
                          {p.unrealizedProfit.toLocaleString("en-US", {
                            minimumFractionDigits: curr === "$" ? 2 : 0,
                            maximumFractionDigits: 2,
                          })}
                        </td>
                        <td
                          style={{
                            textAlign: "right",
                            color: isProfit ? "var(--color-positive)" : "var(--color-negative)",
                          }}
                          className="mono bold tabular-nums"
                        >
                          {isProfit ? "+" : ""}
                          {p.unrealizedProfitPercent.toFixed(2)}%
                        </td>
                        <td style={{ textAlign: "right" }} className="mono tabular-nums">
                          <span className="badge badge-default tiny">{p.weightPercent}%</span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <button
                            type="button"
                            className="btn btn-ghost tiny"
                            onClick={() => handleDeletePosition(p.id, p.name)}
                            title="削除"
                            style={{ padding: "4px" }}
                          >
                            <Trash2 size={14} className="muted" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Watchlist */}
      {activeTab === "WATCHLIST" && (
        <div className="card" style={{ padding: "20px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))",
              gap: "12px",
            }}
          >
            {watchlist.map((ticker) => {
              const live = liveQuotes.get(ticker.toUpperCase());
              const fund = live ?? getStockFundamentals(ticker);
              const isPos = fund.changePercent >= 0;
              return (
                <div
                  key={ticker}
                  role="button"
                  tabIndex={0}
                  className="card interactive-card"
                  style={{
                    padding: "14px 16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    border: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                  }}
                  onClick={() => onOpenStockDetail(ticker)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onOpenStockDetail(ticker);
                    }
                  }}
                  aria-label={`${fund.name} (${ticker}) の詳細を見る`}
                >
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                      <span className="mono bold">{ticker}</span>
                      <span className="badge badge-default tiny mono">{fund.market}</span>
                    </div>
                    <div style={{ fontWeight: 600, fontSize: "0.95rem", marginTop: 2 }}>
                      {fund.name}
                    </div>
                    <div className="tiny muted">{fund.theme}</div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div className="mono bold" style={{ fontSize: "1.1rem" }}>
                      {getStockCurrency(ticker)}
                      {fund.price.toLocaleString()}
                    </div>
                    <div
                      className="mono tiny bold"
                      style={{ color: isPos ? "var(--color-positive)" : "var(--color-negative)" }}
                    >
                      {isPos ? "+" : ""}
                      {fund.changePercent.toFixed(2)}%
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost tiny"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveFromWatchlist(ticker);
                      }}
                      onKeyDown={(e) => e.stopPropagation()}
                      title="ウォッチリストから削除"
                      aria-label={`${fund.name} をウォッチリストから削除`}
                      style={{ padding: "2px", marginTop: 4 }}
                    >
                      <Trash2 size={12} className="muted" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add Position Modal */}
      <ModalBase
        isOpen={isAddModalOpen}
        onClose={() => {
          setIsAddModalOpen(false);
          setAddError(null);
        }}
        title="保有銘柄の新規登録"
        icon={<Briefcase size={18} style={{ color: "var(--accent-text)" }} />}
        maxWidth={500}
      >
        <form onSubmit={handleAddPosition}>
          {addError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 12px",
                marginBottom: 14,
                borderRadius: 6,
                background: "rgba(239, 68, 68, 0.12)",
                border: "1px solid rgba(239, 68, 68, 0.4)",
                color: "var(--color-negative)",
                fontSize: "0.85rem",
              }}
            >
              <AlertCircle size={15} />
              <span>{addError}</span>
            </div>
          )}

          {/* Quick preset selector buttons */}
          <div style={{ marginBottom: 12 }}>
            <span className="tiny muted mono uppercase block" style={{ marginBottom: 6 }}>
              人気銘柄クイック選択
            </span>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {PRESET_STOCKS.slice(0, 7).map((p) => (
                <button
                  key={p.ticker}
                  type="button"
                  className="btn btn-ghost tiny"
                  style={{
                    border: "1px solid var(--border-subtle)",
                    padding: "3px 8px",
                    fontSize: "11px",
                    background: newTicker.toUpperCase() === p.ticker.toUpperCase() ? "rgba(0, 229, 255, 0.15)" : undefined,
                    borderColor: newTicker.toUpperCase() === p.ticker.toUpperCase() ? "var(--neon-cyan)" : undefined,
                  }}
                  onClick={() => {
                    setNewTicker(p.ticker);
                    setNewName(p.name);
                    const f = getStockFundamentals(p.ticker);
                    if (f && f.price > 0) {
                      setNewAverageCost(String(f.price));
                    }
                    setAddError(null);
                  }}
                >
                  <span className="mono bold">{p.ticker}</span>
                  <span style={{ marginLeft: 4 }}>{p.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Custom ticker input */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <label htmlFor="position-ticker-select" className="tiny muted mono uppercase">
                銘柄コード (ティッカー)
              </label>
              <span className="tiny mono" style={{ color: "var(--accent-text)" }}>
                通貨区分: {getStockCurrency(newTicker) === "$" ? "米ドル (USD)" : "日本円 (JPY)"}
              </span>
            </div>
            <input
              id="position-ticker-select"
              type="text"
              className="input-styled mono"
              style={{ width: "100%", padding: "8px 12px", textTransform: "uppercase" }}
              placeholder="例: 7203, AAPL, 6758, NVDA, TSLA"
              value={newTicker}
              onChange={(e) => {
                const val = e.target.value;
                setNewTicker(val);
                setAddError(null);
                const upper = val.trim().toUpperCase();
                if (upper) {
                  const match = POPULAR_STOCKS.find((s) => s.ticker.toUpperCase() === upper);
                  if (match) {
                    setNewName(match.name);
                    const f = getStockFundamentals(upper);
                    if (f && f.price > 0) {
                      setNewAverageCost(String(f.price));
                    }
                  }
                }
              }}
              required
            />

            {/* Suggestions dropdown if user is typing query */}
            {newTicker.trim().length >= 1 && (
              <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
                {searchPopularStocks(newTicker, 3)
                  .filter((s) => s.ticker.toUpperCase() !== newTicker.trim().toUpperCase())
                  .map((s) => (
                    <button
                      key={s.ticker}
                      type="button"
                      className="btn btn-ghost tiny"
                      style={{ fontSize: "11px", padding: "2px 6px" }}
                      onClick={() => {
                        setNewTicker(s.ticker);
                        setNewName(s.name);
                        const f = getStockFundamentals(s.ticker);
                        if (f && f.price > 0) {
                          setNewAverageCost(String(f.price));
                        }
                      }}
                    >
                      候補: <span className="mono bold">{s.ticker}</span> ({s.name})
                    </button>
                  ))}
              </div>
            )}
          </div>

          {/* Stock Name input */}
          <div style={{ marginBottom: 12 }}>
            <label htmlFor="position-name-input" className="tiny muted mono uppercase block" style={{ marginBottom: 4 }}>
              銘柄名・企業名
            </label>
            <input
              id="position-name-input"
              type="text"
              className="input-styled"
              style={{ width: "100%", padding: "8px 12px" }}
              placeholder="例: トヨタ自動車 (未入力の場合は自動解決)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>

          {/* Shares input */}
          <div style={{ marginBottom: 12 }}>
            <label
              htmlFor="position-shares-input"
              className="tiny muted mono uppercase block"
              style={{ marginBottom: 4 }}
            >
              保有株数
            </label>
            <input
              id="position-shares-input"
              type="number"
              className="input-styled mono"
              style={{ width: "100%", padding: "8px 12px" }}
              value={newShares}
              onChange={(e) => {
                setNewShares(e.target.value);
                setAddError(null);
              }}
              min="0.001"
              step="any"
              required
            />
          </div>

          {/* Average cost input with clear currency indicator */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
              <label
                htmlFor="position-avg-cost-input"
                className="tiny muted mono uppercase"
              >
                平均取得単価 ({getStockCurrency(newTicker) === "$" ? "米ドル / USD ($)" : "日本円 / 円 (¥)"})
              </label>
              <button
                type="button"
                className="btn btn-ghost tiny"
                style={{ fontSize: "11px", padding: "1px 6px" }}
                onClick={() => {
                  const f = getStockFundamentals(newTicker.trim());
                  if (f && f.price > 0) {
                    setNewAverageCost(String(f.price));
                  }
                }}
              >
                現在参考価格を自動入力
              </button>
            </div>
            <input
              id="position-avg-cost-input"
              type="number"
              className="input-styled mono"
              style={{ width: "100%", padding: "8px 12px" }}
              value={newAverageCost}
              onChange={(e) => {
                setNewAverageCost(e.target.value);
                setAddError(null);
              }}
              placeholder={getStockCurrency(newTicker) === "$" ? "例: 175.50 (USD)" : "例: 2500 (円)"}
              min="0.01"
              step="any"
              required
            />
            <p className="tiny muted" style={{ margin: "4px 0 0", fontSize: "11px" }}>
              ※ {getStockCurrency(newTicker) === "$" ? "米国株は米ドル建単価 (USD) を入力してください。" : "日本株は日本円建単価 (¥) を入力してください。"}
            </p>
          </div>

          <div
            style={{
              padding: "8px 12px",
              marginBottom: 16,
              borderRadius: 6,
              background: "rgba(0, 229, 255, 0.05)",
              border: "1px solid var(--border-cyan)",
              fontSize: "11px",
              color: "var(--text-secondary)",
              lineHeight: 1.5,
            }}
          >
            ※ 米国株 (USD) の評価額および損益は、為替市場のリアルタイムレート (1 USD ≒ {usdJpyRate ? usdJpyRate.toFixed(2) : DEFAULT_USD_JPY_RATE.toFixed(2)} 円) に基づき自動的に円換算されて総合計に反映されます。
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
            <button
              type="button"
              className="btn btn-default"
              onClick={() => {
                setIsAddModalOpen(false);
                setAddError(null);
              }}
            >
              キャンセル
            </button>
            <button type="submit" className="btn btn-accent">
              <Check size={14} />
              <span>登録する</span>
            </button>
          </div>
        </form>
      </ModalBase>
    </motion.div>
  );
}
