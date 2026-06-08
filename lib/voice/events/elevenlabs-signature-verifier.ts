// ElevenLabs webhook signature verification — HMAC-SHA256

import crypto from "crypto";

export function verifyElevenLabsSignature(
  rawBody: string,
  headerValue: string,
  secret: string
): boolean {
  try {
    // Parse header format: t=timestamp,v0=signature
    const parts = headerValue.split(',');
    let timestamp = '';
    let signature = '';

    for (const part of parts) {
      const [key, value] = part.split('=');
      if (key === 't') {
        timestamp = value;
      } else if (key === 'v0') {
        signature = value;
      }
    }

    if (!timestamp || !signature) {
      console.error("[sig-verify] 🔴 Invalid signature header format", {
        headerValue: headerValue.substring(0, 50),
      });
      return false;
    }

    // Validate timestamp is within 30 minutes
    const timestampSeconds = parseInt(timestamp, 10);
    const nowSeconds = Math.floor(Date.now() / 1000);
    const ageSeconds = nowSeconds - timestampSeconds;
    const thirtyMinutesSeconds = 30 * 60;

    if (ageSeconds > thirtyMinutesSeconds || ageSeconds < 0) {
      console.error("[sig-verify] 🔴 Timestamp outside 30-minute window", {
        timestamp,
        ageSeconds,
        maxAge: thirtyMinutesSeconds,
      });
      return false;
    }

    // Compute HMAC-SHA256 over "${timestamp}.${rawBody}"
    const message = `${timestamp}.${rawBody}`;
    const computed = crypto.createHmac("sha256", secret).update(message).digest("hex");

    // Compare safely using timing-safe comparison
    try {
      const isMatch = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(computed)
      );

      if (!isMatch) {
        console.warn("[sig-verify] 🔴 Signature verification failed", {
          provided: signature.substring(0, 16),
          computed: computed.substring(0, 16),
        });
      }

      return isMatch;
    } catch (comparisonError) {
      // timingSafeEqual throws if buffers are different lengths
      console.error("[sig-verify] 🔴 Signature length mismatch", {
        providedLength: signature.length,
        computedLength: computed.length,
      });
      return false;
    }
  } catch (error) {
    console.error("[sig-verify] 🔴 Exception during signature verification", {
      error: error instanceof Error ? error.message : String(error),
    });
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
