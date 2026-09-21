import { useEffect, useState } from "react";
import { api, type AuditRow, type useLive } from "../api.ts";

type Live = ReturnType<typeof useLive>;

const LABELS: Record<string, string> = {
  "source.url": "Merkez fiyat soketi adresi",
  "settlement.cutoff_local": "Mahsuplaşma kesim saati (otomatik başlar)",
  "settlement.timezone": "Kesim saat dilimi",
  "settlement.windows_per_day": "Günlük mahsuplaşma penceresi sayısı",
  "vault.accept_mode": "Kasa talimatı kabulü (MANUAL elle / AUTO otomatik)",
  "vault.accept_target_minutes": "Kasa talimatı hedef cevap süresi (dk)",
  "vault.placement_due_days": "Kasaya koyma vadesi (gün, T+n)",
  "limit.current_account_gold_mg": "Cari hesap limiti, altın (mg)",
  "limit.current_account_usd_cents": "Cari hesap limiti, para (USD cent karşılığı)",
  "quote.delivery_valid_hours": "Lojistik teklifi geçerlilik (saat)",
  "quote.refining_valid_hours": "Rafinasyon teklifi geçerlilik (saat)",
  "publish.manual_halt": "Yayın elle durduruldu (1 / 0)",
  "publish.halt_reason": "Yayın durdurma gerekçesi",
};

export function R10Settings({ live }: { live: Live }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const load = async () => { setForm(await api.settings()); setAudit(await api.audit()); };
  useEffect(() => { load(); }, [live.overview?.ts]);

  const editable = Object.keys(LABELS).filter((k) => !k.startsWith("publish."));
  return (
    <div>
      <span className="tag">R10</span>
      <h1>Ayarlar ve kullanıcılar</h1>
      <p className="sub">Parametreler kod değil, buradan girilir. Sprint 1: parametre listesi ve denetim günlüğü. Kullanıcılar, roller, API istemcileri ve ikinci onay sonraki sprintlerde.</p>
      <div className="grid c2">
        <section className="card">
          <h2>Parametreler</h2>
          <div className="kv" style={{ gridTemplateColumns: "1fr 1fr" }}>
            {editable.map((k) => (
              <div key={k} style={{ display: "contents" }}>
                <label className="k" style={{ alignSelf: "center" }}>{LABELS[k]}<div className="small mono">{k}</div></label>
                <input className="mono" value={form[k] ?? ""} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 12, justifyContent: "flex-end" }}>
            <button className="primary" onClick={async () => { await api.saveSettings(Object.fromEntries(editable.map((k) => [k, form[k] ?? ""]))); setMsg("Kaydedildi, denetim günlüğüne yazıldı."); await load(); live.refresh(); setTimeout(() => setMsg(null), 2500); }}>Kaydet</button>
          </div>
        </section>
        <section className="card">
          <h2>Denetim günlüğü</h2>
          <table>
            <thead><tr><th>Zaman</th><th>Kim</th><th>Ne</th><th>Ayrıntı</th></tr></thead>
            <tbody>
              {audit.length === 0 && <tr><td colSpan={4} className="small">Kayıt yok</td></tr>}
              {audit.map((a) => (
                <tr key={a.id}><td className="mono small">{new Date(a.ts).toLocaleString("tr-TR")}</td><td>{a.actor}</td><td className="mono">{a.action}</td><td className="small mono" style={{ maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.after ?? a.before ?? ""}</td></tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}
