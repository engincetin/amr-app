import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ageSec, api, fmtG, fmtMoney, fmtTime, STL_STATUS_TR, type Settlement, type useLive } from "../api.ts";
import { legs, summary } from "../settlementFlow.ts";

type Live = ReturnType<typeof useLive>;

export function R1Overview({ live }: { live: Live }) {
  const o = live.overview;
  /** Mahsuplaşma ve teslimat sayıları genel bakışta da görünsün (ayrı uçlardan gelir). */
  const [stl, setStl] = useState<Settlement | null>(null);
  const [work, setWork] = useState({ deliveries: 0, refining: 0 });
  useEffect(() => {
    api.settlements().then((r) => setStl(r.open)).catch(() => {});
    Promise.all([api.deliveries(), api.refining()])
      .then(([d, r]) => setWork({ deliveries: d.open, refining: r.open }))
      .catch(() => {});
  }, [live.overview?.account.seq]);
  const stlLegs = legs(stl);
  const stlOpen = stlLegs.filter((l) => l.state === "sizde" || l.state === "karşıda").length;
  const pub = o?.publish;
  const src = o?.source;
  const acc = o?.account;
  const usd = pub?.lastPrices?.find((p) => p.ccy === "USD");
  return (
    <div>
      <span className="tag">R1</span>
      <h1>Genel bakış</h1>
      <p className="sub">Günün durumu tek bakışta: fiyat yayını, iki hesap, bugünkü emirler, limit kullanımı, bekleyen işler ve Kanzasset bağlantısı.</p>
      <div className="grid c3">
        <Link to="/fiyat" className="card">
          <h2>Fiyat yayını</h2>
          <div className="status"><span className={`dot ${pub?.tradable ? "ok" : "bad"}`} />{pub?.tradable ? "Yayında" : pub?.manualHalt ? "Durduruldu" : "Merkez bağlı değil"}</div>
          <div className="small" style={{ marginTop: 6 }}>{usd ? `USD ${usd.bid} / ${usd.ask} · seq ${pub?.seq} · ${ageSec(pub?.lastTickTs)} sn önce` : "tick yok"}</div>
          <div className="small">Merkez: {src?.status === "CONNECTED" ? `bağlı (${fmtTime(src.connectedSince)} itibarıyla)` : src?.status ?? ""}</div>
        </Link>
        <div className="card">
          <h2>Kasa hesabı</h2>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{acc ? fmtG(acc.vault.in_vault_mg + acc.vault.placing_mg + acc.vault.shipping_mg) : "0,000"} g</div>
          <div className="small">kasada {acc ? fmtG(acc.vault.in_vault_mg) : 0} · kasaya konuluyor {acc ? fmtG(acc.vault.placing_mg) : 0} · sevkiyatta {acc ? fmtG(acc.vault.shipping_mg) : 0}</div>
          
        </div>
        <Link to="/cari" className="card">
          <h2>Cari hesap</h2>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{acc ? `${acc.current_account.gold_mg >= 0 ? "+" : ""}${fmtG(acc.current_account.gold_mg)}` : "0,000"} g</div>
          <div className="small">{acc?.current_account.money.map((m) => `${m.ccy} ${fmtMoney(m.cents)}`).join(" · ")}</div>
          <div className="small" style={{ marginTop: 6 }}>limit kullanımı %{o?.limit ? (o.limit.max_pct * 100).toFixed(1) : "0,0"} · durum {acc?.status ?? ""}</div>
        </Link>
        <Link to="/emirler" className="card">
          <h2>Bugünkü emirler</h2>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{o?.orders_today?.total ?? 0}</div>
          <div className="small">alış {o?.orders_today?.buy.filled ?? 0} emir · {fmtG(o?.orders_today?.buy.mg ?? 0)} g · satış {o?.orders_today?.sell.filled ?? 0} emir · {fmtG(o?.orders_today?.sell.mg ?? 0)} g</div>
          <div className="small" style={{ marginTop: 6 }}>red {(o?.orders_today?.buy.rejected ?? 0) + (o?.orders_today?.sell.rejected ?? 0)}</div>
        </Link>
        <Link className="card" to="/kasa">
          <h2>Bekleyen işler</h2>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{o?.vault_pending ?? 0}</div>
          <div className="small">kasa talepleri {o?.vault_pending ?? 0} · teslimat {work.deliveries} · rafinasyon {work.refining} · mahsuplaşma {stl ? 1 : 0}</div>
          <div className="small" style={{ marginTop: 6, color: (o?.vault_overdue ?? 0) > 0 ? "var(--bad)" : undefined }}>
            {(o?.vault_overdue ?? 0) > 0 ? `${o?.vault_overdue} kasa girişinde T+3 vadesi geçti` : "T+3 vadesi geçen kasa girişi yok"}
          </div>
        </Link>
        <Link to="/mahsuplasma" className="card">
          <h2>Mahsuplaşma</h2>
          {stl ? (
            <>
              <div className="status"><span className={`dot ${stl.status === "MISMATCH" ? "bad" : stl.status === "SETTLED" ? "ok" : "warn"}`} />{STL_STATUS_TR[stl.status] ?? stl.status}</div>
              <div className="small" style={{ marginTop: 6 }}>{stl ? `${stlLegs.length - stlOpen}/${stlLegs.length} bacak kapandı` : ""} · {summary(stl)}</div>
              <div className="small">kesim {o?.settings["settlement.cutoff_local"] ?? "17:00"} {o?.settings["settlement.timezone"] ?? "Asia/Dubai"}</div>
            </>
          ) : (
            <>
              <div className="status"><span className="dot" />Açık pencere yok</div>
              <div className="small" style={{ marginTop: 6 }}>Kesim saatinde kendiliğinden açılır: {o?.settings["settlement.cutoff_local"] ?? "17:00"} {o?.settings["settlement.timezone"] ?? "Asia/Dubai"}</div>
            </>
          )}
        </Link>
        <div className="card">
          <h2>Kanzasset bağlantısı</h2>
          <div className="status"><span className={`dot ${(pub?.subscribers ?? 0) > 0 ? "ok" : "bad"}`} />{(pub?.subscribers ?? 0) > 0 ? "Fiyat soketine bağlı" : "Bağlı değil"}</div>
          <div className="small" style={{ marginTop: 6 }}>{o?.subscribers.map((s) => `${s.client} · ${fmtTime(s.connected_at)}`).join(", ")}</div>
          <div className="small">Bildirimler: {o?.unread ?? 0} okunmamış</div>
        </div>
      </div>
    </div>
  );
}
