'use client';

interface YouToldMe {
  ownerName: string;
  growthPriority: string;
  inductionMaterials: Array<{
    type: string;
    label?: string;
    content: string;
  }>;
}

interface TheWebsiteSaid {
  websiteUrl: string;
  pagesAnalyzed: number;
  evidence: Array<{
    id: string;
    description?: string;
    content: string;
  }>;
}

interface PreliminaryInterpretation {
  id: string;
  meaning: string;
  confidence: number;
  domains: string[];
}

interface StillUnclear {
  gaps: string[];
  unknowns: string[];
}

interface PreparedContext {
  youToldMe: YouToldMe;
  theWebsiteSaid: TheWebsiteSaid;
  myPreliminaryInterpretation: PreliminaryInterpretation[];
  stillUnclear: StillUnclear;
  possibleContradictions: Array<{ description: string; question: string }>;
  questionsForOurSession: string[];
}

interface DirectHirePreparationContextProps {
  context: PreparedContext;
  onReadyToContinue?: () => void;
}

export function DirectHirePreparationContext({
  context,
  onReadyToContinue,
}: DirectHirePreparationContextProps) {
  return (
    <div className="space-y-8">
      {/* Opening statement */}
      <div className="rounded-lg border border-blue-200 bg-blue-50 p-6">
        <p className="text-base text-blue-900">
          <span className="font-semibold">This is what I currently believe.</span> Help me make it accurate.
        </p>
      </div>

      {/* Category 1: You told me */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">You told me</h2>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-700">Your name</p>
            <p className="text-slate-600">{context.youToldMe.ownerName}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Growth priority</p>
            <p className="text-slate-600">{context.youToldMe.growthPriority}</p>
          </div>
          {context.youToldMe.inductionMaterials.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Materials you provided</p>
              <ul className="space-y-2">
                {context.youToldMe.inductionMaterials.map((m, idx) => (
                  <li key={idx} className="text-sm text-slate-600">
                    {m.label && <span className="font-medium">{m.label}:</span>} {m.content}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Category 2: The public website said */}
      <section className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="mb-4 text-lg font-semibold text-slate-900">The public website said</h2>
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium text-slate-700">Website</p>
            <p className="text-sm text-blue-600 break-all">{context.theWebsiteSaid.websiteUrl}</p>
          </div>
          <div>
            <p className="text-sm font-medium text-slate-700">Pages analyzed</p>
            <p className="text-slate-600">{context.theWebsiteSaid.pagesAnalyzed} pages reviewed</p>
          </div>
          {context.theWebsiteSaid.evidence.length > 0 && (
            <div>
              <p className="text-sm font-medium text-slate-700 mb-2">Key findings</p>
              <ul className="space-y-2">
                {context.theWebsiteSaid.evidence.slice(0, 3).map((e, idx) => (
                  <li key={idx} className="text-sm text-slate-600">
                    {e.description || 'Website content'}: {e.content.substring(0, 100)}
                    {e.content.length > 100 ? '…' : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* Category 3: My preliminary interpretation */}
      {context.myPreliminaryInterpretation.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">My preliminary interpretation</h2>
          <div className="space-y-3">
            {context.myPreliminaryInterpretation.map((obs) => (
              <div key={obs.id} className="border-l-4 border-blue-300 bg-blue-50 p-3">
                <p className="text-sm text-slate-700">{obs.meaning}</p>
                <p className="text-xs text-slate-500 mt-1">
                  Confidence: {obs.confidence}%
                  {obs.domains.length > 0 && ` • ${obs.domains.join(', ')}`}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Category 4: Still unclear */}
      {(context.stillUnclear.gaps.length > 0 || context.stillUnclear.unknowns.length > 0) && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-6">
          <h2 className="mb-4 text-lg font-semibold text-amber-900">Still unclear</h2>
          <div className="space-y-4">
            {context.stillUnclear.gaps.length > 0 && (
              <div>
                <p className="text-sm font-medium text-amber-900 mb-2">Gaps in what&apos;s available</p>
                <ul className="space-y-1">
                  {context.stillUnclear.gaps.map((gap, idx) => (
                    <li key={idx} className="text-sm text-amber-800">• {gap}</li>
                  ))}
                </ul>
              </div>
            )}
            {context.stillUnclear.unknowns.length > 0 && (
              <div>
                <p className="text-sm font-medium text-amber-900 mb-2">What I don&apos;t know yet</p>
                <ul className="space-y-1">
                  {context.stillUnclear.unknowns.map((unknown, idx) => (
                    <li key={idx} className="text-sm text-amber-800">• {unknown}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Category 5: Possible contradictions */}
      {context.possibleContradictions.length > 0 && (
        <section className="rounded-lg border border-red-200 bg-red-50 p-6">
          <h2 className="mb-4 text-lg font-semibold text-red-900">Items to clarify</h2>
          <div className="space-y-3">
            {context.possibleContradictions.map((c, idx) => (
              <div key={idx}>
                <p className="text-sm font-medium text-red-900">{c.description}</p>
                <p className="text-sm text-red-800 mt-1">{c.question}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Category 6: Questions for our session */}
      {context.questionsForOurSession.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-6">
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Questions for our conversation</h2>
          <ol className="space-y-2">
            {context.questionsForOurSession.map((q, idx) => (
              <li key={idx} className="text-sm text-slate-700">
                <span className="font-medium">{idx + 1}.</span> {q}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Action button */}
      {onReadyToContinue && (
        <div className="flex justify-end">
          <button
            onClick={onReadyToContinue}
            className="rounded-lg bg-blue-600 px-6 py-3 font-medium text-white hover:bg-blue-700"
          >
            This looks right. Let&apos;s talk.
          </button>
        </div>
      )}
    </div>
  );
}
