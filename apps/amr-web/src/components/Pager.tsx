import { useEffect, useMemo, useState } from "react";

/**
 * Tablo sayfalayıcı: uzun listeler 20'şer gösterilir, kayıt sayısı büyüdükçe ekran bozulmaz.
 * Süzgeç değişince başa döner. Aynı bileşen iki panelde de kullanılır.
 */
export function usePager<T>(items: T[], size = 20, resetKey: unknown = null) {
  const [page, setPage] = useState(0);
  useEffect(() => { setPage(0); }, [resetKey, size]);
  const pages = Math.max(1, Math.ceil(items.length / size));
  const safe = Math.min(page, pages - 1);
  const slice = useMemo(() => items.slice(safe * size, (safe + 1) * size), [items, safe, size]);
  return { page: safe, pages, setPage, slice, total: items.length, from: items.length === 0 ? 0 : safe * size + 1, to: Math.min(items.length, (safe + 1) * size) };
}

export function Pager({ p, label }: { p: ReturnType<typeof usePager<unknown>>; label?: string }) {
  if (p.total === 0) return null;
  return (
    <div className="pager">
      <span className="small">{label ? `${label} · ` : ""}{p.total} kayıt · {p.from}-{p.to}</span>
      <span className="sp" />
      <button disabled={p.page === 0} onClick={() => p.setPage(0)} title="ilk sayfa">⏮</button>
      <button disabled={p.page === 0} onClick={() => p.setPage(p.page - 1)}>← Önceki</button>
      <span className="small mono">{p.page + 1} / {p.pages}</span>
      <button disabled={p.page + 1 >= p.pages} onClick={() => p.setPage(p.page + 1)}>Sonraki →</button>
      <button disabled={p.page + 1 >= p.pages} onClick={() => p.setPage(p.pages - 1)} title="son sayfa">⏭</button>
    </div>
  );
}
