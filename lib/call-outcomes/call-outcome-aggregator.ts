// Call Outcome Aggregator — Aggregate metrics from multiple outcomes

import type { CallOutcome, AggregatedOutcomes } from "./call-outcome-types";

export function aggregateCallOutcomes(outcomes: CallOutcome[]): AggregatedOutcomes {
  if (outcomes.length === 0) {
    return {
      totalCalls: 0,
      interested: 0,
      notInterested: 0,
      noAnswer: 0,
      callBacks: 0,
      meetingsBooked: 0,
      wrongContacts: 0,
      voicemails: 0,
      failed: 0,
      interestRate: 0,
      conversionRate: 0,
      callbackRate: 0,
      positiveCount: 0,
      neutralCount: 0,
      negativeCount: 0,
      averageSentimentScore: 0,
      totalDurationSeconds: 0,
      averageDurationSeconds: 0,
      followUpsRequired: 0,
    };
  }

  // Count outcome types
  const counts = {
    interested: 0,
    notInterested: 0,
    noAnswer: 0,
    callBacks: 0,
    meetingsBooked: 0,
    wrongContacts: 0,
    voicemails: 0,
    failed: 0,
  };

  let positiveCount = 0;
  let neutralCount = 0;
  let negativeCount = 0;
  let totalDurationSeconds = 0;
  let followUpsRequired = 0;

  for (const outcome of outcomes) {
    switch (outcome.outcomeType) {
      case "INTERESTED":
        counts.interested++;
        break;
      case "NOT_INTERESTED":
        counts.notInterested++;
        break;
      case "NO_ANSWER":
        counts.noAnswer++;
        break;
      case "CALL_BACK":
        counts.callBacks++;
        break;
      case "MEETING_BOOKED":
        counts.meetingsBooked++;
        break;
      case "WRONG_CONTACT":
        counts.wrongContacts++;
        break;
      case "VOICEMAIL":
        counts.voicemails++;
        break;
      case "FAILED":
        counts.failed++;
        break;
    }

    // Sentiment counts
    if (outcome.sentiment === "POSITIVE") {
      positiveCount++;
    } else if (outcome.sentiment === "NEUTRAL") {
      neutralCount++;
    } else if (outcome.sentiment === "NEGATIVE") {
      negativeCount++;
    }

    // Duration
    if (outcome.callDurationSeconds) {
      totalDurationSeconds += outcome.callDurationSeconds;
    }

    // Follow-ups
    if (outcome.followUpRequired) {
      followUpsRequired++;
    }
  }

  const totalCalls = outcomes.length;

  // Calculate rates
  const interestRate = Math.round((counts.interested / totalCalls) * 100);
  const conversionRate = Math.round((counts.meetingsBooked / totalCalls) * 100);
  const callbackRate = Math.round((counts.callBacks / totalCalls) * 100);

  // Calculate average sentiment score (-1 to 1)
  const sentimentScore =
    (positiveCount - negativeCount) / totalCalls;

  return {
    totalCalls,
    interested: counts.interested,
    notInterested: counts.notInterested,
    noAnswer: counts.noAnswer,
    callBacks: counts.callBacks,
    meetingsBooked: counts.meetingsBooked,
    wrongContacts: counts.wrongContacts,
    voicemails: counts.voicemails,
    failed: counts.failed,

    interestRate,
    conversionRate,
    callbackRate,

    positiveCount,
    neutralCount,
    negativeCount,
    averageSentimentScore: sentimentScore,

    totalDurationSeconds,
    averageDurationSeconds: Math.round(totalDurationSeconds / totalCalls),

    followUpsRequired,
  };
}
