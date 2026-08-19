import { readFile } from 'node:fs/promises';
import { describe,expect,it } from 'vitest';
import { prepareMissionErrorResponse } from '../../lib/work/prepare-mission-error';

describe('P2.4 prepare route diagnostics',()=>{
  it('preserves PZ404 and PZ409 public contracts',()=>{
    expect(prepareMissionErrorResponse({code:'PZ404',message:'mission not found'},'production')).toEqual({
      body:{success:false,error:'mission_not_found'},status:404,
    });
    expect(prepareMissionErrorResponse({code:'PZ409',message:'mission is not preparable'},'production')).toEqual({
      body:{success:false,error:'mission_stale_or_not_preparable'},status:409,
    });
  });

  it.each(['42P01','23503','42703'])('keeps %s a safe public 409 while exposing its code in Preview',code=>{
    const response=prepareMissionErrorResponse({
      code,
      message:'relation "v_stored" does not exist',
      detail:'SELECT secret FROM internal_table',
      hint:'inspect service_role key',
      stack:'database stack',
    } as Parameters<typeof prepareMissionErrorResponse>[0],'preview');
    expect(response).toEqual({
      body:{success:false,error:'mission_stale_or_not_preparable',diagnostic:{dbCode:code}},status:409,
    });
    expect(JSON.stringify(response)).not.toMatch(/SELECT|internal_table|service_role|stack|detail|hint|v_stored/);
  });

  it('allowlists controlled RPC messages in Preview only',()=>{
    for(const message of ['mission source lineage is stale','mission is not preparable','prepared context lineage is incomplete']){
      expect(prepareMissionErrorResponse({code:'PZ409',message},'preview').body).toHaveProperty('diagnostic.dbMessage',message);
    }
    expect(prepareMissionErrorResponse({code:'PZ409',message:'arbitrary database internals'},'preview').body).toEqual({
      success:false,error:'mission_stale_or_not_preparable',diagnostic:{dbCode:'PZ409'},
    });
    expect(prepareMissionErrorResponse({code:'42P01',message:'internal'},'production').body).toEqual({
      success:false,error:'mission_stale_or_not_preparable',
    });
  });

  it('leaves the successful route response unchanged',async()=>{
    const route=await readFile('app/api/work/missions/[missionId]/prepare/route.ts','utf8');
    expect(route).toContain("{success:true,data:{missionId:row.mission_id,status:row.status,replayed:row.replayed,executionContext:row.execution_context}}");
    expect(route).toContain('{status:row.replayed?200:201}');
  });
});
