import { useEffect, useState } from "react";
import { api, DOC_TYPE_TR, fmtDT, type Doc, type RequestLogRow, type RequestSummary, type useLive } from "../api.ts";
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
  const [reqs, setReqs] = useState<RequestLogRow[]>([]);
  const [reqSum, setReqSum] = useState<RequestSummary | null>(null);
  const [reqQ, setReqQ] = useState({ channel: "", errors: false });

  const load = async () => {
    try {
      const [d, e, r] = await Promise.all([api.documents(), api.events(), api.requests({ limit: 100, channel: reqQ.channel || undefined, errors: reqQ.errors })]);
      setRows(d); setEvents(e); setReqs(r.items); setReqSum(r.summary);
    }
    catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
  };
  useEffect(() => { load(); }, [live.overview?.account.seq, reqQ.channel, reqQ.errors]);

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

      <section className="card" style={{ marginTop: 14 }}>
        <h2>İstek günlüğü <span className="pill">{reqSum?.total ?? 0}</span></h2>
        <p className="small">Kanzasset'in yaptığı her istek ve panelden yapılan her değişiklik burada. Gövdenin kendisi saklanmaz; imzalanan gövdenin sha256 özeti saklanır, böylece "bu istek bu gövdeyle geldi" sonradan kanıtlanır. Saklama süresi R10'daki <span className="mono">log.retention_days</span> parametresidir{reqSum ? ` (şu an ${reqSum.retention_days} gün)` : ""}.</p>
        {reqSum && (
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="pill">son 24 saat: {reqSum.last_24h}</span>
            <span className={`pill ${reqSum.errors_24h > 0 ? "warn" : "ok"}`}>hata: {reqSum.errors_24h}</span>
            <span className="pill">ortalama {reqSum.avg_ms} ms</span>
            {reqSum.oldest_ts && <span className="small">en eski kayıt {fmtDT(reqSum.oldest_ts)}</span>}
          </div>
        )}
        <div className="row" style={{ marginBottom: 8 }}>
          <select value={reqQ.channel} onChange={(e) => setReqQ({ ...reqQ, channel: e.target.value })}>
            <option value="">tüm kanallar</option>
            <option value="KANZASSET">Kanzasset (/v1)</option>
            <option value="PANEL">panel (/admin)</option>
          </select>
          <label className="small"><input type="checkbox" checked={reqQ.errors} onChange={(e) => setReqQ({ ...reqQ, errors: e.target.checked })} /> yalnız hatalar</label>
          <button className="ghost" onClick={load}>Yenile</button>
        </div>
        <table>
          <thead><tr><th>Zaman</th><th>Kanal</th><th>İstek</th><th className="num">Sonuç</th><th className="num">Süre</th><th>Kim</th><th>Gövde özeti</th></tr></thead>
          <tbody>
            {reqs.length === 0 && <tr><td colSpan={7} className="small">Kayıt yok</td></tr>}
            {reqs.map((r) => (
              <tr key={r.id}>
                <td className="mono small">{fmtDT(r.ts)}</td>
                <td className="small">{r.channel === "KANZASSET" ? "Kanzasset" : "panel"}</td>
                <td className="mono small">{r.method} {r.path}</td>
                <td className="num"><span className={`pill ${r.status >= 400 ? "bad" : "ok"}`}>{r.status}</span></td>
                <td className="num mono small">{r.duration_ms} ms</td>
                <td className="small">{r.actor ?? r.api_key ?? ""}</td>
                <td className="mono small" title={r.body_sha256 ?? ""}>{r.body_sha256 ? r.body_sha256.slice(0, 12) + "…" : ""}{r.idempotency_key ? <div style={{ opacity: .6 }}>idem {r.idempotency_key.slice(0, 10)}…</div> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {doc && <DocModal doc={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}
