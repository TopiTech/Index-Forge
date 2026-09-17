import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { MotionConfig } from "framer-motion";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorFallback";
import { ToastProvider } from "./components/Toast";
import {
  isPageReload,
  applyReloadSuppressionClass,
  removeReloadSuppressionClass,
} from "./lib/pageReload";
import "./index.css";

export function RootApp() {
  const isReload = isPageReload();
  const [suppressAnimation, setSuppressAnimation] = useState(isReload);

  useEffect(() => {
    if (!isReload) return;

    // Ensure suppression class is attached during reload mount
    applyReloadSuppressionClass();

    // After initial page load and paint have settled, restore normal interaction animations
    let cancelled = false;
    const timer = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          if (cancelled) return;
          removeReloadSuppressionClass();
          setSuppressAnimation(false);
        });
      });
    }, 150);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      removeReloadSuppressionClass();
    };
  }, [isReload]);

  return (
    <MotionConfig reducedMotion={suppressAnimation ? "always" : "user"}>
      <ToastProvider>
        <App isReloadSuppressed={suppressAnimation} />
      </ToastProvider>
    </MotionConfig>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <RootApp />
    </ErrorBoundary>
  </React.StrictMode>
);
