import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const sessionId = (await params).sessionId;
  if (!sessionId || !UUID.test(sessionId)) {
    return failure('invalid_session_id', 400);
  }

  try {
    // Load Formation session to get lineage
    const sessionResult = await auth.supabase
      .from('representation_formation_sessions')
      .select(
        'id, initiated_from, initiated_from_id, business_representation_id, owner_id',
      )
      .eq('id', sessionId)
      .eq('owner_id', auth.user.id)
      .maybeSingle();

    if (sessionResult.error) return failure('session_lookup_failed', 500);
    if (!sessionResult.data) return failure('session_not_found', 404);

    const session = sessionResult.data as {
      id: string;
      initiated_from: string;
      initiated_from_id: string | null;
      business_representation_id: string;
      owner_id: string;
    };

    // Only Direct Hire onboarding sessions have prepared context
    if (session.initiated_from !== 'direct_hire_onboarding' || !session.initiated_from_id) {
      return NextResponse.json({
        success: true,
        data: null,
      });
    }

    const onboardingSessionId = session.initiated_from_id;

    // Load Direct Hire onboarding session for context metadata
    const onboardingResult = await auth.supabase
      .from('direct_hire_onboarding_sessions')
      .select(
        'id, owner_relationship_name, website_url, growth_priority, preparation_status',
      )
      .eq('id', onboardingSessionId)
      .eq('owner_id', auth.user.id)
      .maybeSingle();

    if (onboardingResult.error) return failure('onboarding_lookup_failed', 500);
    if (!onboardingResult.data) return failure('onboarding_not_found', 404);

    const onboarding = onboardingResult.data as {
      id: string;
      owner_relationship_name: string;
      website_url: string;
      growth_priority: string;
      preparation_status: string;
    };

    // Load Evidence grouped by source type
    const evidenceResult = await auth.supabase
      .from('evidence')
      .select(
        'id, source_type, raw_statement, source_description, induction_material_type, induction_material_label, created_at',
      )
      .eq('business_representation_id', session.business_representation_id)
      .eq('direct_hire_onboarding_session_id', onboardingSessionId)
      .in('source_type', ['public_website', 'direct_hire_induction'])
      .order('created_at', { ascending: true });

    if (evidenceResult.error) return failure('evidence_lookup_failed', 500);

    const evidence = evidenceResult.data || [];

    // Separate Evidence by source
    const websiteEvidence = evidence.filter((e) => e.source_type === 'public_website');
    const inductionEvidence = evidence.filter((e) => e.source_type === 'direct_hire_induction');

    // Load Observations (preliminary interpretation)
    let observations: Array<{
      id: string;
      interpreted_meaning: string;
      confidence_in_interpretation: number;
      affected_domains?: string[];
    }> = [];

    if (evidence.length > 0) {
      const evidenceIds = evidence.map((e) => e.id);
      const obsResult = await auth.supabase
        .from('observations')
        .select('id, interpreted_meaning, confidence_in_interpretation, affected_domains')
        .in('evidence_id', evidenceIds);

      if (!obsResult.error) {
        observations = obsResult.data || [];
      }
    }

    // Build prepared context with six categories
    const context = {
      youToldMe: {
        ownerName: onboarding.owner_relationship_name,
        growthPriority: onboarding.growth_priority,
        inductionMaterials: inductionEvidence.map((e) => ({
          type: e.induction_material_type || 'note',
          label: e.induction_material_label,
          content: e.raw_statement,
        })),
      },
      theWebsiteSaid: {
        websiteUrl: onboarding.website_url,
        pagesAnalyzed: websiteEvidence.length,
        evidence: websiteEvidence.map((e) => ({
          id: e.id,
          description: e.source_description,
          content: e.raw_statement,
        })),
      },
      myPreliminaryInterpretation: observations.map((o) => ({
        id: o.id,
        meaning: o.interpreted_meaning,
        confidence: o.confidence_in_interpretation,
        domains: o.affected_domains || [],
      })),
      stillUnclear: {
        gaps:
          onboarding.preparation_status === 'partial'
            ? [
                'Pricing structure not found on website',
                'Customer acquisition approach unclear',
                'Competitive differentiation needs clarification',
              ]
            : [],
        unknowns: [
          'Customer satisfaction and retention metrics',
          'Detailed go-to-market strategy',
          'Technical implementation and roadmap',
        ],
      },
      possibleContradictions: extractContradictions(websiteEvidence, inductionEvidence),
      questionsForOurSession: generateQuestions(onboarding, websiteEvidence, inductionEvidence),
    };

    return NextResponse.json({
      success: true,
      data: context,
    });
  } catch (err) {
    console.error('[prepared-context]', err);
    return failure('prepared_context_error', 500);
  }
}

function extractContradictions(
  websiteEvidence: any[],
  inductionEvidence: any[],
): Array<{ description: string; question: string }> {
  const contradictions: Array<{ description: string; question: string }> = [];

  // Example: if website suggests one product focus but owner notes suggest another
  if (websiteEvidence.length > 0 && inductionEvidence.length > 0) {
    // This is simplified; real implementation would do semantic comparison
    // For now, return empty if no obvious contradictions
  }

  return contradictions;
}

function generateQuestions(
  onboarding: any,
  websiteEvidence: any[],
  inductionEvidence: any[],
): string[] {
  const questions: string[] = [];

  if (websiteEvidence.length === 0) {
    questions.push('Can you help me understand your products and services more deeply?');
  }

  if (inductionEvidence.length === 0) {
    questions.push('What would you most like me to understand about your business?');
  }

  if (questions.length === 0) {
    questions.push('How accurate is my understanding of your business from what I\'ve reviewed?');
    questions.push('What am I missing that would be important for me to know?');
  }

  if (questions.length < 3) {
    questions.push('How do you want me to represent your business to prospects?');
  }

  return questions.slice(0, 5);
}
