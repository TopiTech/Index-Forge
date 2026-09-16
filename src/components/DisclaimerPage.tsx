import { motion } from "framer-motion";
import { ArrowLeft, ShieldAlert, AlertTriangle } from "lucide-react";
import type { PageView } from "./Footer";

interface DisclaimerPageProps {
  onNavigate: (view: PageView) => void;
}

export function DisclaimerPage({ onNavigate }: DisclaimerPageProps) {
  return (
    <div className="disclaimer-page-wrapper">
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
        <span className="mono tiny muted uppercase">LEGAL / DISCLAIMER</span>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 15 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        className="disclaimer-container"
      >
        {/* Header Title */}
        <div className="disclaimer-header">
          <div className="disclaimer-icon-badge">
            <ShieldAlert size={28} />
          </div>
          <h1 className="disclaimer-title">免責事項（Disclaimer）</h1>
          <p className="disclaimer-subtitle muted">
            IndexForge（以下、「当サービス」）をご利用いただくにあたり、
            以下の免責事項・注意事項を必ずお読みいただき、同意の上でご利用ください。
          </p>
          <div className="disclaimer-date mono tiny muted">
            最終更新日: 2026年9月7日
          </div>
        </div>

        {/* Warning Banner */}
        <div className="disclaimer-banner">
          <AlertTriangle size={20} className="banner-icon" />
          <div className="banner-text">
            <strong>投資に関する重要な警告</strong>
            <p className="tiny" style={{ margin: "4px 0 0" }}>
              当サービスは株式投資の成果を保証するものではありません。
              株式等の金融商品取引は相場変動や発行体の信用状況等により元本を割り込むリスクがあります。
              投資判断は必ず自己の責任と判断において行ってください。
            </p>
          </div>
        </div>

        {/* Disclaimer Articles */}
        <div className="disclaimer-sections-list">
          {/* Article 1 */}
          <article className="disclaimer-card">
            <div className="card-header-row">
              <span className="card-number mono tiny">第 1 条</span>
              <h2 className="card-title">目的と情報の性質（投資助言の否定）</h2>
            </div>
            <div className="card-body-text">
              <p>
                当サービスは、ユーザー独自の視点やテーマに基づく株価指数・ポートフォリオの客観的計算、および市場ベンチマーク（日経平均・S&P500等）との比較・可視化を支援する<strong>情報整理・分析補助ツール</strong>です。
              </p>
              <p>
                金融商品取引法に基づく「投資助言・代理業」または「金融商品取引業」を行うものではなく、特定の株式銘柄や金融商品の売買を推奨・勧誘するものではありません。
              </p>
            </div>
          </article>

          {/* Article 2 */}
          <article className="disclaimer-card">
            <div className="card-header-row">
              <span className="card-number mono tiny">第 2 条</span>
              <h2 className="card-title">投資判断の自己責任原則</h2>
            </div>
            <div className="card-body-text">
              <p>
                株式等の金融商品取引には、価格の変動、金利水準の変動、為替相場の変動、発行会社の信用状況の悪化等により、投資元本を割り込む損失が生じるリスクがあります。
              </p>
              <p>
                当サービスによって提供・表示される一切の情報（インデックス値、リターン率、シャープレシオ、ベータ値、最大ドローダウン等のリスク指標を含む）を参考にして行われた投資その他の行動について、いかなる結果・損害が生じた場合でも、当サービスの開発者および運営者は一切の責任を負いません。
              </p>
            </div>
          </article>

          {/* Article 3 */}
          <article className="disclaimer-card">
            <div className="card-header-row">
              <span className="card-number mono tiny">第 3 条</span>
              <h2 className="card-title">データの正確性・完全性・最新性の非保証</h2>
            </div>
            <div className="card-body-text">
              <p>
                当サービスで利用・表示している株価データ、為替レート、企業情報、市場指標等のデータは、外部API（Yahoo Finance等）をはじめとする第三者ソースから取得しております。
              </p>
              <p>
                開発者および運営者は、これらのデータの正確性、完全性、最新性、信頼性、特定目的への適合性、あるいはシステムエラーや計算上の不具合がないことについて、明示・黙示を問わず一切保証いたしません。通信状況や市場の状況により、データの配信遅延や欠落が発生する場合があります。
              </p>
            </div>
          </article>

          {/* Article 4 */}
          <article className="disclaimer-card">
            <div className="card-header-row">
              <span className="card-number mono tiny">第 4 条</span>
              <h2 className="card-title">損害への責任免除</h2>
            </div>
            <div className="card-body-text">
              <p>
                当サービスを利用したこと、または利用できなかったこと（サービスの停止、障害、アクセス遮断、データの消失・改ざん等を含む）によって生じた直接的、間接的、付随的、特別、結果的損害、ならびに投資上の損失や逸失利益等について、開発者および運営者はその予見可能性の有無を問わず一切の賠償責任を負わないものとします。
              </p>
            </div>
          </article>

          {/* Article 5 */}
          <article className="disclaimer-card">
            <div className="card-header-row">
              <span className="card-number mono tiny">第 5 条</span>
              <h2 className="card-title">サービスの変更・中断・終了</h2>
            </div>
            <div className="card-body-text">
              <p>
                開発者および運営者は、事前の通知なしに、当サービスの仕様変更、機能追加、一時的な提供の中断、メンテナンス、またはサービスの提供を終了することができるものとします。これらに伴いユーザーに生じたいかなる損害についても責任を負いません。
              </p>
            </div>
          </article>

          {/* Article 6 */}
          <article className="disclaimer-card">
            <div className="card-header-row">
              <span className="card-number mono tiny">第 6 条</span>
              <h2 className="card-title">知的財産権</h2>
            </div>
            <div className="card-body-text">
              <p>
                当サービスを構成するプログラム、UIデザイン、グラフィック、商標、テキスト等の著作権その他の知的財産権は、開発者または正当な権利者に帰属します。
                各銘柄名称、ベンチマーク指数名称（日経平均株価、S&P 500等）は、それぞれの権利者の商標または登録商標です。
              </p>
            </div>
          </article>

          {/* Article 7 */}
          <article className="disclaimer-card">
            <div className="card-header-row">
              <span className="card-number mono tiny">第 7 条</span>
              <h2 className="card-title">免責事項の改定</h2>
            </div>
            <div className="card-body-text">
              <p>
                本免責事項は、法令の改正、サービス内容の更新その他の事由により、事前の予告なく改定されることがあります。改定後の免責事項は当サービス上に掲示された時点から効力を有するものとします。
              </p>
            </div>
          </article>
        </div>

        {/* Back button bottom */}
        <div className="disclaimer-bottom-action">
          <button
            type="button"
            onClick={() => onNavigate("dashboard")}
            className="btn btn-accent"
            style={{ padding: "10px 24px", fontSize: 13 }}
          >
            <ArrowLeft size={16} />
            <span>ダッシュボードに戻る</span>
          </button>
        </div>
      </motion.div>
    </div>
  );
}
