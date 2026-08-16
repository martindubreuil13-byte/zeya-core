import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { projectDirectHireFormationProposal } from '../../lib/formation/direct-hire-proposal';

describe('P2.3D Direct Hire Formation proposal',()=>{
  it('projects only owner-safe proposal content',()=>{
    const result=projectDirectHireFormationProposal({id:'proposal',status:'pending_approval',proposed_changes:{_review:{headline:'Review'},elementUpdates:{whatYouSell:{after:'Business coaching',reason:'Confirmed'}}}});
    expect(result).toEqual({proposalId:'proposal',status:'pending_approval',requiresApproval:true,message:'Review',elementUpdates:[{domain:'whatYouSell',proposedValue:'Business coaching',reason:'Confirmed'}]});
    expect(JSON.stringify(result)).not.toMatch(/fingerprint|evidence|hypothesis|sourceId/i);
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
