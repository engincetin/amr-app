import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDT, fmtG, fmtMoney, STL_STATUS_TR, STL_TRIGGER_TR, type Settlement, type useLive } from "../api.ts";
import { nextAction, openMoneyLegs, steps } from "../settlementFlow.ts";

type Live = ReturnType<typeof useLive>;

/**
 * R8 Mahsuplaşma (Akışlar 12).
 *
 * Ekran tek soruya cevap verir: "şimdi ne olacak". Üstte beş adımlık durum şeridi,
 * altında o an yapılacak tek aksiyon durur. Rakamlar ve geçmiş "Ayrıntılar" altındadır.
 * Akış değişmedi: ekstre → mutabakat → altın bacağı (kasa talimatı) → para bacağı → kapanış.
 */
export function R8Settlement({ live }: { live: Live }) {
  const [items, setItems] = useState<Settlement[]>([]);
  const [open, setOpen] = useState<Settlement | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState<Settlement | null>(null);
  const [reason, setReason] = useState("");
  const [bankRef, setBankRef] = useState("");

  const load = () => api.settlements().then((r) => { setItems(r.items); setOpen(r.open); if (sel) setSel(r.items.find((x) => x.settlement_id === sel.settlement_id) ?? null); }).catch((e) => setMsg(`Hata: ${e.message}`));
  useEffect(() => { load(); }, [live.overview?.account.seq]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key); setMsg("");
    try { await fn(); setMsg(done); await load(); live.refresh(); }
    catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
    finally { setBusy(""); }
  };

  const w = sel ?? open;
  /** Açık pencere yoksa şerit son pencereyi gösterir: ekran boş kalmasın, gün nasıl kapandı görünsün. */
  const shown = w ?? items[0] ?? null;
  const flow = steps(shown);
  const next = nextAction(w);
  const legs = w ? openMoneyLegs(w) : [];
  const leg = next.ccy ? w!.money_leg.find((m) => m.ccy === next.ccy)! : null;

  return (
    <div>
      <span className="tag">R8</span>
      <h1>Mahsuplaşma</h1>
      <p className="sub">Gün içinde biriken karşılıklı alacak ve borç tek seferde kapatılır. Pencere kesim saatinde talep gelmese de kendiliğinden açılır. Adımlar sırayla ilerler; her an yapılacak tek iş aşağıdaki kutuda yazar.</p>

      {/* ---- durum şeridi ---- */}
      {!w && shown && <div className="small" style={{ marginBottom: 6 }}>Son pencere: {shown.settlement_id} · {fmtDT(shown.opened_ts)}</div>}
      <div className="steps" style={{ marginBottom: 14 }}>
        {flow.map((s) => (
          <div key={s.n} className={`step ${s.state === "bad" ? "now" : s.state}`}>
            <div className="n">ADIM {s.n}{s.state === "done" ? " ✓" : ""}</div>
            <div className="t" style={s.state === "bad" ? { color: "var(--bad)" } : undefined}>{s.title}</div>
            <div className="d">{s.detail}</div>
          </div>
        ))}
      </div>

      {/* ---- sıradaki adım: tek cümle, tek aksiyon ---- */}
      <div className="next" style={{ marginBottom: 14 }}>
        <div>
          <div className="q">{next.title}</div>
          <div className="w">{next.body}</div>
        </div>
        <div className="sp" />
        <div className="row">
          {next.action === "open" && (
            <>
              <input placeholder="gerekçe" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minWidth: 200 }} />
              <button className="primary" disabled={busy === "open"} onClick={() => act("open", () => api.settlementOpen("REQUEST_AMR", reason.trim() || "rafineri talebi"), "Pencere açıldı, Kanzasset'e bildirim gitti.")}>Mahsuplaşma talep et</button>
              <button disabled={busy === "open"} onClick={() => act("open", () => api.settlementOpen("CUTOFF", "kesim elle tetiklendi"), "Kesim tetiklendi, pencere açıldı.")}>Kesimi şimdi tetikle</button>
            </>
          )}
          {next.action === "draft" && (
            <button className="primary" disabled={busy === "draft"} onClick={() => act("draft", () => api.settlementDraft(w!.settlement_id), "Ekstre çıkarıldı ve Kanzasset'e gönderildi.")}>Ekstreyi çıkar</button>
          )}
          {next.action === "diffs" && (
            <button className="primary" disabled={busy === "draft"} onClick={() => act("draft", () => api.settlementDraft(w!.settlement_id), "Ekstre yeniden çıkarıldı, mutabakat tekrar çalışacak.")}>Ekstreyi yeniden çıkar</button>
          )}
          {next.action === "gold" && <Link to="/kasa"><button className="primary">R4 Kasa hesabına git</button></Link>}
          {next.action === "pay-out" && leg && (
            <>
              <input placeholder="banka referansı" value={bankRef} onChange={(e) => setBankRef(e.target.value)} style={{ minWidth: 200 }} />
              <button className="primary" disabled={!bankRef.trim() || busy === "pn"} onClick={() => act("pn", async () => {
                const r = await api.settlementNotice(w!.settlement_id, { ccy: leg.ccy, amount_cents: Math.abs(leg.net_cents), direction: "AMR_TO_KZ", bank_ref: bankRef.trim() });
                if (r.needs_approval && r.approval_id) { setMsg(`Ödeme talimatı ikinci onay bekliyor (onay ${r.approval_id}). R10 → bekleyen onaylar ekranından farklı bir kullanıcı onaylamalı.`); throw new Error("ikinci onay bekleniyor"); }
              }, "Ödeme bildirimi gönderildi.").catch(() => {})}>Ödemeyi bildir</button>
            </>
          )}
          {next.action === "pay-in" && leg && (
            <button className="primary" disabled={busy === "pr"} onClick={() => act("pr", () => api.settlementReceived(w!.settlement_id, leg.ccy), `${leg.ccy} ödemesi alındı olarak işaretlendi.`)}>Ödeme alındı</button>
          )}
          {next.action === "done" && w?.doc_id && (
            <a className="pill accent" href={`/admin/documents/${w.doc_id}/pdf`} target="_blank" rel="noreferrer" style={{ padding: "8px 13px" }}>Mahsuplaşma Ekstresi (PDF)</a>
          )}
        </div>
      </div>

      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      {/* ---- mutabakat farkları: yalnız fark varken ---- */}
      {w?.diffs && w.diffs.length > 0 && (
        <section className="card" style={{ marginBottom: 14, borderColor: "var(--bad)" }}>
          <h2>Mutabakat farkları</h2>
          <p className="small">İki ekstre tutmadığı sürece ödeme yapılmaz. Kalemler düzeltilip ekstre yeniden çıkarılır.</p>
          <table>
            <thead><tr><th>Alan</th><th className="num">Rafineri</th><th className="num">Kanzasset</th></tr></thead>
            <tbody>{w.diffs.map((d, i) => <tr key={i}><td>{d.field}</td><td className="num mono">{d.amr}</td><td className="num mono">{d.kz}</td></tr>)}</tbody>
          </table>
        </section>
      )}

      {/* ---- ayrıntılar: gerekirse açılır ---- */}
      {shown && (
        <details className="card" style={{ marginBottom: 14 }}>
          <summary>Ayrıntılar · {shown.settlement_id} · {STL_STATUS_TR[shown.status] ?? shown.status}</summary>
          <div className="grid c2" style={{ marginTop: 12 }}>
            <div>
              <h2>Pencere</h2>
              <div className="kv">
                <span className="k">Tetik</span><span>{STL_TRIGGER_TR[shown.trigger] ?? shown.trigger}</span>
                <span className="k">Aralık</span><span className="mono small">{fmtDT(shown.window_from)} → {fmtDT(shown.window_to)}</span>
                <span className="k">İşlem sayısı</span><span>{shown.statement?.movements.length ?? 0}</span>
                <span className="k">Ekstre özeti</span><span className="mono small" style={{ wordBreak: "break-all" }}>{shown.statement_hash?.slice(0, 24)}…</span>
                {shown.kz_statement_hash && <><span className="k">Kanzasset özeti</span><span className="mono small" style={{ wordBreak: "break-all" }}>{shown.kz_statement_hash.slice(0, 24)}…</span></>}
                <span className="k">Kesim ayarı</span><span className="mono small">{live.overview?.settings["settlement.cutoff_local"] ?? "17:00"} {live.overview?.settings["settlement.timezone"] ?? "Asia/Dubai"}</span>
              </div>
              <div className="row" style={{ marginTop: 10 }}>
                <button disabled={busy === "draft"} onClick={() => act("draft", () => api.settlementDraft(shown.settlement_id), "Ekstre yeniden çıkarıldı.")}>Ekstreyi yeniden çıkar</button>
                {shown.doc_id && <a href={`/admin/documents/${shown.doc_id}/pdf`} target="_blank" rel="noreferrer" className="pill">Ekstre PDF</a>}
              </div>
            </div>
            <div>
              <h2>Altın bacağı</h2>
              {shown.gold_leg ? (
                <div className="kv">
                  <span className="k">T net</span><span className="mono">{shown.gold_leg.t_net_mg >= 0 ? "+" : ""}{fmtG(shown.gold_leg.t_net_mg)} g</span>
                  <span className="k">Yön</span><span>{shown.gold_leg.direction === "VAULT_IN" ? "kasa girişi" : shown.gold_leg.direction === "VAULT_OUT" ? "kasa çıkışı" : "işlem yok"}</span>
                  <span className="k">Miktar</span><span className="mono">{fmtG(shown.gold_leg.qty_mg)} g</span>
                  <span className="k">Talimatlar</span><span className="mono small">{shown.gold_leg.requests.join(", ") || "bekleniyor"}</span>
                  <span className="k">Durum</span><span><span className={`pill ${shown.gold_leg.done ? "ok" : "warn"}`}>{shown.gold_leg.done ? "kapandı" : "bekliyor"}</span></span>
                </div>
              ) : <div className="small">Ekstre çıkınca belirir.</div>}
              <h2 style={{ marginTop: 14 }}>Para bacağı</h2>
              <table>
                <thead><tr><th>Kur</th><th className="num">Net</th><th>Yön</th><th>Durum</th><th>Banka ref</th></tr></thead>
                <tbody>
                  {shown.money_leg.map((m) => (
                    <tr key={m.ccy}>
                      <td>{m.ccy}</td>
                      <td className="num mono">{m.net_cents > 0 ? "+" : ""}{fmtMoney(m.net_cents)}</td>
                      <td className="small">{m.direction === "KZ_TO_AMR" ? "Kanzasset öder" : m.direction === "AMR_TO_KZ" ? "rafineri öder" : "yok"}</td>
                      <td><span className={`pill ${m.paid ? "ok" : m.net_cents === 0 ? "neut" : "warn"}`}>{m.paid ? "kapandı" : m.net_cents === 0 ? "yok" : "bekliyor"}</span></td>
                      <td className="mono small">{m.bank_ref ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {legs.length > 1 && <div className="small" style={{ marginTop: 6 }}>Kalan {legs.length} kur sırayla kapanır; üstteki kutu sıradakini gösterir.</div>}
            </div>
          </div>
          <h2 style={{ marginTop: 14 }}>Zaman çizelgesi</h2>
          <table><tbody>{(shown.history ?? []).map((h, i) => <tr key={i}><td className="mono small" style={{ whiteSpace: "nowrap" }}>{fmtDT(h.ts)}</td><td className="small"><b>{STL_STATUS_TR[h.status] ?? h.status}</b> {h.note ?? ""}</td></tr>)}</tbody></table>
        </details>
      )}

      <section className="card">
        <h2>Pencereler</h2>
        <table>
          <thead><tr><th>Açılış</th><th>Pencere</th><th>Tetik</th><th>Durum</th><th className="num">T net</th><th>Para</th><th>Kapanış</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={7} className="small">Pencere yok</td></tr>}
            {items.map((x) => (
              <tr key={x.settlement_id} onClick={() => setSel(x.settlement_id === sel?.settlement_id ? null : x)} style={{ cursor: "pointer", background: sel?.settlement_id === x.settlement_id ? "var(--soft)" : undefined }}>
                <td className="mono">{fmtDT(x.opened_ts)}</td>
                <td className="mono small">{x.settlement_id}</td>
                <td className="small">{STL_TRIGGER_TR[x.trigger] ?? x.trigger}</td>
                <td><span className={`pill ${x.status === "SETTLED" ? "ok" : x.status === "MISMATCH" ? "bad" : "warn"}`}>{STL_STATUS_TR[x.status] ?? x.status}</span></td>
                <td className="num mono">{x.gold_leg ? fmtG(x.gold_leg.t_net_mg) : ""}</td>
                <td className="small">{x.money_leg.filter((m) => m.net_cents !== 0).map((m) => `${m.ccy} ${fmtMoney(m.net_cents)}`).join(" · ") || "yok"}</td>
                <td className="mono small">{x.settled_ts ? fmtDT(x.settled_ts) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="small" style={{ marginTop: 6 }}>Satıra tıklayınca o pencerenin adımları yukarıda görünür; tekrar tıklayınca açık pencereye döner.</div>
      </section>
    </div>
  );
}
