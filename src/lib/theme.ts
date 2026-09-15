import { useState, useEffect, useCallback } from "react";
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

const listeners = new Set<() => void>();

function notifyThemeListeners(): void {
  listeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // Ignore listener error
    }
  });
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() => getStoredTheme());
  const [accent, setAccentState] = useState<AccentColor>(() => getStoredAccent());

  useEffect(() => {
    applyTheme(theme, accent);
  }, [theme, accent]);

  useEffect(() => {
    const handleSync = () => {
      setThemeState(getStoredTheme());
      setAccentState(getStoredAccent());
    };
    listeners.add(handleSync);

    const handleStorage = (e: unknown) => {
      const key = (e as { key?: string | null } | null)?.key;
      if (key === THEME_STORAGE_KEY || key === ACCENT_STORAGE_KEY) {
        handleSync();
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

  const setTheme = useCallback((newTheme: ThemeMode) => {
    setThemeState(newTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, newTheme);
    } catch {
      // Storage may be unavailable or read-only.
    }
    applyTheme(newTheme, accent);
    notifyThemeListeners();
  }, [accent]);

  const toggleTheme = useCallback(() => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
  }, [theme, setTheme]);

  const setAccent = useCallback((newAccent: AccentColor) => {
    setAccentState(newAccent);
    try {
      localStorage.setItem(ACCENT_STORAGE_KEY, newAccent);
    } catch {
      // Storage may be unavailable or read-only.
    }
    applyTheme(theme, newAccent);
    notifyThemeListeners();
  }, [theme]);

  return {
    theme,
    accent,
    setTheme,
    toggleTheme,
    setAccent,
    accentOptions: ACCENT_OPTIONS,
  };
}

