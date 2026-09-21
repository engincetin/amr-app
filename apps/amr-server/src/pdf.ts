/**
 * Belge PDF üretimi (R9, K4 / K6 / K7).
 *
 * Bağımlılık eklemeden, elle yazılan küçük bir PDF üreticisi: A4, rafineri başlığı, belge numarası,
 * alan listesi ve imza özeti. Türkçe karakterler için WinAnsi (CP1252) kodlaması kullanılır;
 * PDF'in standart Helvetica yazı tipi bu kodlamayla ı, ş, ğ, ç, ö, ü ve büyük hâllerini taşır.
 */
import type { Document } from "@amr/contract";

/** WinAnsi'de olmayan birkaç işaret için en yakın karşılık. */
const FALLBACK: Record<string, string> = { "·": "-", "—": "-", "–": "-", "’": "'", "“": '"', "”": '"', "₺": "TL", "≤": "<=", "≥": ">=", "→": "->" };

/** Metni WinAnsi bayt dizisine çevirir (Türkçe harfler dahil). */
function winAnsi(text: string): number[] {
  const map: Record<string, number> = {
    "Ş": 0x8a, "ş": 0x9a, "Ğ": 0xd0, "ğ": 0xf0, "İ": 0xdd, "ı": 0xfd,
    "Ç": 0xc7, "ç": 0xe7, "Ö": 0xd6, "ö": 0xf6, "Ü": 0xdc, "ü": 0xfc,
  };
  const out: number[] = [];
  for (const ch of [...text]) {
    const rep = FALLBACK[ch] ?? ch;
    for (const c of [...rep]) {
      if (map[c] !== undefined) { out.push(map[c]); continue; }
      const code = c.codePointAt(0)!;
      out.push(code <= 0xff ? code : 0x3f); // bilinmeyen -> '?'
    }
  }
  return out;
}

/** PDF dizesi: kaçış ve WinAnsi baytları. */
function pdfString(text: string): string {
  const bytes = winAnsi(text);
  let s = "";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b < 32 || b > 126) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s;
}

const TITLES: Record<string, string> = {
  ALLOCATION_CERTIFICATE: "Tahsis Belgesi",
  VAULT_IN_SLIP: "Kasa Giris Fisi",
  VAULT_OUT_SLIP: "Kasa Cikis Fisi",
  LOGISTICS_QUOTE: "Lojistik Teklifi",
  REFINING_QUOTE: "Rafinasyon Teklifi",
  SHIPPING_SLIP: "Sevkiyat Fisi",
  DELIVERY_RECORD: "Teslimat Kaydi",
  VAULT_STATEMENT: "Gunluk Kasa Ekstresi",
  CURRENT_ACCOUNT_STATEMENT: "Cari Hesap Ekstresi",
  SETTLEMENT_STATEMENT: "Mahsuplasma Ekstresi",
};

/** Alan adlarının okunur karşılıkları. */
const LABELS: Record<string, string> = {
  doc_id: "Belge no", type: "Tip", request_id: "Talep no", order_id: "Emir no", client_order_id: "Müşteri emri",
  kz_ref: "Kanzasset referansı", qty_mg: "Miktar (mg)", qty_g: "Miktar (g)", total_mg: "Toplam (mg)", total_g: "Toplam (g)",
  fineness: "Ayar", px: "Fiyat", ccy: "Kur", amount_cents: "Tutar (cent)", amount: "Tutar", owner: "Sahiplik",
  terms: "Şartlar", statement: "Açıklama", accepted_ts: "Kabul zamanı", accepted_by: "Kabul eden",
  trade_ts: "İşlem zamanı", issued_by: "Düzenleyen", issued_ts: "Düzenleme zamanı", carrier: "Taşıyıcı",
  tracking_no: "Takip numarası", valid_until: "Geçerlilik", quoted_by: "Teklifi giren", prepared_by: "Hazırlayan",
  delivered_by: "Teslim eden", delivered_ts: "Teslim zamanı", address_ref: "Adres referansı",
  insured_party_ref: "Sigorta lehtarı referansı", items: "Kalemler", product: "Ürün bedeli", logistics: "Lojistik",
  total: "Toplam", lead_time_days: "Üretim süresi (gün)", kind: "Tür", settlement_id: "Mahsuplaşma no",
  trigger: "Tetik", window_from: "Pencere başı", window_to: "Pencere sonu", gold_leg: "Altın bacağı",
  money_leg: "Para bacağı", statement_hash: "Ekstre özeti", movements: "Hareket sayısı", settled_ts: "Kapanış",
};

/** Belgeyi tek sayfalık A4 PDF olarak üretir. */
export function documentPdf(doc: Document): Buffer {
  const title = TITLES[doc.meta.type] ?? String(doc.content.title ?? doc.meta.type);
  const lines: { text: string; size: number; gap: number; bold?: boolean }[] = [];

  lines.push({ text: "AHLATCI METAL REFINERY", size: 16, gap: 22, bold: true });
  lines.push({ text: "Kanzasset FZCO adina duzenlenmistir", size: 9, gap: 26 });
  lines.push({ text: title, size: 15, gap: 20, bold: true });
  lines.push({ text: `Belge no: ${doc.meta.doc_id}`, size: 10, gap: 18 });

  for (const [k, v] of Object.entries(doc.content)) {
    if (k === "title" || k === "doc_id" || k === "type") continue;
    const label = LABELS[k] ?? k;
    const value = typeof v === "object" ? JSON.stringify(v) : String(v);
    // uzun değerleri böl
    const chunks = value.match(/.{1,72}/g) ?? [""];
    lines.push({ text: `${label}: ${chunks[0]}`, size: 10, gap: 14 });
    for (const c of chunks.slice(1)) lines.push({ text: `    ${c}`, size: 10, gap: 14 });
  }

  lines.push({ text: "", size: 10, gap: 10 });
  lines.push({ text: "Imza ozeti", size: 11, gap: 16, bold: true });
  lines.push({ text: `sha256: ${doc.meta.hash}`, size: 8, gap: 12 });
  lines.push({ text: `imza:   ${doc.meta.signature}`, size: 8, gap: 12 });
  lines.push({ text: `olusturma: ${doc.meta.created_ts}`, size: 8, gap: 12 });
  if (doc.meta.sent_ts) lines.push({ text: `Kanzasset'e gonderim: ${doc.meta.sent_ts}`, size: 8, gap: 12 });

  // içerik akışı
  let y = 800;
  let content = "";
  for (const l of lines) {
    if (l.text) {
      content += `BT /${l.bold ? "F2" : "F1"} ${l.size} Tf 1 0 0 1 56 ${y} Tm (${pdfString(l.text)}) Tj ET\n`;
    }
    y -= l.gap;
    if (y < 50) break;
  }
  content += `BT /F1 8 Tf 1 0 0 1 56 36 Tm (${pdfString("Bu belge AMR uygulamasi tarafindan uretilmistir. Dogrulama: GET /v1/documents/" + doc.meta.doc_id)}) Tj ET\n`;

  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  objects.push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>");
  objects.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}endstream`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}
