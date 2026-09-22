/**
 * Mahsuplaşmanın ekran karşılığı (R8, R1).
 *
 * Pencere tek bir listeye indirgenir: kapatılacak her kalem bir "bacak"tır (altın, USD, EUR, AED).
 * Her bacağın tek bir hâli ve o an yapılacak tek bir işi vardır. Operatör tabloya bakıp
 * sırasını görür, durum adlarını ezberlemek zorunda kalmaz. İş kuralları sunucudadır; burada yalnız sunum.
 */
import type { Settlement } from "./api.ts";

const g = (mg: number) => (mg / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const money = (c: number) => (c / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type LegState = "kapandı" | "sizde" | "karşıda" | "yok";
export type LegAction = "gold-propose" | "gold-accept-info" | "pay-notice" | "pay-received" | null;

export interface Leg {
  key: string;
  /** Ekranda görünen ad: Altın · USD · EUR · AED */
  label: string;
  /** Tutar metni (yön işaretiyle). */
  amount: string;
  /** Kim borçlu. */
  who: string;
  state: LegState;
  /** Tek satırlık açıklama: bu bacakta şu an ne oluyor. */
  note: string;
  /** Rafineri tarafında basılacak tek düğme; null ise karşı taraf bekleniyor. */
  action: LegAction;
  actionLabel?: string;
  ccy?: string;
}

/** Mutabakat adımının hâli: ekstre çıkarıldı mı, iki ekstre eşit mi. */
export function reconciliation(w: Settlement | null): { state: "yok" | "bekliyor" | "eşit" | "fark"; text: string; canDraft: boolean } {
  if (!w) return { state: "yok", text: "açık pencere yok", canDraft: false };
  if (w.status === "OPEN" || w.status === "REQUESTED") return { state: "yok", text: "ekstre henüz çıkarılmadı", canDraft: true };
  if (w.status === "DRAFT") return { state: "bekliyor", text: "ekstre Kanzasset'e gitti, karşılaştırması bekleniyor", canDraft: false };
  if (w.status === "MISMATCH") return { state: "fark", text: `${w.diffs?.length ?? 0} satırda fark var: kalemler düzeltilip ekstre yeniden çıkarılmalı`, canDraft: true };
  return { state: "eşit", text: "iki ekstre birebir eşit, bacaklar kapatılabilir", canDraft: false };
}

/** Kapsam metni: hangi bacaklar bu pencerede kapatılıyor. */
export function scopeText(w: Settlement | null): string {
  const s = w?.scope;
  if (!s || s.length === 0 || s.length >= 4) return "tümü (altın + USD + EUR + AED)";
  return s.map((x) => (x === "GOLD" ? "altın" : x)).join(" + ");
}

/**
 * Rafineri tarafının bacak listesi.
 * Altın bacağının sırası sabittir: rafineri borçluysa teklif eder ve Kanzasset'in onayını bekler;
 * Kanzasset borçluysa rafineri hiçbir şey yapamaz, kasa çıkışı yalnız Kanzasset'in talebiyle başlar.
 */
export function legs(w: Settlement | null): Leg[] {
  if (!w) return [];
  const rec = reconciliation(w);
  const ready = rec.state === "eşit";
  const out: Leg[] = [];
  const inScope = (k: string) => !w.scope || w.scope.length === 0 || w.scope.includes(k as never);

  if (inScope("GOLD")) {
    const gl = w.gold_leg;
    if (!gl || gl.direction === "NONE") {
      out.push({ key: "GOLD", label: "Altın", amount: "0,000 g", who: "gram farkı yok", state: "yok", note: "cari hesapta kapanacak gram yok", action: null });
    } else if (gl.done) {
      out.push({ key: "GOLD", label: "Altın", amount: `${g(gl.qty_mg)} g`, who: gl.direction === "VAULT_IN" ? "rafineri borçluydu" : "Kanzasset borçluydu", state: "kapandı", note: `kasa talimatı kapandı${gl.requests.length ? ` (${gl.requests.join(", ")})` : ""}, T sıfırlandı`, action: null });
    } else if (gl.direction === "VAULT_IN") {
      // rafineri gram borçlu: önce "kasaya koyalım mı" teklifi, sonra Kanzasset'in onayı ve kasa girişi talebi
      if (!gl.proposed_ts) {
        out.push({ key: "GOLD", label: "Altın", amount: `${g(gl.qty_mg)} g`, who: "rafineri borçlu", state: ready ? "sizde" : "karşıda", note: ready ? "gramı kasaya koymayı teklif edin; Kanzasset onaylayınca kasa girişi talebi gelir" : "mutabakattan sonra teklif edilir", action: ready ? "gold-propose" : null, actionLabel: "Kasaya koymayı teklif et" });
      } else if (!gl.approved_ts) {
        out.push({ key: "GOLD", label: "Altın", amount: `${g(gl.qty_mg)} g`, who: "rafineri borçlu", state: "karşıda", note: "teklif gönderildi, Kanzasset'in onayı bekleniyor", action: null });
      } else {
        out.push({ key: "GOLD", label: "Altın", amount: `${g(gl.qty_mg)} g`, who: "rafineri borçlu", state: "karşıda", note: "onay geldi: Kanzasset'in kasa girişi talebi bekleniyor, talep düşünce R4 Kasa hesabı ekranından kabul edin", action: "gold-accept-info", actionLabel: "R4 Kasa hesabı" });
      }
    } else {
      out.push({ key: "GOLD", label: "Altın", amount: `${g(gl.qty_mg)} g`, who: "Kanzasset borçlu", state: "karşıda", note: "Kanzasset önce token yakar, sonra kasa çıkışı talebi gönderir. Rafineri kendi başına kasadan gram çıkaramaz", action: "gold-accept-info", actionLabel: "R4 Kasa hesabı" });
    }
  }

  for (const m of w.money_leg) {
    if (m.net_cents === 0) {
      out.push({ key: m.ccy, label: m.ccy, amount: money(0), who: "kapanacak kalem yok", state: "yok", note: "bu kurda borç alacak yok", action: null, ccy: m.ccy });
      continue;
    }
    if (m.paid) {
      out.push({ key: m.ccy, label: m.ccy, amount: money(Math.abs(m.net_cents)), who: m.direction === "KZ_TO_AMR" ? "Kanzasset borçluydu" : "rafineri borçluydu", state: "kapandı", note: `ödeme kapandı${m.bank_ref ? ` · banka ref ${m.bank_ref}` : ""}`, action: null, ccy: m.ccy });
      continue;
    }
    if (m.direction === "AMR_TO_KZ") {
      out.push({ key: m.ccy, label: m.ccy, amount: money(Math.abs(m.net_cents)), who: "rafineri borçlu", state: ready ? "sizde" : "karşıda", note: ready ? "şirket hesabından ödeyin ve banka referansıyla bildirin (ikinci onay ister)" : "mutabakattan sonra ödenir", action: ready ? "pay-notice" : null, actionLabel: "Ödemeyi bildir", ccy: m.ccy });
    } else {
      out.push({ key: m.ccy, label: m.ccy, amount: money(Math.abs(m.net_cents)), who: "Kanzasset borçlu", state: ready ? "sizde" : "karşıda", note: m.bank_ref ? `Kanzasset ödeme bildirdi (${m.bank_ref}); para hesaba geçtiyse onaylayın` : "Kanzasset şirket hesabından ödeyecek; para geldiğinde onaylayın", action: ready ? "pay-received" : null, actionLabel: "Ödeme alındı", ccy: m.ccy });
    }
  }
  return out;
}

/** Tek cümlelik özet: kaç bacak açık ve sıradaki iş kimde. */
export function summary(w: Settlement | null): string {
  if (!w) return "Açık pencere yok. Kesim saatinde kendiliğinden açılır; erken kapatmak için talep edin.";
  if (w.status === "SETTLED") return "Pencere kapandı: bütün bacaklar sıfırlandı, Mahsuplaşma Ekstresi üretildi.";
  const rec = reconciliation(w);
  if (rec.state !== "eşit") return `Mutabakat: ${rec.text}.`;
  const rows = legs(w).filter((l) => l.state === "sizde" || l.state === "karşıda");
  if (rows.length === 0) return "Bütün bacaklar kapandı, pencere birazdan kapanacak.";
  const mine = rows.filter((l) => l.state === "sizde");
  const head = `${rows.length} bacak açık`;
  return mine.length ? `${head} · sıradaki iş sizde: ${mine[0].label} ${mine[0].amount}` : `${head} · sıradaki iş Kanzasset'te: ${rows[0].label} ${rows[0].amount}`;
}
