import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { api, ageSec, currentUser, fmtG, fmtMoney, fmtTime, setCurrentUser, useLive, type AppUser, type Notification, type Overview } from "./api.ts";
import { Icon, useSidebar, useTheme } from "./ui.tsx";
import { LogsPage } from "./pages/Logs.tsx";
import { R1Overview } from "./pages/R1Overview.tsx";
import { R2Prices } from "./pages/R2Prices.tsx";
import { Placeholder } from "./pages/Placeholder.tsx";
import { R10Settings } from "./pages/R10Settings.tsx";
import { R3Orders } from "./pages/R3Orders.tsx";
import { R5CurrentAccount } from "./pages/R5CurrentAccount.tsx";
import { R4Vault } from "./pages/R4Vault.tsx";
import { R6Delivery } from "./pages/R6Delivery.tsx";
import { R7Refining } from "./pages/R7Refining.tsx";
import { R8Settlement } from "./pages/R8Settlement.tsx";
import { R9Documents } from "./pages/R9Documents.tsx";

export const SCREENS = [
  { code: "R1", path: "/", title: "Genel bakış", sprint: 1 },
  { code: "R2", path: "/fiyat", title: "Fiyat yayını", sprint: 1 },
  { code: "R3", path: "/emirler", title: "Emirler", sprint: 2, done: true },
  { code: "R4", path: "/kasa", title: "Kasa hesabı", sprint: 3, done: true },
  { code: "R5", path: "/cari", title: "Cari hesap", sprint: 2, done: true },
  { code: "R6", path: "/teslimat", title: "Fiziksel teslimat", sprint: 4, done: true },
  { code: "R7", path: "/rafinasyon", title: "Rafinasyon", sprint: 4, done: true },
  { code: "R8", path: "/mahsuplasma", title: "Mahsuplaşma", sprint: 5, done: true },
  { code: "R9", path: "/belgeler", title: "Belgeler", sprint: 5, done: true },
  { code: "R10", path: "/ayarlar", title: "Ayarlar ve kullanıcılar", sprint: 1 },
  { code: "R11", path: "/kayitlar", title: "Kayıtlar", sprint: 1 },
];

export function App() {
  const live = useLive();
  const o = live.overview;
  const side = useSidebar();
  return (
    <div className={`layout${side.collapsed ? " collapsed" : ""}${side.mobileOpen ? " nav-open" : ""}`}>
      {side.mobileOpen && <div className="nav-backdrop" onClick={side.closeMobile} />}
      <aside className="side">
        <button className="side-toggle" onClick={side.toggle} title={side.collapsed ? "Menüyü genişlet" : "Menüyü daralt"} aria-label="Menüyü daralt">{Icon.chevronLeft}</button>
        <div className="brand">
          <img src="/amr-logo.svg" alt="AMR" />
          <span className="bt">AMR</span>
          <span className="badge">BO</span>
        </div>
        <nav className="nav" onClick={() => side.isMobile && side.closeMobile()}>
        {SCREENS.map((s) => (
          <NavLink key={s.code} to={s.path} end={s.path === "/"} title={s.title}>
            <span className="code">{s.code}</span><span className="label">{s.title}</span>
            {s.sprint > 1 && !(s as any).done && <span className="sprint">Sprint {s.sprint}</span>}
          </NavLink>
        ))}
        <a className="doc" href="/docs" target="_blank" rel="noreferrer" title="API dokümanı">
          <span className="code">API</span><span className="label">API dokümanı</span>
        </a>
        </nav>
        <SideStatus o={o} sse={live.connected} />
      </aside>
      <TopBar o={o} sseConnected={live.connected} refresh={live.refresh} onMenu={side.openMobile} />
      <main className="main">
        <Routes>
          <Route path="/" element={<R1Overview live={live} />} />
          <Route path="/fiyat" element={<R2Prices live={live} />} />
          <Route path="/emirler" element={<R3Orders live={live} />} />
          <Route path="/kasa" element={<R4Vault live={live} />} />
          <Route path="/cari" element={<R5CurrentAccount live={live} />} />
          <Route path="/teslimat" element={<R6Delivery live={live} />} />
          <Route path="/rafinasyon" element={<R7Refining live={live} />} />
          <Route path="/mahsuplasma" element={<R8Settlement live={live} />} />
          <Route path="/belgeler" element={<R9Documents live={live} />} />
          <Route path="/ayarlar" element={<R10Settings live={live} />} />
          <Route path="/kayitlar" element={<LogsPage endpoint="/admin/logs" tag="R11" title="Kayıtlar" />} />
        </Routes>
      </main>
    </div>
  );
}

/** Demoda oturum açma yoktur: aktif kullanıcı buradan seçilir, her istekte X-User ile gider. */
function UserPicker() {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [who, setWho] = useState(currentUser.name);
  useEffect(() => { api.users().then((r) => setUsers(r.items)).catch(() => {}); }, []);
  const me = users.find((u) => u.username === who);
  const initials = (me?.display_name ?? who).slice(0, 2).toUpperCase();
  return (
    <label className="user" title={me ? `${me.display_name} · ${me.role_tr ?? me.role}` : who}>
      <span className="avatar">{initials}</span>
      <select value={who} onChange={(e) => { setWho(e.target.value); setCurrentUser(e.target.value); location.reload(); }}>
        {users.length === 0 && <option value={who}>{who}</option>}
        {users.map((u) => <option key={u.username} value={u.username}>{u.display_name}</option>)}
      </select>
    </label>
  );
}

function TopBar({ o, sseConnected, refresh, onMenu }: { o: Overview | null; sseConnected: boolean; refresh: () => void; onMenu: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (open) api.notifications().then((r) => setItems(r.items)); }, [open, o?.unread]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  const pub = o?.publish;
  const usd = pub?.lastPrices?.find((p) => p.ccy === "USD");
  void sseConnected;

  return (
    <header className="topbar">
      <button className="hamburger" onClick={onMenu} title="Menü" aria-label="Menü">{Icon.menu}</button>

      {/* üst şeritte yalnız iki canlı değer: yayın durumu ve fiyat. Ayrıntı ilgili ekranda. */}
      <span className={`state ${pub?.tradable ? "ok" : "bad"}`} title={pub?.tradable ? "Kanzasset'e fiyat veriliyor" : pub?.haltReason ?? "yayın durdu"}>
        <span className={`dot ${pub?.tradable ? "ok" : "bad"}`} />
        {pub ? (pub.tradable ? "Yayın açık" : "Yayın durdu") : "…"}
      </span>
      <span className="price" title={pub?.lastTickTs ? `seq ${pub.seq} · ${ageSec(pub.lastTickTs)} sn önce` : "tick yok"}>
        <span className="k">FİYAT</span>
        <span className="mono v">{usd ? `${usd.bid} / ${usd.ask}` : "yok"}</span>
        <span className="k">USD/g</span>
      </span>

      <div className="tspace" />

      <ThemeButton />
      <button className="bell" onClick={() => setOpen((v) => !v)} title="Bildirimler" aria-label="Bildirimler">
        {Icon.bellIcon}
        {o && o.unread > 0 && <span className="n">{o.unread}</span>}
      </button>
      <UserPicker />

      {open && (
        <>
          <div className="drawer-backdrop" onClick={() => setOpen(false)} />
          <div className="drawer">
            <div className="dhead">
              <b>Bildirimler</b>
              <span className="sp" />
              <button className="ghost" onClick={async () => { await Promise.all(items.filter((n) => !n.read_ts).map((n) => api.markRead(n.id))); setItems((await api.notifications()).items); refresh(); }}>Tümünü okundu</button>
              <button className="ghost" onClick={() => setOpen(false)} aria-label="Kapat">✕</button>
            </div>
            {items.length === 0 && <div className="item">Bildirim yok</div>}
            {items.map((n) => {
              const to = noticeRoute(n.type);
              return (
                <div key={n.id} className={`item ${n.read_ts ? "" : "unread"}`}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div><b>{n.title}</b></div>
                    {n.body && <div className="small">{n.body}</div>}
                    <div className="t">{new Date(n.created_ts).toLocaleString("tr-TR")}</div>
                    <div className="row" style={{ marginTop: 6 }}>
                      {to && <Link to={to.path} onClick={async () => { if (!n.read_ts) { await api.markRead(n.id); refresh(); } setOpen(false); }}><button className="primary">{to.label}</button></Link>}
                      {!n.read_ts && <button className="ghost" onClick={async () => { await api.markRead(n.id); setItems((await api.notifications()).items); refresh(); }}>Okundu</button>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </header>
  );
}

/** Bildirimi ilgili ekrana bağlar: "okundu" demek yerine işi yapılacak yere götürür. */
function noticeRoute(type: string): { path: string; label: string } | null {
  if (type.startsWith("approval")) return { path: "/ayarlar", label: "Onaya git (R10)" };
  if (type.startsWith("vault")) return { path: "/kasa", label: "Kasa hesabına git (R4)" };
  if (type.startsWith("settlement")) return { path: "/mahsuplasma", label: "Mahsuplaşmaya git (R8)" };
  if (type.startsWith("delivery")) return { path: "/teslimat", label: "Teslimata git (R6)" };
  if (type.startsWith("refining") || type.startsWith("catalog")) return { path: "/rafinasyon", label: "Rafinasyona git (R7)" };
  if (type.startsWith("order")) return { path: "/emirler", label: "Emirlere git (R3)" };
  if (type.startsWith("account")) return { path: "/cari", label: "Cari hesaba git (R5)" };
  if (type.startsWith("source") || type.startsWith("price") || type.startsWith("publish")) return { path: "/fiyat", label: "Fiyat yayınına git (R2)" };
  if (type.startsWith("document")) return { path: "/belgeler", label: "Belgelere git (R9)" };
  return null;
}

function ThemeButton() {
  const theme = useTheme();
  const label = theme.mode === "light" ? "Açık tema" : theme.mode === "dark" ? "Koyu tema" : "Sistem teması";
  return (
    <button className="theme-btn" onClick={theme.cycle} title={`${label} (değiştirmek için tıklayın)`} aria-label={label}>
      {theme.mode === "light" ? Icon.sun : theme.mode === "dark" ? Icon.moon : Icon.auto}
    </button>
  );
}

/**
 * Yan menünün altındaki sabit durum satırları.
 *
 * Bağlantılar üst şeritte değil burada durur: her ekranda görünür, yer kaplamaz
 * ve üst şerit günlük işe (yayın, fiyat, bildirim, kullanıcı) kalır.
 */
function SideStatus({ o, sse }: { o: Overview | null; sse: boolean }) {
  const src = o?.source;
  const subs = o?.publish?.subscribers ?? 0;
  return (
    <div className="side-status">
      <div className="srow" title={src?.url ?? ""}>
        <span className={`dot ${src?.status === "CONNECTED" ? "ok" : src?.status === "CONNECTING" ? "warn" : "bad"}`} />
        <span className="label">Merkez {src?.status === "CONNECTED" ? "bağlı" : src?.status === "CONNECTING" ? "bağlanıyor" : "kopuk"}</span>
      </div>
      <div className="srow" title="Kanzasset fiyat soketine bağlı mı">
        <span className={`dot ${subs > 0 ? "ok" : "bad"}`} />
        <span className="label">Kanzasset {subs > 0 ? `bağlı · ${subs} abone` : "bağlı değil"}</span>
      </div>
      <div className="srow" title="sunucudan canlı akış (SSE)">
        <span className={`dot ${sse ? "ok" : "warn"}`} />
        <span className="label">Canlı akış {sse ? "açık" : "kapalı"}</span>
      </div>
    </div>
  );
}
