// Call Outcome Simulator — Generate realistic simulated call outcomes

import { buildCallOutcome } from "./call-outcome-builder";
import type { CallOutcome, OutcomeType, Sentiment } from "./call-outcome-types";
import type { WorkerBrief } from "@/lib/workers";

function getRandomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function getRandomElement<T>(array: T[]): T {
  return array[Math.floor(Math.random() * array.length)];
}

// Distribution of outcomes (realistic for cold calling)
const OUTCOME_DISTRIBUTION = [
  { type: "INTERESTED" as const, weight: 70 },
  { type: "MEETING_BOOKED" as const, weight: 10 },
  { type: "CALL_BACK" as const, weight: 10 },
  { type: "NOT_INTERESTED" as const, weight: 5 },
  { type: "NO_ANSWER" as const, weight: 3 },
  { type: "VOICEMAIL" as const, weight: 1 },
  { type: "WRONG_CONTACT" as const, weight: 0.5 },
  { type: "FAILED" as const, weight: 0.5 },
];

function selectOutcomeType(): OutcomeType {
  const random = Math.random() * 100;
  let accumulated = 0;

  for (const { type, weight } of OUTCOME_DISTRIBUTION) {
    accumulated += weight;
    if (random <= accumulated) {
      return type;
    }
  }

  return "INTERESTED"; // Default fallback
}

function generateSummaryForOutcome(
  outcomeType: OutcomeType,
  targetName?: string
): { summary: string; sentiment: Sentiment; objections: string[]; keyInsights: string[] } {
  const target = targetName || "prospect";

  const summaries: Record<
    OutcomeType,
    {
      summary: string;
      sentiment: Sentiment;
      objections: string[];
      keyInsights: string[];
    }[]
  > = {
    INTERESTED: [
      {
        summary: `${target} showed strong interest in learning more about the product. Discussed pain points and use cases.`,
        sentiment: "POSITIVE",
        objections: [],
        keyInsights: [
          "Budget approved for Q3",
          "2-3 other decision makers involved",
          "Current solution has limitations with reporting",
        ],
      },
      {
        summary: `${target} confirmed they have been looking for a solution to their current challenges.`,
        sentiment: "POSITIVE",
        objections: [],
        keyInsights: [
          "Timeline is flexible",
          "Budget already allocated for this",
          "Similar solution trial failed last year",
        ],
      },
      {
        summary: `${target} engaged positively throughout the call and asked detailed questions about implementation.`,
        sentiment: "POSITIVE",
        objections: [],
        keyInsights: [
          "Needs integration with existing system",
          "Team size: 5 people in operations",
          "Currently using manual process",
        ],
      },
    ],
    NOT_INTERESTED: [
      {
        summary: `${target} explained they are satisfied with their current solution.`,
        sentiment: "NEUTRAL",
        objections: ["Happy with current vendor", "No immediate need"],
        keyInsights: ["Open to revisiting in 6-12 months", "Would recommend if needs change"],
      },
      {
        summary: `${target} indicated they are not looking to make changes right now.`,
        sentiment: "NEUTRAL",
        objections: ["Wrong timing", "No budget available"],
        keyInsights: ["Situation may change next fiscal year", "Keep for future outreach"],
      },
    ],
    CALL_BACK: [
      {
        summary: `${target} was interested but too busy to continue. Requested a callback at a specific time.`,
        sentiment: "POSITIVE",
        objections: ["Timing not right for call"],
        keyInsights: ["Will have more time on Thursday afternoon", "Promised to look at materials in advance"],
      },
      {
        summary: `${target} needs to check with team before committing. Wants to reconnect after internal discussion.`,
        sentiment: "POSITIVE",
        objections: ["Needs team input"],
        keyInsights: ["Likely decision within 2 weeks", "Team meeting scheduled for next week"],
      },
    ],
    MEETING_BOOKED: [
      {
        summary: `Successfully scheduled a 30-minute discovery meeting with ${target} for next week.`,
        sentiment: "POSITIVE",
        objections: [],
        keyInsights: [
          "Meeting: Tuesday 2pm EST",
          "Attendees: ${target} + one additional stakeholder",
          "Focus: product demo and ROI discussion",
        ],
      },
      {
        summary: `${target} committed to a demo call and will have team members present.`,
        sentiment: "POSITIVE",
        objections: [],
        keyInsights: [
          "Meeting: Thursday 10am PST",
          "3 people attending",
          "Sent pre-call materials",
        ],
      },
    ],
    NO_ANSWER: [
      {
        summary: `${target} did not answer the call.`,
        sentiment: "NEUTRAL",
        objections: [],
        keyInsights: ["Phone went to voicemail", "During business hours"],
      },
    ],
    VOICEMAIL: [
      {
        summary: `Left voicemail for ${target} with call-back request.`,
        sentiment: "NEUTRAL",
        objections: [],
        keyInsights: ["Professional message left", "Request for return call within 24 hours"],
      },
    ],
    WRONG_CONTACT: [
      {
        summary: `${target} is no longer at the organization.`,
        sentiment: "NEGATIVE",
        objections: ["Person no longer employed"],
        keyInsights: ["Contact information outdated", "Need updated prospect list"],
      },
    ],
    FAILED: [
      {
        summary: `Call failed due to technical issues. Will retry shortly.`,
        sentiment: "NEGATIVE",
        objections: [],
        keyInsights: ["Technical issue: connection dropped", "Retry attempted"],
      },
    ],
  };

  const options = summaries[outcomeType];
  return getRandomElement(options);
}

export function simulateCallOutcome(workerBrief: WorkerBrief): CallOutcome {
  const outcomeType = selectOutcomeType();
  const { summary, sentiment, objections, keyInsights } = generateSummaryForOutcome(
    outcomeType,
    workerBrief.leadContext
  );

  // Simulate call duration (realistic range for cold calls: 30 seconds to 5 minutes)
  const callDurationSeconds = getRandomInt(30, 300);

  // Determine meeting booking
  const meetingBooked = outcomeType === "MEETING_BOOKED";
  let meetingDate;
  if (meetingBooked) {
    const daysUntilMeeting = getRandomInt(1, 7);
    const meetingTime = new Date();
    meetingTime.setDate(meetingTime.getDate() + daysUntilMeeting);
    meetingTime.setHours(getRandomInt(9, 17), 0, 0, 0);
    meetingDate = meetingTime.toISOString();
  }

  // Determine follow-up date if needed
  let followUpDate;
  if (outcomeType === "CALL_BACK" || outcomeType === "VOICEMAIL") {
    const daysUntilFollowUp = getRandomInt(1, 3);
    const followUpTime = new Date();
    followUpTime.setDate(followUpTime.getDate() + daysUntilFollowUp);
    followUpDate = followUpTime.toISOString();
  }

  // Determine next action
  let nextAction;
  if (outcomeType === "INTERESTED") {
    nextAction = "Send product materials and schedule follow-up demo";
  } else if (outcomeType === "MEETING_BOOKED") {
    nextAction = "Prepare demo materials and confirm meeting details";
  } else if (outcomeType === "CALL_BACK") {
    nextAction = `Call back on scheduled date`;
  } else if (outcomeType === "VOICEMAIL") {
    nextAction = "Wait for return call, follow up if no response in 24 hours";
  } else if (outcomeType === "NO_ANSWER") {
    nextAction = "Retry call tomorrow at different time";
  }

  return buildCallOutcome({
    missionId: workerBrief.missionId,
    executionPlanId: workerBrief.dynamicVariables?.planId as string | undefined,
    workerBriefId: workerBrief.id,

    workerName: workerBrief.workerName,
    workerType: workerBrief.workerType,

    targetName: workerBrief.leadContext?.split("-")[0]?.trim(), // Extract name if available
    targetPhone: workerBrief.dynamicVariables?.targetPhone as string | undefined,

    outcomeType,
    sentiment,

    summary,
    objections,
    keyInsights,

    nextAction,
    followUpRequired: outcomeType === "CALL_BACK" || outcomeType === "VOICEMAIL",
    followUpDate,

    meetingBooked,
    meetingDate,

    callDurationSeconds,
  });
}
