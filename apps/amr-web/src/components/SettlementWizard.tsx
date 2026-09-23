import { useMemo, useState } from "react";

/**
 * Mahsuplaşma sihirbazı.
 *
 * Mahsuplaşma tek düğmeye sığmaz: önce neyin kapanacağı görülür, sonra ne kadarının kapanacağı
 * girilir, en sonda gerekçeyle onaylanır. Üç adım da aynı pencerededir; her adımda yalnız o adımın
 * sorusu vardır. Aynı bileşenin karşılığı Kanzasset panelinde de durur.
 */

export interface Position {
  /** Bacak anahtarı: GOLD · USD · EUR · AED */
  key: string;
  label: string;
  /** İşaretli net: artı = karşı taraf borçlu, eksi = biz borçluyuz. */
  net: number;
  /** "g" ya da kur kodu. */
  unit: string;
  /** Kim borçlu, tek satır. */
  who: string;
}

export interface WizardResult {
  scope: string[];
  amounts: { gold_mg?: number; money?: { ccy: string; cents: number }[] };
  reason: string;
}

const g = (mg: number) => (mg / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const money = (c: number) => (c / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** Bacağın tutarı ekranda: altın gram, para kur birimi. */
export const fmtLeg = (p: Position, v: number) => (p.key === "GOLD" ? `${g(v)} g` : `${money(v)} ${p.unit}`);
/** Ekrandaki metni tam sayıya çevirir (gram → mg, para → cent). */
const parseAmount = (key: string, text: string) => {
  const n = Number(String(text).replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0) return NaN;
  return Math.round(n * (key === "GOLD" ? 1000 : 100));
};
const toText = (key: string, v: number) => (key === "GOLD" ? g(v) : money(v));

export function SettlementWizard({ positions, onClose, onStart, busy, side }: {
  positions: Position[];
  onClose: () => void;
  onStart: (r: WizardResult) => void;
  busy: boolean;
  /** Karşı tarafın adı: metinlerde geçer. */
  side: string;
}) {
  const [step, setStep] = useState(1);
  const open = useMemo(() => positions.filter((p) => p.net !== 0), [positions]);
  const [picked, setPicked] = useState<string[]>(open.map((p) => p.key));
  const [amounts, setAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(open.map((p) => [p.key, toText(p.key, Math.abs(p.net))])));
  const [reason, setReason] = useState("");

  const chosen = open.filter((p) => picked.includes(p.key));
  const value = (p: Position) => parseAmount(p.key, amounts[p.key] ?? "");
  const bad = chosen.filter((p) => { const v = value(p); return !Number.isFinite(v) || v <= 0 || v > Math.abs(p.net); });
  const partial = chosen.filter((p) => Number.isFinite(value(p)) && value(p) < Math.abs(p.net));

  const start = () => {
    const goldPos = chosen.find((p) => p.key === "GOLD");
    onStart({
      scope: chosen.map((p) => p.key),
      amounts: {
        ...(goldPos ? { gold_mg: value(goldPos) } : {}),
        money: chosen.filter((p) => p.key !== "GOLD").map((p) => ({ ccy: p.key, cents: value(p) })),
      },
      reason: reason.trim(),
    });
  };

  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ alignItems: "baseline" }}>
          <h3 style={{ margin: 0 }}>Mahsuplaşma sihirbazı</h3>
          <span className="sp" />
          <span className="small">adım {step} / 3</span>
        </div>

        {open.length === 0 && (
          <>
            <p className="small" style={{ marginTop: 10 }}>Kapatılacak kalem yok: altın ve üç kurun hepsi sıfır. Mahsuplaşacak bir şey olmadan pencere açmaya gerek yoktur.</p>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}><button onClick={onClose}>Kapat</button></div>
          </>
        )}

        {open.length > 0 && step === 1 && (
          <>
            <p className="small" style={{ marginTop: 10 }}>Neyi kapatıyoruz? Kapatılacak her kalem bir bacaktır. İşaretlemediğiniz bacaklar dokunulmadan kalır ve bir sonraki pencereye girer.</p>
            <table>
              <thead><tr><th /><th>Bacak</th><th className="num">Tutar</th><th>Kim borçlu</th></tr></thead>
              <tbody>
                {open.map((p) => (
                  <tr key={p.key} onClick={() => setPicked(picked.includes(p.key) ? picked.filter((x) => x !== p.key) : [...picked, p.key])} style={{ cursor: "pointer" }}>
                    <td><input type="checkbox" checked={picked.includes(p.key)} readOnly /></td>
                    <td><b>{p.label}</b></td>
                    <td className="num mono">{fmtLeg(p, Math.abs(p.net))}</td>
                    <td className="small">{p.who}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={onClose}>Vazgeç</button>
              <button className="primary" disabled={chosen.length === 0} onClick={() => setStep(2)}>Devam</button>
            </div>
          </>
        )}

        {open.length > 0 && step === 2 && (
          <>
            <p className="small" style={{ marginTop: 10 }}>Ne kadarını kapatıyoruz? Varsayılan tamamıdır. Daha azını girerseniz kalanı cari hesapta durur ve sonraki pencereye kalır.</p>
            <table>
              <thead><tr><th>Bacak</th><th className="num">Tamamı</th><th>Kapatılacak</th><th /></tr></thead>
              <tbody>
                {chosen.map((p) => {
                  const v = value(p);
                  const err = !Number.isFinite(v) || v <= 0 || v > Math.abs(p.net);
                  return (
                    <tr key={p.key}>
                      <td><b>{p.label}</b><div className="small">{p.who}</div></td>
                      <td className="num mono">{fmtLeg(p, Math.abs(p.net))}</td>
                      <td>
                        <input className="mono" style={{ width: 150, borderColor: err ? "var(--bad)" : undefined }} value={amounts[p.key] ?? ""}
                          onChange={(e) => setAmounts({ ...amounts, [p.key]: e.target.value })} />
                        <span className="small"> {p.key === "GOLD" ? "g" : p.unit}</span>
                      </td>
                      <td><button className="ghost" onClick={() => setAmounts({ ...amounts, [p.key]: toText(p.key, Math.abs(p.net)) })}>Tamamı</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {bad.length > 0 && <div className="small" style={{ color: "var(--bad)", marginTop: 8 }}>Tutar sıfırdan büyük ve bacağın tamamından küçük ya da ona eşit olmalı.</div>}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={() => setStep(1)}>Geri</button>
              <button className="primary" disabled={bad.length > 0} onClick={() => setStep(3)}>Devam</button>
            </div>
          </>
        )}

        {open.length > 0 && step === 3 && (
          <>
            <p className="small" style={{ marginTop: 10 }}>Özet ve gerekçe. Pencere açılınca {side} tarafına bildirim düşer, iki taraf ekstresini çıkarır ve mutabakat olmadan hiçbir bacak kapanmaz.</p>
            <div className="kv">
              {chosen.map((p) => (
                <span key={p.key} style={{ display: "contents" }}>
                  <span className="k">{p.label}</span>
                  <span className="mono">{fmtLeg(p, value(p))}{value(p) < Math.abs(p.net) ? <span className="small"> (tamamı {fmtLeg(p, Math.abs(p.net))}, kalanı sonraki pencereye)</span> : null} · {p.who}</span>
                </span>
              ))}
              <span className="k">Kapsam dışı</span>
              <span className="small">{positions.filter((p) => !picked.includes(p.key)).map((p) => p.label).join(", ") || "yok"}</span>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <input className="wide" placeholder="gerekçe (ör. gün sonu, limit yaklaştı, karşı taraf istedi)" value={reason} onChange={(e) => setReason(e.target.value)} />
            </div>
            {partial.length > 0 && <div className="small" style={{ marginTop: 8 }}>Kısmi kapatma: {partial.map((p) => p.label).join(", ")}. Kalan tutar cari hesapta görünmeye devam eder.</div>}
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
              <button onClick={() => setStep(2)}>Geri</button>
              <button className="primary" disabled={busy} onClick={start}>Mahsuplaşmayı başlat</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Ekranın tepesindeki alacak verecek durumu.
 * Kasa hesabındaki durum şeridinin karşılığı: pencere olsun olmasın, kapanmayı bekleyen
 * kalemler burada durur. Mahsuplaşmanın kendisi değil, sebebi görünür.
 */
export function PositionBand({ positions, note }: { positions: Position[]; note: string }) {
  const open = positions.filter((p) => p.net !== 0);
  return (
    <section className="card" style={{ marginBottom: 14 }}>
      <div className="row" style={{ alignItems: "baseline" }}>
        <h2 style={{ margin: 0 }}>Alacak verecek durumu</h2>
        <span className="small">{open.length === 0 ? "kapanacak kalem yok, hesap temiz" : `${open.length} kalem kapanmayı bekliyor`}</span>
      </div>
      <div className="grid c4" style={{ marginTop: 10 }}>
        {positions.map((p) => (
          <div key={p.key} className="kpi" style={{ opacity: p.net === 0 ? 0.55 : 1 }}>
            <h2>{p.label}</h2>
            <div className="n">{p.net > 0 ? "+" : ""}{fmtLeg(p, p.net)}</div>
            <div className="small">{p.who}</div>
          </div>
        ))}
      </div>
      <p className="small" style={{ marginTop: 8 }}>{note}</p>
    </section>
  );
}
