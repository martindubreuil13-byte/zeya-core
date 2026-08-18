import { NextRequest,NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';
import { createExperienceServiceClient } from '@/lib/experience/public-session-server';
import { isNonEmpty,isUuid,ownerSafeLead } from '@/lib/work/operating-spine';

const fail=(error:string,status:number)=>NextResponse.json({success:false,error},{status});
export async function POST(request:NextRequest){
  const auth=await createAuthenticatedRepresentationContext(request);if(auth instanceof NextResponse)return auth;
  let body:Record<string,unknown>;try{body=await request.json();}catch{return fail('invalid_request',400);}
  if(!isUuid(body.businessRepresentationId)||!isUuid(body.operationId)||!isNonEmpty(body.companyName)
    ||(!isNonEmpty(body.phone)&&!isNonEmpty(body.email)))return fail('invalid_lead',400);
  const db=createExperienceServiceClient();
  const result=await db.rpc('zeya_create_operating_lead',{p_owner_id:auth.user.id,p_business_representation_id:body.businessRepresentationId,p_operation_id:body.operationId,p_company_name:body.companyName,p_contact_name:body.contactName??null,p_phone:body.phone??null,p_email:body.email??null,p_source:body.source??'manual',p_notes:body.notes??null});
  if(result.error)return fail(result.error.code==='PZ404'?'representation_not_found':'lead_not_eligible',result.error.code==='PZ404'?404:409);
  const created=result.data?.[0];
  const lead=created&&await db.from('mission_leads').select('id,company_name,contact_name,phone,email,source,status,notes,created_at').eq('id',created.lead_id).eq('business_representation_id',body.businessRepresentationId).maybeSingle();
  if(!lead||lead.error||!lead.data)return fail('lead_persistence_failed',500);
  return NextResponse.json({success:true,data:{...ownerSafeLead(lead.data),replayed:created.replayed}},{status:created.replayed?200:201});
}
