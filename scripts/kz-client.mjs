/**
 * Geliştirme aracı: Kanzasset gibi fiyat soketine bağlanır ve gelen mesajları yazar.
 *   node scripts/kz-client.mjs [süre_ms] [ws://localhost:4000/v1/prices] [api_key] [secret]
 */
import WebSocket from "ws";
import { createHmac } from "node:crypto";
const [dur = "5000", url = "ws://localhost:4000/v1/prices", key = "kz-dev-key", secret = "kz-dev-secret"] = process.argv.slice(2);
const ws = new WebSocket(url);
ws.on("open", () => {
  const ts = new Date().toISOString();
  const sig = createHmac("sha256", secret).update(`${ts}GET/v1/prices`).digest("hex");
  ws.send(JSON.stringify({ type: "auth", api_key: key, ts, sig }));
});
ws.on("message", (m) => {
  const j = JSON.parse(m.toString());
  const usd = j.prices?.find((p) => p.ccy === "USD");
  console.log(new Date().toISOString().slice(11, 23), j.type.padEnd(10), j.seq ?? "", usd ? `USD ${usd.bid}/${usd.ask}` : "", j.tradable === undefined ? "" : `tradable=${j.tradable}`, j.reason ?? "");
});
ws.on("close", (c, r) => { console.log("kapandı", c, r.toString()); process.exit(0); });
setTimeout(() => ws.close(), Number(dur));
