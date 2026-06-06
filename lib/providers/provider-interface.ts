import type { ProviderDispatchRequest, ProviderDispatchResult } from "./provider-types";

export interface WorkerProvider {
  dispatch(request: ProviderDispatchRequest): Promise<ProviderDispatchResult>;
}
