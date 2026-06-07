import { MockProvider } from "./mock-provider";
import { ElevenLabsProvider } from "./elevenlabs-provider";
import type { WorkerProvider } from "./provider-interface";
import type { ProviderType } from "./provider-types";

export function getProvider(type: ProviderType = "MOCK"): WorkerProvider {
  switch (type) {
    case "MOCK":
      return new MockProvider();
    case "ELEVENLABS":
      return new ElevenLabsProvider();
    case "TWILIO":
      throw new Error("TWILIO provider is not implemented");
  }
}
