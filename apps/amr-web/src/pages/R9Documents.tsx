import { useEffect, useState } from "react";
import { api, DOC_TYPE_TR, fmtDT, type Doc, type useLive } from "../api.ts";
import { DocModal } from "./shared.tsx";

type Live = ReturnType<typeof useLive>;
type Row = { doc_id: string; type: string; related_id: string; created_ts: string; sent_ts: string | null };

/**
 * R9 Belgeler.
 * Tüm fiş, teklif, kayıt ve ekstreler tek listede: oluşturma ve Kanzasset'e gönderim zamanı,
 * teslim durumu, imza doğrulama, PDF indirme ve olay yeniden gönderimi.
 */
export function R9Documents({ live }: { live: Live }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [events, setEvents] = useState<{ event_id: string; type: string; status: string; attempts: number; last_error: string | null; created_ts: string; sent_ts: string | null }[]>([]);
  const [doc, setDoc] = useState<Doc | null>(null);
  const [q, setQ] = useState({ type: "", text: "" });
  const [msg, setMsg] = useState("");

  const load = async () => {
    try { const [d, e] = await Promise.all([api.documents(), api.events()]); setRows(d); setEvents(e); }
    catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
  };
  useEffect(() => { load(); }, [live.overview?.account.seq]);

  const types = [...new Set(rows.map((r) => r.type))];
  const shown = rows.filter((r) =>
    (!q.type || r.type === q.type) &&
    (!q.text || r.doc_id.toLowerCase().includes(q.text.toLowerCase()) || r.related_id.toLowerCase().includes(q.text.toLowerCase())));

  return (
    <div>
      <span className="tag">R9</span>
      <h1>Belgeler</h1>
      <p className="sub">Rafinerinin ürettiği bütün belgeler: Tahsis Belgesi, Kasa Giriş ve Çıkış Fişi, Lojistik ve Rafinasyon Teklifi, Sevkiyat Fişi, Teslimat Kaydı, günlük kasa ekstresi, cari hesap ekstresi ve mahsuplaşma ekstresi. Her belgenin içeriği, sha256 özeti ve imzası saklanır; Kanzasset belgeyi çektiğinde gönderim zamanı işlenir. PDF olarak indirilebilir.</p>

      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      <section className="card" style={{ marginBottom: 14 }}>
        <h2>Arama</h2>
        <div className="row">
          <select value={q.type} onChange={(e) => setQ({ ...q, type: e.target.value })}>
            <option value="">tüm tipler</option>
            {types.map((t) => <option key={t} value={t}>{DOC_TYPE_TR[t] ?? t}</option>)}
          </select>
          <input className="wide" placeholder="belge no ya da ilgili kayıt" value={q.text} onChange={(e) => setQ({ ...q, text: e.target.value })} />
          <button className="ghost" onClick={load}>Yenile</button>
        </div>
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <h2>Belgeler <span className="pill">{shown.length}</span></h2>
        <table>
          <thead><tr><th>Belge no</th><th>Tip</th><th>İlgili kayıt</th><th>Oluşturma</th><th>Kanzasset'e gönderim</th><th>Aksiyon</th></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={6} className="small">Belge yok</td></tr>}
            {shown.map((r) => (
              <tr key={r.doc_id}>
                <td className="mono small">{r.doc_id}</td>
                <td>{DOC_TYPE_TR[r.type] ?? r.type}</td>
                <td className="mono small">{r.related_id}</td>
                <td className="mono small">{fmtDT(r.created_ts)}</td>
                <td className="mono small">{r.sent_ts ? fmtDT(r.sent_ts) : <span className="pill">çekilmedi</span>}</td>
                <td>
                  <div className="row">
                    <button className="ghost" onClick={async () => setDoc(await api.document(r.doc_id))}>Görüntüle</button>
                    <a className="ghost" href={`/admin/documents/${r.doc_id}/pdf`} target="_blank" rel="noreferrer" style={{ textDecoration: "none", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 6 }}>PDF</a>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <h2>Olay teslimleri</h2>
        <p className="small">Her durum değişikliği Kanzasset'in olay adresine gönderilir. Teslim edilemeyen olaylar üstel bekleme ile yeniden denenir; burada son durum görünür.</p>
        <table>
          <thead><tr><th>Olay</th><th>Tip</th><th>Durum</th><th className="num">Deneme</th><th>Oluşturma</th><th>Teslim</th><th>Hata</th></tr></thead>
          <tbody>
            {events.length === 0 && <tr><td colSpan={7} className="small">Olay yok</td></tr>}
            {events.slice(0, 50).map((e) => (
              <tr key={e.event_id}>
                <td className="mono small">{e.event_id.slice(0, 12)}…</td>
                <td className="small">{e.type}</td>
                <td><span className={`pill ${e.status === "SENT" ? "ok" : e.status === "FAILED" ? "bad" : "warn"}`}>{e.status}</span></td>
                <td className="num">{e.attempts}</td>
                <td className="mono small">{fmtDT(e.created_ts)}</td>
                <td className="mono small">{e.sent_ts ? fmtDT(e.sent_ts) : ""}</td>
                <td className="small">{e.last_error ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {doc && <DocModal doc={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}
