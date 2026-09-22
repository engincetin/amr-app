import { useEffect, useState } from "react";
import { api, fmtDT, fmtG, fmtTime, untilText, VAULT_MOVE_TR, VAULT_STATUS_TR, type Doc, type VaultRequest, type VaultStatement, type VaultView, type useLive } from "../api.ts";
import { Pager, usePager } from "../components/Pager.tsx";

type Live = ReturnType<typeof useLive>;

/**
 * R4 Kasa hesabı (Akışlar 05, 06).
 * Bekleyen talepler kuyruğu (Kabul et / Reddet), kabulde fiş oluşur ve Kanzasset'e gider;
 * giriş için Kasaya konuluyor → Kasaya konuldu (en geç T+3); günlük kasa ekstresi rezerv kanıtıdır.
 */
export function R4Vault({ live }: { live: Live }) {
  const [v, setV] = useState<VaultView | null>(null);
  const [busy, setBusy] = useState<string>("");
  const [msg, setMsg] = useState("");
  const [rejecting, setRejecting] = useState<VaultRequest | null>(null);
  const [reason, setReason] = useState("");
  const [doc, setDoc] = useState<Doc | null>(null);
  const [stmt, setStmt] = useState<VaultStatement | null>(null);
  const [, tick] = useState(0);

  const load = () => api.vault({ limit: 300 }).then(setV).catch((e) => setMsg(`Hata: ${e.message}`));
  useEffect(() => { load(); }, [live.overview?.account.seq, live.overview?.vault_pending]);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []); // sayaçlar

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id); setMsg("");
    try { await fn(); setMsg(done); await load(); live.refresh(); }
    catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
    finally { setBusy(""); }
  };

  const acc = v?.account ?? live.overview?.account;
  const vaultTotal = acc ? acc.vault.in_vault_mg + acc.vault.placing_mg + acc.vault.shipping_mg : 0;

  const pMov = usePager(v?.movements ?? [], 20);
  const pReq = usePager(v?.requests ?? [], 20);
  return (
    <div>
      <span className="tag">R4</span>
      <h1>Kasa hesabı</h1>
      <p className="sub">Kasa hesabına gram girişi ve çıkışı yalnız Kanzasset'in kasa talimatıyla olur. Kabul edildiğinde Kasa Giriş Fişi ya da Kasa Çıkış Fişi oluşur, Kanzasset'e gider ve defter işlenir. Giriş kabulünde gram cari hesaptan "kasaya konuluyor" kalemine geçer, külçe yerleşince "kasada" olur: en geç T+3. Çıkış kabulle biter. İşlem fiyatsızdır: gramlar emirlerde zaten alındı ya da satıldı.</p>

      <div className="grid c3" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Kasa hesabı (V)</h2>
          <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{fmtG(vaultTotal)} g</div>
          <div className="kv" style={{ marginTop: 8 }}>
            <span className="k">Kasada</span><span className="mono">{fmtG(acc?.vault.in_vault_mg ?? 0)} g</span>
            <span className="k">Kasaya konuluyor</span><span className="mono">{fmtG(acc?.vault.placing_mg ?? 0)} g</span>
            <span className="k">Sevkiyatta</span><span className="mono">{fmtG(acc?.vault.shipping_mg ?? 0)} g</span>
          </div>
        </div>
        <div className="card">
          <h2>Cari hesap altını (T)</h2>
          <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{(acc?.current_account.gold_mg ?? 0) >= 0 ? "+" : ""}{fmtG(acc?.current_account.gold_mg ?? 0)} g</div>
          <div className="small">Giriş talebi bu bakiyeden karşılanır: kural olarak cari hesap altını talep edilen gramdan az olamaz. Çıkış talebinde ise kasada yeterli gram aranır, "kasaya konuluyor" sayılmaz.</div>
        </div>
        <div className="card">
          <h2>Kabul ayarı</h2>
          <div className="kv">
            <span className="k">Kabul</span><span><span className={`pill ${v?.accept_mode === "AUTO" ? "ok" : ""}`}>{v?.accept_mode === "AUTO" ? "otomatik" : "elle"}</span></span>
            <span className="k">Hedef cevap</span><span>{v?.accept_target_minutes ?? 15} dk</span>
            <span className="k">Kasaya koyma vadesi</span><span>T+{v?.placement_due_days ?? 3}</span>
          </div>
          <div className="small" style={{ marginTop: 6 }}>Otomatik kabul R11 Ayarlar → parametreler (`vault.accept_mode`) ile açılır.</div>
        </div>
      </div>

      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      <section className="card" style={{ marginBottom: 14 }}>
        <h2>Bekleyen talepler {v && v.pending.length > 0 && <span className="pill">{v.pending.length}</span>}</h2>
        <p className="small">Kabul edildiğinde fiş oluşur ve Kanzasset'e olayla gider; kabul, Kanzasset tarafında mint'in dayanağıdır. Red gerekçe ister; gram yerinde kalır.</p>
        <table>
          <thead><tr><th>Geliş</th><th>Tür</th><th className="num">Gram</th><th>KZ referansı</th><th>Hedef cevap</th><th>Aksiyon</th></tr></thead>
          <tbody>
            {(v?.pending.length ?? 0) === 0 && <tr><td colSpan={6} className="small">Bekleyen talep yok</td></tr>}
            {v?.pending.map((r) => {
              const target = untilText(new Date(Date.parse(r.requested_ts) + (v.accept_target_minutes ?? 15) * 60_000).toISOString());
              return (
                <tr key={r.request_id}>
                  <td className="mono">{fmtDT(r.requested_ts)}</td>
                  <td>{r.type === "IN" ? "Kasa girişi" : "Kasa çıkışı"}</td>
                  <td className="num mono">{fmtG(r.qty_mg)}</td>
                  <td className="mono small">{r.ref}</td>
                  <td className="small" style={{ color: target?.late ? "var(--bad)" : undefined }}>{target?.text}</td>
                  <td>
                    <div className="row">
                      <button className="primary" disabled={busy === r.request_id} onClick={() => act(r.request_id, () => api.vaultAccept(r.request_id), `${r.ref}: kabul edildi, fiş Kanzasset'e gönderildi.`)}>Kabul et</button>
                      <button className="ghost" disabled={busy === r.request_id} onClick={() => { setRejecting(r); setReason(""); }}>Reddet</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="card" style={{ marginBottom: 14 }}>
        <h2>Kasaya koyma kuyruğu (T+3)</h2>
        <p className="small">Kabul edilmiş girişler: külçe kasaya taşınırken "Kasaya konuluyor", yerleşince "Kasaya konuldu" işaretlenir. Vade geçerse uyarı düşer ve Kanzasset tarafında yeni mint bloke olur.</p>
        <table>
          <thead><tr><th>Kabul</th><th className="num">Gram</th><th>KZ referansı</th><th>Durum</th><th>Vade (T+3)</th><th>Fiş</th><th>Aksiyon</th></tr></thead>
          <tbody>
            {(v?.placing_queue.length ?? 0) === 0 && <tr><td colSpan={7} className="small">Kuyruk boş</td></tr>}
            {v?.placing_queue.map((r) => {
              const due = untilText(r.due_ts);
              return (
                <tr key={r.request_id}>
                  <td className="mono">{fmtDT(r.accepted_ts)}</td>
                  <td className="num mono">{fmtG(r.qty_mg)}</td>
                  <td className="mono small">{r.ref}</td>
                  <td><StatusPill s={r.status} /></td>
                  <td className="small" style={{ color: due?.late ? "var(--bad)" : undefined }}>{fmtDT(r.due_ts)}<br />{due?.text}</td>
                  <td className="mono small">{r.doc_id && <button className="ghost" onClick={async () => setDoc(await api.document(r.doc_id!))}>{r.doc_id}</button>}</td>
                  <td>
                    <div className="row">
                      {r.status === "ACCEPTED" && <button className="ghost" disabled={busy === r.request_id} onClick={() => act(r.request_id, () => api.vaultPlacing(r.request_id), `${r.ref}: kasaya konuluyor.`)}>Kasaya konuluyor</button>}
                      <button className="primary" disabled={busy === r.request_id} onClick={() => act(r.request_id, () => api.vaultPlaced(r.request_id), `${r.ref}: kasaya konuldu, gram "kasada" kalemine geçti.`)}>Kasaya konuldu</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <div className="grid c2" style={{ marginBottom: 14 }}>
        <section className="card">
          <h2>Kasa hareketleri</h2>
          <table>
            <thead><tr><th className="num">Sıra</th><th>Zaman</th><th>Tür</th><th className="num">Kasada</th><th className="num">Konuluyor</th><th className="num">Sevkiyatta</th></tr></thead>
            <tbody>
              {(v?.movements.length ?? 0) === 0 && <tr><td colSpan={6} className="small">Hareket yok</td></tr>}
              {pMov.slice.map((m) => (
                <tr key={m.id}>
                  <td className="num">{m.seq}</td><td className="mono">{fmtTime(m.ts)}</td><td>{VAULT_MOVE_TR[m.type] ?? m.type}</td>
                  <td className="num mono">{m.in_vault_mg ? `${m.in_vault_mg > 0 ? "+" : ""}${fmtG(m.in_vault_mg)}` : ""}</td>
                  <td className="num mono">{m.placing_mg ? `${m.placing_mg > 0 ? "+" : ""}${fmtG(m.placing_mg)}` : ""}</td>
                  <td className="num mono">{m.shipping_mg ? `${m.shipping_mg > 0 ? "+" : ""}${fmtG(m.shipping_mg)}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager p={pMov} label="Hareketler" />
        </section>

        <section className="card">
          <h2>Günlük kasa ekstresi</h2>
          <p className="small">Rezerv kanıtı: gün içi kasa hareketleri, açılış ve kapanış alt kalemleri, fiş referansları ve imza. Kanzasset `GET /v1/vault/statement` ile aynı ekstreyi çeker.</p>
          <div className="row"><button className="primary" onClick={async () => setStmt(await api.vaultStatement())}>Bugünün ekstresini çıkar</button></div>
          {stmt && (
            <div style={{ marginTop: 10 }}>
              <div className="kv">
                <span className="k">Tarih</span><span className="mono">{stmt.date}</span>
                <span className="k">Açılış</span><span className="mono">{fmtG(stmt.opening.in_vault_mg)} · {fmtG(stmt.opening.placing_mg)} · {fmtG(stmt.opening.shipping_mg)} g</span>
                <span className="k">Kapanış</span><span className="mono">{fmtG(stmt.closing.in_vault_mg)} · {fmtG(stmt.closing.placing_mg)} · {fmtG(stmt.closing.shipping_mg)} g</span>
                <span className="k">Toplam (V)</span><span className="mono">{fmtG(stmt.total_mg)} g</span>
                <span className="k">Hareket</span><span>{stmt.movements.length}</span>
                <span className="k">Fişler</span><span className="mono small">{stmt.slips.map((s) => s.doc_id).join(", ") || "yok"}</span>
                <span className="k">İmza</span><span className="mono small" style={{ wordBreak: "break-all" }}>{stmt.signature.slice(0, 32)}…</span>
              </div>
            </div>
          )}
        </section>
      </div>

      <section className="card">
        <h2>İşlenen talepler</h2>
        <table>
          <thead><tr><th>Geliş</th><th>Tür</th><th className="num">Gram</th><th>KZ referansı</th><th>Durum</th><th>Fiş</th><th>Not</th></tr></thead>
          <tbody>
            {(v?.requests.length ?? 0) === 0 && <tr><td colSpan={7} className="small">Talep yok</td></tr>}
            {pReq.slice.map((r) => (
              <tr key={r.request_id}>
                <td className="mono">{fmtDT(r.requested_ts)}</td>
                <td>{r.type === "IN" ? "Giriş" : "Çıkış"}</td>
                <td className="num mono">{fmtG(r.qty_mg)}</td>
                <td className="mono small">{r.ref}</td>
                <td><StatusPill s={r.status} /></td>
                <td className="mono small">{r.doc_id && <button className="ghost" onClick={async () => setDoc(await api.document(r.doc_id!))}>{r.doc_id}</button>}</td>
                <td className="small">{r.reject_reason ?? r.history?.at(-1)?.note ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Pager p={pReq} label="Talepler" />
      </section>

      {rejecting && (
        <div className="modal-bg" onClick={() => setRejecting(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Talebi reddet</h3>
            <p className="small">{rejecting.type === "IN" ? "Kasa girişi" : "Kasa çıkışı"} {fmtG(rejecting.qty_mg)} g · ref {rejecting.ref}. Gerekçe Kanzasset'e gider; gram yerinde kalır.</p>
            <input className="wide" placeholder="gerekçe (zorunlu)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <div className="row" style={{ marginTop: 10 }}>
              <button className="danger" disabled={!reason.trim()} onClick={async () => { const r = rejecting; setRejecting(null); await act(r.request_id, () => api.vaultReject(r.request_id, reason.trim()), `${r.ref}: reddedildi.`); }}>Reddet</button>
              <button className="ghost" onClick={() => setRejecting(null)}>Vazgeç</button>
            </div>
          </div>
        </div>
      )}

      {doc && (
        <div className="modal-bg" onClick={() => setDoc(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{String(doc.content.title ?? doc.meta.type)}</h3>
            <div className="kv">
              {Object.entries(doc.content).filter(([k]) => k !== "title").map(([k, val]) => (
                <span key={k} style={{ display: "contents" }}><span className="k">{k}</span><span className="mono small" style={{ wordBreak: "break-all" }}>{String(val)}</span></span>
              ))}
              <span className="k">hash</span><span className="mono small" style={{ wordBreak: "break-all" }}>{doc.meta.hash}</span>
              <span className="k">imza</span><span className="mono small" style={{ wordBreak: "break-all" }}>{doc.meta.signature}</span>
              <span className="k">Kanzasset'e gönderim</span><span className="mono small">{doc.meta.sent_ts ? fmtDT(doc.meta.sent_ts) : "henüz çekilmedi"}</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}><button className="ghost" onClick={() => setDoc(null)}>Kapat</button></div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ s }: { s: VaultRequest["status"] }) {
  const cls = s === "PLACED" || s === "ACCEPTED" ? "ok" : s === "REJECTED" || s === "OVERDUE" ? "bad" : "";
  return <span className={`pill ${cls}`}>{VAULT_STATUS_TR[s] ?? s}</span>;
}
