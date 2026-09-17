import { motion } from "framer-motion";
import { ArrowLeft, ExternalLink, Sparkles, Layers, Cpu, TrendingUp, BarChart3, Terminal, Globe } from "lucide-react";
import { GitHubIcon, XIcon, type PageView } from "./Footer";

interface PortfolioPageProps {
  onNavigate: (view: PageView) => void;
}

export function PortfolioPage({ onNavigate }: PortfolioPageProps) {
  return (
    <div className="portfolio-page-wrapper">
      {/* Subpage Top Bar */}
      <div className="subpage-nav-bar">
        <button
          type="button"
          onClick={() => onNavigate("dashboard")}
          className="btn btn-default subpage-back-btn"
          aria-label="ダッシュボードへ戻る"
        >
          <ArrowLeft size={16} />
          <span>ダッシュボードに戻る</span>
        </button>
        <span className="mono tiny muted uppercase">DEVELOPER PROFILE & PORTFOLIO</span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="portfolio-container"
      >
        {/* Profile Hero Card */}
        <section className="profile-hero-card">
          <div className="profile-hero-glow" aria-hidden="true" />
          <div className="profile-header-content">
            <div className="profile-avatar-box">
              <div className="profile-avatar">
                <span className="profile-avatar-text mono">T</span>
              </div>
              <div className="profile-status-indicator" title="Active Developer" />
            </div>

            <div className="profile-info">
              <div className="profile-title-row">
                <h1 className="profile-name">とぴ / TopiTech</h1>
                <span className="badge badge-accent mono tiny">CREATOR</span>
              </div>
              <p className="profile-tagline mono">
                Web & FinTech Enthusiast / Individual Developer
              </p>
              <p className="profile-bio">
                金融・株式データ分析とモダンWeb技術に関心を持つ個人開発者です。
                投資家自身が客観的にポートフォリオや独自インデックスを追跡・評価できるツール
                「<strong>IndexForge</strong>」をはじめ、
                直感的かつ高速で実用性の高いアプリケーションの設計・開発を行っています。
              </p>
            </div>
          </div>

          {/* Social Links Cards */}
          <div className="social-cards-grid">
            {/* X (Twitter) */}
            <a
              href="https://x.com/TopiSan_1"
              target="_blank"
              rel="noopener noreferrer"
              className="social-card social-card-x"
            >
              <div className="social-card-icon-wrap x-bg">
                <XIcon size={22} />
              </div>
              <div className="social-card-text">
                <div className="social-card-header">
                  <span className="social-name">とぴ（@TopiSan_1）</span>
                  <ExternalLink size={13} className="social-ext-icon" />
                </div>
                <span className="social-handle mono tiny muted">@TopiSan_1</span>
                <p className="social-desc">
                  日々の開発進捗、個人開発の気づき、Web技術や投資に関する情報発信を行っています。
                </p>
              </div>
              <div className="social-card-action">
                <span className="social-btn-label">Xをフォロー</span>
              </div>
            </a>

            {/* GitHub */}
            <a
              href="https://github.com/TopiTech"
              target="_blank"
              rel="noopener noreferrer"
              className="social-card social-card-github"
            >
              <div className="social-card-icon-wrap github-bg">
                <GitHubIcon size={24} />
              </div>
              <div className="social-card-text">
                <div className="social-card-header">
                  <span className="social-name">GitHub / TopiTech</span>
                  <ExternalLink size={13} className="social-ext-icon" />
                </div>
                <span className="social-handle mono tiny muted">@TopiTech</span>
                <p className="social-desc">
                  ソースコードやオープンソース活動、個人開発のリポジトリを公開・管理しています。
                </p>
              </div>
              <div className="social-card-action">
                <span className="social-btn-label">GitHubを見る</span>
              </div>
            </a>
          </div>
        </section>

        {/* Featured Project Section */}
        <section className="portfolio-section">
          <div className="section-title-row">
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <Sparkles size={18} style={{ color: "var(--accent-text)" }} />
              <h2 className="section-title">FEATURED PROJECT</h2>
            </div>
            <span className="mono tiny muted">MAIN PRODUCT</span>
          </div>

          <div className="project-feature-card">
            <div className="project-badge-row">
              <span className="badge badge-accent mono tiny">IndexForge</span>
              <span className="badge badge-subtle mono tiny">LIVE SERVICE</span>
            </div>
            <h3 className="project-title">独自株価指数トラッカー & クオンツ分析プラットフォーム</h3>
            <p className="project-desc">
              「特定のテーマや自分独自の投資戦略銘柄群を、市場ベンチマーク（日経平均・S&P 500・米ドル/円）と客観的に比較したい」というニーズに応えるため開発したWebアプリケーション。
              Yahoo Financeの最新データを取得し、Cloudflare EdgeとD1データベースを組み合わせた高速な多段キャッシュ機構により、瞬時にインデックス計算とリスク指標分析を提供します。
            </p>

            <div className="project-features-grid">
              <div className="feature-item">
                <div className="feature-item-header">
                  <TrendingUp size={16} className="feature-icon" />
                  <strong>客観的な指数化エンジン</strong>
                </div>
                <p className="feature-item-desc tiny muted">
                  構成比率と基準値（既定 1,000pt）をもとに時系列インデックスを正規化算出。取得できた日足終値を基準に比較します。
                </p>
              </div>

              <div className="feature-item">
                <div className="feature-item-header">
                  <BarChart3 size={16} className="feature-icon" />
                  <strong>クオンツ・リスクメトリクス</strong>
                </div>
                <p className="feature-item-desc tiny muted">
                  シャープレシオ、ベータ値（対市場感応度）、年率ボラティリティ、最大ドローダウン（MDD）、日次勝率を動的に算出。
                </p>
              </div>

              <div className="feature-item">
                <div className="feature-item-header">
                  <Layers size={16} className="feature-icon" />
                  <strong>インタラクティブ・ツリーマップ</strong>
                </div>
                <p className="feature-item-desc tiny muted">
                  保有銘柄の時価評価・騰落状況をセクター/テーマ別ツリーマップと構成銘柄テーブルで多角的に可視化。
                </p>
              </div>

              <div className="feature-item">
                <div className="feature-item-header">
                  <Cpu size={16} className="feature-icon" />
                  <strong>エッジ高速計算 & 多段キャッシュ</strong>
                </div>
                <p className="feature-item-desc tiny muted">
                  Cloudflare Workers + D1 (SQLite) を活用し、Yahoo Finance APIのレート制限を回避しつつ高速なレスポンスを実現。
                </p>
              </div>
            </div>

            <div className="project-tech-tags">
              <span className="tech-tag mono tiny">React 19</span>
              <span className="tech-tag mono tiny">TypeScript</span>
              <span className="tech-tag mono tiny">Cloudflare Workers</span>
              <span className="tech-tag mono tiny">Cloudflare D1</span>
              <span className="tech-tag mono tiny">Vite</span>
              <span className="tech-tag mono tiny">Recharts</span>
              <span className="tech-tag mono tiny">Framer Motion</span>
            </div>
          </div>
        </section>

        {/* Skills & Focus Areas */}
        <section className="portfolio-section">
          <div className="section-title-row">
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <Terminal size={18} style={{ color: "var(--accent-text)" }} />
              <h2 className="section-title">SKILLS & ARCHITECTURE</h2>
            </div>
            <span className="mono tiny muted">TECHNICAL HIGHLIGHTS</span>
          </div>

          <div className="skills-grid">
            <div className="skill-card">
              <div className="skill-card-icon">
                <Globe size={20} style={{ color: "var(--accent-text)" }} />
              </div>
              <h4 className="skill-card-title">Frontend Engineering</h4>
              <p className="skill-card-desc tiny muted">
                React / TypeScriptによる型安全な開発、レスポンシブUI、Framer Motionを活用した滑らかなマイクロインタラクション、アクセシビリティに配慮した設計。
              </p>
            </div>

            <div className="skill-card">
              <div className="skill-card-icon">
                <Cpu size={20} style={{ color: "#a855f7" }} />
              </div>
              <h4 className="skill-card-title">Serverless & Edge</h4>
              <p className="skill-card-desc tiny muted">
                Cloudflare Workers, D1 Database, Edge Caching、堅牢なレート制限設計、セキュアな認証ロジック、分散エッジ環境における高可用性アーキテクチャ。
              </p>
            </div>

            <div className="skill-card">
              <div className="skill-card-icon">
                <TrendingUp size={20} style={{ color: "#10b981" }} />
              </div>
              <h4 className="skill-card-title">Financial & Analytics</h4>
              <p className="skill-card-desc tiny muted">
                株価・インデックス時系列データモデリング、統計的リスクリターン計算、ベンチマーク比較分析、データの整合性検証アルゴリズム。
              </p>
            </div>
          </div>
        </section>

        {/* Contact / Connect CTA */}
        <section className="portfolio-cta-box">
          <div className="row space-between flex-wrap portfolio-cta-content" style={{ gap: 16, alignItems: "center" }}>
            <div>
              <h3 style={{ margin: "0 0 6px", fontSize: "1.1rem" }}>フィードバックやメッセージ</h3>
              <p className="muted tiny" style={{ margin: 0, maxWidth: 540 }}>
                本サービスへの機能リクエスト・不具合報告、または開発に関するメッセージは、X（旧Twitter）のDMやリプライ等でお気軽にお寄せください。
              </p>
            </div>
            <div className="row portfolio-cta-buttons" style={{ gap: 10 }}>
              <a
                href="https://x.com/TopiSan_1"
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-accent"
                style={{ padding: "8px 16px", textDecoration: "none" }}
              >
                <XIcon size={14} />
                <span>Xでメッセージを送る</span>
              </a>
              <button
                type="button"
                onClick={() => onNavigate("dashboard")}
                className="btn btn-outline"
                style={{ padding: "8px 16px" }}
              >
                <span>ダッシュボードへ</span>
              </button>
            </div>
          </div>
        </section>
      </motion.div>
    </div>
  );
}
