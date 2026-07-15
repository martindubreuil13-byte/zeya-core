import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type AuthFixture={id:string;email:string}; export type BusinessFixture={id:string;userId:string};
export type RepresentationFixture={id:string;businessId:string};
export class FixtureRegistry {
  readonly createdAt=new Date().toISOString(); readonly authUsers:AuthFixture[]=[]; readonly businesses:BusinessFixture[]=[]; readonly representations:RepresentationFixture[]=[];
  readonly domainIds:string[]=[]; readonly elementIds:string[]=[]; readonly evidenceIds:string[]=[]; readonly observationIds:string[]=[]; readonly proposalIds:string[]=[]; readonly proposalEvidenceIds:string[]=[]; readonly proposalObservationIds:string[]=[]; readonly proposalElementIds:string[]=[]; readonly approvalIds:string[]=[]; readonly versionIds:string[]=[]; readonly confidenceIds:string[]=[]; readonly auditIds:string[]=[];
  constructor(readonly runId=crypto.randomUUID()){}
  get recoveryFile(){return join(process.cwd(),'.test-artifacts',`representation-${this.runId}.json`)}
  registerAuthUser(id:string,email:string){this.authUsers.push({id,email})} registerBusiness(id:string,userId:string){this.businesses.push({id,userId})} registerBusinessRepresentation(id:string,businessId:string){this.representations.push({id,businessId})}
  registerDomain(id:string){this.domainIds.push(id)} registerElement(id:string){this.elementIds.push(id)} registerEvidence(id:string){this.evidenceIds.push(id)} registerObservation(id:string){this.observationIds.push(id)} registerProposal(id:string){this.proposalIds.push(id)} registerApproval(id:string){this.approvalIds.push(id)} registerVersion(id:string){this.versionIds.push(id)} registerConfidenceAssessment(id:string){this.confidenceIds.push(id)} registerAuditEvent(id:string){this.auditIds.push(id)}
  async writeRecovery(failures:string[]){await mkdir(join(process.cwd(),'.test-artifacts'),{recursive:true});await writeFile(this.recoveryFile,JSON.stringify({...this,failures},null,2))} async clearRecovery(){await rm(this.recoveryFile,{force:true})}
}
