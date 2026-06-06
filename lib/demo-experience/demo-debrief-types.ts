export interface DemoDebrief {
  id: string;
  demoSessionId: string;
  workerBriefId: string;
  callOutcomeId?: string;
  strengths: string[];
  weaknesses: string[];
  suggestedImprovements: string[];
  salesAngle: string;
  objectionHandlingAdvice: string;
  followUpRecommendation: string;
  createdAt: string;
}
