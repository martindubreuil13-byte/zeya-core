import { MockProvider } from "./mock-provider";
import type { WorkerProvider } from "./provider-interface";
import type { ProviderType } from "./provider-types";

export function getProvider(type: ProviderType = "MOCK"): WorkerProvider {
  switch (type) {
    case "MOCK":
      return new MockProvider();
    case "TWILIO":
      throw new Error("TWILIO provider is not implemented");
  }
}
