#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const db = createClient(supabaseUrl, supabaseKey);

async function main() {
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

  console.log("================================================================================");
  console.log("BRIEF_PAYLOAD TOP-LEVEL STRUCTURE");
  console.log("================================================================================\n");
  
  console.log("Keys:", Object.keys(payload).join(", "));
  console.log("\nLooking for 'opening' value:");
  
  // Search for where opening might be
  if (payload.dynamicVariables?.opening) {
    console.log("Found at: payload.dynamicVariables.opening");
    console.log(`Value: "${payload.dynamicVariables.opening}"`);
  } else if (payload.opening) {
    console.log("Found at: payload.opening");
    console.log(`Value: "${payload.opening}"`);
  } else {
    console.log("Not found in dynamicVariables or top level");
    console.log("\nSearching all nested fields:");
    
    const search = (obj: any, path: string = ""): void => {
      if (obj === null || obj === undefined) return;
      if (typeof obj === "string" && obj.includes("Hi") && obj.includes("Test Contact")) {
        console.log(`Found candidate at ${path}: "${obj.substring(0, 100)}..."`);
        return;
      }
      if (typeof obj === "object" && !Array.isArray(obj)) {
        Object.entries(obj).forEach(([k, v]) => {
          search(v, `${path}.${k}`);
        });
      }
    };
    
    search(payload);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
