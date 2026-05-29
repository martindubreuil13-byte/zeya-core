// Browser-side lead parsing — no external dependencies.
// Handles CSV (with header mapping) and freeform pasted text.

import type { LeadInput } from "@/lib/leads/types";

// ─── CSV parser ───────────────────────────────────────────────────────────────

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if ((ch === "," || ch === "\t") && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

const COLUMN_MAP: Record<string, keyof LeadInput> = {
  company:         "company_name",
  company_name:    "company_name",
  business:        "company_name",
  organization:    "company_name",
  organisation:    "company_name",
  account:         "company_name",
  employer:        "company_name",
  name:            "contact_name",
  contact_name:    "contact_name",
  contact:         "contact_name",
  person:          "contact_name",
  full_name:       "contact_name",
  first_last:      "contact_name",
  representative:  "contact_name",
  phone:           "phone",
  mobile:          "phone",
  telephone:       "phone",
  phone_number:    "phone",
  cell:            "phone",
  tel:             "phone",
  email:           "email",
  email_address:   "email",
  mail:            "email",
  website:         "website",
  url:             "website",
  web:             "website",
  domain:          "website",
  link:            "website",
  industry:        "industry",
  category:        "industry",
  sector:          "industry",
  vertical:        "industry",
  type:            "industry",
  niche:           "industry",
  city:            "city",
  town:            "city",
  location:        "city",
  country:         "country",
  nation:          "country",
  notes:           "notes",
  note:            "notes",
  comments:        "notes",
  comment:         "notes",
  description:     "notes",
  tags:            "notes",
};

function normalizeHeader(h: string): keyof LeadInput | null {
  const clean = h
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  return COLUMN_MAP[clean] ?? null;
}

export function parseCSV(text: string): LeadInput[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]);
  const fieldMap = headers.map(normalizeHeader);

  const leads: LeadInput[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.every((v) => !v.trim())) continue;

    const lead: LeadInput = {};
    fieldMap.forEach((field, idx) => {
      const val = values[idx]?.trim();
      if (field && val) {
        // Don't overwrite a field already set by an earlier column
        if (!lead[field]) lead[field] = val;
      }
    });

    // Keep the full row as notes fallback if we got nothing useful
    if (Object.keys(lead).length === 0) continue;
    leads.push(lead);
  }

  return leads;
}

// ─── Paste parser ─────────────────────────────────────────────────────────────

const EMAIL_RE   = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/;
const PHONE_RE   = /(?:\+?[\d][\d\s\-\(\).]{6,18}[\d])/;
const URL_RE     = /\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/[^\s]*)?\b/;

function looksLikeCSV(text: string): boolean {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return false;
  const commaCount = (lines[0].match(/,/g) ?? []).length;
  const tabCount   = (lines[0].match(/\t/g) ?? []).length;
  return commaCount >= 2 || tabCount >= 2;
}

export function parsePastedText(text: string): LeadInput[] {
  if (looksLikeCSV(text)) return parseCSV(text);

  const leads: LeadInput[] = [];

  // Split by blank lines — each block is one potential lead.
  // A block can span multiple lines: company name on line 1, email on line 2, notes on line 3, etc.
  const blocks = text.split(/\n\s*\n+/).filter((b) => b.trim());

  for (const rawBlock of blocks) {
    const lead: LeadInput = {};
    let blockText = rawBlock;

    // Extract email (once per block, from anywhere in the block)
    const emailMatch = blockText.match(EMAIL_RE);
    if (emailMatch) {
      lead.email = emailMatch[0];
      blockText = blockText.replace(emailMatch[0], "");
    }

    // Extract URL (once per block, avoid email domains)
    const urlMatch = blockText.match(URL_RE);
    if (urlMatch && !urlMatch[0].includes("@")) {
      lead.website = urlMatch[0];
      blockText = blockText.replace(urlMatch[0], "");
    }

    // Extract phone (once per block, needs at least 7 real digits)
    const phoneMatch = blockText.match(PHONE_RE);
    if (phoneMatch && phoneMatch[0].replace(/\D/g, "").length >= 7) {
      lead.phone = phoneMatch[0].trim();
      blockText = blockText.replace(phoneMatch[0], "");
    }

    // Split block back into lines and clean them
    // These lines now have email/phone/website removed.
    const remainingLines = blockText
      .split(/\r?\n/)
      .map((line) =>
        line
          .replace(/[|;\t]+/g, " ")
          .replace(/\s{2,}/g, " ")
          .trim(),
      )
      .filter((line) => line.length > 0);

    if (remainingLines.length > 0) {
      // First remaining line: check for company·contact delimiter
      const firstLine = remainingLines[0];
      const parts = firstLine.split(/\s*[·\-–—,]\s*/);
      if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
        lead.company_name = parts[0].trim();
        lead.contact_name = parts[1].trim();
      } else {
        lead.company_name = firstLine;
      }

      // All remaining lines become notes (joined with space)
      if (remainingLines.length > 1) {
        lead.notes = remainingLines.slice(1).join(" ").trim();
      }
    }

    if (Object.keys(lead).length > 0) leads.push(lead);
  }

  return leads;
}
