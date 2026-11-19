import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { prefersReducedMotion, subscribeMediaQuery, REDUCED_MOTION_QUERY } from "../lib/mediaQuery";

function Spinner() {
  return (
    <div
      style={{
        width: 48,
        height: 48,
        borderRadius: "50%",
        border: "2px solid transparent",
        borderTopColor: "var(--neon-cyan)",
        borderRightColor: "var(--neon-cyan)",
      }}
    />
  );
}

export function LoadingScreen({ message = "INITIALIZING..." }: { message?: string }) {
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  useEffect(() => subscribeMediaQuery(REDUCED_MOTION_QUERY, setReducedMotion), []);

  return (
    <div
      className="app"
      role="status"
      aria-live="polite"
      aria-label={message}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        flexDirection: "column",
        gap: 20,
      }}
    >
      {reducedMotion ? (
        // Keep the same static icon visible, but do not spin it when the OS
        // asks for reduced motion (including changes while the screen is up).
        <div>
          <Spinner />
        </div>
      ) : (
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
        >
          <Spinner />
        </motion.div>
      )}
      <div className="muted mono" style={{ letterSpacing: 2, fontSize: 12 }}>
        {message}
      </div>
    </div>
  );
}
