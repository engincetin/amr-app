import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDT, fmtG, fmtMoney, MOVE_TR, type CurrentAccount, type Settlement, type useLive } from "../api.ts";
import { Pager, usePager } from "../components/Pager.tsx";

type Live = ReturnType<typeof useLive>;

/** R5 Cari hesap: gün içi karşılıklı alacak borç (altın + kur bazında para), limit göstergeleri, mahsuplaşma çağır. */
export function R5CurrentAccount({ live }: { live: Live }) {
  const [data, setData] = useState<CurrentAccount | null>(null);
  const [stl, setStl] = useState<Settlement | null>(null);
  const load = () => {
    api.currentAccount(300).then(setData).catch(console.warn);
    api.settlements().then((r) => setStl(r.open ?? r.items[0] ?? null)).catch(() => {});
  };
  useEffect(() => { load(); }, [live.overview?.account.seq, live.version]);

  const acc = data?.account ?? live.overview?.account;
  const lim = data?.limit ?? live.overview?.limit;
  const T = acc?.current_account.gold_mg ?? 0;
  const gold = lim?.gold;

  /** Kanzasset ile eşleşme: son mahsuplaşma penceresinin mutabakat sonucu. */
  const match = (() => {
    const w = stl;
    if (!w) return { state: "yok", label: "pencere yok", note: "mutabakat mahsuplaşma penceresinde yapılır; gün içinde karşılaştırma her hareketin bakiye bilgisiyle sürer." };
    if (w.status === "MISMATCH") return { state: "fark", label: "fark var", note: `${w.settlement_id}: ${w.diffs?.length ?? 0} satırda fark, ödeme yapılmaz.` };
    if (w.status === "SETTLED") return { state: "eşit", label: "eşit", note: `${w.settlement_id} kapandı: iki ekstre birebir tutmuştu.` };
    if (w.status === "OPEN" || w.status === "DRAFT" || w.status === "REQUESTED") return { state: "bekliyor", label: "bekliyor", note: `${w.settlement_id} açık: Kanzasset ekstreyi karşılaştırıyor.` };
    return { state: "eşit", label: "eşit", note: `${w.settlement_id}: iki ekstre birebir eşit, bacaklar kapanıyor.` };
  })();
  const pMov = usePager(data?.movements ?? [], 10);
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

      <section className="card" style={{ marginBottom: 14 }}>
        <div className="row" style={{ alignItems: "baseline" }}>
          <h2 style={{ margin: 0 }}>Kanzasset ile mutabakat</h2>
          <span className={`pill ${match.state === "eşit" ? "ok" : match.state === "fark" ? "bad" : ""}`}>{match.label}</span>
          <span className="small">{match.note}</span>
          <span className="sp" />
          <Link to="/mahsuplasma"><button className="ghost">Mahsuplaşmaya git</button></Link>
        </div>
        <div className="small" style={{ marginTop: 8 }}>
          Hesap durumu <span className={`pill ${acc?.status === "OK" ? "ok" : "bad"}`}>{acc?.status ?? ""}</span> · bakiye sırası {acc?.seq ?? 0} · limit uyarı eşiği %{live.overview?.settings["limit.warn_pct"] ?? "80"} · en yüksek kullanım %{lim ? (lim.max_pct * 100).toFixed(1) : "0,0"}.
          Limit dolarsa yeni emir CURRENT_ACCOUNT_LIMIT ile reddedilir ve mahsuplaşma çağrılır. Kanzasset her harekette kendi kaydını bu bakiye bilgisiyle karşılaştırır; fark çıkarsa iki taraf da durur.
        </div>
      </section>

      <section className="card">
        <h2>Hareketler</h2>
        <table className="wide">
          <thead><tr><th className="num">Sıra</th><th>Zaman</th><th>Tür</th><th className="num">Altın (g)</th><th>Kur</th><th className="num">Para</th><th>Referans</th></tr></thead>
          <tbody>
            {(data?.movements ?? []).length === 0 && <tr><td colSpan={7} className="small">Hareket yok</td></tr>}
            {pMov.slice.map((m) => (
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
        <Pager p={pMov} label="Hareketler" />
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
