import { useState, useEffect, useCallback, useRef } from "react";
import type { ThemeMode, AccentColor } from "../types";

const THEME_STORAGE_KEY = "custom_stock_index_theme";
const ACCENT_STORAGE_KEY = "custom_stock_index_accent";

interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

interface DocumentLike {
  documentElement?: {
    setAttribute: (name: string, value: string) => void;
  };
}

export interface AccentOption {
  key: AccentColor;
  label: string;
  color: string;
  glow: string;
}

export const ACCENT_OPTIONS: AccentOption[] = [
  {
    key: "cyan",
    label: "シアン",
    color: "#00e5ff",
    glow: "rgba(0, 229, 255, 0.4)",
  },
  {
    key: "emerald",
    label: "エメラルド",
    color: "#00e676",
    glow: "rgba(0, 230, 118, 0.4)",
  },
  {
    key: "violet",
    label: "バイオレット",
    color: "#b388ff",
    glow: "rgba(179, 136, 255, 0.4)",
  },
  {
    key: "amber",
    label: "アンバー",
    color: "#ffab00",
    glow: "rgba(255, 171, 0, 0.4)",
  },
  {
    key: "rose",
    label: "ローズ",
    color: "#ff3366",
    glow: "rgba(255, 51, 102, 0.4)",
  },
];

function getLocalStorage(): StorageLike | null {
  try {
    const storage = (globalThis as unknown as { localStorage?: StorageLike }).localStorage;
    return storage && typeof storage.getItem === "function" ? storage : null;
  } catch {
    return null;
  }
}

function getDocument(): DocumentLike | null {
  try {
    return (globalThis as unknown as { document?: DocumentLike }).document ?? null;
  } catch {
    return null;
  }
}

export function getStoredTheme(): ThemeMode {
  try {
    const store = getLocalStorage();
    const saved = store?.getItem(THEME_STORAGE_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {
    // Storage may be unavailable or contain an invalid value.
  }
  return "dark";
}

export function getStoredAccent(): AccentColor {
  try {
    const store = getLocalStorage();
    const saved = store?.getItem(ACCENT_STORAGE_KEY) as AccentColor;
    if (ACCENT_OPTIONS.some((opt) => opt.key === saved)) return saved;
  } catch {
    // Storage may be unavailable or contain an invalid value.
  }
  return "cyan";
}

export function applyTheme(theme: ThemeMode, accent: AccentColor): void {
  const doc = getDocument();
  if (!doc?.documentElement) return;
  doc.documentElement.setAttribute("data-theme", theme);
  doc.documentElement.setAttribute("data-accent", accent);
}

const listeners = new Set<(theme: ThemeMode, accent: AccentColor) => void>();

function notifyThemeListeners(theme: ThemeMode, accent: AccentColor): void {
  listeners.forEach((listener) => {
    try {
      listener(theme, accent);
    } catch {
      // Ignore listener error
    }
  });
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());
  const [accent, setAccentState] = useState<AccentColor>(() => getStoredAccent());
  const themeRef = useRef<ThemeMode>(theme);
  const accentRef = useRef<AccentColor>(accent);

  useEffect(() => {
    applyTheme(theme, accent);
  }, [theme, accent]);

  useEffect(() => {
    // Same-page instances receive the new values directly. Re-reading storage
    // here made the toggle appear broken whenever storage is read-only: the
    // write failed, the listener read the old/default value, and the state
    // reverted immediately after the click.
    const handleSync = (nextTheme: ThemeMode, nextAccent: AccentColor) => {
      themeRef.current = nextTheme;
      accentRef.current = nextAccent;
      setThemeState(nextTheme);
      setAccentState(nextAccent);
    };
    listeners.add(handleSync);

    const handleStorage = (e: unknown) => {
      const key = (e as { key?: string | null } | null)?.key;
      if (key === null || key === THEME_STORAGE_KEY || key === ACCENT_STORAGE_KEY) {
        // Cross-tab change or localStorage.clear(): storage is the source of truth.
        const nextTheme = getStoredTheme();
        const nextAccent = getStoredAccent();
        themeRef.current = nextTheme;
        accentRef.current = nextAccent;
        setThemeState(nextTheme);
        setAccentState(nextAccent);
      }
    };
    const win = globalThis as unknown as {
      addEventListener?: (type: string, listener: (e: unknown) => void) => void;
      removeEventListener?: (type: string, listener: (e: unknown) => void) => void;
    };
    if (typeof win.addEventListener === "function") {
      win.addEventListener("storage", handleStorage);
    }
    return () => {
      listeners.delete(handleSync);
      if (typeof win.removeEventListener === "function") {
        win.removeEventListener("storage", handleStorage);
      }
    };
  }, []);

  const setTheme = useCallback(
    (newTheme: ThemeMode) => {
      themeRef.current = newTheme;
      setThemeState(newTheme);
      try {
        getLocalStorage()?.setItem(THEME_STORAGE_KEY, newTheme);
      } catch {
        // Storage may be unavailable or read-only.
      }
      applyTheme(newTheme, accentRef.current);
      notifyThemeListeners(newTheme, accentRef.current);
    },
    [],
  );

  const toggleTheme = useCallback(() => {
    const next = themeRef.current === "dark" ? "light" : "dark";
    setTheme(next);
  }, [setTheme]);

  const setAccent = useCallback(
    (newAccent: AccentColor) => {
      accentRef.current = newAccent;
      setAccentState(newAccent);
      try {
        getLocalStorage()?.setItem(ACCENT_STORAGE_KEY, newAccent);
      } catch {
        // Storage may be unavailable or read-only.
      }
      applyTheme(themeRef.current, newAccent);
      notifyThemeListeners(themeRef.current, newAccent);
    },
    [],
  );

  return {
    theme,
    accent,
    setTheme,
    toggleTheme,
    setAccent,
    accentOptions: ACCENT_OPTIONS,
  };
}
