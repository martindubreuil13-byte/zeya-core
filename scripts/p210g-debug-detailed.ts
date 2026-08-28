#!/usr/bin/env npx tsx
import { createClient } from '@supabase/supabase-js';

const QA_OWNER_ID = 'da53cf7f-beb1-4168-a0cb-015610f092fc';

async function debug() {
  const db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } }
  );

  const d = (await db.from('dispatches').select('*').eq('owner_id', QA_OWNER_ID).order('created_at', { ascending: false }).limit(1).single()).data;
  const b = (await db.from('worker_briefs').select('*').eq('id', d?.worker_brief_id).single()).data;
  const m = (await db.from('operating_missions').select('*').eq('id', d?.mission_id).single()).data;
  const c = (await db.from('mission_execution_contexts').select('*').eq('id', d?.execution_context_id).single()).data;
  const r = (await db.from('business_representations').select('*').eq('id', d?.business_representation_id).single()).data;
  const l = (await db.from('mission_leads').select('*').eq('id', d?.lead_id).single()).data;
  const o = (await db.from('direct_hire_formation_outcome_packages').select('*').eq('id', d?.mandate_outcome_package_id).single()).data;

  console.log('\n╔═══════════════════════════════════════════════════════════╗\n');
  console.log('DISPATCH LINEAGE DETAILED CHECK\n');

  const checks = [
    ['dispatch.id present', !!d?.id],
    ['dispatch.execution_context_id present', !!d?.execution_context_id],
    ['dispatch.status=draft', d?.status === 'draft'],
    ['dispatch.execution_allowed IS NULL check', d?.execution_allowed !== null],
    ['dispatch.worker_role correct', d?.worker_role === 'outbound_business_development_voice_worker'],
    ['dispatch.channel=phone', d?.channel === 'phone'],
    ['brief found', !!b?.id],
    ['brief.execution_allowed matches dispatch', b?.execution_allowed === d?.execution_allowed],
    ['brief.source_fingerprint matches dispatch', b?.source_fingerprint === d?.source_fingerprint],
    ['brief.operating_mission_id matches dispatch.mission_id', b?.operating_mission_id === d?.mission_id],
    ['brief.execution_context_id matches dispatch', b?.execution_context_id === d?.execution_context_id],
    ['brief.representation_version_id matches dispatch', b?.representation_version_id === d?.representation_version_id],
    ['brief.mandate_outcome_package_id matches dispatch', b?.mandate_outcome_package_id === d?.mandate_outcome_package_id],
    ['brief.lead_id matches dispatch', b?.lead_id === d?.lead_id],
    ['mission found', !!m?.id],
    ['mission.status=ready', m?.status === 'ready'],
    ['mission.representation_version_id matches dispatch', m?.representation_version_id === d?.representation_version_id],
    ['mission.mandate_outcome_package_id matches dispatch', m?.mandate_outcome_package_id === d?.mandate_outcome_package_id],
    ['mission.lead_id matches dispatch', m?.lead_id === d?.lead_id],
    ['context found', !!c?.id],
    ['context contract version valid', ['operating-execution-context-v1', 'operating-execution-context-v2'].includes(c?.context_contract_version)],
    ['representation found', !!r?.id],
    ['representation.current_version_id matches dispatch', r?.current_version_id === d?.representation_version_id],
    ['lead found', !!l?.id],
    ['outcome found', !!o?.id],
  ];

  for (const [name, result] of checks) {
    console.log(`  ${result ? '✓' : '✗'} ${name}`);
  }

  // Check context fingerprint calculation
  console.log(`\nContext fingerprint validation:`);
  if (c?.context) {
    const crypto = require('crypto');
    const contextStr = typeof c.context === 'string' ? c.context : JSON.stringify(c.context);
    const hash = crypto.createHash('sha256').update(contextStr, 'utf8').digest('hex');
    console.log(`  Calculated: ${hash.substring(0, 16)}...`);
    console.log(`  Stored: ${c?.context_fingerprint?.substring(0, 16)}...`);
    console.log(`  ${hash === c?.context_fingerprint ? '✓' : '✗'} Match`);
  }

  // Check mission lead fingerprint
  console.log(`\nMission lead fingerprint:`);
  console.log(`  Mission stored: ${m?.lead_fingerprint?.substring(0, 16)}...`);
  if (l) {
    const fingerRes = await db.rpc('zeya_p24_lead_fingerprint', { p_lead: l });
    console.log(`  Calculated: ${fingerRes.data?.substring(0, 16)}...`);
    console.log(`  ${m?.lead_fingerprint === fingerRes.data ? '✓' : '✗'} Match`);
  }

  // Check outcome readiness
  console.log(`\nOutcome readiness:`);
  console.log(`  ready: ${o?.readiness_result?.ready}`);
  console.log(`  outcome_fingerprint: ${o?.outcome_fingerprint?.substring(0, 16)}...`);
  console.log(`  mandate_fingerprint: ${m?.mandate_fingerprint?.substring(0, 16)}...`);
  console.log(`  ${o?.outcome_fingerprint === m?.mandate_fingerprint ? '✓' : '✗'} Fingerprints match`);

  // Check outcome current status
  console.log(`\nOutcome currency check:`);
  const outcomeCurrentRes = await db.rpc('zeya_direct_hire_formation_outcome_is_current', {
    p_owner_id: QA_OWNER_ID,
    p_outcome_package_id: o?.id,
  });
  console.log(`  zeya_direct_hire_formation_outcome_is_current: ${outcomeCurrentRes.data}`);

  console.log('\n╚═══════════════════════════════════════════════════════════╝\n');
}

debug().catch(e => { console.error(e); process.exit(1); });
