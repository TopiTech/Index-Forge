import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  X,
  RotateCcw,
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  Sparkles,
  Eye,
  EyeOff,
  Keyboard,
  Info,
  Compass,
} from "lucide-react";
import {
  TUTORIAL_STEPS,
  TUTORIAL_KEYBOARD_SHORTCUTS,
  getSystemPrefersReducedMotion,
  formatAccessibilityAnnouncement,
  type TutorialStep,
} from "../lib/tutorialAccessibility";
import { setTutorialCompleted } from "../lib/tutorialStorage";
import { Tutorial3DCanvas, type Tutorial3DCanvasHandle } from "./Tutorial3DCanvas";
import { ModalBase } from "./ModalBase";

export interface TutorialPageProps {
  onComplete: () => void;
  onSkip?: () => void;
}

export function TutorialPage({ onComplete, onSkip }: TutorialPageProps) {
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [isReducedMotion, setIsReducedMotion] = useState(getSystemPrefersReducedMotion);
  const [isAutoRotatePaused, setIsAutoRotatePaused] = useState(false);
  const [isShortcutsModalOpen, setIsShortcutsModalOpen] = useState(false);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");

  const canvasRef = useRef<Tutorial3DCanvasHandle>(null);
  const currentStep: TutorialStep = TUTORIAL_STEPS[currentStepIndex];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === TUTORIAL_STEPS.length - 1;

  // Live announcement update on step or motion change
  useEffect(() => {
    const text = formatAccessibilityAnnouncement(currentStep, {
      isReducedMotion,
      isAutoRotatePaused,
    });
    setLiveAnnouncement(text);
  }, [currentStep, isReducedMotion, isAutoRotatePaused]);

  // Finish tutorial handler
  const handleFinish = useCallback(() => {
    setTutorialCompleted(true);
    onComplete();
  }, [onComplete]);

  // Skip tutorial handler
  const handleSkip = useCallback(() => {
    setTutorialCompleted(true);
    if (onSkip) {
      onSkip();
    } else {
      onComplete();
    }
  }, [onComplete, onSkip]);

  const goToNextStep = useCallback(() => {
    if (isLastStep) {
      handleFinish();
    } else {
      setCurrentStepIndex((prev) => Math.min(TUTORIAL_STEPS.length - 1, prev + 1));
    }
  }, [isLastStep, handleFinish]);

  const goToPrevStep = useCallback(() => {
    setCurrentStepIndex((prev) => Math.max(0, prev - 1));
  }, []);

  // Global Keyboard listener for tutorial navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // If modal is open, don't intercept standard inputs
      if (isShortcutsModalOpen) {
        if (e.key === "Escape") setIsShortcutsModalOpen(false);
        return;
      }

      const target = e.target as HTMLElement | null;
      const isInputFocused =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (isInputFocused) return;

      switch (e.key) {
        case "Escape":
          e.preventDefault();
          handleSkip();
          break;
        case "ArrowRight":
        case "Enter":
          // Only trigger next step if not focused on a button (which handles its own click)
          if (!target || target.tagName !== "BUTTON") {
            e.preventDefault();
            goToNextStep();
          }
          break;
        case "ArrowLeft":
          if (!isFirstStep && (!target || target.tagName !== "BUTTON")) {
            e.preventDefault();
            goToPrevStep();
          }
          break;
        case "m":
        case "M":
          e.preventDefault();
          setIsReducedMotion((prev) => !prev);
          break;
        case "r":
        case "R":
          e.preventDefault();
          canvasRef.current?.resetCamera();
          break;
        case " ":
          if (!target || target.tagName !== "BUTTON") {
            e.preventDefault();
            const next = canvasRef.current?.toggleAutoRotate() ?? false;
            setIsAutoRotatePaused(next);
          }
          break;
        case "?":
          e.preventDefault();
          setIsShortcutsModalOpen((prev) => !prev);
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [goToNextStep, goToPrevStep, handleSkip, isShortcutsModalOpen]);

  return (
    <div className="tutorial-page-wrapper" role="main" aria-label="IndexForge 操作チュートリアル">
      {/* Visually hidden screen reader announcements */}
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {liveAnnouncement}
      </div>

      {/* Top Header Bar */}
      <header className="tutorial-top-bar">
        <div className="tutorial-brand">
          <div className="tutorial-brand-icon" aria-hidden="true">
            <Sparkles size={18} />
          </div>
          <div>
            <h1 className="tutorial-brand-title">IndexForge Quick Start</h1>
            <span className="muted tiny">初回操作チュートリアルガイド</span>
          </div>
        </div>

        <div className="tutorial-top-actions">
          {/* Reduced Motion Toggle */}
          <button
            type="button"
            className={`btn btn-sm ${isReducedMotion ? "btn-primary" : "btn-outline"} tutorial-control-btn`}
            onClick={() => setIsReducedMotion((prev) => !prev)}
            aria-pressed={isReducedMotion}
            title={isReducedMotion ? "アニメーションを有効化" : "アニメーションを軽減・静止"}
            aria-label={isReducedMotion ? "アニメーションを有効化" : "アニメーションを軽減・静止"}
          >
            {isReducedMotion ? <EyeOff size={14} /> : <Eye size={14} />}
            <span className="tutorial-btn-label">
              {isReducedMotion ? "モーション軽減中" : "モーション軽減"}
            </span>
          </button>

          {/* Keyboard Shortcuts Help Button */}
          <button
            type="button"
            className="btn btn-sm btn-outline tutorial-control-btn"
            onClick={() => setIsShortcutsModalOpen(true)}
            title="キーボードショートカット一覧"
            aria-label="キーボード操作ヘルプを開く"
          >
            <Keyboard size={14} />
            <span className="tutorial-btn-label">操作ヘルプ</span>
          </button>

          {/* Skip Button */}
          <button
            type="button"
            className="btn btn-sm btn-ghost tutorial-skip-btn"
            onClick={handleSkip}
            title="チュートリアルをスキップしてダッシュボードへ"
            aria-label="チュートリアルをスキップしてダッシュボードへ移動"
          >
            <span>スキップ</span>
            <X size={15} aria-hidden="true" />
          </button>
        </div>
      </header>

      {/* Main Interactive Stage */}
      <div className="tutorial-stage">
        {/* 3D Visualizer Canvas */}
        <div className="tutorial-canvas-area">
          <Tutorial3DCanvas
            ref={canvasRef}
            currentStep={currentStep.id}
            isReducedMotion={isReducedMotion}
            isAutoRotatePaused={isAutoRotatePaused}
            onToggleAutoRotate={setIsAutoRotatePaused}
            sceneDescription={currentStep.sceneDescription}
          />

          {/* Floating Camera Controls Toolbar */}
          <div
            className="tutorial-camera-toolbar"
            role="toolbar"
            aria-label="カメラ視点操作ツールバー"
          >
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={() => canvasRef.current?.rotateCamera(0.2, 0)}
              title="カメラを左に回転 (A)"
              aria-label="カメラを左に回転"
            >
              <Compass size={16} />
            </button>
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={() => canvasRef.current?.zoomCamera(-1.5)}
              title="カメラをズームイン (+)"
              aria-label="カメラをズームイン"
            >
              <ZoomIn size={16} />
            </button>
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={() => canvasRef.current?.zoomCamera(1.5)}
              title="カメラをズームアウト (-)"
              aria-label="カメラをズームアウト"
            >
              <ZoomOut size={16} />
            </button>
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={() => {
                const next = canvasRef.current?.toggleAutoRotate() ?? false;
                setIsAutoRotatePaused(next);
              }}
              title={isAutoRotatePaused ? "自動回転を再開 (Space)" : "自動回転を一時停止 (Space)"}
              aria-label={isAutoRotatePaused ? "自動回転を再開" : "自動回転を一時停止"}
            >
              {isAutoRotatePaused ? <Play size={16} /> : <Pause size={16} />}
            </button>
            <button
              type="button"
              className="toolbar-icon-btn"
              onClick={() => canvasRef.current?.resetCamera()}
              title="視点を初期位置にリセット (R)"
              aria-label="視点を初期位置にリセット"
            >
              <RotateCcw size={16} />
            </button>
          </div>
        </div>

        {/* Narrative & Guidance Sidebar Card */}
        <aside className="tutorial-narrative-card">
          {/* Progress Indicators */}
          <div
            className="tutorial-progress-bar-container"
            role="progressbar"
            aria-valuenow={currentStepIndex + 1}
            aria-valuemin={1}
            aria-valuemax={TUTORIAL_STEPS.length}
            aria-label={`ステップ ${currentStepIndex + 1} / ${TUTORIAL_STEPS.length}`}
          >
            <div className="tutorial-step-tabs">
              {TUTORIAL_STEPS.map((step, idx) => {
                const isCurrent = idx === currentStepIndex;
                const isPassed = idx < currentStepIndex;
                return (
                  <button
                    key={step.id}
                    type="button"
                    className={`step-tab-indicator ${isCurrent ? "is-active" : ""} ${isPassed ? "is-passed" : ""}`}
                    onClick={() => setCurrentStepIndex(idx)}
                    title={`ステップ${step.id}: ${step.title}`}
                    aria-label={`ステップ${step.id}を表示: ${step.title}`}
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    <span className="step-num">{step.id}</span>
                  </button>
                );
              })}
            </div>
            <div className="tutorial-step-counter mono tiny muted">
              STEP {currentStepIndex + 1} OF {TUTORIAL_STEPS.length}
            </div>
          </div>

          {/* Content Card with Framer Motion Transition */}
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep.id}
              initial={isReducedMotion ? false : { opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={isReducedMotion ? undefined : { opacity: 0, x: -20 }}
              transition={{ duration: 0.25, ease: "easeOut" }}
              className="tutorial-step-content"
            >
              <div className="tutorial-badge-row">
                <span className="badge badge-cyan mono tiny">{currentStep.badge}</span>
              </div>

              <h2 className="tutorial-step-title">{currentStep.title}</h2>
              <p className="tutorial-step-subtitle muted">{currentStep.subtitle}</p>

              <div className="tutorial-divider" />

              <p className="tutorial-step-description">{currentStep.description}</p>

              {/* Action Recommendation Box */}
              <div className="tutorial-action-box">
                <div className="action-box-header">
                  <Info size={15} className="action-box-icon" />
                  <span className="mono tiny uppercase" style={{ fontWeight: 600 }}>
                    操作のヒント
                  </span>
                </div>
                <p className="action-box-text">{currentStep.keyAction}</p>
              </div>

              {/* 3D Scene Accessibility Note */}
              <div className="tutorial-scene-note">
                <span className="tiny muted">
                  <strong>3Dシーンの解説:</strong> {currentStep.sceneDescription}
                </span>
              </div>
            </motion.div>
          </AnimatePresence>

          {/* Navigation Controls Footer */}
          <div className="tutorial-nav-footer">
            {!isFirstStep && (
              <button
                type="button"
                className="btn btn-outline"
                onClick={goToPrevStep}
                aria-label="前のステップに戻る"
              >
                <ChevronLeft size={16} />
                <span>前へ</span>
              </button>
            )}

            {isLastStep ? (
              <button
                type="button"
                className="btn btn-primary tutorial-finish-btn"
                onClick={handleFinish}
                aria-label="チュートリアルを完了してIndexForgeを開始する"
              >
                <CheckCircle2 size={16} />
                <span>チュートリアルを完了して始める</span>
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary tutorial-next-btn"
                onClick={goToNextStep}
                aria-label="次のステップに進む"
              >
                <span>次へ</span>
                <ChevronRight size={16} />
              </button>
            )}
          </div>
        </aside>
      </div>

      {/* Keyboard Shortcuts Modal */}
      <ModalBase
        isOpen={isShortcutsModalOpen}
        onClose={() => setIsShortcutsModalOpen(false)}
        title="キーボード操作＆アクセシビリティガイド"
        icon={<Keyboard size={18} />}
        maxWidth={520}
        ariaLabel="キーボードショートカット一覧"
      >
        <div className="tutorial-shortcuts-dialog">
          <p className="tiny muted" style={{ marginBottom: 14 }}>
            マウス操作を行わなくても、キーボードのみで全てのチュートリアルおよび視点操作を実行できます。
          </p>

          <div className="shortcuts-table-container">
            <table className="shortcuts-table" aria-label="利用可能なショートカット一覧">
              <thead>
                <tr>
                  <th scope="col">キー</th>
                  <th scope="col">動作</th>
                  <th scope="col">分類</th>
                </tr>
              </thead>
              <tbody>
                {TUTORIAL_KEYBOARD_SHORTCUTS.map((item, idx) => (
                  <tr key={idx}>
                    <td>
                      <kbd className="tutorial-kbd">{item.key}</kbd>
                    </td>
                    <td>{item.label}</td>
                    <td>
                      <span className="badge badge-subtle mono tiny" style={{ fontSize: 10 }}>
                        {item.category === "navigation"
                          ? "ナビゲーション"
                          : item.category === "3d_camera"
                            ? "3Dカメラ"
                            : "アクセシビリティ"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 16, display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setIsShortcutsModalOpen(false)}
            >
              閉じる
            </button>
          </div>
        </div>
      </ModalBase>
    </div>
  );
}
