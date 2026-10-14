import React from "react";
import {
  Globe,
  Zap,
  BarChart3,
  PieChart,
  Calendar,
} from "lucide-react";
import type { PageView } from "../lib/navigation";

interface MobileBottomNavProps {
  currentView: PageView;
  onNavigate: (view: PageView) => void;
}

interface NavTab {
  id: PageView;
  label: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
}

const TABS: readonly NavTab[] = [
  { id: "market", label: "マーケット", icon: Globe },
  { id: "screener", label: "スクリーナー", icon: Zap },
  { id: "dashboard", label: "指数スタジオ", icon: BarChart3 },
  { id: "portfolio", label: "資産管理", icon: PieChart },
  { id: "calendar", label: "カレンダー", icon: Calendar },
];

export function MobileBottomNav({ currentView, onNavigate }: MobileBottomNavProps) {
  return (
    <nav
      className="mobile-bottom-nav"
      aria-label="モバイル下部ナビゲーション"
      role="navigation"
    >
      <div className="mobile-bottom-nav-inner">
        {TABS.map((tab) => {
          const isActive = currentView === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              className={`mobile-bottom-nav-item ${isActive ? "active" : ""}`}
              onClick={() => onNavigate(tab.id)}
              aria-current={isActive ? "page" : undefined}
              aria-label={`${tab.label}へ移動`}
            >
              <div className="mobile-bottom-nav-icon-wrapper">
                <Icon size={20} strokeWidth={isActive ? 2.4 : 1.8} />
                {isActive && <span className="mobile-bottom-nav-dot" />}
              </div>
              <span className="mobile-bottom-nav-label">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
