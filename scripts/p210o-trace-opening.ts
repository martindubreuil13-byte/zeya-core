#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = createClient(supabaseUrl, supabaseKey);

// Recreate buildGovernedCommercialOpening locally
function buildGovernedCommercialOpening(input: {
  spokenName: string;
  prospectName: string;
  offer: string;
  audience: string;
  relationshipState: 'first_contact' | 'follow_up';
  priorPain: string | null;
  callbackRequested: boolean;
}): string {
  const greeting = `Hi ${input.prospectName || "there"}, this is ${input.spokenName}.`;
  if (input.relationshipState === "follow_up") {
    const history = input.priorPain
      ? ` Last time we spoke, you mentioned ${input.priorPain.replace(/[.\s]+$/g, "").replace(/^the prospect (?:reported|said) /i, "")}.`
      : " We spoke previously.";
    const callback = input.callbackRequested ? " You had asked us to reconnect." : "";
    return `${greeting}${history}${callback}`;
  }
  return `${greeting} I'm calling because we work with ${input.audience.replace(/[.\s]+$/g, "")} through ${input.offer.replace(/[.\s]+$/g, "")}, and I wanted to see whether that could be relevant to your current priorities.`;
}

async function main() {
  console.log("================================================================================");
  console.log("[3] RECONSTRUCTING EXACT RUNTIME INPUT FROM FROZEN BRIEF");
  console.log("================================================================================\n");

  // Load the ACTUAL frozen brief
  const briefRes = await db
    .from("worker_briefs")
    .select("brief_payload")
    .eq("id", "p25_brief_a83e4f05e2b9406db494e14981c727f0")
    .single();

  if (briefRes.error) {
    console.error(`Error: ${briefRes.error.message}`);
    process.exit(1);
  }

  const payload = briefRes.data.brief_payload as Record<string, any>;

  // Extract exact values from governed-voice-execution.ts logic
  const prospect = payload.prospect || {};
  const who =
    Object.keys(prospect).length > 0
      ? prospect.identity
      : payload.who || {};

  const frozenWorker = payload.worker;
  const what = Object.keys(payload.business || {}).length ? payload.business : payload.what || {};
  const frozenProspectContext = payload.prospect?.context || {};
  const mission = payload.mission || {};
  const why = Object.keys(mission).length ? mission : payload.why || {};
  const authority = payload.authority || {};

  const text = (value: unknown) =>
    typeof value === "string" ? value : "";

  const object = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};

  // Recreate the exact input to buildGovernedCommercialOpening
  const currentFacts = Array.isArray(frozenProspectContext.currentFacts)
    ? frozenProspectContext.currentFacts
    : [];
  const obligations = Array.isArray(frozenProspectContext.obligations)
    ? frozenProspectContext.obligations
    : [];

  const priorPain = currentFacts.find(
    (fact) =>
      fact &&
      typeof fact === "object" &&
      text((fact as any).slot).includes("pain")
  );

  const openingInput = {
    spokenName: frozenWorker?.spokenName || "",
    prospectName: text(who.contactName) || text(who.companyName),
    offer: text(what.representation?.offer || what.offer),
    audience: text(what.representation?.audience || what.audience),
    relationshipState:
      (frozenProspectContext.relationshipState as "first_contact" | "follow_up") ||
      "first_contact",
    priorPain: priorPain ? text((priorPain as any).summary) : null,
    callbackRequested: obligations.some(
      (obligation) =>
        text((obligation as any).kind) === "callback" &&
        (obligation as any).requestedByProspect === true
    ),
  };

  console.log("[3.1] EXTRACTED INPUT TO buildGovernedCommercialOpening:");
  console.log(`  spokenName:       "${openingInput.spokenName}"`);
  console.log(`  prospectName:     "${openingInput.prospectName}"`);
  console.log(`  offer:            "${openingInput.offer}"`);
  console.log(`  audience:         "${openingInput.audience}"`);
  console.log(`  relationshipState: "${openingInput.relationshipState}"`);
  console.log(`  priorPain:        ${openingInput.priorPain ? `"${openingInput.priorPain}"` : "null"}`);
  console.log(`  callbackRequested: ${openingInput.callbackRequested}`);

  console.log("\n[4] INVOKING buildGovernedCommercialOpening LOCALLY WITH ACTUAL DATA");
  const opening = buildGovernedCommercialOpening(openingInput);
  console.log(`\nOUTPUT:\n"${opening}"`);

  console.log("\n================================================================================");
  console.log("[5] CLASSIFICATION");
  if (opening.includes("Test Contact")) {
    console.log('✓ Opening CORRECTLY uses prospect name "Test Contact"');
  } else if (opening.includes("Controlled Startup Prospect")) {
    console.log('✓ Opening uses company name "Controlled Startup Prospect"');
  } else if (opening.includes("the prospect")) {
    console.log('❌ Opening incorrectly contains "the prospect" (defect in prior diagnosis)');
  } else if (opening.includes("there")) {
    console.log('❌ Opening fell back to "there" (prospectName was empty)');
  }

  console.log("\n================================================================================");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
