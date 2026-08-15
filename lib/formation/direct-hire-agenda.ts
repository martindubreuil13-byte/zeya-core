import { createHash } from 'node:crypto';
import type {
  BriefSection,
  BriefStatement,
  FirstWorkingSessionBrief,
} from '@/lib/onboarding/first-working-session-brief';
import type {
  CurrentPreparationHypothesis,
  PreparationDomain,
  RepresentationRisk,
} from '@/lib/onboarding/preparation-intelligence';

export type FormationAgendaCategory =
  | 'authority'
  | 'contradiction'
  | 'commercial'
  | 'formation_priority'
  | 'clarification'
  | 'descriptive_refinement';

export type DirectHireFormationAgendaItem = {
  agendaItemId: string;
  rank: number;
  category: FormationAgendaCategory;
  constitutionalDomain: PreparationDomain | null;
  risk: RepresentationRisk;
  blocking: boolean;
  resolutionStatus: 'unresolved';
  sourceBriefSections: BriefSection[];
  sourceHypothesisIds: string[];
  sourceEvidenceIds: string[];
  questionIntent: string;
  suggestedWording: string | null;
  createdFromSnapshotFingerprint: string;
};

type Candidate = Omit<DirectHireFormationAgendaItem, 'agendaItemId' | 'rank'> & {
  dedupeKey: string;
  priority: number;
};

const DOMAIN_ORDER: PreparationDomain[] = [
  'authorityBoundaries',
  'whoItIsFor',
  'whatYouSell',
  'problemOrAspiration',
  'whyCustomersShouldCare',
  'clarificationsNeeded',
  'proposedDescription',
];
const RISK_ORDER: Record<RepresentationRisk, number> = { high: 0, medium: 1, low: 2 };
const AUTHORITY_LANGUAGE = /\b(?:pricing|price|discount|negotiat|promise|guarantee|commitment|agree|authority|approval|escalat|book(?:ing)? meetings?)\b/i;
const COMMERCIAL_LANGUAGE = /\b(?:target|customer|segment|offer|qualification|qualify|meeting objective|geograph|territor|market)\b/i;

function unique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function maxRisk(hypotheses: CurrentPreparationHypothesis[]): RepresentationRisk {
  if (hypotheses.some((item) => item.representationRisk === 'high')) return 'high';
  if (hypotheses.some((item) => item.representationRisk === 'medium')) return 'medium';
  return 'low';
}

function isUnresolved(hypothesis: CurrentPreparationHypothesis): boolean {
  return hypothesis.epistemicState !== 'supported' || hypothesis.ownerDecision !== 'approved';
}

function categoryFor(
  section: BriefSection,
  statement: BriefStatement,
  hypotheses: CurrentPreparationHypothesis[],
): FormationAgendaCategory {
  if (hypotheses.some((item) => item.constitutionalDomain === 'authorityBoundaries')
    || AUTHORITY_LANGUAGE.test(statement.statement)) return 'authority';
  if (section === 'contradictions' || hypotheses.some((item) => item.epistemicState === 'contradicted')) {
    return 'contradiction';
  }
  if (hypotheses.some((item) => ['whoItIsFor', 'whatYouSell'].includes(item.constitutionalDomain))
    || COMMERCIAL_LANGUAGE.test(statement.statement)) return 'commercial';
  if (section === 'formationPriorities') return 'formation_priority';
  if (section === 'unknowns' || section === 'questions') return 'clarification';
  return 'descriptive_refinement';
}

function priorityFor(category: FormationAgendaCategory, hypotheses: CurrentPreparationHypothesis[]): number {
  if (category === 'authority' && hypotheses.some((item) =>
    item.constitutionalDomain === 'authorityBoundaries'
      && item.representationRisk === 'high' && isUnresolved(item))) return 1;
  if (category === 'contradiction'
    || hypotheses.some((item) => item.representationRisk === 'high' && isUnresolved(item))) return 2;
  if (category === 'commercial') return 3;
  if (category === 'formation_priority') return 4;
  if (category === 'clarification') return 5;
  return 6;
}

function blockingFor(category: FormationAgendaCategory, hypotheses: CurrentPreparationHypothesis[], text: string): boolean {
  if (category === 'authority' && (AUTHORITY_LANGUAGE.test(text)
    || hypotheses.some((item) => item.constitutionalDomain === 'authorityBoundaries' && isUnresolved(item)))) return true;
  if (hypotheses.some((item) => item.epistemicState === 'contradicted'
    && item.representationRisk === 'high')) return true;
  return category === 'commercial' && hypotheses.some((item) =>
    ['whoItIsFor', 'whatYouSell'].includes(item.constitutionalDomain)
      && item.representationRisk === 'high' && isUnresolved(item));
}

function primaryDomain(hypotheses: CurrentPreparationHypothesis[]): PreparationDomain | null {
  return [...hypotheses].sort((left, right) =>
    DOMAIN_ORDER.indexOf(left.constitutionalDomain) - DOMAIN_ORDER.indexOf(right.constitutionalDomain))[0]
    ?.constitutionalDomain ?? null;
}

function mergeCandidate(left: Candidate, right: Candidate): Candidate {
  const risk = RISK_ORDER[left.risk] <= RISK_ORDER[right.risk] ? left.risk : right.risk;
  return {
    ...left,
    category: left.priority <= right.priority ? left.category : right.category,
    constitutionalDomain: left.constitutionalDomain ?? right.constitutionalDomain,
    risk,
    blocking: left.blocking || right.blocking,
    sourceBriefSections: unique([...left.sourceBriefSections, ...right.sourceBriefSections]) as BriefSection[],
    sourceHypothesisIds: unique([...left.sourceHypothesisIds, ...right.sourceHypothesisIds]),
    sourceEvidenceIds: unique([...left.sourceEvidenceIds, ...right.sourceEvidenceIds]),
    questionIntent: left.priority <= right.priority ? left.questionIntent : right.questionIntent,
    suggestedWording: left.suggestedWording ?? right.suggestedWording,
    priority: Math.min(left.priority, right.priority),
  };
}

export function buildDirectHireFormationAgenda(input: {
  brief: FirstWorkingSessionBrief;
  hypotheses: CurrentPreparationHypothesis[];
  snapshotFingerprint: string;
}): DirectHireFormationAgendaItem[] {
  const hypothesisById = new Map(input.hypotheses.map((item) => [item.id, item]));
  const candidates = new Map<string, Candidate>();
  const add = (section: BriefSection, statement: BriefStatement) => {
    const hypotheses = statement.hypothesisIds
      .map((id) => hypothesisById.get(id)).filter((item): item is CurrentPreparationHypothesis => Boolean(item));
    const category = categoryFor(section, statement, hypotheses);
    const domain = primaryDomain(hypotheses);
    const dedupeKey = category === 'authority'
      ? 'authority:outreach-safety'
      : domain ? `domain:${domain}`
        : `${category}:${statement.statement.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`;
    const candidate: Candidate = {
      dedupeKey,
      priority: priorityFor(category, hypotheses),
      category,
      constitutionalDomain: domain,
      risk: maxRisk(hypotheses),
      blocking: blockingFor(category, hypotheses, statement.statement),
      resolutionStatus: 'unresolved',
      sourceBriefSections: [section],
      sourceHypothesisIds: unique(statement.hypothesisIds),
      sourceEvidenceIds: unique(statement.evidenceIds),
      questionIntent: statement.statement.trim(),
      suggestedWording: section === 'questions' ? statement.statement.trim() : null,
      createdFromSnapshotFingerprint: input.snapshotFingerprint,
    };
    candidates.set(dedupeKey, candidates.has(dedupeKey)
      ? mergeCandidate(candidates.get(dedupeKey)!, candidate) : candidate);
  };

  const domainSection: Record<PreparationDomain, BriefSection> = {
    whatYouSell: 'offerRead',
    whoItIsFor: 'customerRead',
    problemOrAspiration: 'problemOutcomeRead',
    whyCustomersShouldCare: 'businessRead',
    proposedDescription: 'positioningRead',
    authorityBoundaries: 'authorityGaps',
    clarificationsNeeded: 'questions',
  };
  for (const hypothesis of input.hypotheses.filter(isUnresolved)) {
    const text = hypothesis.verificationNeed ?? hypothesis.riskReason
      ?? hypothesis.currentBelief ?? `Clarify ${hypothesis.constitutionalDomain}.`;
    add(domainSection[hypothesis.constitutionalDomain], {
      statement: text,
      kind: hypothesis.epistemicState === 'contradicted' ? 'contradiction' : 'unknown',
      hypothesisIds: [hypothesis.id],
      evidenceIds: [],
    });
  }

  for (const [section, statements] of [
    ['authorityGaps', input.brief.authorityGaps],
    ['contradictions', input.brief.contradictions],
    ['formationPriorities', input.brief.formationPriorities],
    ['unknowns', input.brief.unknowns],
    ['questions', input.brief.questions],
    ['workingOpinions', input.brief.workingOpinions],
  ] as Array<[BriefSection, BriefStatement[]]>) statements.forEach((statement) => add(section, statement));

  return [...candidates.values()]
    .sort((left, right) => left.priority - right.priority
      || Number(right.blocking) - Number(left.blocking)
      || RISK_ORDER[left.risk] - RISK_ORDER[right.risk]
      || DOMAIN_ORDER.indexOf(left.constitutionalDomain ?? 'proposedDescription')
        - DOMAIN_ORDER.indexOf(right.constitutionalDomain ?? 'proposedDescription')
      || left.dedupeKey.localeCompare(right.dedupeKey))
    .map(({ dedupeKey, priority: _priority, ...item }, index) => ({
      ...item,
      agendaItemId: `agenda_${createHash('sha256')
        .update(`${input.snapshotFingerprint}|${dedupeKey}`).digest('hex').slice(0, 24)}`,
      rank: index + 1,
    }));
}
