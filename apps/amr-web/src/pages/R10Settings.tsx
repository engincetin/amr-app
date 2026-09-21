import { useEffect, useState } from "react";
import { api, fmtDT, type ApiClientRow, type AuditRow, type UsersView, type useLive } from "../api.ts";

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
  "limit.warn_pct": "Limit uyarı eşiği (%)",
  "order.quote_max_age_ms": "quote_seq tazelik sınırı (ms)",
  "quote.delivery_valid_hours": "Lojistik teklifi geçerlilik (saat)",
  "quote.refining_valid_hours": "Rafinasyon teklifi geçerlilik (saat)",
  "debug.order_delay_ms": "Demo: emir kararı gecikmesi (ms)",
};

/**
 * R10 Ayarlar ve kullanıcılar.
 * Parametreler koddan değil buradan girilir ve kritik olanlar ikinci onay ister.
 * Kullanıcılar ve roller, API istemcileri, bekleyen onaylar ve denetim günlüğü burada.
 */
export function R10Settings({ live }: { live: Live }) {
  const [form, setForm] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [users, setUsers] = useState<UsersView | null>(null);
  const [clients, setClients] = useState<ApiClientRow[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [newUser, setNewUser] = useState({ username: "", display_name: "", role: "KASA" });
  const [newClient, setNewClient] = useState({ name: "Kanzasset FZCO", event_url: "http://localhost:5000/api/events" });
  const [approver, setApprover] = useState("masa");

  const load = async () => {
    setForm(await api.settings());
    setAudit(await api.audit());
    try { setUsers(await api.users()); setClients(await api.clients()); } catch { /* yetki yoksa boş kalır */ }
  };
  useEffect(() => { load(); }, [live.overview?.ts]);

  const editable = Object.keys(LABELS);
  const say = (t: string) => { setMsg(t); setTimeout(() => setMsg(null), 6000); };

  return (
    <div>
      <span className="tag">R10</span>
      <h1>Ayarlar ve kullanıcılar</h1>
      <p className="sub">Parametreler kod değil, buradan girilir. Kritik değişiklikler (parametreler, API anahtarı, ödeme talimatı) ikinci onay ister: bir kullanıcı ister, başka bir kullanıcı onaylar. Her elle aksiyon denetim günlüğüne yazılır. Demoda aktif kullanıcı üst şeritten seçilir; ekranlardaki düğmeler rolüne göre çalışır.</p>

      {msg && <div className="note" style={{ marginBottom: 12 }}>{msg}</div>}

      <div className="grid c2" style={{ marginBottom: 14 }}>
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
            <button className="primary" onClick={async () => {
              try {
                const r = await api.saveSettings(Object.fromEntries(editable.map((k) => [k, form[k] ?? ""]))) as any;
                if (r?.needs_approval) say(`Parametre değişikliği ikinci onay bekliyor (onay no ${r.approval_id}). Aşağıdan farklı bir kullanıcı onaylamalı.`);
                else say("Kaydedildi, denetim günlüğüne yazıldı.");
                await load(); live.refresh();
              } catch (e) { say(`Hata: ${(e as Error).message}`); }
            }}>Kaydet (ikinci onay ister)</button>
          </div>
        </section>

        <section className="card">
          <h2>Bekleyen onaylar</h2>
          <p className="small">Kritik aksiyonlar iki kişi ister. İsteyen kullanıcı kendi isteğini onaylayamaz.</p>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="small">Onaylayan:</span>
            <input value={approver} onChange={(e) => setApprover(e.target.value)} />
          </div>
          <table>
            <thead><tr><th>No</th><th>Aksiyon</th><th>İsteyen</th><th>Zaman</th><th>Aksiyon</th></tr></thead>
            <tbody>
              {(users?.pending_approvals.length ?? 0) === 0 && <tr><td colSpan={5} className="small">Bekleyen onay yok</td></tr>}
              {users?.pending_approvals.map((a) => (
                <tr key={a.id}>
                  <td className="mono">{a.id}</td>
                  <td className="small">{a.action}<br /><span className="mono small">{a.payload.slice(0, 80)}</span></td>
                  <td>{a.requested_by}</td>
                  <td className="mono small">{fmtDT(a.requested_ts)}</td>
                  <td>
                    <div className="row">
                      <button className="primary" onClick={async () => {
                        try { await api.approve(a.id, approver.trim()); say(`Onay ${a.id} verildi. Aksiyonu tekrar çalıştırın ya da ilgili ekrandan devam edin.`); await load(); }
                        catch (e) { say(`Hata: ${(e as Error).message}`); }
                      }}>Onayla</button>
                      <button className="ghost" onClick={async () => { await api.rejectApproval(a.id); await load(); }}>Reddet</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>

      <div className="grid c2" style={{ marginBottom: 14 }}>
        <section className="card">
          <h2>Kullanıcılar ve roller</h2>
          <table>
            <thead><tr><th>Kullanıcı</th><th>Ad</th><th>Rol</th><th>Durum</th><th>Aksiyon</th></tr></thead>
            <tbody>
              {users?.items.map((u) => (
                <tr key={u.username}>
                  <td className="mono">{u.username}</td>
                  <td>{u.display_name}</td>
                  <td>
                    <select value={u.role} onChange={async (e) => { await api.userSave({ username: u.username, role: e.target.value }); say(`${u.username}: rol değişti.`); await load(); }}>
                      {users.roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
                    </select>
                  </td>
                  <td><span className={`pill ${u.active ? "ok" : ""}`}>{u.active ? "aktif" : "pasif"}</span></td>
                  <td><button className="ghost" onClick={async () => { await api.userSave({ username: u.username, active: !u.active }); await load(); }}>{u.active ? "Pasife al" : "Aktifleştir"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <input placeholder="kullanıcı adı" value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} />
            <input placeholder="görünen ad" value={newUser.display_name} onChange={(e) => setNewUser({ ...newUser, display_name: e.target.value })} />
            <select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}>
              {users?.roles.map((r) => <option key={r.code} value={r.code}>{r.name}</option>)}
            </select>
            <button className="primary" disabled={!newUser.username.trim()} onClick={async () => {
              try { await api.userSave(newUser); setNewUser({ username: "", display_name: "", role: "KASA" }); say("Kullanıcı eklendi."); await load(); }
              catch (e) { say(`Hata: ${(e as Error).message}`); }
            }}>Ekle</button>
          </div>
        </section>

        <section className="card">
          <h2>Roller ve yetkiler</h2>
          <table>
            <thead><tr><th>Rol</th><th>Yapabildikleri</th></tr></thead>
            <tbody>
              {users?.roles.map((r) => (
                <tr key={r.code}>
                  <td><b>{r.name}</b></td>
                  <td className="small">{r.permissions.length ? r.permissions.join(", ") : "salt okunur"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="small" style={{ marginTop: 8 }}>İkinci onay isteyen aksiyonlar: {users?.second_approval.join(", ")}</div>
        </section>
      </div>

      <div className="grid c2">
        <section className="card">
          <h2>API istemcileri</h2>
          <p className="small">Kanzasset'in anahtarı ve imza sırrı. Anahtar üretimi ikinci onay ister; sır yalnız üretim anında bir kez gösterilir.</p>
          <table>
            <thead><tr><th>Anahtar</th><th>Ad</th><th>Olay adresi</th><th>Durum</th><th></th></tr></thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.api_key}>
                  <td className="mono small">{c.api_key}</td>
                  <td>{c.name}</td>
                  <td className="mono small">{c.event_url ?? ""}</td>
                  <td><span className={`pill ${c.active ? "ok" : "bad"}`}>{c.active ? "aktif" : "iptal"}</span></td>
                  <td>{c.active === 1 && <button className="ghost" onClick={async () => { await api.clientRevoke(c.api_key); say("Anahtar iptal edildi."); await load(); }}>İptal et</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 10 }}>
            <input placeholder="istemci adı" value={newClient.name} onChange={(e) => setNewClient({ ...newClient, name: e.target.value })} />
            <input placeholder="olay adresi" value={newClient.event_url} onChange={(e) => setNewClient({ ...newClient, event_url: e.target.value })} />
            <button className="primary" onClick={async () => {
              try {
                const r = await api.clientCreate(newClient);
                if (r.needs_approval) say(`Anahtar üretimi ikinci onay bekliyor (onay no ${r.approval_id}).`);
                else say(`Anahtar üretildi: ${r.api_key} · sır: ${r.secret} (bir daha gösterilmez)`);
                await load();
              } catch (e) { say(`Hata: ${(e as Error).message}`); }
            }}>Anahtar üret</button>
          </div>
        </section>

        <section className="card">
          <h2>Denetim günlüğü</h2>
          <table>
            <thead><tr><th>Zaman</th><th>Kim</th><th>Ne</th><th>Önce / sonra</th></tr></thead>
            <tbody>
              {audit.length === 0 && <tr><td colSpan={4} className="small">Kayıt yok</td></tr>}
              {audit.slice(0, 60).map((a) => (
                <tr key={a.id}>
                  <td className="mono small">{fmtDT(a.ts)}</td>
                  <td>{a.actor}</td>
                  <td className="small">{a.action}</td>
                  <td className="mono small" style={{ maxWidth: 380, overflow: "hidden", textOverflow: "ellipsis" }}>{[a.before, a.after].filter(Boolean).join(" → ").slice(0, 160)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}
