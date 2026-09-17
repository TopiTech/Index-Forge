import { ExternalLink, ShieldAlert, User, Home, Shield, Code2, Sliders, Compass } from "lucide-react";
import { getViewPath, type PageView } from "../lib/navigation";
import { useAuth } from "../hooks/useAuth";

export type { PageView };

export function GitHubIcon({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
      />
    </svg>
  );
}

export function XIcon({ size = 15, className = "" }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

interface FooterProps {
  onNavigate: (view: PageView) => void;
  currentView?: PageView;
}

function FooterNavLink({
  view,
  currentView,
  onNavigate,
  icon,
  label,
}: {
  view: PageView;
  currentView?: PageView;
  onNavigate: (view: PageView) => void;
  icon: React.ReactNode;
  label: string;
}) {
  const path = getViewPath(view);
  const isActive = currentView === view;

  return (
    <a
      href={path}
      onClick={(e) => {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey && e.button === 0) {
          e.preventDefault();
          onNavigate(view);
        }
      }}
      className={`footer-link-btn ${isActive ? "is-active" : ""}`}
      aria-current={isActive ? "page" : undefined}
    >
      {icon}
      <span>{label}</span>
    </a>
  );
}

export function Footer({ onNavigate, currentView = "dashboard" }: FooterProps) {
  const { isAdmin } = useAuth();
  const currentYear = new Date().getFullYear();

  return (
    <footer className="app-footer">
      <div className="footer-inner">
        <div className="footer-grid">
          {/* Brand Info */}
          <div className="footer-col footer-col-brand">
            <div className="footer-brand-header">
              <span className="footer-brand-title">IndexForge</span>
              <span className="badge badge-subtle mono tiny" style={{ fontSize: 10, padding: "2px 6px" }}>v0.1.0</span>
            </div>
            <p className="footer-desc muted">
              独自投資戦略・テーマ別ポートフォリオの客観的株価指数化プラットフォーム。
              日米主要ベンチマークとの比較分析とリスク指標の算出を、エッジ上で高速に実行します。
            </p>
            <div className="footer-creator-note">
              <Code2 size={13} className="footer-icon-accent" />
              <span>Developed by <strong style={{ color: "var(--text-primary)" }}>とぴ / TopiTech</strong></span>
            </div>
          </div>

          {/* Site Navigation */}
          <div className="footer-col">
            <h4 className="footer-heading">ページ</h4>
            <ul className="footer-nav-list">
              <li>
                <FooterNavLink
                  view="dashboard"
                  currentView={currentView}
                  onNavigate={onNavigate}
                  icon={<Home size={14} />}
                  label="ダッシュボード"
                />
              </li>
              <li>
                <FooterNavLink
                  view="builder"
                  currentView={currentView}
                  onNavigate={onNavigate}
                  icon={<Sliders size={14} />}
                  label="指数ビルダー & シミュレーター"
                />
              </li>
              <li>
                <FooterNavLink
                  view="portfolio"
                  currentView={currentView}
                  onNavigate={onNavigate}
                  icon={<User size={14} />}
                  label="ポートフォリオ / SNS"
                />
              </li>
              <li>
                <FooterNavLink
                  view="disclaimer"
                  currentView={currentView}
                  onNavigate={onNavigate}
                  icon={<ShieldAlert size={14} />}
                  label="免責事項"
                />
              </li>
              <li>
                <FooterNavLink
                  view="tutorial"
                  currentView={currentView}
                  onNavigate={onNavigate}
                  icon={<Compass size={14} />}
                  label="操作チュートリアル (3D)"
                />
              </li>
              {isAdmin && (
                <li>
                  <FooterNavLink
                    view="admin"
                    currentView={currentView}
                    onNavigate={onNavigate}
                    icon={<Shield size={14} />}
                    label="管理者ページ"
                  />
                </li>
              )}
            </ul>
          </div>

          {/* Social Links */}
          <div className="footer-col">
            <h4 className="footer-heading">SNS & 開発者リンク</h4>
            <ul className="footer-social-list">
              <li>
                <a
                  href="https://x.com/TopiSan_1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-social-link"
                  aria-label="とぴ（@TopiSan_1）さん / X"
                >
                  <XIcon size={14} />
                  <span>とぴ（@TopiSan_1）</span>
                  <ExternalLink size={11} className="footer-ext-icon" />
                </a>
              </li>
              <li>
                <a
                  href="https://github.com/TopiTech"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-social-link"
                  aria-label="GitHub @TopiTech"
                >
                  <GitHubIcon size={15} />
                  <span>TopiTech</span>
                  <ExternalLink size={11} className="footer-ext-icon" />
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="footer-divider" />

        {/* Bottom Bar */}
        <div className="footer-bottom row space-between flex-wrap" style={{ gap: 12, alignItems: "center" }}>
          <p className="footer-disclaimer-note muted tiny">
            ※ 本サービスで提供される指数・データおよび分析結果は情報提供のみを目的としており、投資の勧誘や助言を目的としたものではありません。
          </p>
          <div className="footer-copyright mono tiny muted">
            &copy; {currentYear} TopiTech. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
}
