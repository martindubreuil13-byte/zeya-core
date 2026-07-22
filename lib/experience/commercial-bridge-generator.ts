import type {RepresentationBrief} from "@/types/experience";

export type CommercialBridge={
  constraint:string;desiredBenefit:string|null;hypothesis:string;direction:string;
  recognition:string;roleExplanation:string;boundaries:string;hiringInvitation:string;
  recognitionPhrase:string;rolePhrases:string[];boundaryPhrases:string[];
  onboardingIntroduction:string;onboardingSteps:string[];onboardingClose:string;
};

const clean=(value:string)=>value.replace(/[“”"]/g,"").replace(/\s+/g," ").trim();
function evidenceText(brief:RepresentationBrief){return brief.evidenceSources.map(source=>source.excerpt).join(" ").toLowerCase()}
export function generateCommercialBridge(brief:RepresentationBrief,correction?:string|null):CommercialBridge{
  const evidence=evidenceText(brief),meaning=clean(brief.whatThatMayMean),direction=clean(brief.whereIWouldBegin);
  let constraint="too many important commercial conversations still depend on your personal time";
  if(/trust|credib|reassur|confidence/.test(evidence))constraint="trust has to be established before a useful commercial conversation can move forward";
  else if(/follow[ -]?up|fragment/.test(evidence))constraint="valuable conversations are not always followed through consistently";
  else if(/unclear|position|explain|message/.test(evidence))constraint="the value of the business is not always easy for the right people to understand quickly";
  else if(/reach|discover|find you|social media|referral|word of mouth/.test(evidence)&&!/time|busy|capacity/.test(evidence))constraint="reaching the right people depends on a narrow or inconsistent path";
  else if(/qualif/.test(evidence))constraint="your time can be consumed before genuine interest is clear";
  else if(/time|busy|capacity|personally/.test(`${evidence} ${meaning.toLowerCase()}`))constraint="too many commercial conversations still depend on you personally finding the time to begin them";
  const benefitSource=brief.evidenceSources.find(source=>/save|allow|more|reduce|free|consisten|faster|time/i.test(source.excerpt));
  const desiredBenefit=benefitSource?clean(benefitSource.excerpt):null;
  const correctionLine=correction?.trim()?` I’ve also kept your correction in view: ${clean(correction)}.`:"";
  return{
    constraint,desiredBenefit,hypothesis:meaning,direction,
    recognition:`Good. Then I think I understand the beginning of the opportunity. ${meaning} In practical terms, ${constraint}.${correctionLine}`,
    roleExplanation:`If we worked together, I could help begin informed conversations grounded in this Representation. I could understand what a prospect needs, respond only within what you have approved, and recognize when there is a genuine reason for you to become involved. ${direction}`,
    boundaries:"I would not pretend to be you. I would not invent claims or make promises you have not approved. I would represent the business within boundaries we define together, and bring the conversation back to you whenever your judgment matters.",
    hiringInvitation:"Would you like me to show you what hiring me would involve?",
    recognitionPhrase:"The opportunity I see",rolePhrases:["Begin the right conversations","Understand genuine interest","Bring you in when it matters"],boundaryPhrases:["Accurate","Approved","Under your control"],
    onboardingIntroduction:"Before I could responsibly represent your business, we would need to work through four things together.",
    onboardingSteps:["Understand the business","Define the customer","Set the boundaries","Approve the Representation"],
    onboardingClose:"If that makes sense, I just need the basics so we can preserve what we’ve learned today.",
  };
}
