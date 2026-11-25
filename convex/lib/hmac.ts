// HMAC-SHA256 helpers (Web Crypto, available in the Convex runtime).
const enc = new TextEncoder();

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Constant-time string comparison, so signature checks do not leak timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const MAX_SKEW_MS = 5 * 60 * 1000;

/**
 * Verify a signed request. Signed string: `${timestamp}.${METHOD}.${path}.${body}`.
 * The timestamp window blocks replay of old requests.
 */
export async function verifySignedRequest(opts: {
  secret: string | undefined;
  method: string;
  path: string;
  body: string;
  timestamp: string | null;
  signature: string | null;
  now: number;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { secret, method, path, body, timestamp, signature, now } = opts;
  if (!secret) return { ok: false, reason: "server secret not configured" };
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(now - ts) > MAX_SKEW_MS) {
    return { ok: false, reason: "timestamp outside allowed window" };
  }
  const expected = await hmacHex(secret, `${timestamp}.${method}.${path}.${body}`);
  if (!safeEqual(expected, signature.toLowerCase())) {
    return { ok: false, reason: "bad signature" };
  }
  return { ok: true };
}
