import { useEffect, useState } from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { api, ageSec, fmtG, fmtMoney, fmtTime, useLive, type Notification, type Overview } from "./api.ts";
import { R1Overview } from "./pages/R1Overview.tsx";
import { R2Prices } from "./pages/R2Prices.tsx";
import { Placeholder } from "./pages/Placeholder.tsx";
import { R10Settings } from "./pages/R10Settings.tsx";

export const SCREENS = [
  { code: "R1", path: "/", title: "Genel bakış", sprint: 1 },
  { code: "R2", path: "/fiyat", title: "Fiyat yayını", sprint: 1 },
  { code: "R3", path: "/emirler", title: "Emirler", sprint: 2 },
  { code: "R4", path: "/kasa", title: "Kasa hesabı", sprint: 3 },
  { code: "R5", path: "/cari", title: "Cari hesap", sprint: 2 },
  { code: "R6", path: "/teslimat", title: "Fiziksel teslimat", sprint: 4 },
  { code: "R7", path: "/rafinasyon", title: "Rafinasyon", sprint: 4 },
  { code: "R8", path: "/mahsuplasma", title: "Mahsuplaşma", sprint: 5 },
  { code: "R9", path: "/belgeler", title: "Belgeler", sprint: 5 },
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
            {s.sprint > 1 && <span className="sprint">Sprint {s.sprint}</span>}
          </NavLink>
        ))}
      </nav>
      <TopBar o={o} sseConnected={live.connected} refresh={live.refresh} />
      <main className="main">
        <Routes>
          <Route path="/" element={<R1Overview live={live} />} />
          <Route path="/fiyat" element={<R2Prices live={live} />} />
          <Route path="/emirler" element={<Placeholder code="R3" title="Emirler" sprint={2} text="KZ'den gelen alış / satış emirleri: zaman, client_order_id, yön, gram, kur, quote_seq, limit, sonuç (FILLED / REJECTED / CANCELLED), fill fiyatı ve tutar, Tahsis Belgesi. Fill, red ve iptal otomatiktir; ekran izler." />} />
          <Route path="/kasa" element={<Placeholder code="R4" title="Kasa hesabı" sprint={3} text="Kasa giriş / çıkış talepleri kuyruğu: Kabul et / Reddet, giriş için Kasaya konuluyor → Kasaya konuldu (en geç T+3). Kabulde Kasa Giriş / Çıkış Fişi oluşur ve Kanzasset'e gider. Alt kalemler: kasada · kasaya konuluyor · sevkiyatta. Günlük kasa ekstresi." />} />
          <Route path="/cari" element={<Placeholder code="R5" title="Cari hesap" sprint={2} text="Gün içi karşılıklı alacak borç: altın (gram, işaretli) ve para (USD / EUR / AED, işaretli). Hareketler: fill'ler, kasa giriş / çıkış aktarımları, lojistik ve rafinasyon bedelleri. Cari hesap limiti göstergesi ve Mahsuplaşma çağır." />} />
          <Route path="/teslimat" element={<Placeholder code="R6" title="Fiziksel teslimat" sprint={4} text="Ücretsiz külçe teslimatı: talep → Lojistik fiyatı gir → KZ onayı → Hazırlığa al → Hazır (Sevkiyat Fişi) → Taşıyıcıya verildi (takip no) → Teslim edildi. Masraf cari hesaba yazılır." />} />
          <Route path="/rafinasyon" element={<Placeholder code="R7" title="Rafinasyon" sprint={4} text="Ürün kataloğu (ürün, gramaj, ayar, tarife, üretim süresi) ve rafinasyon talepleri: Teklif ver (ürün bedeli + lojistik) → KZ onayı → Üretime al → Hazır → Taşıyıcıya verildi → Teslim edildi." />} />
          <Route path="/mahsuplasma" element={<Placeholder code="R8" title="Mahsuplaşma" sprint={5} text="Pencereler (kesim saati otomatik, talep iki yönlü, limit): ekstre taslağı, KZ ekstresiyle karşılaştırma (mutabakat), altın bacağı talepleri, para bacağı: ödeme bildirimi ve ödeme alındı." />} />
          <Route path="/belgeler" element={<Placeholder code="R9" title="Belgeler" sprint={5} text="Tahsis Belgesi, Kasa Giriş / Çıkış Fişi, Lojistik ve Rafinasyon Teklifi, Sevkiyat Fişi, Teslimat Kaydı, faturalar, ekstreler: oluşturma ve KZ'ye gönderim zamanı, indir, imza doğrulama." />} />
          <Route path="/ayarlar" element={<R10Settings live={live} />} />
        </Routes>
      </main>
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
        <span className="s">{acc ? acc.current_account.money.map((m) => `${m.ccy} ${fmtMoney(m.cents)}`).join(" · ") : ""}</span>
      </div>
      <div className="chip">
        <span className="l">Kanzasset bağlantısı</span>
        <span className="v"><span className={`dot ${(pub?.subscribers ?? 0) > 0 ? "ok" : "bad"}`} />{(pub?.subscribers ?? 0) > 0 ? "Bağlı" : "Bağlı değil"}</span>
        <span className="s">{pub?.subscribers ?? 0} abone · canlı akış {sseConnected ? "açık" : "kapalı"}</span>
      </div>
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
