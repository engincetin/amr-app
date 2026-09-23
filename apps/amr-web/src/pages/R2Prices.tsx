import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import { api, ageSec, fmtTime, type useLive } from "../api.ts";

type Live = ReturnType<typeof useLive>;

export function R2Prices({ live }: { live: Live }) {
  const o = live.overview;
  const src = o?.source;
  const pub = o?.publish;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [haltOpen, setHaltOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 1000); return () => clearInterval(t); }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null);
    try { await fn(); await live.refresh(); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };

  const age = ageSec(pub?.lastTickTs);
  const lastPrices = pub?.lastPrices ?? [];

  return (
    <div>
      <span className="tag">R2</span>
      <h1>Fiyat</h1>
      <p className="sub">Fiyat rafinerinin merkezi uygulamasından gelir. Merkez bağlantısı kurulup fiyat akmaya başlayınca Kanzasset'e soketle yayınlanır: gram başına, 999,9 ayar, USD · EUR · AED, boyuttan bağımsız. Merkez yoksa yayın yok, yayın yoksa işlem yok.</p>

      <section className="card" style={{ marginBottom: 14 }}>
        <h2>Güncel fiyat (gram başına, 999,9)</h2>
        <table>
          <thead><tr><th>Kur</th><th className="num">Alış (biz alırız)</th><th className="num">Satış (biz satarız)</th><th className="num">Makas (merkez)</th></tr></thead>
          <tbody>
            {lastPrices.length === 0 && <tr><td colSpan={4} className="small">Fiyat yok</td></tr>}
            {lastPrices.map((p) => (
              <tr key={p.ccy}><td><b>{p.ccy}</b></td><td className="num">{p.bid}</td><td className="num">{p.ask}</td><td className="num">{(Number(p.ask) - Number(p.bid)).toFixed(2)}</td></tr>
            ))}
          </tbody>
        </table>
        <p className="small foot" style={{ marginTop: 8 }}>Fiyat merkezden geldiği gibi yayınlanır: rafineri üzerine bir şey eklemez, yuvarlamaz. Makas sütunu bilgidir, merkezin kendi alış satış farkıdır.</p>
      </section>
      <div className="grid c2">
        <section className="card stack">
          <h2>Merkez bağlantısı</h2>
          <div className="kv">
            <span className="k">Durum</span>
            <span className="status"><span className={`dot ${src?.status === "CONNECTED" ? "ok" : src?.status === "CONNECTING" ? "warn" : "bad"}`} />{src?.status === "CONNECTED" ? "Bağlı" : src?.status === "CONNECTING" ? `Bağlanıyor${src.reconnectAttempt ? ` (deneme ${src.reconnectAttempt})` : ""}` : "Kopuk"}</span>
            <span className="k">Son fiyat</span><span>{src?.lastPriceTs ? `${fmtTime(src.lastPriceTs)} (${ageSec(src.lastPriceTs)} sn önce)` : "gelmedi"}</span>
            <span className="k">Bağlı olduğu süre</span><span>{src?.connectedSince ? `${fmtTime(src.connectedSince)} itibarıyla` : ""}</span>
            {src?.lastError && (<><span className="k">Son hata</span><span className="small">{src.lastError}</span></>)}
          </div>
          <p className="small foot" style={{ marginTop: 10 }}>Adres, bağlan / kes ve yeniden bağlanma kuralı <Link to="/ayarlar">Ayarlar</Link> ekranındadır. Kopukken yayın kendiliğinden durur ve Kanzasset'e halt gider.</p>
        </section>

        <section className="card stack">
          <h2>Kanzasset'e yayın</h2>
          <div className="kv">
            <span className="k">Durum</span>
            <span className="status"><span className={`dot ${pub?.tradable ? "ok" : "bad"}`} />{pub?.tradable ? "Yayında (işlem yapılabilir)" : pub?.manualHalt ? `Durduruldu: ${pub.haltReason}` : "Yayın yok: merkez bağlı değil"}</span>
            <span className="k">Son tick</span><span>{pub?.lastTickTs ? `sıra ${pub.seq} · ${fmtTime(pub.lastTickTs)} · ${age} sn önce` : "yok"}</span>
            <span className="k">Aboneler</span><span>{o?.subscribers.length ? o.subscribers.map((s) => `${s.client} (${fmtTime(s.connected_at)})`).join(", ") : "Kanzasset bağlı değil"}</span>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            {pub?.manualHalt
              ? <button className="primary" disabled={busy} onClick={() => run(() => api.resume())}>Yayını başlat</button>
              : <button className="danger" disabled={busy} onClick={() => setHaltOpen(true)}>Yayını durdur</button>}
          </div>
          <p className="small foot" style={{ marginTop: 10 }}>Tick yalnız fiyat değişince (saniyede en çok 1). 5 sn tick yoksa heartbeat. Kanzasset 10 sn mesaj almazsa fiyatı bayat sayar ve müşteri işlemlerini durdurur.</p>
        </section>
      </div>


      <section className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Son 10 tick</h2>
          <Link to="/kayitlar"><button className="ghost">Tümünü gör</button></Link>
        </div>
        <table>
          <thead><tr><th className="num">Sıra</th><th>Zaman</th><th className="num">USD alış</th><th className="num">USD satış</th><th className="num">EUR alış</th><th className="num">EUR satış</th><th className="num">AED alış</th><th className="num">AED satış</th><th>İşlem</th></tr></thead>
          <tbody>
            {live.ticks.slice(0, 10).map((t) => {
              const g = (c: string) => t.prices.find((p) => p.ccy === c);
              return (
                <tr key={t.seq}>
                  <td className="num">{t.seq}</td><td className="mono">{fmtTime(t.ts)}</td>
                  <td className="num">{g("USD")?.bid}</td><td className="num">{g("USD")?.ask}</td>
                  <td className="num">{g("EUR")?.bid}</td><td className="num">{g("EUR")?.ask}</td>
                  <td className="num">{g("AED")?.bid}</td><td className="num">{g("AED")?.ask}</td>
                  <td><span className={`pill ${t.tradable ? "ok" : "bad"}`}>{t.tradable ? "yapılabilir" : "durdu"}</span></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {err && <div className="toast">{err}</div>}
      {haltOpen && (
        <div className="modal-bg" onClick={() => setHaltOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Yayını durdur</h3>
            <p className="small">Gerekçe zorunlu. Kanzasset'e halt mesajı gider, müşteri işlemleri durur. Kayıt denetim günlüğüne yazılır.</p>
            <textarea style={{ width: "100%" }} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="ör. merkez fiyatı şüpheli, bakım" />
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 10 }}>
              <button onClick={() => setHaltOpen(false)}>Vazgeç</button>
              <button className="danger" disabled={!reason.trim() || busy} onClick={() => run(async () => { await api.halt(reason.trim()); setHaltOpen(false); setReason(""); })}>Durdur</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
