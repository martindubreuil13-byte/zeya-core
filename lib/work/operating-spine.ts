export const CHANNELS = ['phone','email','research'] as const;
export const PRIORITIES = ['low','normal','high'] as const;
export const isUuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export const isNonEmpty=(value:unknown):value is string=>typeof value==='string'&&value.trim().length>0;

export function ownerSafeLead(row:Record<string,unknown>){
  return {id:row.id,companyName:row.company_name,contactName:row.contact_name,phone:row.phone,email:row.email,source:row.source,status:row.status,notes:row.notes,createdAt:row.created_at};
}
export function ownerSafeMission(row:Record<string,unknown>){
  return {id:row.id,leadId:row.lead_id,representationVersionId:row.representation_version_id,objective:row.objective,qualificationGoal:row.qualification_goal,desiredNextStep:row.desired_next_step,channel:row.allowed_channel,constraints:row.constraints,notes:row.notes,priority:row.priority,status:row.status,createdAt:row.created_at};
}
