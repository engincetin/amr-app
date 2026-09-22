/**
 * Ekran kabuğunun küçük yardımcıları: tema (açık / koyu / sistem), yan menü durumu, kırılma noktaları.
 *
 * Kanzasset backoffice'indeki ThemeService'in karşılığıdır: seçim localStorage'da durur,
 * "sistem" seçiliyken işletim sistemi tercihi izlenir ve <html> üzerine `dark` sınıfı konur.
 * Kırılma noktaları kanzasset-web ile aynıdır: 768 mobil, 1024 tablet.
 */
import { useEffect, useState } from "react";

export const BP = { mobile: 768, tablet: 1024 };

export type ThemeMode = "light" | "dark" | "system";
const THEME_KEY = "amrTheme";
const SIDE_KEY = "amrSidebarCollapsed";

const prefersDark = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
const readMode = (): ThemeMode => {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* yok */ }
  return "system";
};
const apply = (mode: ThemeMode, systemDark: boolean) => {
  const dark = mode === "system" ? systemDark : mode === "dark";
  document.documentElement.classList.toggle("dark", dark);
};

/** Tema seçimi: açık, koyu ya da sistem. Dönen `resolved` o an uygulanan moddur. */
export function useTheme() {
  const [mode, setMode] = useState<ThemeMode>(readMode);
  const [systemDark, setSystemDark] = useState(prefersDark);

  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => { apply(mode, systemDark); }, [mode, systemDark]);

  const set = (m: ThemeMode) => {
    setMode(m);
    try { localStorage.setItem(THEME_KEY, m); } catch { /* yok */ }
  };
  const resolved: "light" | "dark" = mode === "system" ? (systemDark ? "dark" : "light") : mode;
  /** Tek düğmeyle sıra: açık → koyu → sistem. */
  const cycle = () => set(mode === "light" ? "dark" : mode === "dark" ? "system" : "light");
  return { mode, resolved, set, cycle };
}

/** Ekran genişliği eşiği (mobilde yan menü çekmeceye döner). */
export function useMediaQuery(query: string) {
  const get = () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return matches;
}
export const useIsMobile = () => useMediaQuery(`(max-width:${BP.mobile}px)`);
export const useIsTablet = () => useMediaQuery(`(max-width:${BP.tablet}px)`);

/** Yan menü: masaüstünde daraltılır (tercih saklanır), mobilde çekmece olarak açılır. */
export function useSidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(SIDE_KEY) === "1"; } catch { return false; }
  });
  const [mobileOpen, setMobileOpen] = useState(false);
  const isMobile = useIsMobile();
  const toggle = () => setCollapsed((c) => {
    const next = !c;
    try { localStorage.setItem(SIDE_KEY, next ? "1" : "0"); } catch { /* yok */ }
    return next;
  });
  useEffect(() => { if (!isMobile) setMobileOpen(false); }, [isMobile]);
  return { collapsed, toggle, isMobile, mobileOpen, openMobile: () => setMobileOpen(true), closeMobile: () => setMobileOpen(false) };
}

/** Yan menü ve tema düğmelerinin simgeleri (bağımlılık eklemeden, satır içi SVG). */
export const Icon = {
  chevronLeft: (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M7.5 3L4.5 6L7.5 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  menu: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  sun: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  moon: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  ),
  auto: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.7" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
    </svg>
  ),
};
