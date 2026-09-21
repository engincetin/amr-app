export function Placeholder({ code, title, sprint, text }: { code: string; title: string; sprint: number; text: string }) {
  return (
    <div>
      <span className="tag">{code}</span>
      <h1>{title}</h1>
      <p className="sub">Bu ekran Sprint {sprint}'te çalışır hâle gelir. Kapsamı KZ-AMR Sistem dokümanı bölüm 02'de.</p>
      <div className="placeholder"><b>Ne yapacak:</b> {text}</div>
    </div>
  );
}
