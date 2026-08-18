import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { normalizeOwnerDecisionRepresentationText, projectDirectHireFormationProposal } from '../../lib/formation/direct-hire-proposal';

describe('P2.3D Direct Hire Formation proposal',()=>{
  it('projects only owner-safe proposal content',()=>{
    const result=projectDirectHireFormationProposal({id:'proposal',status:'pending_approval',proposed_changes:{_review:{headline:'Review'},elementUpdates:{whatYouSell:{after:'Business coaching',reason:'Confirmed'}}}});
    expect(result).toEqual({proposalId:'proposal',status:'pending_approval',requiresApproval:true,message:'Review',elementUpdates:[{domain:'whatYouSell',proposedValue:'Business coaching',reason:'Confirmed'}]});
    expect(JSON.stringify(result)).not.toMatch(/fingerprint|evidence|hypothesis|sourceId/i);
  });
  it.each([
    ['Yes. Our primary target is startups.', 'Our primary target is startups.'],
    ['Yes, our primary target is startups.', 'our primary target is startups.'],
    ['Correct. We sell business coaching.', 'We sell business coaching.'],
    ['Correct, we sell business coaching.', 'we sell business coaching.'],
    ["That's right. We sell business coaching.", 'We sell business coaching.'],
    ['That is right, we sell business coaching.', 'we sell business coaching.'],
    ['Confirmed. We sell business coaching.', 'We sell business coaching.'],
    ['We sell business coaching.', 'We sell business coaching.'],
    ['  We sell business coaching.  ', '  We sell business coaching.  '],
    ['Our customers say yes inside the application.', 'Our customers say yes inside the application.'],
  ])('normalizes only a recognized leading owner confirmation: %s', (input, expected) => {
    expect(normalizeOwnerDecisionRepresentationText(input)).toBe(expected);
  });
  it('creates an immutable v2 successor without canonical or voice mutation',async()=>{
    const sql=await readFile('supabase/migrations/20260817010000_direct_hire_formation_proposal_content_normalization.sql','utf8');
    expect(sql).toContain("proposal_contract_version='direct-hire-formation-proposal-v2'");
    expect(sql).toContain("proposal_contract_version='direct-hire-formation-proposal-v1' FOR UPDATE");
    expect(sql).toContain("SET status='superseded',status_updated_at=pg_catalog.now()");
    expect(sql).toContain("v_normalized_target:=btrim(regexp_replace(v_target");
    expect(sql).toContain("'sourceType','formation_decision'");
    expect(sql).toContain("RETURN QUERY SELECT v_existing.id,true");
    expect(sql).not.toMatch(/UPDATE public\.representation_proposals SET (?:proposed_changes|source_)/i);
    expect(sql).not.toMatch(/INSERT INTO public\.(approval_decisions|representation_versions|voice_conversation_outputs)/i);
    expect(sql).not.toMatch(/current_version_id\s*=/i);
  });
  it('uses current finalized outcomes, initial semantics, idempotency, and descriptive domains only',async()=>{
    const sql=await readFile('supabase/migrations/20260817000000_direct_hire_formation_proposal.sql','utf8');
    expect(sql).toContain('zeya_direct_hire_formation_outcome_is_current');
    expect(sql).toContain("v_run.completion_readiness_result->>'ready'<>'true'");
    expect(sql).toContain('representation_proposals_direct_hire_source_unique');
    expect(sql).toContain("canonicalization_intent='initial_canonicalization'");
    for(const domain of ['whatYouSell','whoItIsFor','problemOrAspiration','whyCustomersShouldCare','proposedDescription']) expect(sql).toContain(domain);
    expect(sql).not.toMatch(/jsonb_build_object\('authorityBoundaries'/);
    expect(sql).not.toMatch(/INSERT INTO public\.(approval_decisions|representation_versions|voice_conversation_outputs)/i);
    expect(sql).not.toMatch(/current_version_id\s*=/i);
  });
  it('ships read-only exact-target manual checks and an owner-authenticated endpoint',async()=>{
    const [pre,post,route]=await Promise.all([
      readFile('supabase/manual/20260817_direct_hire_formation_proposal_preflight.sql','utf8'),
      readFile('supabase/manual/20260817_direct_hire_formation_proposal_postcheck.sql','utf8'),
      readFile('app/api/formation/sessions/[sessionId]/proposal/route.ts','utf8'),
    ]);
    for(const sql of [pre,post]) expect(sql).not.toMatch(/^\s*(?:INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|CALL)\b/im);
    expect(route).toContain('createAuthenticatedRepresentationContext');
    expect(route).not.toMatch(/approval_decisions|representation_versions|voice/i);
  });
});
