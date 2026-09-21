/**
 * Kanzasset istemci kimliği: API anahtarı + HMAC-SHA256 imza.
 *  REST : X-API-Key, X-Timestamp, X-Signature = HMAC(secret, ts + METHOD + path + body)
 *  WS   : ilk mesaj { type: "auth", api_key, ts, sig = HMAC(secret, ts + "GET" + "/v1/prices") }
 * Zaman damgası ±5 dk içinde olmalı.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { PRICE_SOCKET, signingString } from "@amr/contract";
import { type Db, getApiClient } from "./db.ts";

export function hmacHex(secret: string, text: string): string {
  return createHmac("sha256", secret).update(text).digest("hex");
}

export function verify(db: Db, apiKey: string | undefined, ts: string | undefined, sig: string | undefined, method: string, path: string, body = "") {
  if (!apiKey || !ts || !sig) return { ok: false as const, code: "AUTH_MISSING" };
  const client = getApiClient(db, apiKey);
  if (!client) return { ok: false as const, code: "AUTH_UNKNOWN_KEY" };
  const t = Date.parse(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() - t) > PRICE_SOCKET.authSkewMs) return { ok: false as const, code: "AUTH_CLOCK" };
  const expected = hmacHex(client.secret, signingString(ts, method, path, body));
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { ok: false as const, code: "AUTH_BAD_SIGNATURE" };
  return { ok: true as const, client };
}
