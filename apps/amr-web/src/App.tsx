import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, ageSec, currentUser, fmtG, fmtMoney, fmtTime, setCurrentUser, useLive, type AppUser, type Notification, type Overview } from "./api.ts";
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
];

export function App() {
  const live = useLive();
  const o = live.overview;
  return (
    <div className="layout">
      <div className="brand"><span>AMR uygulaması</span><b>·</b><span className="small" style={{ color: "#c9ced6" }}>Kanzasset FZCO</span></div>
      <nav className="nav">
        {SCREENS.map((s) => (
          <NavLink key={s.code} to={s.path} end={s.path === "/"}>
            <span className="code">{s.code}</span><span>{s.title}</span>
            {s.sprint > 1 && !(s as any).done && <span className="sprint">Sprint {s.sprint}</span>}
          </NavLink>
        ))}
      </nav>
      <TopBar o={o} sseConnected={live.connected} refresh={live.refresh} />
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
  return (
    <div className="chip">
      <span className="l">Kullanıcı</span>
      <span className="v">
        <select value={who} onChange={(e) => { setWho(e.target.value); setCurrentUser(e.target.value); location.reload(); }}>
          {users.length === 0 && <option value={who}>{who}</option>}
          {users.map((u) => <option key={u.username} value={u.username}>{u.display_name}</option>)}
        </select>
      </span>
      <span className="s">{me ? `${me.role_tr ?? me.role}${me.permissions && me.permissions.length === 0 ? " · salt okunur" : ""}` : "rol yükleniyor"}</span>
    </div>
  );
}

function TopBar({ o, sseConnected, refresh }: { o: Overview | null; sseConnected: boolean; refresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);
  useEffect(() => { if (open) api.notifications().then((r) => setItems(r.items)); }, [open, o?.unread]);

  const pub = o?.publish;
  const src = o?.source;
  const age = ageSec(pub?.lastTickTs);
  const priceDot = !pub ? "" : pub.tradable ? (age !== null && age > 10 ? "warn" : "ok") : "bad";
  const priceText = !pub ? "…" : pub.tradable ? "Yayında" : pub.manualHalt ? "Durduruldu" : "Merkez yok";
  const usd = pub?.lastPrices?.find((p) => p.ccy === "USD");
  const acc = o?.account;

  return (
    <header className="topbar">
      <div className="chip">
        <span className="l">Fiyat yayını</span>
        <span className="v"><span className={`dot ${priceDot}`} />{priceText}</span>
        <span className="s">{usd ? `USD ${usd.bid} / ${usd.ask} · ${age ?? 0} sn önce` : "tick yok"}</span>
      </div>
      <div className="chip">
        <span className="l">Merkez</span>
        <span className="v"><span className={`dot ${src?.status === "CONNECTED" ? "ok" : src?.status === "CONNECTING" ? "warn" : "bad"}`} />{src?.status === "CONNECTED" ? "Bağlı" : src?.status === "CONNECTING" ? "Bağlanıyor" : "Kopuk"}</span>
        <span className="s">{src?.lastPriceTs ? `son fiyat ${fmtTime(src.lastPriceTs)}` : "fiyat gelmedi"}</span>
      </div>
      <div className="chip">
        <span className="l">Kasa hesabı</span>
        <span className="v mono">{acc ? fmtG(acc.vault.in_vault_mg + acc.vault.placing_mg + acc.vault.shipping_mg) : "…"} g</span>
        <span className="s">{acc ? `kasada ${fmtG(acc.vault.in_vault_mg)} · konuluyor ${fmtG(acc.vault.placing_mg)} · sevkiyatta ${fmtG(acc.vault.shipping_mg)}` : ""}</span>
      </div>
      <div className="chip">
        <span className="l">Cari hesap</span>
        <span className="v mono">{acc ? `${acc.current_account.gold_mg >= 0 ? "+" : ""}${fmtG(acc.current_account.gold_mg)} g` : "…"}</span>
        <span className="s">{acc ? acc.current_account.money.map((m) => `${m.ccy} ${fmtMoney(m.cents)}`).join(" · ") : ""}{o?.limit ? ` · limit %${(o.limit.max_pct * 100).toFixed(1)}` : ""}</span>
      </div>
      <div className="chip">
        <span className="l">Kanzasset bağlantısı</span>
        <span className="v"><span className={`dot ${(pub?.subscribers ?? 0) > 0 ? "ok" : "bad"}`} />{(pub?.subscribers ?? 0) > 0 ? "Bağlı" : "Bağlı değil"}</span>
        <span className="s">{pub?.subscribers ?? 0} abone · canlı akış {sseConnected ? "açık" : "kapalı"}</span>
      </div>
      <UserPicker />
      <button className="bell" onClick={() => setOpen((v) => !v)} title="Bildirimler">
        🔔 Bildirimler {o && o.unread > 0 && <span className="n">{o.unread}</span>}
      </button>
      {open && (
        <div className="drawer">
          {items.length === 0 && <div className="item">Bildirim yok</div>}
          {items.map((n) => (
            <div key={n.id} className={`item ${n.read_ts ? "" : "unread"}`}>
              <div style={{ flex: 1 }}>
                <div><b>{n.title}</b></div>
                {n.body && <div className="small">{n.body}</div>}
                <div className="t">{new Date(n.created_ts).toLocaleString("tr-TR")}</div>
              </div>
              {!n.read_ts && <button className="ghost" onClick={async () => { await api.markRead(n.id); const r = await api.notifications(); setItems(r.items); refresh(); }}>Okundu</button>}
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
