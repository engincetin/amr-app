/**
 * Mock merkez: rafinerinin merkezi fiyat uygulamasını taklit eder.
 *
 * WS  ws://localhost:4100/prices   → her saniye { type: "price", ts, prices: { USD: {bid, ask}, EUR: {...}, AED: {...} } }
 * HTTP http://localhost:4110/control
 *   GET  /state            durum
 *   POST /pause            fiyat göndermeyi durdur (bağlantı açık kalır)
 *   POST /resume           fiyat göndermeye devam et
 *   POST /kill             tüm soketleri kapat (bağlantı kesintisi simülasyonu)
 *   POST /jump {"pct": 1}  fiyatı yüzde kadar sıçrat (slippage testleri için)
 *
 * Gerçek merkez arayüzü netleşince AMR uygulamasındaki merkez adaptörü buna göre değişir; gerisi değişmez.
 */
import { createServer } from "node:http";
import { WebSocketServer, WebSocket } from "ws";

const WS_PORT = Number(process.env.MERKEZ_WS_PORT ?? 4100);
const HTTP_PORT = Number(process.env.MERKEZ_HTTP_PORT ?? 4110);
const INTERVAL_MS = Number(process.env.MERKEZ_INTERVAL_MS ?? 1000);

// Piyasa modeli: USD/g etrafında rastgele yürüyüş; EUR ve AED sabit kurlarla türetilir.
const state = {
  usdMid: Number(process.env.MERKEZ_START_USD ?? 141.9),
  spreadUsd: 0.2, // ask − bid
  eurUsd: 1.0885, // 1 EUR = 1.0885 USD
  usdAed: 3.6725, // 1 USD = 3.6725 AED
  paused: false,
  sent: 0,
  clients: 0,
  startedAt: new Date().toISOString(),
};

function fmt(n: number): string {
  return n.toFixed(2);
}

function prices() {
  const bidUsd = state.usdMid - state.spreadUsd / 2;
  const askUsd = state.usdMid + state.spreadUsd / 2;
  return {
    USD: { bid: fmt(bidUsd), ask: fmt(askUsd) },
    EUR: { bid: fmt(bidUsd / state.eurUsd), ask: fmt(askUsd / state.eurUsd) },
    AED: { bid: fmt(bidUsd * state.usdAed), ask: fmt(askUsd * state.usdAed) },
  };
}

function step() {
  // ~0,02 USD standart sapmalı rastgele yürüyüş, ortalamaya hafif dönüş
  const drift = (141.9 - state.usdMid) * 0.01;
  const shock = (Math.random() - 0.5) * 0.06;
  state.usdMid = Math.max(50, state.usdMid + drift + shock);
}

const wss = new WebSocketServer({ port: WS_PORT, path: "/prices" });
wss.on("connection", (ws) => {
  state.clients = wss.clients.size;
  console.log(`[merkez] AMR adaptörü bağlandı (${state.clients} bağlantı)`);
  ws.send(JSON.stringify({ type: "hello", source: "mock-merkez", ts: new Date().toISOString() }));
  ws.on("close", () => {
    state.clients = wss.clients.size;
    console.log(`[merkez] bağlantı kapandı (${state.clients} bağlantı)`);
  });
});

setInterval(() => {
  if (state.paused) return;
  step();
  const msg = JSON.stringify({ type: "price", ts: new Date().toISOString(), prices: prices() });
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(msg);
  state.sent++;
}, INTERVAL_MS);

const http = createServer((req, res) => {
  const send = (code: number, body: unknown) => {
    res.writeHead(code, { "content-type": "application/json", "access-control-allow-origin": "*" });
    res.end(JSON.stringify(body));
  };
  const url = req.url ?? "/";
  // sağlık: konteyner denetimi buradan bakar (diğer servisler merkez hazır olunca kalkar)
  if (req.method === "GET" && url === "/health") return send(200, { status: "ok", subscribers: wss.clients.size, sent: state.sent, paused: state.paused, ts: new Date().toISOString() });
  if (req.method === "GET" && url === "/control/state") return send(200, { ...state, prices: prices() });
  if (req.method === "POST" && url === "/control/pause") { state.paused = true; return send(200, { ok: true, paused: true }); }
  if (req.method === "POST" && url === "/control/resume") { state.paused = false; return send(200, { ok: true, paused: false }); }
  if (req.method === "POST" && url === "/control/kill") {
    for (const c of wss.clients) c.close(1012, "merkez bakım");
    return send(200, { ok: true, closed: true });
  }
  if (req.method === "POST" && url === "/control/jump") {
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      const pct = Number(JSON.parse(body || "{}").pct ?? 1);
      state.usdMid = state.usdMid * (1 + pct / 100);
      send(200, { ok: true, usdMid: fmt(state.usdMid) });
    });
    return;
  }
  send(404, { error: "not found" });
});
http.listen(HTTP_PORT, () => {
  console.log(`[merkez] fiyat soketi ws://localhost:${WS_PORT}/prices · kontrol http://localhost:${HTTP_PORT}/control/state`);
});
