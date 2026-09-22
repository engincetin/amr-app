import { useEffect, useState } from "react";
import { api, fmtDT, fmtG, fmtMoney, fmtTime, REJECT_TR, STATUS_TR, type Doc, type Order, type useLive } from "../api.ts";

type Live = ReturnType<typeof useLive>;
const today = () => new Date().toISOString().slice(0, 10);

/** R3 Emirler: KZ'den gelen alış / satış emirleri. Fill, red ve iptal otomatiktir; ekran izler. */
export function R3Orders({ live }: { live: Live }) {
  const [day, setDay] = useState(today());
  const [side, setSide] = useState("");
  const [status, setStatus] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [sel, setSel] = useState<Order | null>(null);
  const [doc, setDoc] = useState<Doc | null>(null);

  const load = () => api.orders({ day: day || undefined, side: side || undefined, status: status || undefined, limit: 300 }).then(setOrders).catch(console.warn);
  useEffect(() => { load(); }, [day, side, status]);
  useEffect(() => { if (live.lastOrder) load(); }, [live.lastOrder]);
  useEffect(() => { setDoc(null); if (sel?.allocation_certificate) api.document(sel.allocation_certificate.doc_id).then(setDoc).catch(() => setDoc(null)); }, [sel?.order_id]);

  const t = live.overview?.orders_today;
  const filled = orders.filter((o) => o.status === "FILLED");
  const sumMg = (s: "BUY" | "SELL") => filled.filter((o) => o.side === s).reduce((a, o) => a + o.qty_mg, 0);

  return (
    <div>
      <span className="tag">R3</span>
      <h1>Emirler</h1>
      <p className="sub">Kanzasset'ten gelen alış / satış emirleri. Emri almak, fiyatı quote_seq ve limitle karşılaştırmak, fill ya da red, Tahsis Belgesi (alışta), cari hesabı güncellemek ve bakiye bilgisiyle cevaplamak otomatiktir. Bu ekran izler; elle aksiyon yoktur.</p>

      <div className="grid c3" style={{ marginBottom: 14 }}>
        <div className="card"><h2>Bugün</h2><div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{t?.total ?? 0} emir</div><div className="small">gerçekleşen alış {t?.buy.filled ?? 0} · satış {t?.sell.filled ?? 0} · red {(t?.buy.rejected ?? 0) + (t?.sell.rejected ?? 0)}</div></div>
        <div className="card"><h2>Listedeki alışlar</h2><div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmtG(sumMg("BUY"))} g</div><div className="small">Kanzasset aldı → T artar, P azalır (Kanzasset borçlu)</div></div>
        <div className="card"><h2>Listedeki satışlar</h2><div className="mono" style={{ fontSize: 18, fontWeight: 600 }}>{fmtG(sumMg("SELL"))} g</div><div className="small">Kanzasset sattı → T azalır, P artar (rafineri borçlu)</div></div>
      </div>

      <section className="card">
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="small">Gün <input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
          <label className="small">Yön <select value={side} onChange={(e) => setSide(e.target.value)}><option value="">hepsi</option><option value="BUY">alış</option><option value="SELL">satış</option></select></label>
          <label className="small">Durum <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="">hepsi</option><option value="FILLED">gerçekleşti</option><option value="REJECTED">reddedildi</option><option value="CANCELLED">iptal</option><option value="RECEIVED">alındı (bekliyor)</option></select></label>
          <button className="ghost" onClick={() => { setDay(""); setSide(""); setStatus(""); }}>Temizle</button>
          <span className="small" style={{ marginLeft: "auto" }}>{orders.length} kayıt</span>
        </div>
        <table>
          <thead><tr><th>Zaman</th><th>client_order_id</th><th>Yön</th><th className="num">Gram</th><th>Kur</th><th className="num">quote_seq</th><th className="num">Limit</th><th>Sonuç</th><th className="num">Fill</th><th className="num">Tutar</th><th>Belge</th></tr></thead>
          <tbody>
            {orders.length === 0 && <tr><td colSpan={11} className="small">Kayıt yok</td></tr>}
            {orders.map((o) => (
              <tr key={o.order_id} onClick={() => setSel(o)} style={{ cursor: "pointer", background: sel?.order_id === o.order_id ? "var(--sel)" : undefined }}>
                <td className="mono">{fmtTime(o.received_ts)}</td>
                <td className="mono">{o.client_order_id}</td>
                <td>{o.side === "BUY" ? <span className="pill ok">ALIŞ</span> : <span className="pill warn">SATIŞ</span>}</td>
                <td className="num">{fmtG(o.qty_mg)}</td>
                <td>{o.ccy}</td>
                <td className="num">{o.quote_seq}</td>
                <td className="num">{o.limit_px}</td>
                <td><StatusPill o={o} /></td>
                <td className="num">{o.fill?.px ?? ""}</td>
                <td className="num">{o.fill ? fmtMoney(o.fill.amount_cents) : ""}</td>
                <td className="mono small">{o.allocation_certificate?.doc_id ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {sel && (
        <section className="card" style={{ marginTop: 14 }}>
          <div className="row"><h2 style={{ margin: 0 }}>Emir detayı · {sel.order_id}</h2><button className="ghost" style={{ marginLeft: "auto" }} onClick={() => setSel(null)}>Kapat</button></div>
          <div className="grid c2" style={{ marginTop: 10 }}>
            <div>
              <div className="kv">
                <span className="k">client_order_id</span><span className="mono">{sel.client_order_id}</span>
                <span className="k">Yön · gram · kur</span><span>{sel.side === "BUY" ? "ALIŞ" : "SATIŞ"} · {fmtG(sel.qty_mg)} g · {sel.ccy}</span>
                <span className="k">quote_seq · limit</span><span className="mono">{sel.quote_seq} · {sel.limit_px}</span>
                <span className="k">Sonuç</span><span><StatusPill o={sel} />{sel.reject_reason ? ` ${REJECT_TR[sel.reject_reason] ?? sel.reject_reason}` : ""}</span>
                {sel.fill && (<><span className="k">Fill</span><span className="mono">{sel.fill.px} {sel.ccy} × {fmtG(sel.qty_mg)} g = {fmtMoney(sel.fill.amount_cents)} {sel.ccy} · {fmtTime(sel.fill.trade_ts)}</span></>)}
                <span className="k">Alındı · karar</span><span className="mono">{fmtDT(sel.received_ts)} · {fmtDT(sel.decided_ts)}</span>
              </div>
              <h2 style={{ marginTop: 12 }}>Geçmiş</h2>
              {sel.history?.map((h, i) => <div key={i} className="small"><span className="mono">{fmtTime(h.ts)}</span> · {STATUS_TR[h.status] ?? h.status}{h.note ? ` · ${h.note}` : ""}</div>)}
            </div>
            <div>
              <h2>Cevapta giden bakiye bilgisi</h2>
              {sel.account ? (
                <div className="kv">
                  <span className="k">seq</span><span className="mono">{sel.account.seq}</span>
                  <span className="k">Kasa hesabı</span><span className="mono">kasada {fmtG(sel.account.vault.in_vault_mg)} · konuluyor {fmtG(sel.account.vault.placing_mg)} · sevkiyatta {fmtG(sel.account.vault.shipping_mg)}</span>
                  <span className="k">Cari hesap T</span><span className="mono">{sel.account.current_account.gold_mg >= 0 ? "+" : ""}{fmtG(sel.account.current_account.gold_mg)} g</span>
                  <span className="k">Cari hesap P</span><span className="mono">{sel.account.current_account.money.map((m) => `${m.ccy} ${fmtMoney(m.cents)}`).join(" · ")}</span>
                </div>
              ) : <div className="small">Metal hareketi olmadı; bakiye bilgisi gönderilmedi.</div>}
              {doc && (
                <>
                  <h2 style={{ marginTop: 12 }}>Tahsis Belgesi · {doc.meta.doc_id}</h2>
                  <div className="kv">
                    <span className="k">Gram · ayar</span><span>{String(doc.content.qty_g)} g · {String(doc.content.fineness)}</span>
                    <span className="k">Sahip</span><span>{String(doc.content.owner)}</span>
                    <span className="k">Şart</span><span>{String(doc.content.terms)}</span>
                    <span className="k">Fiyat · tutar</span><span className="mono">{String(doc.content.px)} {String(doc.content.ccy)} · {fmtMoney(Number(doc.content.amount_cents))}</span>
                    <span className="k">sha256 · imza</span><span className="mono small">{doc.meta.hash.slice(0, 16)}… · {doc.meta.signature.slice(0, 16)}…</span>
                    <span className="k">KZ'ye gönderim</span><span>{doc.meta.sent_ts ? fmtDT(doc.meta.sent_ts) : "cevapla birlikte (bağlantı verildi)"}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

export function StatusPill({ o }: { o: Order }) {
  const cls = o.status === "FILLED" ? "ok" : o.status === "REJECTED" ? "bad" : o.status === "CANCELLED" ? "neut" : "warn";
  return <span className={`pill ${cls}`}>{STATUS_TR[o.status] ?? o.status}</span>;
}
