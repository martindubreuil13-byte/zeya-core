import crypto from "node:crypto";

const MAX_SIGNATURE_AGE_SECONDS = 30 * 60;

export function verifyElevenLabsSignature(rawBody: string, headerValue: string, secret: string, nowMs = Date.now()): boolean {
  const fields = new Map(headerValue.split(",").map((part) => {
    const index = part.indexOf("=");
    return index > 0 ? [part.slice(0, index).trim(), part.slice(index + 1).trim()] : ["", ""];
  }));
  const timestamp = fields.get("t") ?? "";
  const signature = fields.get("v0") ?? "";
  if (!/^\d{10,13}$/.test(timestamp) || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const seconds = Number(timestamp.length === 13 ? Math.floor(Number(timestamp) / 1000) : timestamp);
  const age = Math.floor(nowMs / 1000) - seconds;
  if (!Number.isFinite(seconds) || age < 0 || age > MAX_SIGNATURE_AGE_SECONDS) return false;
  const computed = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(computed, "hex"));
}

export function getWebhookSecret(): string | null {
  const value = process.env.ELEVENLABS_WEBHOOK_SECRET;
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function mayBypassElevenLabsSignature(): boolean {
  return process.env.NODE_ENV === "test" && process.env.ELEVENLABS_WEBHOOK_TEST_BYPASS === "true";
}

export function shouldVerifySignature():boolean{return !mayBypassElevenLabsSignature()}
export function logSignatureWarning():void{/* compatibility no-op: production never warns and bypasses */}
