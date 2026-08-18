import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext, isUuid } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { DIRECT_HIRE_FORMATION_PROPOSAL_CONTRACT, projectDirectHireFormationProposal, type DirectHireProposalRow } from '@/lib/formation/direct-hire-proposal';

const failure = (error: string, status: number) => NextResponse.json({ success: false, error }, { status });

async function loadProposal(client: ReturnType<typeof createExperienceServiceClient>, sessionId: string, ownerId: string) {
  const result = await client.from('representation_proposals').select('id,status,proposed_changes,business_representations!inner(user_id)')
    .eq('formation_session_id', sessionId).eq('proposal_contract_version', DIRECT_HIRE_FORMATION_PROPOSAL_CONTRACT)
    .eq('business_representations.user_id', ownerId).maybeSingle();
  if (result.error) throw new Error('proposal_lookup_failed');
  return result.data ? projectDirectHireFormationProposal(result.data as unknown as DirectHireProposalRow) : null;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await createAuthenticatedRepresentationContext(request); if (auth instanceof NextResponse) return auth;
  const sessionId=(await params).sessionId; if(!isUuid(sessionId)) return failure('invalid_session_id',400);
  try { return NextResponse.json({success:true,data:await loadProposal(createExperienceServiceClient(),sessionId,auth.user.id)}); }
  catch { return failure('proposal_lookup_failed',500); }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ sessionId: string }> }) {
  const auth = await createAuthenticatedRepresentationContext(request); if (auth instanceof NextResponse) return auth;
  const sessionId=(await params).sessionId; if(!isUuid(sessionId)) return failure('invalid_session_id',400);
  try {
    const service=createExperienceServiceClient();
    const result=await service.rpc('zeya_generate_direct_hire_formation_proposal',{p_owner_id:auth.user.id,p_formation_session_id:sessionId});
    if(result.error) return failure('formation_proposal_not_eligible',409);
    const proposal=await loadProposal(service,sessionId,auth.user.id); if(!proposal) return failure('proposal_persistence_failed',500);
    return NextResponse.json({success:true,data:proposal},{status:result.data?.[0]?.replayed?200:201});
  } catch { return failure('proposal_generation_failed',500); }
}
