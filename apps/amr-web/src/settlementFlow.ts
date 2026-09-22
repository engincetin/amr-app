/**
 * Mahsuplaşma akışının ekran karşılığı (R8, R1).
 *
 * Pencerenin durumu beş adıma indirgenir ve her an için tek bir "sıradaki adım" cümlesi üretilir.
 * Amaç: operatör altı kartı okuyup ne yapacağını çıkarmak zorunda kalmasın.
 * İş kuralları sunucudadır; burada yalnız sunum vardır.
 */
import type { Settlement } from "./api.ts";

export type StepState = "done" | "now" | "wait" | "bad";
export interface Step { n: number; title: string; detail: string; state: StepState }

const g = (mg: number) => (mg / 1000).toLocaleString("tr-TR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const money = (c: number) => (c / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Para bacağında kapanmamış kurlar. */
export const openMoneyLegs = (w: Settlement) => w.money_leg.filter((m) => m.net_cents !== 0 && !m.paid);
/** Altın bacağı gerekiyor mu ve kapandı mı. */
export const goldPending = (w: Settlement) => !!w.gold_leg && w.gold_leg.direction !== "NONE" && !w.gold_leg.done;

export function steps(w: Settlement | null): Step[] {
  const st = w?.status;
  const drafted = !!w && st !== "REQUESTED" && st !== "OPEN";
  const reconciled = !!w && (st === "RECONCILED" || st === "PAYMENT_PENDING" || st === "SETTLED");
  const mismatch = st === "MISMATCH";
  const goldDone = !!w && (!w.gold_leg || w.gold_leg.direction === "NONE" || w.gold_leg.done);
  const moneyDone = !!w && openMoneyLegs(w).length === 0;
  const settled = st === "SETTLED";

  return [
    {
      n: 1, title: "Pencere",
      detail: w ? `${w.settlement_id}` : "açık pencere yok",
      state: w ? "done" : "wait",
    },
    {
      n: 2, title: "Ekstre",
      detail: drafted ? `${w!.statement?.movements.length ?? 0} hareket imzalandı` : "rafineri ekstresi çıkarılacak",
      state: drafted ? "done" : w ? "now" : "wait",
    },
    {
      n: 3, title: "Mutabakat",
      detail: mismatch ? `${w!.diffs?.length ?? 0} fark var` : reconciled ? "iki ekstre birebir eşit" : drafted ? "Kanzasset karşılaştırıyor" : "ekstre bekleniyor",
      state: mismatch ? "bad" : reconciled ? "done" : drafted ? "now" : "wait",
    },
    {
      n: 4, title: "Altın bacağı",
      detail: !w?.gold_leg ? "ekstreden sonra belirir"
        : w.gold_leg.direction === "NONE" ? "gram farkı yok"
        : `${w.gold_leg.direction === "VAULT_IN" ? "kasa girişi" : "kasa çıkışı"} ${g(w.gold_leg.qty_mg)} g${w.gold_leg.done ? " · kapandı" : " · talimat bekleniyor"}`,
      state: goldDone && reconciled ? "done" : reconciled ? "now" : "wait",
    },
    {
      n: 5, title: "Para bacağı",
      detail: !w ? "ekstreden sonra belirir"
        : moneyDone ? (settled ? "kapandı" : "kapanacak kalem yok")
        : openMoneyLegs(w).map((m) => `${m.ccy} ${money(Math.abs(m.net_cents))}`).join(" · "),
      state: settled ? "done" : reconciled && goldDone ? (moneyDone ? "done" : "now") : "wait",
    },
  ];
}

export interface NextAction {
  /** Tek cümlelik soru karşılığı: şimdi ne olacak. */
  title: string;
  /** Neden ve nasıl. */
  body: string;
  /** Ekranda hangi aksiyonun açılacağı; null ise karşı taraf bekleniyor demektir. */
  action: "open" | "draft" | "diffs" | "gold" | "pay-out" | "pay-in" | "done" | null;
  ccy?: string;
}

/** Rafineri tarafının "şimdi ne yapmalıyım" cümlesi. */
export function nextAction(w: Settlement | null): NextAction {
  if (!w) return {
    title: "Açık pencere yok",
    body: "Pencere kesim saatinde kendiliğinden açılır. Erken kapatmak isterseniz şimdi talep edebilir ya da kesimi elle tetikleyebilirsiniz.",
    action: "open",
  };
  switch (w.status) {
    case "REQUESTED":
    case "OPEN":
      return { title: "Ekstreyi çıkarın", body: "Pencere açık. Gün içindeki hareketlerden rafineri ekstresi üretilip imzalanacak ve Kanzasset'e gidecek.", action: "draft" };
    case "DRAFT":
      return { title: "Kanzasset'in mutabakatı bekleniyor", body: "Ekstre gitti. Kanzasset kendi kaydıyla karşılaştırıyor; eşitse onaylayacak, değilse kendi toplamlarını gönderecek. Rafineri tarafında yapılacak bir şey yok.", action: null };
    case "MISMATCH":
      return { title: "İki ekstre tutmadı", body: "Farkları aşağıda görüyorsunuz. Kalemler düzeltildikten sonra ekstreyi yeniden çıkarın; mutabakat yeniden çalışır.", action: "diffs" };
    case "RECONCILED":
    case "PAYMENT_PENDING": {
      if (goldPending(w)) return {
        title: "Altın bacağı kasa talimatını bekliyor",
        body: `Cari hesaptaki ${g(Math.abs(w.gold_leg!.t_net_mg))} g için Kanzasset ${w.gold_leg!.direction === "VAULT_IN" ? "kasa girişi" : "kasa çıkışı"} talimatı gönderecek. Talimat düşünce R4 Kasa hesabı ekranından kabul edin; T sıfırlanınca bu adım kapanır.`,
        action: "gold",
      };
      const open = openMoneyLegs(w);
      if (open.length === 0) return { title: "Kapanış bekleniyor", body: "Bacakların ikisi de kapandı, pencere birazdan SETTLED olacak.", action: null };
      const first = open[0];
      return first.direction === "AMR_TO_KZ"
        ? { title: `${first.ccy} ${money(Math.abs(first.net_cents))} ödemesi rafineriden`, body: "Ödemeyi şirket hesabından yapın ve banka referansıyla bildirin. Ödeme talimatı kritik aksiyondur: farklı bir kullanıcının ikinci onayı gerekir.", action: "pay-out", ccy: first.ccy }
        : { title: `${first.ccy} ${money(Math.abs(first.net_cents))} ödemesi Kanzasset'ten`, body: "Kanzasset şirket hesabından ödeyecek. Para hesaba geçtiğinde \"Ödeme alındı\" deyin; cari hesabın o kur bacağı kapanır.", action: "pay-in", ccy: first.ccy };
    }
    case "SETTLED":
      return { title: "Pencere kapandı", body: "Altın ve para bacağı kapandı, cari hesap sıfırlandı. Mahsuplaşma Ekstresi belgesi indirilebilir.", action: "done" };
    default:
      return { title: w.status, body: "", action: null };
  }
}
