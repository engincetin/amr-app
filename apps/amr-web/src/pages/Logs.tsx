import { useEffect, useState } from "react";
import { fmtDT } from "../api.ts";

/**
 * Kayıtlar: geriye dönük tek pencere (istek günlüğü, denetim günlüğü, olaylar, bildirimler, fiyat tick'leri).
 *
 * Her kaynak aynı dört sütunla okunur: zaman · kim · ne · sonuç. Metinle, tarih aralığıyla süzülür
 * ve sayfa sayfa geriye gidilir; kayıt sayısı büyüdükçe ekran bozulmaz.
 * İki panelde de aynı ekran vardır, yalnız uç adresi ve kaynak adları değişir.
 */
export interface LogRow { ts: string; source: string; who: string; what: string; state: string; level: "ok" | "warn" | "bad" | "neut"; detail?: string }

const SOURCES: { id: string; label: string; hint: string }[] = [
  { id: "requests", label: "İstek günlüğü", hint: "Kanzasset'in istekleri ve panelin değişiklikleri (VARA kanıtı): gövdenin kendisi değil sha256 özeti saklanır." },
  { id: "audit", label: "Denetim günlüğü", hint: "Elle yapılan aksiyonlar: kim, ne zaman, ne yaptı; öncesi ve sonrasıyla." },
  { id: "events", label: "Olaylar", hint: "Kanzasset'e gönderilen olaylar (webhook): teslim durumu ve deneme sayısı." },
  { id: "notifications", label: "Bildirimler", hint: "Ekranlarda çıkan bildirimlerin tamamı, okunmuşlar dahil." },
  { id: "ticks", label: "Fiyat tick'leri", hint: "Yayınlanan her fiyat: seq, üç kur ve o anda işlem yapılabilir miydi." },
];

export function LogsPage({ endpoint, tag, title }: { endpoint: string; tag: string; title: string }) {
  const [source, setSource] = useState("requests");
  const [q, setQ] = useState("");
  const [range, setRange] = useState({ from: "", to: "" });
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(50);
  const [data, setData] = useState<{ items: LogRow[]; total: number }>({ items: [], total: 0 });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [openRow, setOpenRow] = useState<number | null>(null);

  const load = async () => {
    setBusy(true); setMsg("");
    try {
      const p = new URLSearchParams({ source, limit: String(size), offset: String(page * size) });
      if (q.trim()) p.set("q", q.trim());
      if (range.from) p.set("from", range.from);
      if (range.to) p.set("to", range.to);
      const res = await fetch(`${endpoint}?${p}`, { headers: { "content-type": "application/json" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
    } catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };
  useEffect(() => { void load(); }, [source, page, size]);
  useEffect(() => { setPage(0); }, [source]);

  const src = SOURCES.find((s) => s.id === source)!;
  const pages = Math.max(1, Math.ceil(data.total / size));
  const shownFrom = data.total === 0 ? 0 : page * size + 1;
  const shownTo = Math.min(data.total, (page + 1) * size);

  return (
    <div>
      <span className="tag">{tag}</span>
      <h1>{title}</h1>
      <p className="sub">Geriye dönük bütün kayıtlar tek yerde. Kaynağı seçin, metinle ya da tarihle süzün, sayfa sayfa geriye gidin. Kayıtlar sunucuda durur; sayfa yenilenince kaybolmaz.</p>

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ marginBottom: 10 }}>
          {SOURCES.map((s) => (
            <button key={s.id} className={source === s.id ? "primary" : ""} onClick={() => setSource(s.id)}>{s.label}</button>
          ))}
        </div>
        <p className="small" style={{ margin: "0 0 10px" }}>{src.hint}</p>
        <div className="row">
          <input placeholder="ara (uç, kullanıcı, tip, metin)" value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setPage(0); void load(); } }} style={{ minWidth: 240, flex: 1 }} />
          <span className="small">tarih</span>
          <input type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
          <span className="small">→</span>
          <input type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
          <button className="primary" disabled={busy} onClick={() => { setPage(0); void load(); }}>Süz</button>
          <button className="ghost" disabled={busy} onClick={() => { setQ(""); setRange({ from: "", to: "" }); setPage(0); void load(); }}>Temizle</button>
        </div>
      </section>

      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      <section className="card">
        <div className="row" style={{ marginBottom: 8 }}>
          <b>{src.label}</b>
          <span className="pill">{data.total} kayıt</span>
          <span className="small">{shownFrom}–{shownTo} arası gösteriliyor</span>
          <span style={{ flex: 1 }} />
          <select value={size} onChange={(e) => { setSize(Number(e.target.value)); setPage(0); }}>
            {[25, 50, 100, 200].map((n) => <option key={n} value={n}>{n} satır</option>)}
          </select>
          <button disabled={busy || page === 0} onClick={() => setPage(0)} title="en yeni">⏮</button>
          <button disabled={busy || page === 0} onClick={() => setPage((p) => p - 1)}>← Yeni</button>
          <span className="small mono">{page + 1} / {pages}</span>
          <button disabled={busy || page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>Eski →</button>
          <button disabled={busy || page + 1 >= pages} onClick={() => setPage(pages - 1)} title="en eski">⏭</button>
        </div>
        <table>
          <thead><tr><th>Zaman</th><th>Kim</th><th>Ne</th><th>Sonuç</th></tr></thead>
          <tbody>
            {data.items.length === 0 && <tr><td colSpan={4} className="small">Kayıt yok</td></tr>}
            {data.items.map((r, i) => (
              <tr key={i} onClick={() => setOpenRow(openRow === i ? null : i)} style={{ cursor: r.detail ? "pointer" : undefined }}>
                <td className="mono small" style={{ whiteSpace: "nowrap" }}>{fmtDT(r.ts)}</td>
                <td className="small">{r.who}</td>
                <td className="mono small">{r.what}{openRow === i && r.detail && <div className="small" style={{ opacity: .75, marginTop: 4, whiteSpace: "pre-wrap" }}>{r.detail}</div>}</td>
                <td><span className={`pill ${r.level === "neut" ? "" : r.level}`}>{r.state}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="small" style={{ marginTop: 6 }}>Satıra tıklayınca ayrıntı açılır (süre, gövde özeti, öncesi ve sonrası).</div>
      </section>
    </div>
  );
}
