import { Link } from "react-router-dom";
import { ageSec, fmtG, fmtMoney, fmtTime, type useLive } from "../api.ts";

type Live = ReturnType<typeof useLive>;

export function R1Overview({ live }: { live: Live }) {
  const o = live.overview;
  const pub = o?.publish;
  const src = o?.source;
  const acc = o?.account;
  const usd = pub?.lastPrices?.find((p) => p.ccy === "USD");
  return (
    <div>
      <span className="tag">R1</span>
      <h1>Genel bakış</h1>
      <p className="sub">Günün durumu tek bakışta. Sprint 1'de fiyat yayını ve bağlantılar canlı; emirler, kasa hesabı, cari hesap ve bekleyen işler sonraki sprintlerde dolar.</p>
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
          <div className="small" style={{ marginTop: 6 }}>Sprint 3'te dolar.</div>
        </div>
        <div className="card">
          <h2>Cari hesap</h2>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{acc ? fmtG(acc.current_account.gold_mg) : "0,000"} g</div>
          <div className="small">{acc?.current_account.money.map((m) => `${m.ccy} ${fmtMoney(m.cents)}`).join(" · ")}</div>
          <div className="small" style={{ marginTop: 6 }}>Sprint 2'de dolar.</div>
        </div>
        <div className="card">
          <h2>Bugünkü emirler</h2>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>0</div>
          <div className="small">alış 0 g · satış 0 g · Sprint 2'de dolar</div>
        </div>
        <div className="card">
          <h2>Bekleyen işler</h2>
          <div className="small">kasa talepleri 0 · teslimat adımları 0 · rafinasyon 0 · mahsuplaşma 0</div>
          <div className="small" style={{ marginTop: 6 }}>Sprint 3'ten itibaren dolar.</div>
        </div>
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
