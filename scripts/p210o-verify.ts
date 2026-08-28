#!/usr/bin/env npx tsx

import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials');
  process.exit(1);
}

const db = createClient(supabaseUrl, supabaseKey);

const LEAD_ID = '16c2ab57-64a7-4339-a843-4411732221ce';
const CONTEXT_ID = '589287d2-9a6c-4ea9-8a3a-9cee36a3e35e';
const BRIEF_ID = 'p25_brief_a83e4f05e2b9406db494e14981c727f0';

async function main() {
  console.log('================================================================================');
  console.log('P2.10O — FROZEN VS CURRENT TARGET IDENTITY VERIFICATION');
  console.log('================================================================================\n');

  // 1. Current Lead
  console.log('[1] CURRENT GOVERNED LEAD');
  const leadRes = await db
    .from('mission_leads')
    .select('id, contact_name, company_name, phone')
    .eq('id', LEAD_ID)
    .single();

  if (leadRes.error) {
    console.error(`❌ Lead query failed: ${leadRes.error.message}`);
    process.exit(1);
  }

  const lead = leadRes.data;
  console.log(`  Lead ID:        ${lead.id}`);
  console.log(`  contact_name:   ${lead.contact_name ?? '(NULL)'}`);
  console.log(`  company_name:   ${lead.company_name ?? '(NULL)'}`);
  console.log(`  phone:          ${lead.phone ?? '(NULL)'}`);

  // 2. Frozen Execution Context
  console.log('\n[2] FROZEN EXECUTION CONTEXT');
  const contextRes = await db
    .from('mission_execution_contexts')
    .select('id, context')
    .eq('id', CONTEXT_ID)
    .single();

  if (contextRes.error) {
    console.error(`❌ Context query failed: ${contextRes.error.message}`);
    process.exit(1);
  }

  const context = contextRes.data.context as Record<string, any>;
  const target = context.target || {};
  console.log(`  Context ID:             ${CONTEXT_ID}`);
  console.log(`  context.target.leadId:  ${target.leadId ?? '(NULL)'}`);
  console.log(`  context.target.contactName: ${target.contactName ?? '(NULL)'}`);
  console.log(`  context.target.companyName: ${target.companyName ?? '(NULL)'}`);

  // 3. Frozen Worker Brief
  console.log('\n[3] FROZEN WORKER BRIEF');
  const briefRes = await db
    .from('worker_briefs')
    .select('id, brief_payload')
    .eq('id', BRIEF_ID)
    .single();

  if (briefRes.error) {
    console.error(`❌ Brief query failed: ${briefRes.error.message}`);
    process.exit(1);
  }

  const briefPayload = briefRes.data.brief_payload as Record<string, any>;
  const prospect = briefPayload.prospect || {};
  const identity = prospect.identity || {};
  console.log(`  Brief ID:                   ${BRIEF_ID}`);
  console.log(`  brief_payload.prospect.identity.contactName: ${identity.contactName ?? '(NULL)'}`);
  console.log(`  brief_payload.prospect.identity.companyName: ${identity.companyName ?? '(NULL)'}`);

  // Classification
  console.log('\n[4] CLASSIFICATION');
  const currentLeadHasName = lead.contact_name && lead.contact_name.trim().length > 0;
  const frozenContextHasName = target.contactName && String(target.contactName).trim().length > 0;
  const frozenBriefHasName = identity.contactName && String(identity.contactName).trim().length > 0;

  if (currentLeadHasName && !frozenContextHasName) {
    console.log('  ✓ DEFECT TYPE A: Lead was updated AFTER mission preparation');
    console.log(`    Current: "${lead.contact_name}"`);
    console.log('    Frozen:  NULL');
    console.log('    → This is historical/frozen-data timing, NOT a current lead defect.');
    console.log('    → Do NOT mutate lead.');
    console.log('    → Create ONE fresh application-path mission to capture current name.');
  } else if (currentLeadHasName && frozenContextHasName) {
    console.log('  ✓ DEFECT TYPE B: Lead name is preserved in frozen context');
    console.log(`    Current: "${lead.contact_name}"`);
    console.log(`    Frozen:  "${target.contactName}"`);
    console.log('    → Data is consistent, issue is NOT in projection.');
    console.log('    → Opening generation may have a fallback logic issue.');
  } else if (!currentLeadHasName) {
    console.log('  ⚠ DEFECT TYPE C: Current lead still has NULL contact_name');
    console.log('    → Must correct via authorized lead-update route');
    console.log('    → Then create fresh mission');
  }

  console.log('\n[5] VERIFICATION STATUS');
  console.log(`  Current lead contact_name populated:    ${currentLeadHasName ? '✓ YES' : '✗ NO'}`);
  console.log(`  Frozen context contactName populated:   ${frozenContextHasName ? '✓ YES' : '✗ NO'}`);
  console.log(`  Frozen brief identity contactName:      ${frozenBriefHasName ? '✓ YES' : '✗ NO'}`);

  console.log('\n================================================================================');
  if (currentLeadHasName && !frozenContextHasName) {
    console.log('VERDICT: CREATE ONE FRESH APPLICATION-PATH MISSION (current lead has name)');
  } else if (!currentLeadHasName) {
    console.log('HOLD: CURRENT LEAD CONTACT_NAME IS NULL — UPDATE REQUIRED VIA AUTHORIZED ROUTE');
  } else {
    console.log('INVESTIGATE: Data consistency verified but opening still failing');
  }
  console.log('================================================================================');
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
