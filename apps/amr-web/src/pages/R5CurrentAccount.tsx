import { useEffect, useState } from "react";
import { api, fmtDT, fmtG, fmtMoney, MOVE_TR, type CurrentAccount, type useLive } from "../api.ts";

type Live = ReturnType<typeof useLive>;

/** R5 Cari hesap: gün içi karşılıklı alacak borç (altın + kur bazında para), limit göstergeleri, mahsuplaşma çağır. */
export function R5CurrentAccount({ live }: { live: Live }) {
  const [data, setData] = useState<CurrentAccount | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const load = () => api.currentAccount(300).then(setData).catch(console.warn);
  useEffect(() => { load(); }, [live.overview?.account.seq]);

  const acc = data?.account ?? live.overview?.account;
  const lim = data?.limit ?? live.overview?.limit;
  const T = acc?.current_account.gold_mg ?? 0;
  const gold = lim?.gold;

  const call = async () => {
    setBusy(true); setMsg("");
    try { await api.requestSettlement(reason.trim()); setMsg("Mahsuplaşma talebi Kanzasset'e gönderildi (settlement.requested)."); setReason(""); }
    catch (e) { setMsg(`Hata: ${(e as Error).message}`); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <span className="tag">R5</span>
      <h1>Cari hesap</h1>
      <p className="sub">İki taraf arasında gün içinde biriken karşılıklı alacak ve borç. Altın: T (artı = Kanzasset aldı, henüz kasaya konmadı; eksi = sattı, henüz kasadan çıkmadı). Para: kur bazında (eksi = Kanzasset borçlu, artı = rafineri borçlu). Kesim saatinde ya da talep üzerine mahsuplaşmada kapanır. Limit aşılırsa yeni emir reddedilir.</p>

      <div className="grid c3" style={{ marginBottom: 14 }}>
        <div className="card">
          <h2>Altın (T)</h2>
          <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{T >= 0 ? "+" : ""}{fmtG(T)} g</div>
          <div className="small">{T > 0 ? "Kanzasset'in alacağı gram: kasa girişiyle kapanır" : T < 0 ? "Kanzasset'in borçlu olduğu gram: kasa çıkışıyla kapanır" : "kapalı"}</div>
          {gold && <Bar pct={gold.pct} text={`limit ${fmtG(gold.limit_mg)} g · kullanım %${(gold.pct * 100).toFixed(1)}`} />}
        </div>
        {acc?.current_account.money.map((m) => {
          const l = lim?.money.find((x) => x.ccy === m.ccy);
          return (
            <div className="card" key={m.ccy}>
              <h2>Para · {m.ccy}</h2>
              <div className="mono" style={{ fontSize: 22, fontWeight: 600 }}>{m.cents > 0 ? "+" : ""}{fmtMoney(m.cents)}</div>
              <div className="small">{m.cents < 0 ? "Kanzasset borçlu (alışlar)" : m.cents > 0 ? "rafineri borçlu (satışlar)" : "kapalı"}</div>
              {l && <Bar pct={l.pct} text={`limit ${fmtMoney(l.limit_cents)} · kullanım %${(l.pct * 100).toFixed(1)}`} />}
            </div>
          );
        })}
      </div>

      <div className="grid c2" style={{ marginBottom: 14 }}>
        <section className="card">
          <h2>Mahsuplaşma çağır</h2>
          <p className="small">Kesim saati beklenmeden pencereyi açar; Kanzasset'e bildirim düşer, iki taraf ekstre hazırlar. Gerekçe: talep ya da limit. Pencere mantığı R8'de (Sprint 5).</p>
          <div className="row">
            <input className="wide" placeholder="gerekçe (zorunlu)" value={reason} onChange={(e) => setReason(e.target.value)} />
            <button className="primary" disabled={busy || !reason.trim()} onClick={call}>Mahsuplaşma çağır</button>
          </div>
          {msg && <div className="small" style={{ marginTop: 8 }}>{msg}</div>}
        </section>
        <section className="card">
          <h2>Limit durumu</h2>
          <div className="kv">
            <span className="k">En yüksek kullanım</span><span className="mono">%{lim ? (lim.max_pct * 100).toFixed(1) : "0,0"}</span>
            <span className="k">Uyarı eşiği</span><span>%{live.overview?.settings["limit.warn_pct"] ?? "80"} (bildirim)</span>
            <span className="k">Limitte</span><span>yeni emir CURRENT_ACCOUNT_LIMIT ile reddedilir; mahsuplaşma çağrılır</span>
            <span className="k">Hesap durumu</span><span><span className={`pill ${acc?.status === "OK" ? "ok" : "bad"}`}>{acc?.status ?? ""}</span> · seq {acc?.seq ?? 0}</span>
          </div>
        </section>
      </div>

      <section className="card">
        <h2>Hareketler</h2>
        <table>
          <thead><tr><th className="num">seq</th><th>Zaman</th><th>Tür</th><th className="num">Altın (g)</th><th>Kur</th><th className="num">Para</th><th>Referans</th></tr></thead>
          <tbody>
            {(data?.movements ?? []).length === 0 && <tr><td colSpan={7} className="small">Hareket yok</td></tr>}
            {data?.movements.map((m) => (
              <tr key={m.id}>
                <td className="num">{m.seq}</td><td className="mono">{fmtDT(m.ts)}</td><td>{MOVE_TR[m.type] ?? m.type}</td>
                <td className="num">{m.gold_mg ? `${m.gold_mg > 0 ? "+" : ""}${fmtG(m.gold_mg)}` : ""}</td>
                <td>{m.ccy ?? ""}</td>
                <td className="num">{m.amount_cents !== undefined && m.amount_cents !== null ? `${m.amount_cents > 0 ? "+" : ""}${fmtMoney(m.amount_cents)}` : ""}</td>
                <td className="mono small">{m.ref ?? ""}{m.related_id && m.related_id !== m.ref ? ` · ${m.related_id}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function Bar({ pct, text }: { pct: number; text: string }) {
  const p = Math.min(100, Math.round(pct * 1000) / 10);
  const color = pct >= 1 ? "var(--bad)" : pct >= 0.8 ? "var(--warn)" : "var(--ok)";
  return (
    <div style={{ marginTop: 8 }}>
      <div style={{ height: 6, background: "var(--soft2)", borderRadius: 99 }}><div style={{ width: `${p}%`, height: 6, background: color, borderRadius: 99 }} /></div>
      <div className="small" style={{ marginTop: 4 }}>{text}</div>
    </div>
  );
}
