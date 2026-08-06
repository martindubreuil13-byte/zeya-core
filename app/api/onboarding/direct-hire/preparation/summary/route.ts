import { NextRequest, NextResponse } from 'next/server';
import { createAuthenticatedRepresentationContext } from '@/lib/representation/api-auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failure(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

interface PreparationSummary {
  understood: Array<{ category: string; items: Array<{ label: string; value: string }> }>;
  gaps: string[];
  contradictions: Array<{ description: string; question: string }>;
  unansweredQuestions: string[];
}

export async function GET(request: NextRequest) {
  const auth = await createAuthenticatedRepresentationContext(request);
  if (auth instanceof NextResponse) return auth;

  const ownerId = auth.user.id;

  try {
    // Load Direct Hire onboarding session
    const sessionResult = await auth.supabase
      .from('direct_hire_onboarding_sessions')
      .select(
        `id,
        onboarding_state,
        preparation_status,
        business_representation_id,
        owner_relationship_name,
        website_url,
        growth_priority`,
      )
      .eq('owner_id', ownerId)
      .maybeSingle();

    if (sessionResult.error) return failure('session_lookup_failed', 500);
    if (!sessionResult.data) return failure('no_session', 404);

    const session = sessionResult.data as {
      id: string;
      onboarding_state: string;
      preparation_status: string;
      business_representation_id: string;
      owner_relationship_name: string;
      website_url: string;
      growth_priority: string;
    };

    const summary: PreparationSummary = {
      understood: [],
      gaps: [],
      contradictions: [],
      unansweredQuestions: [],
    };

    // SECTION 1: What I understand you sell
    // Load website Evidence
    const websiteEvidenceResult = await auth.supabase
      .from('evidence')
      .select('id, raw_statement, source_description, created_at')
      .eq('business_representation_id', session.business_representation_id)
      .eq('source_type', 'public_website')
      .eq('direct_hire_onboarding_session_id', session.id)
      .order('created_at', { ascending: true });

    if (!websiteEvidenceResult.error && websiteEvidenceResult.data) {
      summary.understood.push({
        category: 'What you sell',
        items: websiteEvidenceResult.data.length > 0
          ? [{ label: 'Website analysis', value: `${websiteEvidenceResult.data.length} pages reviewed` }]
          : [{ label: 'Website', value: 'Not yet analyzed' }],
      });
    }

    // SECTION 2: Who I understand it is for
    summary.understood.push({
      category: 'Your target',
      items: [
        { label: 'Growth priority', value: session.growth_priority || 'Not yet specified' },
      ],
    });

    // SECTION 3: The problem it addresses
    // Load owner assertions (induction materials)
    const inductionResult = await auth.supabase
      .from('evidence')
      .select('id, raw_statement, induction_material_type')
      .eq('business_representation_id', session.business_representation_id)
      .eq('source_type', 'direct_hire_induction')
      .eq('direct_hire_onboarding_session_id', session.id)
      .limit(1);

    if (!inductionResult.error && inductionResult.data && inductionResult.data.length > 0) {
      summary.understood.push({
        category: 'The problem',
        items: [
          { label: 'Owner context', value: 'Provided in preparation materials' },
        ],
      });
    } else {
      summary.gaps.push('Problem statement not yet provided');
    }

    // SECTION 4: Why customers should care
    if (websiteEvidenceResult.data && websiteEvidenceResult.data.length > 0) {
      summary.understood.push({
        category: 'Value proposition',
        items: [
          { label: 'Source', value: 'From website and materials' },
        ],
      });
    } else {
      summary.gaps.push('Value proposition not yet extracted');
    }

    // SECTION 5: How to describe it (including pricing)
    summary.understood.push({
      category: 'How to describe it',
      items: [
        { label: 'Pricing visibility', value: 'Will be clarified in first meeting' },
        { label: 'Positioning', value: 'Pending verification' },
      ],
    });

    // SECTION 6: What I must never claim
    summary.understood.push({
      category: 'Authority boundaries',
      items: [
        { label: 'Constraints', value: 'Will be established during first working session' },
      ],
    });

    // SECTION 7: What I still need to clarify
    if (session.preparation_status === 'partial') {
      summary.unansweredQuestions.push(
        'Can you walk me through your customer acquisition approach?',
        'What is your current revenue model, and are there flexibility options?',
        'What does success look like in our first formal engagement?',
      );
    } else if (session.preparation_status === 'ready') {
      summary.unansweredQuestions.push(
        'What would be most valuable from me before our first formal meeting?',
        'Are there specific concerns or obstacles you want me to understand?',
      );
    }

    // Always include unknowns if preparation is partial
    if (session.preparation_status === 'partial') {
      summary.gaps.push('Website pricing information not available');
      summary.gaps.push('Competitive landscape analysis pending');
    }

    return NextResponse.json({
      success: true,
      data: {
        onboardingSessionId: session.id,
        onboardingState: session.onboarding_state,
        preparationStatus: session.preparation_status,
        summary,
      },
    });
  } catch (err) {
    console.error('[preparation-summary]', err);
    return failure('preparation_summary_error', 500);
  }
}
