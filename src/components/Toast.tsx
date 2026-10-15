import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, AlertTriangle, AlertCircle, Info, X } from "lucide-react";

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

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItemData[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const type = options?.type || "info";
      const duration = options?.duration ?? 3500;

      setToasts((prev) => [...prev, { id, message, type, duration }]);

      if (duration > 0) {
        setTimeout(() => {
          removeToast(id);
        }, duration);
      }
    },
    [removeToast],
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

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <div className="toast-container" aria-live="polite" role="region" aria-label="通知一覧">
        <AnimatePresence>
          {toasts.map((toast) => (
            <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: ToastItemData; onClose: () => void }) {
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
