import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";
import { useOverlayRoot } from "./ModalBase";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
}

export interface ToastItemData {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextValue {
  showToast: (message: string, options?: ToastOptions) => void;
  success: (message: string, duration?: number) => void;
  error: (message: string, duration?: number) => void;
  warning: (message: string, duration?: number) => void;
  info: (message: string, duration?: number) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within a ToastProvider");
  }
  return context;
}

/** Why an auto-dismiss timer is currently paused. */
type PauseReason = "pointer" | "focus";

interface ToastTimer {
  handle: ReturnType<typeof setTimeout> | null;
  /** Milliseconds left when the timer was last paused. */
  remaining: number;
  /** Wall clock at which the current (re)started run began. */
  startedAt: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItemData[]>([]);
  // Timer ownership lives in refs so a manual close or an unmount can always
  // cancel the pending auto-dismiss (a bare setTimeout leaked one callback per
  // toast and fired after the provider was gone).
  const timersRef = useRef<Map<string, ToastTimer>>(new Map());
  const pauseReasonsRef = useRef<Map<string, Set<PauseReason>>>(new Map());
  const overlayRoot = useOverlayRoot();

  const clearTimer = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer?.handle) clearTimeout(timer.handle);
    timersRef.current.delete(id);
    pauseReasonsRef.current.delete(id);
  }, []);

  const removeToast = useCallback(
    (id: string) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const startTimer = useCallback(
    (id: string, duration: number) => {
      const timer: ToastTimer = {
        handle: null,
        remaining: duration,
        startedAt: Date.now(),
      };
      timer.handle = setTimeout(() => {
        removeToast(id);
      }, duration);
      timersRef.current.set(id, timer);
    },
    [removeToast],
  );

  const pauseToast = useCallback((id: string, reason: PauseReason) => {
    const timer = timersRef.current.get(id);
    if (!timer || !timer.handle) return;
    const reasons = pauseReasonsRef.current.get(id) ?? new Set<PauseReason>();
    reasons.add(reason);
    pauseReasonsRef.current.set(id, reasons);
    // Another reason is already holding the timer: nothing to stop.
    if (reasons.size > 1) return;
    clearTimeout(timer.handle);
    timer.handle = null;
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
  }, []);

  const resumeToast = useCallback(
    (id: string, reason: PauseReason) => {
      const timer = timersRef.current.get(id);
      if (!timer) return;
      const reasons = pauseReasonsRef.current.get(id);
      if (reasons) {
        reasons.delete(reason);
        // Still hovered, or still focused: keep the timer paused.
        if (reasons.size > 0) return;
        pauseReasonsRef.current.delete(id);
      }
      if (timer.handle || timer.remaining <= 0) return;
      timer.startedAt = Date.now();
      timer.handle = setTimeout(() => {
        removeToast(id);
      }, timer.remaining);
    },
    [removeToast],
  );

  // Cancel every pending timer when the provider unmounts.
  useEffect(() => {
    const timers = timersRef.current;
    const pauseReasons = pauseReasonsRef.current;
    return () => {
      for (const timer of timers.values()) {
        if (timer.handle) clearTimeout(timer.handle);
      }
      timers.clear();
      pauseReasons.clear();
    };
  }, []);

  const showToast = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const type = options?.type || "info";
      const duration = options?.duration ?? 3500;

      setToasts((prev) => [...prev, { id, message, type, duration }]);

      if (duration > 0) {
        startTimer(id, duration);
      }
    },
    [startTimer],
  );

  const success = useCallback(
    (message: string, duration?: number) => showToast(message, { type: "success", duration }),
    [showToast],
  );

  const error = useCallback(
    (message: string, duration?: number) => showToast(message, { type: "error", duration }),
    [showToast],
  );

  const warning = useCallback(
    (message: string, duration?: number) => showToast(message, { type: "warning", duration }),
    [showToast],
  );

  const info = useCallback(
    (message: string, duration?: number) => showToast(message, { type: "info", duration }),
    [showToast],
  );

  // Context value を memo しないと ToastProvider の再レンダーごとに
  // success/error 等の参照が変わり、それらを effect 依存に持つ呼び出し側
  // (自動保存など) が不要な再実行を起こす。
  const contextValue = useMemo(
    () => ({ showToast, success, error, warning, info, removeToast }),
    [showToast, success, error, warning, info, removeToast],
  );

  const toastContainer = (
    // Only one politeness model: each toast owns it (`role="alert"` for errors,
    // `role="status"` otherwise). A live container on top of that announced
    // every error twice and made polite messages interrupt.
    <div className="toast-container" role="region" aria-label="通知一覧">
      <AnimatePresence>
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            onClose={() => removeToast(toast.id)}
            onPause={(reason) => pauseToast(toast.id, reason)}
            onResume={(reason) => resumeToast(toast.id, reason)}
          />
        ))}
      </AnimatePresence>
    </div>
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {/* Portaled to the overlay root so toasts stay visible in fullscreen. */}
      {overlayRoot ? createPortal(toastContainer, overlayRoot) : toastContainer}
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onClose,
  onPause,
  onResume,
}: {
  toast: ToastItemData;
  onClose: () => void;
  onPause: (reason: PauseReason) => void;
  onResume: (reason: PauseReason) => void;
}) {
  const iconMap: Record<ToastType, ReactNode> = {
    success: <CheckCircle2 size={16} style={{ color: "var(--neon-green)" }} />,
    error: <AlertCircle size={16} style={{ color: "var(--neon-red)" }} />,
    warning: <AlertTriangle size={16} style={{ color: "var(--neon-amber)" }} />,
    info: <Info size={16} style={{ color: "var(--neon-cyan)" }} />,
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.2 } }}
      className={`toast-item toast-${toast.type}`}
      role={toast.type === "error" ? "alert" : "status"}
      // Reading a toast (hover or keyboard focus) must not race the
      // auto-dismiss timer.
      onMouseEnter={() => onPause("pointer")}
      onMouseLeave={() => onResume("pointer")}
      onFocus={() => onPause("focus")}
      onBlur={() => onResume("focus")}
    >
      <div className="toast-icon">{iconMap[toast.type]}</div>
      <div className="toast-message">{toast.message}</div>
      <button
        type="button"
        className="toast-close-btn"
        onClick={onClose}
        aria-label="通知を閉じる"
      >
        <X size={14} />
      </button>
    </motion.div>
  );
}
