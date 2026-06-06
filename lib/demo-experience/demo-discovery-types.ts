export type DemoDiscoveryStatus =
  | "DISCOVERY"
  | "READY_FOR_CALL"
  | "CALL_DISPATCHED"
  | "DEBRIEF_READY"
  | "COMPLETED";

export interface DemoDiscoverySession {
  id: string;
  visitorName?: string;
  visitorPhone?: string;
  visitorEmail?: string;
  businessDescription: string;
  offer: string;
  idealCustomer: string;
  pricePoint?: string;
  commonObjection?: string;
  desiredOutcome: string;
  status: DemoDiscoveryStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DemoDiscoveryInput {
  visitorName?: string;
  visitorPhone?: string;
  visitorEmail?: string;
  businessDescription: string;
  offer: string;
  idealCustomer: string;
  pricePoint?: string;
  commonObjection?: string;
  desiredOutcome?: string;
}
