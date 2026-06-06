// ElevenLabs webhook signature verification — HMAC-SHA256

import crypto from "crypto";

export function verifyElevenLabsSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  try {
    const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
  } catch {
    return false;
  }
}

export function shouldVerifySignature(): boolean {
  return typeof process.env.ELEVENLABS_WEBHOOK_SECRET === "string" && process.env.ELEVENLABS_WEBHOOK_SECRET.length > 0;
}

export function getWebhookSecret(): string | null {
  return process.env.ELEVENLABS_WEBHOOK_SECRET ?? null;
}

export function logSignatureWarning(isDevelopment: boolean) {
  if (isDevelopment) {
    console.warn("[webhook] ELEVENLABS_WEBHOOK_SECRET not configured. Skipping signature verification for development.");
  }
}
