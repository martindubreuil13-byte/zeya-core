export type FitStatus = "likely_match" | "possible_match" | "weak_match" | "unreviewed";
export type LeadStatus = "new" | "selected" | "rejected" | "called" | "follow_up" | "closed";

export interface Lead {
  id: string;
  business_id: string;
  mission_key: string | null;
  company_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  industry: string | null;
  city: string | null;
  country: string | null;
  source: string | null;
  notes: string | null;
  fit_status: FitStatus;
  status: LeadStatus;
  raw_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

// Input shape — all fields optional, used before DB insertion
export interface LeadInput {
  company_name?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  website?: string;
  industry?: string;
  city?: string;
  country?: string;
  source?: string;
  notes?: string;
}

export interface LeadSummary {
  total: number;
  likelyMatch: number;
  possibleMatch: number;
  weakMatch: number;
  selected: number;
}

// Parsed + classified lead ready for DB insertion
export interface ClassifiedLead extends LeadInput {
  fit_status: FitStatus;
}
