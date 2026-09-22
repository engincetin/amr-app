/**
 * API dokümanı (tarayıcıdan açılır).
 *
 *   GET /openapi.json    Kanzasset sözleşmesi (sözleşme paketinden üretilir)
 *   GET /admin-api.json  panel API'si (çalışan sunucunun yol tablosundan üretilir)
 *   GET /docs            tek sayfalık görüntüleyici
 *
 * Görüntüleyici sözleşme paketindedir (iki repoda tek kopya), bağımlılıksızdır ve
 * dışarıdan dosya çekmez: rafineri ağı kapalı olsa da açılır.
 * Belgeler `npm run openapi:export` ve `npm run adminapi:export` ile üretilir.
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { docsViewerHtml } from "@amr/contract/docs-viewer";
import type { AppContext } from "./context.ts";

/** Belgeler repo kökünde durur; kurulumda sunucunun yanına da konabilir. */
function findSpec(name: string, envVar?: string): string | null {
  const candidates = [
    envVar ? process.env[envVar] : undefined,
    resolve(import.meta.dirname, `../../../${name}`),
    resolve(process.cwd(), name),
  ].filter(Boolean) as string[];
  return candidates.find((p) => existsSync(p)) ?? null;
}

function serveSpec(name: string, envVar: string, hint: string) {
  return async (_req: unknown, reply: { code: (n: number) => { send: (b: unknown) => unknown }; header: (k: string, v: string) => { send: (b: unknown) => unknown } }) => {
    const p = findSpec(name, envVar);
    if (!p) return reply.code(404).send({ error: `${name} bulunamadı; ${hint}` });
    return reply.header("content-type", "application/json; charset=utf-8").send(readFileSync(p, "utf8"));
  };
}

const VIEWER = docsViewerHtml({
  title: "AMR uygulaması · API dokümanı",
  brand: "AMR uygulaması",
  tabs: [
    {
      id: "v1", label: "Kanzasset sözleşmesi (/v1)", url: "/openapi.json",
      heading: "Kanzasset sözleşmesi",
      intro: "Kanzasset'in kullandığı uçlar. Kimlik ve bütünlük: <code>X-API-Key</code>, <code>X-Timestamp</code>, <code>X-Signature</code> (HMAC-SHA256: zaman damgası + yöntem + yol + ham gövde). Her <code>POST</code> için <code>Idempotency-Key</code>: aynı anahtarla gelen istek aynı cevabı alır, ikinci kez işlenmez.",
      note: "Bu belge <code>packages/contract/src/index.ts</code> dosyasından üretilir. Sözleşme değişince <code>npm run openapi:export</code> çalıştırılır ve Kanzasset tarafında <code>npm run contract:sync</code> yapılır.",
      hint: "Belge için <code>npm run openapi:export</code> çalıştırın.",
    },
    {
      id: "admin", label: "Panel API'si (/admin)", url: "/admin-api.json",
      heading: "Panel API'si",
      intro: "Rafineri ekranlarının (R1'den R10'a) kullandığı iç uçlar. Kanzasset bu uçları kullanmaz. Aktör <code>X-User</code> başlığıyla gelir ve yetkisi rolüne göre denetlenir; <code>ADMIN_TOKEN</code> verilmişse ayrıca <code>X-Admin-Token</code> istenir.",
      note: "Kritik aksiyonlar ikinci onay ister: önce istek açılır (<code>202</code> ve onay numarası döner), sonra farklı bir kullanıcı onaylar. Bu belge çalışan sunucunun yol tablosundan üretilir (<code>npm run adminapi:export</code>), böylece uçlarla belgenin arası açılmaz.",
      hint: "Belge için <code>npm run adminapi:export</code> çalıştırın.",
    },
    { id: "raw", label: "openapi.json", url: "/openapi.json", raw: true },
  ],
});

export async function docsRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get("/openapi.json", serveSpec("openapi.json", "OPENAPI_PATH", "npm run openapi:export çalıştırın"));
  app.get("/admin-api.json", serveSpec("admin-api.json", "ADMIN_API_PATH", "npm run adminapi:export çalıştırın"));
  app.get("/docs", async (_req, reply) => reply.header("content-type", "text/html; charset=utf-8").send(VIEWER));
  void ctx;
}
