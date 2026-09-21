import { fmtDT, type Doc } from "../api.ts";

/** Belge görüntüleyici: içerik, sha256 ve imza; Kanzasset'e gönderim zamanı. */
export function DocModal({ doc, onClose }: { doc: Doc; onClose: () => void }) {
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{String(doc.content.title ?? doc.meta.type)}</h3>
        <div className="kv">
          {Object.entries(doc.content).filter(([k]) => k !== "title").map(([k, v]) => (
            <span key={k} style={{ display: "contents" }}><span className="k">{k}</span><span className="mono small" style={{ wordBreak: "break-all" }}>{String(v)}</span></span>
          ))}
          <span className="k">hash</span><span className="mono small" style={{ wordBreak: "break-all" }}>{doc.meta.hash}</span>
          <span className="k">imza</span><span className="mono small" style={{ wordBreak: "break-all" }}>{doc.meta.signature}</span>
          <span className="k">Kanzasset'e gönderim</span><span className="mono small">{doc.meta.sent_ts ? fmtDT(doc.meta.sent_ts) : "henüz çekilmedi"}</span>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <a className="ghost" href={`/admin/documents/${doc.meta.doc_id}/pdf`} target="_blank" rel="noreferrer" style={{ textDecoration: "none", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 6 }}>PDF indir</a>
          <button className="ghost" onClick={onClose}>Kapat</button>
        </div>
      </div>
    </div>
  );
}

/** Talep zaman çizelgesi (durum geçişleri ve notlar). */
export function Timeline({ title, history, onClose }: { title: string; history: { status: string; ts: string; note?: string }[]; onClose: () => void }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      <table>
        <tbody>
          {history.map((h, i) => (
            <tr key={i}><td className="mono small" style={{ whiteSpace: "nowrap" }}>{fmtDT(h.ts)}</td><td className="small"><b>{h.status}</b> {h.note ?? ""}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="row" style={{ marginTop: 8 }}><button className="ghost" onClick={onClose}>Kapat</button></div>
    </section>
  );
}
