import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDT, fmtG, fmtMoney, STL_STATUS_TR, STL_TRIGGER_TR, type Settlement, type useLive } from "../api.ts";
import { legs, reconciliation, scopeText, summary, type Leg } from "../settlementFlow.ts";

type Live = ReturnType<typeof useLive>;
const LEG_CHOICES: { key: string; label: string; scope: string[] }[] = [
  { key: "ALL", label: "Tümü (altın + üç kur)", scope: [] },
  { key: "GOLD", label: "Yalnız altın", scope: ["GOLD"] },
  { key: "MONEY", label: "Yalnız para (üç kur)", scope: ["USD", "EUR", "AED"] },
  { key: "USD", label: "Yalnız USD", scope: ["USD"] },
  { key: "EUR", label: "Yalnız EUR", scope: ["EUR"] },
  { key: "AED", label: "Yalnız AED", scope: ["AED"] },
];

/**
 * R8 Mahsuplaşma (Akışlar 12).
 *
 * Ekran tek bir listeye indirgenmiştir: kapatılacak her kalem bir bacaktır (altın, USD, EUR, AED).
 * Her satırda ne kadar, kim borçlu, hangi hâlde ve o an yapılacak tek iş yazar. Üstte tek cümlelik özet,
 * altında mutabakat satırı, sonra bacaklar. Rakamlar ve geçmiş "Ayrıntılar" altındadır.
 */
export function R8Settlement({ live }: { live: Live }) {
  const [items, setItems] = useState<Settlement[]>([]);
  const [open, setOpen] = useState<Settlement | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState("");
  const [sel, setSel] = useState<Settlement | null>(null);
  const [reason, setReason] = useState("");
  const [scope, setScope] = useState("ALL");
  const [bankRef, setBankRef] = useState<Record<string, string>>({});

  const load = () => api.settlements().then((r) => { setItems(r.items); setOpen(r.open); if (sel) setSel(r.items.find((x) => x.settlement_id === sel.settlement_id) ?? null); }).catch((e) => setMsg(`Hata: ${e.message}`));
  useEffect(() => { load(); }, [live.overview?.account.seq]);

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key); setMsg("");
    try { await fn(); setMsg(done); await load(); live.refresh(); }
    catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
    finally { setBusy(""); }
  };

  const w = sel ?? open;
  /** Açık pencere yoksa son pencere gösterilir: ekran boş kalmasın, gün nasıl kapandı görünsün. */
  const shown = w ?? items[0] ?? null;
  const rec = reconciliation(w);
  const rows = legs(w);

  return (
    <div>
      <span className="tag">R8</span>
      <h1>Mahsuplaşma</h1>
      <p className="sub">Gün içinde biriken karşılıklı alacak ve borç kapatılır. Kapatılacak her kalem bir bacaktır: altın ve her kur ayrı. Pencere kesim saatinde talep gelmese de kendiliğinden açılır; gün içinde iki taraf da talep edebilir ve isterse tek bacak seçebilir. Bacakların hepsi kapanınca pencere kapanır.</p>

      {/* ---- tek cümlelik özet ---- */}
      <div className="next" style={{ marginBottom: 14 }}>
        <div>
          <div className="q">{summary(w)}</div>
          <div className="w">{w ? `${w.settlement_id} · ${STL_TRIGGER_TR[w.trigger] ?? w.trigger} · kapsam ${scopeText(w)}` : shown ? `son pencere ${shown.settlement_id} · ${fmtDT(shown.opened_ts)}` : "kesim saatinde kendiliğinden açılır"}</div>
        </div>
        <div className="sp" />
        {!w && (
          <div className="row">
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              {LEG_CHOICES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <input placeholder="gerekçe" value={reason} onChange={(e) => setReason(e.target.value)} style={{ minWidth: 180 }} />
            <button className="primary" disabled={busy === "open"} onClick={() => act("open", () => api.settlementOpen("REQUEST_AMR", reason.trim() || "rafineri talebi", LEG_CHOICES.find((c) => c.key === scope)!.scope), "Pencere açıldı, ekstre çıkarılabilir.")}>Mahsuplaşma talep et</button>
          </div>
        )}
        {w && rec.canDraft && (
          <button className="primary" disabled={busy === "draft"} onClick={() => act("draft", () => api.settlementDraft(w.settlement_id), "Ekstre çıkarıldı ve Kanzasset'e gönderildi.")}>{rec.state === "fark" ? "Ekstreyi yeniden çıkar" : "Ekstreyi çıkar"}</button>
        )}
        {w?.status === "SETTLED" && w.doc_id && (
          <a className="pill accent" href={`/admin/documents/${w.doc_id}/pdf`} target="_blank" rel="noreferrer" style={{ padding: "8px 13px" }}>Mahsuplaşma Ekstresi (PDF)</a>
        )}
      </div>

      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      {/* ---- mutabakat: tek satır, farklar açılır ---- */}
      {w && (
        <section className="card" style={{ marginBottom: 14, borderColor: rec.state === "fark" ? "var(--bad)" : undefined }}>
          <div className="row">
            <h2 style={{ margin: 0 }}>Mutabakat</h2>
            <span className={`pill ${rec.state === "eşit" ? "ok" : rec.state === "fark" ? "bad" : "warn"}`}>{rec.state === "eşit" ? "eşit" : rec.state === "fark" ? "fark var" : rec.state === "bekliyor" ? "Kanzasset karşılaştırıyor" : "ekstre bekleniyor"}</span>
            <span className="small">{rec.text}</span>
          </div>
          {w.diffs && w.diffs.length > 0 && (
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>Alan</th><th className="num">Rafineri</th><th className="num">Kanzasset</th></tr></thead>
              <tbody>{w.diffs.map((d, i) => <tr key={i}><td>{d.field}</td><td className="num mono">{d.amr}</td><td className="num mono">{d.kz}</td></tr>)}</tbody>
            </table>
          )}
          <p className="small" style={{ marginTop: 8 }}>İki ekstre tutmadan hiçbir bacak kapanmaz: önce kalemler düzeltilir, ekstre yeniden çıkarılır.</p>
        </section>
      )}

      {/* ---- bacaklar: her satırda tek iş ---- */}
      {w && (
        <section className="card" style={{ marginBottom: 14 }}>
          <h2>Bacaklar</h2>
          <table>
            <thead><tr><th>Bacak</th><th className="num">Tutar</th><th>Kim borçlu</th><th>Durum</th><th>Şu an</th><th /></tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="small">Ekstre çıkınca bacaklar belirir.</td></tr>}
              {rows.map((l) => (
                <tr key={l.key}>
                  <td><b>{l.label}</b></td>
                  <td className="num mono">{l.amount}</td>
                  <td className="small">{l.who}</td>
                  <td><StatePill l={l} /></td>
                  <td className="small">{l.note}</td>
                  <td>
                    <div className="row" style={{ justifyContent: "flex-end" }}>
                      {l.action === "gold-propose" && (
                        <button className="primary" disabled={busy === "gp"} onClick={() => act("gp", () => api.settlementProposeGold(w.settlement_id), "Teklif gönderildi: Kanzasset onaylayınca kasa girişi talebi gelir.")}>{l.actionLabel}</button>
                      )}
                      {l.action === "gold-accept-info" && <Link to="/kasa"><button className="ghost">{l.actionLabel}</button></Link>}
                      {l.action === "pay-notice" && (
                        <>
                          <input placeholder="banka referansı" value={bankRef[l.ccy!] ?? ""} onChange={(e) => setBankRef({ ...bankRef, [l.ccy!]: e.target.value })} style={{ width: 150 }} />
                          <button className="primary" disabled={!(bankRef[l.ccy!] ?? "").trim() || busy === `pn${l.ccy}`} onClick={() => act(`pn${l.ccy}`, async () => {
                            const leg = w.money_leg.find((m) => m.ccy === l.ccy)!;
                            const r = await api.settlementNotice(w.settlement_id, { ccy: leg.ccy, amount_cents: Math.abs(leg.net_cents), direction: "AMR_TO_KZ", bank_ref: (bankRef[l.ccy!] ?? "").trim() });
                            if (r.needs_approval && r.approval_id) setMsg(`Ödeme talimatı ikinci onay bekliyor (onay ${r.approval_id}). R11 Ayarlar ekranından farklı bir kullanıcı onaylar.`);
                          }, "Ödeme bildirimi gönderildi.")}>{l.actionLabel}</button>
                        </>
                      )}
                      {l.action === "pay-received" && (
                        <button className="primary" disabled={busy === `pr${l.ccy}`} onClick={() => act(`pr${l.ccy}`, () => api.settlementReceived(w.settlement_id, l.ccy!), `${l.ccy} ödemesi alındı olarak işlendi.`)}>{l.actionLabel}</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="small" style={{ marginTop: 8 }}>
            Altın bacağının sırası sabittir. Rafineri gram borçluysa "kasaya koyalım mı" diye teklif eder, Kanzasset onaylar, kasa girişi talebi gelir, Kasa Giriş Fişi kesilir. Kanzasset gram borçluysa talebi o gönderir: rafineri kendi başına kasadan gram çıkaramaz.
          </p>
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
                <span className="k">Kapsam</span><span>{scopeText(shown)}</span>
                <span className="k">Aralık</span><span className="mono small">{fmtDT(shown.window_from)} → {fmtDT(shown.window_to)}</span>
                <span className="k">İşlem sayısı</span><span>{shown.statement?.movements.length ?? 0}</span>
                <span className="k">Ekstre özeti</span><span className="mono small" style={{ wordBreak: "break-all" }}>{shown.statement_hash?.slice(0, 24) ?? ""}…</span>
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
                  <span className="k">Yön</span><span>{shown.gold_leg.direction === "VAULT_IN" ? "kasa girişi (rafineri borçlu)" : shown.gold_leg.direction === "VAULT_OUT" ? "kasa çıkışı (Kanzasset borçlu)" : "yok"}</span>
                  <span className="k">Teklif</span><span className="mono small">{shown.gold_leg.proposed_ts ? fmtDT(shown.gold_leg.proposed_ts) : "yok"}</span>
                  <span className="k">Onay</span><span className="mono small">{shown.gold_leg.approved_ts ? fmtDT(shown.gold_leg.approved_ts) : "bekliyor"}</span>
                  <span className="k">Talimatlar</span><span className="mono small">{shown.gold_leg.requests.join(", ") || "bekleniyor"}</span>
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
            </div>
          </div>
          <h2 style={{ marginTop: 14 }}>Zaman çizelgesi</h2>
          <table><tbody>{(shown.history ?? []).map((h, i) => <tr key={i}><td className="mono small" style={{ whiteSpace: "nowrap" }}>{fmtDT(h.ts)}</td><td className="small">{STL_STATUS_TR[h.status] ?? h.status}</td><td className="small">{h.note ?? ""}</td></tr>)}</tbody></table>
        </details>
      )}

      <section className="card">
        <h2>Pencereler</h2>
        <table>
          <thead><tr><th>Açılış</th><th>Pencere</th><th>Tetik</th><th>Kapsam</th><th>Durum</th><th className="num">T net</th><th>Para</th><th>Kapanış</th></tr></thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={8} className="small">Pencere yok</td></tr>}
            {items.map((x) => (
              <tr key={x.settlement_id} onClick={() => setSel(x.settlement_id === sel?.settlement_id ? null : x)} style={{ cursor: "pointer", background: sel?.settlement_id === x.settlement_id ? "var(--sel)" : undefined }}>
                <td className="mono">{fmtDT(x.opened_ts)}</td>
                <td className="mono small">{x.settlement_id}</td>
                <td className="small">{STL_TRIGGER_TR[x.trigger] ?? x.trigger}</td>
                <td className="small">{scopeText(x)}</td>
                <td><span className={`pill ${x.status === "SETTLED" ? "ok" : x.status === "MISMATCH" ? "bad" : "warn"}`}>{STL_STATUS_TR[x.status] ?? x.status}</span></td>
                <td className="num mono">{x.gold_leg ? fmtG(x.gold_leg.t_net_mg) : ""}</td>
                <td className="small">{x.money_leg.filter((m) => m.net_cents !== 0).map((m) => `${m.ccy} ${fmtMoney(m.net_cents)}`).join(" · ") || "yok"}</td>
                <td className="mono small">{x.settled_ts ? fmtDT(x.settled_ts) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="small" style={{ marginTop: 6 }}>Satıra tıklayınca o pencerenin bacakları yukarıda görünür; tekrar tıklayınca açık pencereye dönülür.</div>
      </section>
    </div>
  );
}

function StatePill({ l }: { l: Leg }) {
  const cls = l.state === "kapandı" ? "ok" : l.state === "sizde" ? "warn" : l.state === "karşıda" ? "" : "neut";
  const text = l.state === "sizde" ? "sizde" : l.state === "karşıda" ? "Kanzasset'te" : l.state;
  return <span className={`pill ${cls}`}>{text}</span>;
}
