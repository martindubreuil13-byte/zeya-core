const SAFE_PREPARE_MESSAGES=new Set([
  'mission source lineage is stale',
  'mission is not preparable',
  'prepared context lineage is incomplete',
]);

type PrepareDatabaseError={code?:string|null;message?:string|null};

export function prepareMissionErrorResponse(error:PrepareDatabaseError,vercelEnv=process.env.VERCEL_ENV){
  const notFound=error.code==='PZ404';
  const body:{
    success:false;
    error:'mission_not_found'|'mission_stale_or_not_preparable';
    diagnostic?:{dbCode:string;dbMessage?:string};
  }={
    success:false,
    error:notFound?'mission_not_found':'mission_stale_or_not_preparable',
  };
  if(vercelEnv==='preview'&&error.code){
    body.diagnostic={dbCode:error.code};
    if(error.message&&SAFE_PREPARE_MESSAGES.has(error.message))body.diagnostic.dbMessage=error.message;
  }
  return {body,status:notFound?404:409};
}
