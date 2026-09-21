import { useEffect, useState } from "react";
import { api, DLV_STATUS_TR, fmtDT, fmtG, fmtMoney, type Delivery, type Doc, type useLive } from "../api.ts";
import { DocModal, Timeline } from "./shared.tsx";

type Live = ReturnType<typeof useLive>;

/**
 * R6 Fiziksel teslimat (Akışlar 10).
 * Talep → Lojistik fiyatı gir → Kanzasset onayı → Hazırlığa al → Hazır (Sevkiyat Fişi) →
 * Taşıyıcıya verildi (takip no) → Teslim edildi (Teslimat Kaydı). İptal sevkiyattan önce.
 */
export function R6Delivery({ live }: { live: Live }) {
  const [items, setItems] = useState<Delivery[]>([]);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [sel, setSel] = useState<Delivery | null>(null);
  const [q, setQ] = useState({ carrier: "Brinks", amount: "", ccy: "USD" });
  const [ship, setShip] = useState({ carrier: "Brinks", tracking_no: "" });

  const load = () => api.deliveries().then((r) => setItems(r.items)).catch((e) => setMsg(`Hata: ${e.message}`));
  useEffect(() => { load(); }, [live.overview?.deliveries_open, live.overview?.account.seq]);

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id); setMsg("");
    try { await fn(); setMsg(done); await load(); live.refresh(); }
    catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
    finally { setBusy(""); }
  };

  return (
    <div>
      <span className="tag">R6</span>
      <h1>Fiziksel teslimat</h1>
      <p className="sub">Kanzasset'in itfa talepleri: standart külçe, gram ve adres referansı ile gelir. Rafineri taşıyıcıdan aldığı lojistik fiyatını girer, Kanzasset onaylayınca masraf cari hesaba kalem olur. Hazır olunca Sevkiyat Fişi kesilir ve külçe kasadan sevkiyat alanına geçer: kasa hesabı toplamı değişmez, külçe hâlâ Kanzasset adınadır. Teslimde kasa hesabı azalır. Ekranda müşteri adı yoktur, yalnız adres ve sigorta lehtarı referansı görünür.</p>

      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      <section className="card" style={{ marginBottom: 14 }}>
        <h2>Talepler</h2>
        <table>
          <thead><tr><th>Geliş</th><th>Talep</th><th className="num">Gram</th><th>Adres ref</th><th>Durum</th><th>Lojistik</th><th>Takip</th><th>Belgeler</th><th>Aksiyon</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={9} className="small">Teslimat talebi yok</td></tr>}
            {items.map((d) => (
              <tr key={d.delivery_id} style={{ background: sel?.delivery_id === d.delivery_id ? "#f4f5f7" : undefined }}>
                <td className="mono">{fmtDT(d.requested_ts)}</td>
                <td className="mono small" onClick={() => setSel(d)} style={{ cursor: "pointer" }}>{d.ref}</td>
                <td className="num mono">{fmtG(d.qty_mg)}</td>
                <td className="mono small">{d.address_ref}<br /><span className="small">sigorta {d.insured_party_ref}</span></td>
                <td><span className={`pill ${d.status === "DELIVERED" ? "ok" : d.status === "CANCELLED" || d.status === "FAILED" ? "bad" : ""}`}>{DLV_STATUS_TR[d.status] ?? d.status}</span></td>
                <td className="small">{d.quote ? `${d.quote.carrier} · ${fmtMoney(d.quote.amount_cents)} ${d.quote.ccy}` : ""}</td>
                <td className="mono small">{d.tracking_no ?? ""}</td>
                <td className="mono small">
                  {d.quote?.doc_id && <button className="ghost" onClick={async () => setDoc(await api.document(d.quote!.doc_id!))}>Teklif</button>}
                  {d.shipping_doc_id && <button className="ghost" onClick={async () => setDoc(await api.document(d.shipping_doc_id!))}>Sevkiyat</button>}
                  {d.pod_doc_id && <button className="ghost" onClick={async () => setDoc(await api.document(d.pod_doc_id!))}>Teslimat</button>}
                </td>
                <td>
                  <div className="row">
                    {(d.status === "REQUESTED" || d.status === "QUOTED") && <button className="ghost" onClick={() => setSel(d)}>Lojistik fiyatı gir</button>}
                    {d.status === "APPROVED" && <button className="primary" disabled={busy === d.delivery_id} onClick={() => act(d.delivery_id, () => api.dlvStep(d.delivery_id, "preparing"), `${d.ref}: hazırlığa alındı.`)}>Hazırlığa al</button>}
                    {(d.status === "PREPARING" || d.status === "APPROVED") && <button className="primary" disabled={busy === d.delivery_id} onClick={() => act(d.delivery_id, () => api.dlvStep(d.delivery_id, "ready"), `${d.ref}: hazır, Sevkiyat Fişi kesildi.`)}>Hazır</button>}
                    {d.status === "READY" && <button className="ghost" onClick={() => setSel(d)}>Taşıyıcıya ver</button>}
                    {d.status === "SHIPPED" && <button className="primary" disabled={busy === d.delivery_id} onClick={() => act(d.delivery_id, () => api.dlvStep(d.delivery_id, "delivered"), `${d.ref}: teslim edildi.`)}>Teslim edildi</button>}
                    {["REQUESTED", "QUOTED", "APPROVED", "PREPARING", "READY"].includes(d.status) && <button className="ghost" disabled={busy === d.delivery_id} onClick={() => act(d.delivery_id, () => api.dlvCancel(d.delivery_id, "rafineri iptal etti"), `${d.ref}: iptal edildi.`)}>İptal</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {sel && (sel.status === "REQUESTED" || sel.status === "QUOTED") && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Lojistik fiyatı gir · {sel.ref}</h2>
          <p className="small">Taşıyıcıdan alınan fiyat. Kanzasset onaylayınca bedel cari hesaba kalem olur; Kanzasset komisyon almaz, masraf müşteriden aynen alınır. Teklif geçerlilik süresi ayarlardan gelir (varsayılan 24 saat).</p>
          <div className="row">
            <input placeholder="taşıyıcı" value={q.carrier} onChange={(e) => setQ({ ...q, carrier: e.target.value })} />
            <input placeholder="tutar (ör. 450.00)" value={q.amount} onChange={(e) => setQ({ ...q, amount: e.target.value })} />
            <select value={q.ccy} onChange={(e) => setQ({ ...q, ccy: e.target.value })}><option>USD</option><option>EUR</option><option>AED</option></select>
            <button className="primary" disabled={!q.amount || !q.carrier.trim()} onClick={() => act(sel.delivery_id, () => api.dlvQuote(sel.delivery_id, q), `${sel.ref}: Lojistik Teklifi gönderildi, Kanzasset onayı bekleniyor.`)}>Teklifi gönder</button>
            <button className="ghost" onClick={() => setSel(null)}>Kapat</button>
          </div>
        </section>
      )}

      {sel && sel.status === "READY" && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Taşıyıcıya ver · {sel.ref}</h2>
          <p className="small">Taşıma sigortasının lehtarı müşteridir (referans {sel.insured_party_ref}). Takip numarası girildikten sonra teslimat taşıyıcının sisteminden izlenir.</p>
          <div className="row">
            <input placeholder="taşıyıcı" value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })} />
            <input placeholder="takip numarası" value={ship.tracking_no} onChange={(e) => setShip({ ...ship, tracking_no: e.target.value })} />
            <button className="primary" disabled={!ship.tracking_no.trim()} onClick={() => act(sel.delivery_id, () => api.dlvShipped(sel.delivery_id, ship.carrier, ship.tracking_no), `${sel.ref}: taşıyıcıya verildi.`)}>Taşıyıcıya verildi</button>
            <button className="ghost" onClick={() => setSel(null)}>Kapat</button>
          </div>
        </section>
      )}

      {sel && <Timeline title={`${sel.ref} zaman çizelgesi`} history={sel.history ?? []} onClose={() => setSel(null)} />}
      {doc && <DocModal doc={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}
