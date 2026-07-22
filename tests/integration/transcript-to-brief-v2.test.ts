import assert from "node:assert/strict";
import {classifyEvidenceStatement,generateRepresentationBrief,type RepresentationBriefInput} from "../../lib/experience/representation-brief-generator";

const make=(zeya:string[]=[],veya:string[]=[],providerSummary:string|null=null):RepresentationBriefInput=>({visitorName:"Visitor",businessOffer:null,targetCustomer:null,zeyaTranscript:zeya.map((text,i)=>({role:"user",text,id:`z${i}`})),veyaTranscript:veya.map((text,i)=>({role:"customer",text,id:`v${i}`})),providerSummary});
const valid=(fixture:RepresentationBriefInput)=>{const result=generateRepresentationBrief(fixture);assert.equal(result.status,"valid");if(result.status!=="valid")throw new Error("brief invalid");return result.brief};

const coaching=valid(make(
  ["I provide business coaching.","I mainly work with small businesses and startups."],
  ["People find me through social media or direct contact.","I don't do cold outreach.","I just don't have enough time to call potential customers.","That would save me some time.","A bit of embarrassment because it's a shame."],
  "The visitor provides business coaching to small businesses and startups and lacks time for outbound calls.",
));
const coachingText=[coaching.whatIHeard,coaching.whatStoodOut,coaching.whatThatMayMean,coaching.whereIWouldBegin].join(" ").toLowerCase();
assert.match(coachingText,/business coaching/);assert.match(coachingText,/small businesses and startups/);assert.match(coachingText,/social media|direct contact/);assert.match(coachingText,/time/);assert.match(coachingText,/cold outreach/);assert.match(coaching.whereIWouldBegin.toLowerCase(),/conversations/);assert.match(coaching.whereIWouldBegin.toLowerCase(),/expertise/);assert(!coaching.whatIHeard.toLowerCase().includes("embarrass"));assert(!coaching.whereIWouldBegin.toLowerCase().includes("embarrass"));assert.equal(new Set([coaching.whatIHeard,coaching.whatStoodOut,coaching.whatThatMayMean,coaching.whereIWouldBegin]).size,4);

valid(make(["We build inventory software for independent retailers."],["It reduces manual stock checks before ordering."])); // product
assert.equal(generateRepresentationBrief(make(["I help owners."],[])).status,"requires_clarification"); // sparse
valid(make(["We provide leadership training."],["The customers are startup founders and small business owners."])); // mixed fragments
assert.deepEqual(classifyEvidenceStatement("That feels embarrassing and a bit awkward."),["personal_reaction"]); // filler
valid(make(["At first we sold training, but we actually provide implementation support."],["Clients return for implementation support."])); // contradiction
assert(classifyEvidenceStatement("I don't do cold outreach.").includes("sales_activity")); // no outbound
assert(classifyEvidenceStatement("We prospect every weekday and run outbound sales conversations.").includes("sales_activity")); // active outbound
valid(make(["I provide bookkeeping for independent retailers."],["They get a clearer weekly view of cash."],null)); // missing summary
valid(make(["I run operational coaching for restaurant owners."],["I have no time for prospect calls."])); // delayed transcript represented by Veya arriving later
valid(make(["I advise clinics on patient communication.","The goal is fewer missed follow-ups."],[])); // failed call, browser evidence usable
const rejected=valid(make(["We provide marketing services for restaurants."],["I do not agree that lead volume is our constraint; retention is the problem."]));assert.match(rejected.whatStoodOut.toLowerCase(),/retention|problem|commercial/); // rejected hypothesis evidence

console.log("Transcript-to-brief V2 regressions (12 scenarios) — PASS");
