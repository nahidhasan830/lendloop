import { describe, expect, it } from "vitest";
import { hmacHex, MAX_SKEW_MS, safeEqual, verifySignedRequest } from "./lib/hmac";

const secret = "s3cret";
const base = { secret, method: "POST", path: "/n8n/reminder-result", body: '{"a":1}', now: 1_000_000_000_000 };

async function signed(over: Partial<Parameters<typeof verifySignedRequest>[0]> = {}) {
  const timestamp = String(base.now);
  const signature = await hmacHex(secret, `${timestamp}.${base.method}.${base.path}.${base.body}`);
  return { ...base, timestamp, signature, ...over };
}

describe("HMAC request verification", () => {
  it("accepts a valid signature", async () => {
    expect(await verifySignedRequest(await signed())).toEqual({ ok: true });
  });
  it("rejects a tampered body, path or method", async () => {
    expect((await verifySignedRequest(await signed({ body: '{"a":2}' }))).ok).toBe(false);
    expect((await verifySignedRequest(await signed({ path: "/n8n/failure" }))).ok).toBe(false);
    expect((await verifySignedRequest(await signed({ method: "GET" }))).ok).toBe(false);
  });
  it("rejects a wrong secret and missing headers", async () => {
    expect((await verifySignedRequest(await signed({ secret: "other" }))).ok).toBe(false);
    expect((await verifySignedRequest(await signed({ signature: null }))).ok).toBe(false);
    expect((await verifySignedRequest(await signed({ secret: undefined }))).ok).toBe(false);
  });
  it("rejects replays outside the time window", async () => {
    const old = await signed({ now: base.now + MAX_SKEW_MS + 1 });
    expect(await verifySignedRequest(old)).toEqual({ ok: false, reason: "timestamp outside allowed window" });
  });
  it("compares in constant time and handles length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
