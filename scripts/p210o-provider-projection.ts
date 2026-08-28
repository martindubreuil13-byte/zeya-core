#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = createClient(supabaseUrl, supabaseKey);

async function main() {
  console.log("================================================================================");
  console.log("[6] INSPECTING PROVIDER-SAFE RUNTIME PROJECTION BEFORE dispatchWorkerBrief");
  console.log("================================================================================\n");

  // Load the frozen brief
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

  // Extract the dynamicVariables which is what gets sent to provider
  const dynamicVariables = payload.dynamicVariables || {};
  const opening = dynamicVariables.opening;

  console.log("dynamicVariables in brief_payload:");
  Object.entries(dynamicVariables).forEach(([key, value]) => {
    if (key === "opening") {
      console.log(`  ${key}: "${value}"`);
    } else if (key === "prospectContext" && typeof value === "string") {
      console.log(`  ${key}: [prospectGuidance string, length=${(value as string).length}]`);
    } else if (key === "capabilities") {
      console.log(`  ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    } else {
      console.log(`  ${key}: ${typeof value === "string" ? `"${value}"` : JSON.stringify(value)}`);
    }
  });

  console.log("\n[7] OPENING VALUE THAT WOULD BE SENT TO ELEVENLABS:");
  console.log(`\n"${opening}"\n`);

  console.log("================================================================================");
  console.log("[8] VERDICT");
  console.log("================================================================================");
  if (
    opening &&
    opening.includes("Test Contact") &&
    opening.includes("this is Veya") &&
    opening.includes("We spoke previously") &&
    opening.includes("reconnect")
  ) {
    console.log('✓ OPENING IS VALID AND COMPLETE');
    console.log('  - Prospect name correctly used: "Test Contact"');
    console.log('  - Prior contact acknowledged');
    console.log('  - Callback continuity present');
    console.log('\n✓ EXISTING CHAIN IS VALID FOR FINAL CALL');
  } else {
    console.log('❌ OPENING IS INVALID OR INCOMPLETE');
    console.log(`  Contains "Test Contact": ${opening.includes("Test Contact")}`);
    console.log(`  Contains "Veya": ${opening.includes("Veya")}`);
    console.log(`  Contains callback reference: ${opening.includes("reconnect")}`);
  }
  console.log("================================================================================");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
