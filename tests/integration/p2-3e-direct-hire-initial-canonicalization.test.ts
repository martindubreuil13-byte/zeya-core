import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ownerSafeInitialCanonicalization } from '../../lib/formation/direct-hire-initial-canonicalization';

describe('P2.3E Direct Hire initial canonicalization',()=>{
  it('returns only owner-safe canonical content',()=>{
    const result=ownerSafeInitialCanonicalization({approved:true,replayed:false,version_id:'v',proposal_status:'approved',representation:{whatYouSell:{value:'Business coaching'},whoItIsFor:{value:'Startups'}}});
    expect(result).toEqual({approved:true,replayed:false,versionId:'v',status:'approved',representation:[{domain:'whatYouSell',value:'Business coaching'},{domain:'whoItIsFor',value:'Startups'}]});
    expect(JSON.stringify(result)).not.toMatch(/fingerprint|evidence|hypothesis|service/i);
  });
  it('governs approval, rejection, correction, replay, staleness, and atomic version creation',async()=>{
    const sql=await readFile('supabase/migrations/20260818000000_direct_hire_initial_canonicalization.sql','utf8');
    for(const marker of [
      'FOR UPDATE',"v_proposal.status<>'pending_approval'","proposal_contract_version<>'direct-hire-formation-proposal-v2'",
      "canonicalization_intent<>'initial_canonicalization'",'base_representation_version_id IS NOT NULL','v_rep.current_version_id IS NOT NULL',
      'zeya_direct_hire_formation_outcome_is_current',"completion_readiness_result->>'ready'<>'true'",'source_state_fingerprint IS DISTINCT FROM v_fingerprint',
      'decision operation conflicts','INSERT INTO public.approval_decisions','INSERT INTO public.representation_versions',
      'UPDATE public.business_representations SET current_version_id=v_version.id','UPDATE public.representation_proposals SET status=\'approved\'',
      'INSERT INTO public.audit_events',"p_decision<>'approve'",
    ]) expect(sql).toContain(marker);
    expect(sql).toContain("entry.key IN ('whatYouSell','whoItIsFor','problemOrAspiration','whyCustomersShouldCare','proposedDescription')");
    expect(sql).not.toContain('jsonb_object_length(');
    expect(sql).toContain("SELECT count(*) INTO v_proposed_element_count\n  FROM jsonb_each(coalesce(v_proposal.proposed_changes->'elementUpdates','{}'::jsonb))");
    expect(sql).toContain('SELECT count(*) INTO v_accepted_element_count FROM jsonb_each(v_values)');
    expect(sql).toContain('v_accepted_element_count=0 OR v_accepted_element_count<>v_proposed_element_count');
    expect(sql).not.toMatch(/entry\.key IN \([^)]*(?:pricing|discount|negotiation|meeting|qualification|authority)/i);
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE public\.)voice_/i);
    expect(sql).not.toMatch(/UPDATE public\.representation_formation_sessions/i);
  });
  it('keeps the RPC service-only behind authenticated ownership',async()=>{
    const route=await readFile('app/api/formation/sessions/[sessionId]/proposal/[proposalId]/decision/route.ts','utf8');
    const sql=await readFile('supabase/migrations/20260818000000_direct_hire_initial_canonicalization.sql','utf8');
    expect(route).toContain('createAuthenticatedRepresentationContext');
    expect(route).toContain('p_owner_id:auth.user.id');
    expect(sql).toContain("auth.role()<>'service_role'");
    expect(sql).toContain('REVOKE ALL ON FUNCTION');
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION');
  });
  it('makes replay scope and complete lineage checks explicit',async()=>{
    const sql=await readFile('supabase/migrations/20260818000000_direct_hire_initial_canonicalization.sql','utf8');
    expect(sql).toContain('approver_user_id=p_owner_id AND operation_id=p_operation_id');
    expect(sql).toContain("MESSAGE='decision operation conflicts'");
    expect(sql).toContain('v_approval.source_state_fingerprint IS DISTINCT FROM v_proposal.source_state_fingerprint');
    expect(sql).toContain('source_approval_id=v_approval.id');
    expect(sql).toContain('v_rep.current_version_id IS DISTINCT FROM v_version.id');
    expect(sql).toContain("p_decision<>'approve' AND (v_approval.resulting_version_id IS NOT NULL OR v_proposal.status<>'rejected'");
    expect(sql).toContain("IF p_decision<>'approve' OR v_approval.decision<>'approved'");
  });
});
