"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cssVarsFor, type ThemeName } from "./theme-tokens";

const STORAGE_KEY = "hero-theme";

interface ThemeContextValue {
  theme: ThemeName;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): ThemeName {
  if (typeof window === "undefined") return "sealed";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "open" || saved === "sealed") return saved;
  } catch {
    // ignore (e.g. localStorage disabled)
  }
  return "sealed";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>("sealed");

  // Corrects from localStorage after mount so server and first client
  // render both use the "sealed" default — no hydration mismatch.
  useEffect(() => {
    setTheme(readStoredTheme());
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    const vars = cssVarsFor(theme);
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // ignore
    }
  }, [theme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === "sealed" ? "open" : "sealed")),
    }),
    [theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within a ThemeProvider");
  return ctx;
}
