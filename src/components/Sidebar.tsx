import { useCallback, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Globe,
    TrendingUp,
    Calendar,
    BarChart3,
    Sliders,
    Zap,
    PieChart,
    Compass,
    FileText,
    Shield,
    X,
    Menu,
} from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { DataFreshness } from "./DataFreshness";
import type { PageView } from "../lib/navigation";

interface NavItem {
    view: PageView;
    label: string;
    title: string;
    icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
}

interface NavGroup {
    id: string;
    label: string;
    items: NavItem[];
}

/** Platform navigation grouped by the job each page does for the user. */
const NAV_GROUPS: NavGroup[] = [
    {
        id: "market-watch",
        label: "マーケット観測",
        items: [
            { view: "market", label: "マーケット概観", title: "世界の主要指数・為替・コモディティ動向", icon: Globe },
            { view: "stock", label: "銘柄分析", title: "個別銘柄の財務指標・チャート分析", icon: TrendingUp },
            { view: "calendar", label: "カレンダー", title: "決算発表予定・主要マクロ経済イベント", icon: Calendar },
        ],
    },
    {
        id: "index-studio",
        label: "指数開発",
        items: [
            { view: "dashboard", label: "指数スタジオ", title: "カスタム指数ダッシュボード", icon: BarChart3 },
            { view: "builder", label: "ビルダー", title: "指数ビルダー&シミュレーター", icon: Sliders },
        ],
    },
    {
        id: "research",
        label: "リサーチ",
        items: [
            { view: "screener", label: "スクリーナー", title: "高配当・低PBR・騰落率ランキング", icon: Zap },
        ],
    },
    {
        id: "assets",
        label: "資産管理",
        items: [
            { view: "portfolio", label: "ポートフォリオ", title: "保有資産管理・損益トラッカー&指数化連携", icon: PieChart },
        ],
    },
];

const SUB_ITEMS: NavItem[] = [
    { view: "tutorial", label: "操作チュートリアル", title: "操作チュートリアルガイド", icon: Compass },
    { view: "disclaimer", label: "免責事項", title: "免責事項・利用規約", icon: FileText },
];

interface SidebarProps {
    currentView: PageView;
    navigateTo: (view: PageView, searchParams?: string) => void;
    /** Mobile drawer open state (driven by the header toggle). */
    isOpen: boolean;
    /** Closes the drawer and restores focus to the header toggle button. */
    onRequestClose: () => void;
    /** Data freshness props shared with the header. */
    freshnessProps?: {
        benchmarkUpdatedAt?: number | null;
        calculationUpdatedAt?: number | null;
        dataLoading?: boolean;
        syncing?: boolean;
        benchmarkStale?: boolean;
        hasSyncWarning?: boolean;
    };
}

export function Sidebar({
    currentView,
    navigateTo,
    isOpen,
    onRequestClose,
    freshnessProps,
}: SidebarProps) {
    const { isAdmin } = useAuth();
    const drawerRef = useRef<HTMLElement>(null);

    const handleNavigate = useCallback(
        (view: PageView) => {
            navigateTo(view);
            onRequestClose();
        },
        [navigateTo, onRequestClose],
    );

    // Close the drawer with Escape and trap focus while it is open. Focus
    // restoration to the header toggle is handled by onRequestClose in the parent.
    useEffect(() => {
        if (!isOpen) return;
        const drawer = drawerRef.current;
        if (!drawer) return;

        const focusableSelector = [
            "button:not([disabled])",
            "a[href]:not([disabled])",
            "input:not([disabled])",
            '[tabindex]:not([tabindex="-1"])',
        ].join(",");
        const focusable = () =>
            Array.from(drawer.querySelectorAll<HTMLElement>(focusableSelector)).filter((el) =>
                el.getClientRects().length > 0,
            );

        const frame = window.requestAnimationFrame(() => {
            focusable()[0]?.focus();
        });

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                event.preventDefault();
                onRequestClose();
                return;
            }
            if (event.key !== "Tab") return;
            const items = focusable();
            if (items.length === 0) return;
            const first = items[0];
            const last = items[items.length - 1];
            if (
                event.shiftKey &&
                (document.activeElement === first || !drawer.contains(document.activeElement))
            ) {
                event.preventDefault();
                last.focus();
            } else if (
                !event.shiftKey &&
                (document.activeElement === last || !drawer.contains(document.activeElement))
            ) {
                event.preventDefault();
                first.focus();
            }
        };

        document.addEventListener("keydown", handleKeyDown, true);
        return () => {
            window.cancelAnimationFrame(frame);
            document.removeEventListener("keydown", handleKeyDown, true);
        };
    }, [isOpen, onRequestClose]);

    const renderNavItem = (item: NavItem) => {
        const { view, label, title, icon: Icon } = item;
        const isActive = currentView === view;
        return (
            <button
                key={view}
                type="button"
                className={`global-nav-item ${isActive ? "active" : ""}`}
                onClick={() => handleNavigate(view)}
                title={title}
                aria-label={`${label}へ移動`}
                aria-current={isActive ? "page" : undefined}
            >
                <Icon size={15} strokeWidth={2} />
                <span>{label}</span>
            </button>
        );
    };

    const nav = (
        <nav className="global-nav" aria-label="メインナビゲーション">
            <div className="sidebar-drawer-header">
                <div className="row" style={{ gap: 8 }}>
                    <Menu size={15} style={{ color: "var(--accent-text)" }} aria-hidden="true" />
                    <span className="mono tiny uppercase">ナビゲーション</span>
                </div>
                <button
                    type="button"
                    className="sidebar-close-button"
                    onClick={onRequestClose}
                    aria-label="メニューを閉じる"
                >
                    <X size={18} />
                </button>
            </div>

            <div className="global-nav-groups">
                {NAV_GROUPS.map((group) => (
                    <div key={group.id} className="global-nav-group">
                        <p className="global-nav-group-label mono tiny">{group.label}</p>
                        <div className="global-nav-group-items">{group.items.map(renderNavItem)}</div>
                    </div>
                ))}
            </div>

            <div className="global-nav-sub">
                {(isAdmin
                    ? [
                        ...SUB_ITEMS,
                        { view: "admin", label: "管理者ページ", title: "管理者ページ", icon: Shield } as NavItem,
                    ]
                    : SUB_ITEMS
                ).map(renderNavItem)}
            </div>

            {/* Utility section: shown inside the mobile drawer only — desktop keeps
          data freshness and account controls in the header. */}
            <div className="sidebar-meta-section sidebar-utility">
                <p className="global-nav-group-label mono tiny">データ状態</p>
                <DataFreshness
                    benchmarkUpdatedAt={freshnessProps?.benchmarkUpdatedAt}
                    calculationUpdatedAt={freshnessProps?.calculationUpdatedAt}
                    loading={freshnessProps?.dataLoading}
                    syncing={freshnessProps?.syncing}
                    stale={freshnessProps?.benchmarkStale}
                    hasSyncWarning={freshnessProps?.hasSyncWarning}
                />
            </div>
        </nav>
    );

    return (
        <>
            {/* Desktop: fixed rail */}
            <aside className="global-sidebar" aria-label="サイトナビゲーション">
                {nav}
            </aside>

            {/* Mobile: drawer opened from the header toggle */}
            <AnimatePresence>
                {isOpen && (
                    <>
                        <motion.button
                            type="button"
                            className="global-sidebar-backdrop"
                            aria-label="メニューを閉じる"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ duration: 0.2 }}
                            onClick={onRequestClose}
                        />
                        <motion.aside
                            ref={drawerRef}
                            id="header-mobile-nav"
                            className="global-sidebar global-sidebar-drawer"
                            initial={{ x: -24, opacity: 0 }}
                            animate={{ x: 0, opacity: 1 }}
                            exit={{ x: -24, opacity: 0 }}
                            transition={{ duration: 0.2, ease: "easeOut" }}
                            role="dialog"
                            aria-modal="true"
                            aria-label="ナビゲーションメニュー"
                            tabIndex={-1}
                        >
                            {nav}
                        </motion.aside>
                    </>
                )}
            </AnimatePresence>
        </>
    );
}
