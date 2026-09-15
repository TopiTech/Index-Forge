import React, { useState, useRef, useEffect } from "react";
import { Sun, Moon, Palette, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTheme, ACCENT_OPTIONS } from "../lib/theme";

export function ThemeControls() {
  const { theme, accent, toggleTheme, setAccent } = useTheme();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Close palette on click outside or Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKeyDownGlobal = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDownGlobal);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDownGlobal);
    };
  }, [isOpen]);

  const currentOption = ACCENT_OPTIONS.find((opt) => opt.key === accent) || ACCENT_OPTIONS[0];

  const handleKeyDown = (e: React.KeyboardEvent, currentIndex: number) => {
    let nextIndex = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      nextIndex = (currentIndex + 1) % ACCENT_OPTIONS.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      nextIndex = (currentIndex - 1 + ACCENT_OPTIONS.length) % ACCENT_OPTIONS.length;
    }
    if (nextIndex >= 0) {
      const nextOpt = ACCENT_OPTIONS[nextIndex];
      setAccent(nextOpt.key);
      radioRefs.current[nextIndex]?.focus();
    }
  };

  return (
    <div className="theme-controls row" style={{ gap: 8, alignItems: "center" }}>
      {/* Dark / Light Mode Toggle */}
      <button
        type="button"
        onClick={toggleTheme}
        className="btn btn-sm btn-outline theme-toggle-btn"
        title={theme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"}
        aria-label={theme === "dark" ? "ライトモードに切り替え" : "ダークモードに切り替え"}
        style={{
          padding: "5px 9px",
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12,
          minHeight: 32,
        }}
      >
        {theme === "dark" ? (
          <>
            <Sun size={14} style={{ color: "var(--neon-yellow)" }} />
            <span className="theme-toggle-label">LIGHT</span>
          </>
        ) : (
          <>
            <Moon size={14} style={{ color: "var(--accent-text)" }} />
            <span className="theme-toggle-label">DARK</span>
          </>
        )}
      </button>

      {/* Accent Color Palette Collapsed by Default */}
      <div ref={containerRef} style={{ position: "relative" }}>
        <button
          type="button"
          onClick={() => setIsOpen((prev) => !prev)}
          className="btn btn-sm btn-outline theme-palette-toggle-btn"
          title={`テーマカラー選択 (現在: ${currentOption.label})`}
          aria-label={`テーマカラー選択 (現在: ${currentOption.label})`}
          aria-expanded={isOpen}
          aria-haspopup="true"
          style={{
            padding: "5px 8px",
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            minHeight: 32,
            cursor: "pointer",
          }}
        >
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              background: currentOption.color,
              boxShadow: `0 0 6px ${currentOption.color}`,
              display: "inline-block",
            }}
            aria-hidden="true"
          />
          <Palette size={13} style={{ color: "var(--text-muted)" }} />
          <ChevronDown
            size={12}
            style={{
              color: "var(--text-muted)",
              transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.15s ease",
            }}
          />
        </button>

        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.95 }}
              transition={{ duration: 0.15, ease: "easeOut" }}
              className="accent-picker-popover"
              style={{
                position: "absolute",
                top: "calc(100% + 6px)",
                right: 0,
                zIndex: 150,
                background: "var(--bg-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 10,
                padding: "8px 10px",
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.45), 0 0 0 1px var(--border-subtle)",
                minWidth: 150,
              }}
            >
              <div
                className="mono tiny muted uppercase"
                style={{ fontSize: 10, marginBottom: 8, letterSpacing: "0.05em" }}
              >
                テーマカラー
              </div>
              <div
                className="accent-picker row"
                style={{
                  gap: 8,
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
                role="radiogroup"
                aria-label="アクセントカラーの選択"
              >
                {ACCENT_OPTIONS.map((opt, idx) => {
                  const isSelected = accent === opt.key;
                  return (
                    <button
                      key={opt.key}
                      ref={(el) => {
                        radioRefs.current[idx] = el;
                      }}
                      type="button"
                      className="accent-option"
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      onKeyDown={(e) => handleKeyDown(e, idx)}
                      title={opt.label}
                      aria-label={`アクセントカラーを${opt.label}に変更`}
                      onClick={() => {
                        setAccent(opt.key);
                      }}
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: "50%",
                        background: opt.color,
                        border: isSelected
                          ? "2px solid var(--text-on-selection)"
                          : "2px solid transparent",
                        boxShadow: isSelected
                          ? `0 0 12px ${opt.color}`
                          : "0 2px 4px rgba(0,0,0,0.2)",
                        cursor: "pointer",
                        padding: 0,
                        transform: isSelected ? "scale(1.15)" : "scale(1)",
                        transition: "all 0.15s ease",
                      }}
                    />
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
