import { useEffect, useState } from "react";
import { api, DLV_STATUS_TR, fmtDT, fmtG, fmtMoney, type Catalog, type Doc, type Refining, type useLive } from "../api.ts";
import { DocModal, Timeline } from "./shared.tsx";
import { Pager, usePager } from "../components/Pager.tsx";

type Live = ReturnType<typeof useLive>;

/**
 * R7 Rafinasyon (Akışlar 11).
 * Katalog rafineride tutulur ve Kanzasset çeker (değişince catalog.updated).
 * Talep → Teklif ver (ürün bedeli + lojistik + üretim süresi) → Kanzasset onayı → Üretime al →
 * Hazır (Sevkiyat Fişi) → Taşıyıcıya verildi → Teslim edildi. İptal üretime kadar.
 */
export function R7Refining({ live }: { live: Live }) {
  const [items, setItems] = useState<Refining[]>([]);
  const [cat, setCat] = useState<Catalog | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [sel, setSel] = useState<Refining | null>(null);
  const [q, setQ] = useState({ product: "", logistics: "", ccy: "USD", lead_time_days: 5 });
  const [ship, setShip] = useState({ carrier: "Brinks", tracking_no: "" });
  const [edit, setEdit] = useState<{ item_id: string; unit_price: string; lead: string } | null>(null);
  /** Yeni ürün formu: ad, gramaj, ayar, tarife, üretim süresi. */
  const [neu, setNeu] = useState({ name: "", weight: "", fineness: "999.9", price: "", lead: "3" });

  const load = async () => {
    try { const [r, c] = await Promise.all([api.refining(), api.catalog()]); setItems(r.items); setCat(c); }
    catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
  };
  useEffect(() => { load(); }, [live.overview?.refining_open, live.overview?.account.seq, live.version]);

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id); setMsg("");
    try { await fn(); setMsg(done); await load(); live.refresh(); }
    catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
    finally { setBusy(""); }
  };

  const pItems = usePager(items, 20);
  return (
    <div>
      <span className="tag">R7</span>
      <h1>Rafinasyon</h1>
      <p className="sub">Müşteri tokenlerine karşılık istediği gramajda ürün ister. Katalog burada tutulur, Kanzasset çeker ve müşteriye seçim sunar. Talep gelince ürün bedeli ve lojistik için teklif verilir; Kanzasset onaylayınca bedel cari hesaba kalem olur. Üretim bitince Sevkiyat Fişi kesilir, teslimat adımları teslimat akışıyla aynıdır. Kanzasset'in marjı ve komisyonu müşteri tarafındadır, rafineriye gelmez.</p>

      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      <section className="card" style={{ marginBottom: 14 }}>
        <h2>Talepler</h2>
        <table className="wide">
          <thead><tr><th>Geliş</th><th>Talep</th><th>Kalemler</th><th className="num">Saf gram</th><th>Durum</th><th>Teklif</th><th>Takip</th><th>Belgeler</th><th>Aksiyon</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={9} className="small">Rafinasyon talebi yok</td></tr>}
            {pItems.slice.map((r) => (
              <tr key={r.refining_id} style={{ background: sel?.refining_id === r.refining_id ? "var(--sel)" : undefined }}>
                <td className="mono">{fmtDT(r.requested_ts)}</td>
                <td className="mono small" onClick={() => setSel(r)} style={{ cursor: "pointer" }}>{r.ref}</td>
                <td className="small">{r.items.map((l) => `${l.qty} × ${l.name}`).join(", ")}<br /><span className="small">adres {r.address_ref}</span></td>
                <td className="num mono">{fmtG(r.total_mg)}</td>
                <td><span className={`pill ${r.status === "DELIVERED" ? "ok" : r.status === "CANCELLED" || r.status === "FAILED" ? "bad" : ""}`}>{DLV_STATUS_TR[r.status] ?? r.status}</span></td>
                <td className="small">{r.quote ? `${fmtMoney(r.quote.product_cents)} + ${fmtMoney(r.quote.logistics_cents)} ${r.quote.ccy} · ${r.quote.lead_time_days} gün` : ""}</td>
                <td className="mono small">{r.tracking_no ?? ""}</td>
                <td className="mono small">
                  {r.quote?.doc_id && <button className="ghost" onClick={async () => setDoc(await api.document(r.quote!.doc_id!))}>Teklif</button>}
                  {r.shipping_doc_id && <button className="ghost" onClick={async () => setDoc(await api.document(r.shipping_doc_id!))}>Sevkiyat</button>}
                  {r.pod_doc_id && <button className="ghost" onClick={async () => setDoc(await api.document(r.pod_doc_id!))}>Teslimat</button>}
                </td>
                <td>
                  <div className="row">
                    {(r.status === "REQUESTED" || r.status === "QUOTED") && <button className="ghost" onClick={() => setSel(r)}>Teklif ver</button>}
                    {r.status === "APPROVED" && <button className="primary" disabled={busy === r.refining_id} onClick={() => act(r.refining_id, () => api.rfnStep(r.refining_id, "production"), `${r.ref}: üretime alındı.`)}>Üretime al</button>}
                    {r.status === "IN_PRODUCTION" && <button className="primary" disabled={busy === r.refining_id} onClick={() => act(r.refining_id, () => api.rfnStep(r.refining_id, "ready"), `${r.ref}: hazır, Sevkiyat Fişi kesildi.`)}>Hazır</button>}
                    {r.status === "READY" && <button className="ghost" onClick={() => setSel(r)}>Taşıyıcıya ver</button>}
                    {r.status === "SHIPPED" && <button className="primary" disabled={busy === r.refining_id} onClick={() => act(r.refining_id, () => api.rfnStep(r.refining_id, "delivered"), `${r.ref}: teslim edildi.`)}>Teslim edildi</button>}
                    {["REQUESTED", "QUOTED", "APPROVED"].includes(r.status) && <button className="ghost" disabled={busy === r.refining_id} onClick={() => act(r.refining_id, () => api.rfnCancel(r.refining_id, "rafineri iptal etti"), `${r.ref}: iptal edildi.`)}>İptal</button>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager p={pItems} label="Talepler" />
      </section>

      {sel && (sel.status === "REQUESTED" || sel.status === "QUOTED") && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Teklif ver · {sel.ref}</h2>
          <p className="small">Kalemler: {sel.items.map((l) => `${l.qty} × ${l.name}`).join(", ")} · toplam {fmtG(sel.total_mg)} g. Ürün bedeli katalog tarifesinden hesaplanabilir; lojistik taşıyıcıdan alınır. Teklif geçerlilik süresi ayarlardan gelir (varsayılan 48 saat).</p>
          <div className="row">
            <input placeholder="ürün bedeli (ör. 1900.00)" value={q.product} onChange={(e) => setQ({ ...q, product: e.target.value })} />
            <input placeholder="lojistik (ör. 600.00)" value={q.logistics} onChange={(e) => setQ({ ...q, logistics: e.target.value })} />
            <select value={q.ccy} onChange={(e) => setQ({ ...q, ccy: e.target.value })}><option>USD</option><option>EUR</option><option>AED</option></select>
            <input style={{ width: 90 }} placeholder="gün" value={q.lead_time_days} onChange={(e) => setQ({ ...q, lead_time_days: Number(e.target.value) || 0 })} />
            <button className="primary" disabled={!q.product || !q.logistics} onClick={() => act(sel.refining_id, () => api.rfnQuote(sel.refining_id, q), `${sel.ref}: Rafinasyon Teklifi gönderildi.`)}>Teklifi gönder</button>
            <button className="ghost" onClick={() => setSel(null)}>Kapat</button>
          </div>
          <div className="small" style={{ marginTop: 6 }}>
            Katalog tarifesine göre ürün bedeli önerisi: {fmtMoney(sel.items.reduce((a, l) => a + l.qty * (cat?.items.find((c) => c.item_id === l.item_id)?.unit_price_cents ?? 0), 0))} USD
          </div>
        </section>
      )}

      {sel && sel.status === "READY" && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Taşıyıcıya ver · {sel.ref}</h2>
          <div className="row">
            <input placeholder="taşıyıcı" value={ship.carrier} onChange={(e) => setShip({ ...ship, carrier: e.target.value })} />
            <input placeholder="takip numarası" value={ship.tracking_no} onChange={(e) => setShip({ ...ship, tracking_no: e.target.value })} />
            <button className="primary" disabled={!ship.tracking_no.trim()} onClick={() => act(sel.refining_id, () => api.rfnShipped(sel.refining_id, ship.carrier, ship.tracking_no), `${sel.ref}: taşıyıcıya verildi.`)}>Taşıyıcıya verildi</button>
            <button className="ghost" onClick={() => setSel(null)}>Kapat</button>
          </div>
        </section>
      )}

      {sel && <Timeline title={`${sel.ref} zaman çizelgesi`} history={sel.history ?? []} onClose={() => setSel(null)} />}

      <section className="card">
        <h2>Ürün kataloğu <span className="pill">{cat?.items.length ?? 0} ürün</span></h2>
        <p className="small">Ürünler burada eklenir, düzenlenir, pasife alınır ya da silinir: aynı gramajın farklı ayarı (ör. 999,9 ve 999,5) ayrı ürün olarak durabilir. Her değişiklikte katalog sürümü artar, Kanzasset'e `catalog.updated` olayı gider ve güncel liste çekilir. Pasife alınan ürün yeni taleplerde seçilemez; silinen ürün geçmiş talepleri etkilemez, talepler ürünü kendi içinde saklar.</p>
        <table className="wide">
          <thead><tr><th>Ürün</th><th className="num">Gramaj</th><th>Ayar</th><th className="num">Tarife</th><th className="num">Üretim</th><th>Durum</th><th>Aksiyon</th></tr></thead>
          <tbody>
            {cat?.items.map((i) => (
              <tr key={i.item_id}>
                <td>{i.name}</td>
                <td className="num mono">{fmtG(i.weight_mg)} g</td>
                <td className="mono">{i.fineness}</td>
                <td className="num mono">{edit?.item_id === i.item_id ? <input style={{ width: 90 }} value={edit.unit_price} onChange={(e) => setEdit({ ...edit, unit_price: e.target.value })} /> : `${fmtMoney(i.unit_price_cents)} ${i.ccy}`}</td>
                <td className="num">{edit?.item_id === i.item_id ? <input style={{ width: 60 }} value={edit.lead} onChange={(e) => setEdit({ ...edit, lead: e.target.value })} /> : `${i.lead_time_days} gün`}</td>
                <td><span className={`pill ${i.active ? "ok" : ""}`}>{i.active ? "aktif" : "pasif"}</span></td>
                <td>
                  <div className="row">
                    {edit?.item_id === i.item_id ? (
                      <>
                        <button className="primary" onClick={() => act(i.item_id, () => api.catalogSave({ item_id: i.item_id, unit_price_cents: Math.round(Number(edit.unit_price.replace(",", ".")) * 100), lead_time_days: Number(edit.lead) || 0 }), `${i.name}: güncellendi.`).then(() => setEdit(null))}>Kaydet</button>
                        <button className="ghost" onClick={() => setEdit(null)}>Vazgeç</button>
                      </>
                    ) : (
                      <>
                        <button className="ghost" onClick={() => setEdit({ item_id: i.item_id, unit_price: (i.unit_price_cents / 100).toFixed(2), lead: String(i.lead_time_days) })}>Düzenle</button>
                        <button className="ghost" onClick={() => act(i.item_id, () => api.catalogSave({ item_id: i.item_id, active: !i.active }), `${i.name}: ${i.active ? "pasife alındı" : "aktifleştirildi"}.`)}>{i.active ? "Pasife al" : "Aktifleştir"}</button>
                        <button className="ghost" onClick={() => { if (window.confirm(`${i.name} katalogdan silinsin mi? Geçmiş talepler etkilenmez.`)) void act(i.item_id, () => api.catalogDelete(i.item_id), `${i.name}: silindi.`); }}>Sil</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 style={{ marginTop: 14 }}>Yeni ürün</h2>
        <div className="filters">
          <label>Ad <input style={{ width: 150 }} placeholder="ör. 100 g külçe 999,5" value={neu.name} onChange={(e) => setNeu({ ...neu, name: e.target.value })} /></label>
          <label>Gramaj <input style={{ width: 110 }} placeholder="100" value={neu.weight} onChange={(e) => setNeu({ ...neu, weight: e.target.value })} /> g</label>
          <label>Ayar <input style={{ width: 80 }} value={neu.fineness} onChange={(e) => setNeu({ ...neu, fineness: e.target.value })} /></label>
          <label>Tarife <input style={{ width: 90 }} placeholder="200,00" value={neu.price} onChange={(e) => setNeu({ ...neu, price: e.target.value })} /> USD</label>
          <label>Üretim <input style={{ width: 60 }} value={neu.lead} onChange={(e) => setNeu({ ...neu, lead: e.target.value })} /> gün</label>
          <button className="primary" disabled={!neu.name.trim() || !neu.weight || !neu.price} onClick={() => act("new", async () => {
            const weightMg = Math.round(Number(neu.weight.replace(",", ".")) * 1000);
            const priceCents = Math.round(Number(neu.price.replace(".", "").replace(",", ".")) * 100);
            if (!Number.isFinite(weightMg) || weightMg < 1) throw new Error("gramaj geçersiz");
            if (!Number.isFinite(priceCents) || priceCents < 0) throw new Error("tarife geçersiz");
            const id = `bar-${weightMg}-${neu.fineness.replace(/[^0-9]/g, "")}`;
            await api.catalogSave({ item_id: id, name: neu.name.trim(), weight_mg: weightMg, fineness: neu.fineness.trim(), unit_price_cents: priceCents, ccy: "USD", lead_time_days: Number(neu.lead) || 1, active: true });
            setNeu({ name: "", weight: "", fineness: "999.9", price: "", lead: "3" });
          }, "Ürün katalogda: Kanzasset'e catalog.updated gitti.")}>Ürünü ekle</button>
        </div>
        <p className="small" style={{ marginTop: 8 }}>Ürün numarası gramaj ve ayardan üretilir; aynı gramaj ve ayar varsa o ürün güncellenir.</p>
      </section>

      {doc && <DocModal doc={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}
