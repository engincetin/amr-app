/**
 * Ekran kabuğunun küçük yardımcıları: tema (açık / koyu / sistem), yan menü durumu, kırılma noktaları.
 *
 * Kanzasset backoffice'indeki ThemeService'in karşılığıdır: seçim localStorage'da durur,
 * "sistem" seçiliyken işletim sistemi tercihi izlenir ve <html> üzerine `dark` sınıfı konur.
 * Kırılma noktaları kanzasset-web ile aynıdır: 768 mobil, 1024 tablet.
 */
import { useEffect, useState, type ReactNode } from "react";

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
  bellIcon: (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9z" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" />
      <path d="M10 21a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

/**
 * Menü simgeleri (kanzasset-bo çizgisi: 17 px, ince çizgi, currentColor).
 * Daraltılmış menüde yalnız bunlar görünür; ekran kodu (R3, K3) sayfa başlığındaki etikette kalır.
 */
const I = (d: string, extra?: string) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />{extra ? <path d={extra} /> : null}
  </svg>
);
export const NavIcon: Record<string, ReactNode> = {
  overview: I("M3 3h8v8H3zM13 3h8v5h-8zM13 10h8v11h-8zM3 13h8v8H3z"),
  price: I("M3 17l5-6 4 3 5-8 4 5", "M3 21h18"),
  orders: I("M8 6h13M8 12h13M8 18h13", "M3 6h.01M3 12h.01M3 18h.01"),
  vault: I("M3 5h18v14H3z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM7 19v2M17 19v2"),
  account: I("M4 6h16v12H4z", "M4 10h16M8 15h3"),
  accounts: I("M4 4h12l4 4v12H4z", "M8 12h8M8 16h5"),
  treasury: I("M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M9 9.5c0-1 1.3-1.5 3-1.5s3 .5 3 1.5-1.3 1.5-3 1.5-3 .5-3 1.5 1.3 1.5 3 1.5 3-.5 3-1.5M12 6v2M12 16v2"),
  delivery: I("M3 7h11v9H3zM14 10h4l3 3v3h-7z", "M6 19a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3zM16 19a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3z"),
  refining: I("M12 3c2 3 5 5 5 9a5 5 0 0 1-10 0c0-2 1-3 2-4 0 2 1 3 2 3 1-2 1-5 1-8z"),
  settlement: I("M12 3v18", "M5 8h14M7 8l-3 6h6zM17 8l-3 6h6z"),
  documents: I("M6 3h8l4 4v14H6z", "M14 3v4h4M9 12h6M9 16h6"),
  logs: I("M4 5h16M4 10h16M4 15h10M4 20h7"),
  settings: I("M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z", "M19.4 15a1 1 0 0 0 .2 1.1l.1.1a1.2 1.2 0 1 1-1.7 1.7l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V19a1.2 1.2 0 1 1-2.4 0v-.1a1 1 0 0 0-.7-.9 1 1 0 0 0-1.1.2l-.1.1a1.2 1.2 0 1 1-1.7-1.7l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H5a1.2 1.2 0 1 1 0-2.4h.1a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1.1l-.1-.1a1.2 1.2 0 1 1 1.7-1.7l.1.1a1 1 0 0 0 1.1.2h0a1 1 0 0 0 .6-.9V5a1.2 1.2 0 1 1 2.4 0v.1a1 1 0 0 0 .6.9 1 1 0 0 0 1.1-.2l.1-.1a1.2 1.2 0 1 1 1.7 1.7l-.1.1a1 1 0 0 0-.2 1.1v0a1 1 0 0 0 .9.6H19a1.2 1.2 0 1 1 0 2.4h-.1a1 1 0 0 0-.9.6z"),
  api: I("M8 8l-4 4 4 4M16 8l4 4-4 4", "M14 5l-4 14"),
};
