import { useEffect, useState } from "react";
import { api, fmtDT, fmtG, fmtMoney, STL_STATUS_TR, STL_TRIGGER_TR, type Settlement, type useLive } from "../api.ts";

type Live = ReturnType<typeof useLive>;

/**
 * R8 Mahsuplaşma (Akışlar 12).
 * Pencere kesim saatinde kendiliğinden açılır; iki taraf da talep edebilir, cari hesap limiti de tetikler.
 * Adımlar: ekstre taslağı → mutabakat (Kanzasset özeti) → altın bacağı (kasa talimatı) → para bacağı (ödeme) → kapanış.
 */
export function R8Settlement({ live }: { live: Live }) {
  const [items, setItems] = useState<Settlement[]>([]);
  const [open, setOpen] = useState<Settlement | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState<Settlement | null>(null);
  const [reason, setReason] = useState("");
  const [pay, setPay] = useState({ ccy: "USD", bank_ref: "" });

  const load = () => api.settlements().then((r) => { setItems(r.items); setOpen(r.open); }).catch((e) => setMsg(`Hata: ${e.message}`));
  useEffect(() => { load(); }, [live.overview?.account.seq]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key); setMsg("");
    try { await fn(); setMsg(done); await load(); live.refresh(); }
    catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
    finally { setBusy(""); }
  };

  const w = sel ?? open;

  return (
    <div>
      <span className="tag">R8</span>
      <h1>Mahsuplaşma</h1>
      <p className="sub">Gün içinde biriken karşılıklı alacak ve borçların tek seferde kapatılması. Pencere kesim saatinde talep gelmese de kendiliğinden açılır; iki taraf da "şimdi netleşelim" diyebilir ve cari hesap limiti de tetikler. İçindeki mutabakat adımı iki tarafın ekstresinin birebir karşılaştırılmasıdır. Altın bacağı kasa talimatıyla, para bacağı banka ödemesiyle kapanır; ödeme Kanzasset tarafında yalnız şirket hesabından yapılır.</p>

      <div className="grid c3" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Açık pencere</h2>
          {open ? (
            <>
              <div className="mono" style={{ fontSize: 16, fontWeight: 600 }}>{open.settlement_id}</div>
              <div className="small">{STL_TRIGGER_TR[open.trigger] ?? open.trigger} · <span className="pill">{STL_STATUS_TR[open.status] ?? open.status}</span></div>
            </>
          ) : <div className="small">Açık pencere yok</div>}
        </div>
        <div className="card">
          <h2>Kesim ayarı</h2>
          <div className="kv">
            <span className="k">Kesim saati</span><span className="mono">{live.overview?.settings["settlement.cutoff_local"] ?? "17:00"}</span>
            <span className="k">Saat dilimi</span><span className="mono">{live.overview?.settings["settlement.timezone"] ?? "Asia/Dubai"}</span>
            <span className="k">Gün içi pencere</span><span className="mono">{live.overview?.settings["settlement.windows_per_day"] ?? "1"}</span>
          </div>
          <div className="small" style={{ marginTop: 6 }}>Değerler R10'dan değişir; kesim saatinde pencere kendiliğinden açılır.</div>
        </div>
        <div className="card">
          <h2>Mahsuplaşma talep et</h2>
          <div className="row">
            <input className="wide" placeholder="gerekçe" value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <button className="primary" disabled={busy === "open"} onClick={() => act("open", () => api.settlementOpen("REQUEST_AMR", reason.trim() || "rafineri talebi"), "Pencere açıldı, Kanzasset'e bildirim gitti.")}>Talep et</button>
            <button className="ghost" disabled={busy === "open"} onClick={() => act("open", () => api.settlementOpen("CUTOFF", "kesim elle tetiklendi"), "Kesim tetiklendi, pencere açıldı.")}>Kesimi şimdi tetikle</button>
          </div>
        </div>
      </div>

      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      {w && (
        <>
          <section className="card" style={{ marginBottom: 14 }}>
            <h2>{w.settlement_id} · <span className="pill">{STL_STATUS_TR[w.status] ?? w.status}</span></h2>
            <div className="kv">
              <span className="k">Tetik</span><span>{STL_TRIGGER_TR[w.trigger] ?? w.trigger}</span>
              <span className="k">Pencere</span><span className="mono small">{fmtDT(w.window_from)} → {fmtDT(w.window_to)}</span>
              <span className="k">İşlem sayısı</span><span>{w.statement?.movements.length ?? 0}</span>
              <span className="k">Ekstre özeti</span><span className="mono small" style={{ wordBreak: "break-all" }}>{w.statement_hash?.slice(0, 32)}…</span>
              {w.kz_statement_hash && <><span className="k">Kanzasset özeti</span><span className="mono small" style={{ wordBreak: "break-all" }}>{w.kz_statement_hash.slice(0, 32)}…</span></>}
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="ghost" disabled={busy === "draft"} onClick={() => act("draft", () => api.settlementDraft(w.settlement_id), "Ekstre taslağı yeniden üretildi.")}>Ekstreyi yeniden çıkar</button>
              {w.doc_id && <a className="ghost" href={`/admin/documents/${w.doc_id}/pdf`} target="_blank" rel="noreferrer" style={{ textDecoration: "none", padding: "6px 10px", border: "1px solid var(--line)", borderRadius: 6 }}>Mahsuplaşma Ekstresi (PDF)</a>}
            </div>
          </section>

          {w.diffs && w.diffs.length > 0 && (
            <section className="card" style={{ marginBottom: 14 }}>
              <h2>Mutabakat farkları</h2>
              <p className="small">Fark varsa ödeme bekler; iki taraf düzeltir ve ekstre yeniden çıkarılır.</p>
              <table>
                <thead><tr><th>Alan</th><th className="num">Rafineri</th><th className="num">Kanzasset</th></tr></thead>
                <tbody>{w.diffs.map((d, i) => <tr key={i}><td>{d.field}</td><td className="num mono">{d.amr}</td><td className="num mono">{d.kz}</td></tr>)}</tbody>
              </table>
            </section>
          )}

          <div className="grid c2" style={{ marginBottom: 14 }}>
            <section className="card">
              <h2>Altın bacağı</h2>
              {w.gold_leg ? (
                <div className="kv">
                  <span className="k">T net</span><span className="mono">{w.gold_leg.t_net_mg >= 0 ? "+" : ""}{fmtG(w.gold_leg.t_net_mg)} g</span>
                  <span className="k">Yön</span><span>{w.gold_leg.direction === "VAULT_IN" ? "kasa girişi (Kanzasset talep eder)" : w.gold_leg.direction === "VAULT_OUT" ? "kasa çıkışı" : "işlem yok"}</span>
                  <span className="k">Miktar</span><span className="mono">{fmtG(w.gold_leg.qty_mg)} g</span>
                  <span className="k">Talimatlar</span><span className="mono small">{w.gold_leg.requests.join(", ") || "bekleniyor"}</span>
                  <span className="k">Durum</span><span><span className={`pill ${w.gold_leg.done ? "ok" : ""}`}>{w.gold_leg.done ? "kapandı" : "bekliyor"}</span></span>
                </div>
              ) : <div className="small">Ekstre taslağı çıkarılınca belirir.</div>}
              <div className="small" style={{ marginTop: 6 }}>Altın bacağı Kanzasset'in kasa talimatıyla kapanır; R4'ten kabul edilir.</div>
            </section>

            <section className="card">
              <h2>Para bacağı</h2>
              <table>
                <thead><tr><th>Kur</th><th className="num">Net</th><th>Yön</th><th>Durum</th><th>Banka ref</th></tr></thead>
                <tbody>
                  {w.money_leg.map((m) => (
                    <tr key={m.ccy}>
                      <td>{m.ccy}</td>
                      <td className="num mono">{m.net_cents > 0 ? "+" : ""}{fmtMoney(m.net_cents)}</td>
                      <td className="small">{m.direction === "KZ_TO_AMR" ? "Kanzasset öder" : m.direction === "AMR_TO_KZ" ? "rafineri öder" : "yok"}</td>
                      <td><span className={`pill ${m.paid ? "ok" : m.net_cents === 0 ? "" : "warn"}`}>{m.paid ? "kapandı" : m.net_cents === 0 ? "yok" : "bekliyor"}</span></td>
                      <td className="mono small">{m.bank_ref ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {w.status !== "SETTLED" && (
                <div style={{ marginTop: 10 }}>
                  <div className="row">
                    <select value={pay.ccy} onChange={(e) => setPay({ ...pay, ccy: e.target.value })}>{w.money_leg.map((m) => <option key={m.ccy}>{m.ccy}</option>)}</select>
                    <input placeholder="banka referansı (AMR ödeyense)" value={pay.bank_ref} onChange={(e) => setPay({ ...pay, bank_ref: e.target.value })} />
                  </div>
                  <div className="row" style={{ marginTop: 8 }}>
                    <button className="ghost" disabled={!pay.bank_ref.trim() || busy === "pn"} onClick={() => act("pn", async () => {
                      const leg = w.money_leg.find((m) => m.ccy === pay.ccy)!;
                      const r = await api.settlementNotice(w.settlement_id, { ccy: pay.ccy, amount_cents: Math.abs(leg.net_cents), direction: "AMR_TO_KZ", bank_ref: pay.bank_ref.trim() });
                      if (r.needs_approval && r.approval_id) {
                        setMsg(`Ödeme talimatı ikinci onay bekliyor (onay no ${r.approval_id}). R10 → bekleyen onaylar ekranından farklı bir kullanıcı onaylamalı.`);
                        throw new Error("ikinci onay bekleniyor");
                      }
                    }, "Ödeme bildirimi gönderildi.").catch(() => {})}>Ödeme bildir (ikinci onay ister)</button>
                    <button className="primary" disabled={busy === "pr"} onClick={() => act("pr", () => api.settlementReceived(w.settlement_id, pay.ccy), `${pay.ccy} ödemesi alındı olarak işaretlendi.`)}>Ödeme alındı</button>
                  </div>
                </div>
              )}
            </section>
          </div>

          <section className="card" style={{ marginBottom: 14 }}>
            <h2>Zaman çizelgesi</h2>
            <table><tbody>{(w.history ?? []).map((h, i) => <tr key={i}><td className="mono small" style={{ whiteSpace: "nowrap" }}>{fmtDT(h.ts)}</td><td className="small"><b>{STL_STATUS_TR[h.status] ?? h.status}</b> {h.note ?? ""}</td></tr>)}</tbody></table>
          </section>
        </>
      )}

      <section className="card">
        <h2>Pencereler</h2>
        <table>
          <thead><tr><th>Açılış</th><th>Pencere</th><th>Tetik</th><th>Durum</th><th className="num">T net</th><th>Para</th><th>Kapanış</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={7} className="small">Pencere yok</td></tr>}
            {items.map((x) => (
              <tr key={x.settlement_id} onClick={() => setSel(x)} style={{ cursor: "pointer", background: sel?.settlement_id === x.settlement_id ? "#f4f5f7" : undefined }}>
                <td className="mono">{fmtDT(x.opened_ts)}</td>
                <td className="mono small">{x.settlement_id}</td>
                <td className="small">{STL_TRIGGER_TR[x.trigger] ?? x.trigger}</td>
                <td><span className={`pill ${x.status === "SETTLED" ? "ok" : x.status === "MISMATCH" ? "bad" : ""}`}>{STL_STATUS_TR[x.status] ?? x.status}</span></td>
                <td className="num mono">{x.gold_leg ? fmtG(x.gold_leg.t_net_mg) : ""}</td>
                <td className="small">{x.money_leg.filter((m) => m.net_cents !== 0).map((m) => `${m.ccy} ${fmtMoney(m.net_cents)}`).join(" · ") || "yok"}</td>
                <td className="mono small">{x.settled_ts ? fmtDT(x.settled_ts) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}
