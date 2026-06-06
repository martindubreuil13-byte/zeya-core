// ElevenLabs webhook signature verification — HMAC-SHA256

import crypto from "crypto";

export function verifyElevenLabsSignature(
  rawBody: string,
  signature: string,
  secret: string
): boolean {
  try {
    // Compute HMAC-SHA256 of raw body with secret key, return as hex
    const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");

    // Compare signatures as hex-encoded buffers
    // ElevenLabs sends signature as hex string, computed is also hex string
    // Must decode both as hex to compare the actual binary values
    const signatureBuf = Buffer.from(signature, 'hex');
    const computedBuf = Buffer.from(computed, 'hex');

    // Use timing-safe comparison to prevent timing attacks
    const isMatch = crypto.timingSafeEqual(signatureBuf, computedBuf);

    if (!isMatch) {
      console.log("[sig-verify] 🔴 Signature verification failed", {
        signatureFromHeader: signature.substring(0, 32),
        computedHMAC: computed.substring(0, 32),
        signatureLength: signature.length,
        computedLength: computed.length,
      });
    }

    return isMatch;
  } catch (error) {
    // If signature is not valid hex, try as UTF-8 string
    try {
      const computed = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
      const isMatch = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(computed)
      );
      return isMatch;
    } catch {
      return false;
    }
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
