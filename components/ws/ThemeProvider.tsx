"use client";

import { createContext, useContext, useEffect, useSyncExternalStore } from "react";

type Theme = "day" | "night";
const storageKey = "agilecampus-theme";
let memory: Theme = "night";
function snapshot(): Theme {
  try { const saved = localStorage.getItem(storageKey); if (saved === "day" || saved === "night") return saved; }
  catch { /* Browsers with storage disabled still support switching. */ }
  return memory;
}
function subscribe(update: () => void) {
  window.addEventListener("agilecampus-theme", update);
  window.addEventListener("storage", update);
  return () => { window.removeEventListener("agilecampus-theme", update); window.removeEventListener("storage", update); };
}
const ThemeContext = createContext<{ theme: Theme; toggle(): void }>({ theme: "night", toggle() {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "night" as Theme);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  function toggle() {
    const next = theme === "night" ? "day" : "night";
    memory = next;
    try { localStorage.setItem(storageKey, next); } catch { /* Use memory fallback. */ }
    document.documentElement.dataset.theme = next;
    window.dispatchEvent(new Event("agilecampus-theme"));
  }
  return <ThemeContext.Provider value={{ theme, toggle }}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
