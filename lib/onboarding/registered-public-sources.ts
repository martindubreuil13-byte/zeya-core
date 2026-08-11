import { createHash } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  isSameResearchSite,
  normalizeResearchUrl,
  robotsAllowsPath,
  safeFetchPublicSite,
  SafeFetchError,
  WEBSITE_RESEARCH_LIMITS,
  type SafeFetchDependencies,
} from '../research/safe-public-site-fetch';
import {
  evidenceFromExtractedPage,
  extractWebsitePage,
  WEBSITE_EXTRACTION_VERSION,
} from '../research/html-extraction';

export type PublicSourceStatus =
  | 'registered' | 'validating' | 'ready_to_acquire' | 'acquiring'
  | 'acquired' | 'extracted' | 'complete' | 'unsupported'
  | 'permission_required' | 'robots_disallowed' | 'authentication_required'
  | 'temporarily_unavailable' | 'invalid' | 'failed_retryable' | 'failed_permanent';

type RegisteredSourceRow = {
  id: string;
  submitted_url: string;
  status: PublicSourceStatus;
  authority_type: 'first_party_company' | 'customer' | 'partner' | 'independent_third_party' | 'unknown';
  authority_key: string;
};

type AcquisitionDependencies = {
  safeFetch?: typeof safeFetchPublicSite;
  safeFetchDependencies?: SafeFetchDependencies;
  now?: () => Date;
};

const RESTRICTED_PLATFORM_HOSTS = [
  'linkedin.com', 'facebook.com', 'instagram.com', 'youtube.com',
  'x.com', 'twitter.com', 'tiktok.com',
] as const;

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function authorityHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, '');
}

export function classifyRegisteredPublicSource(input: {
  submittedUrl: string;
  companyWebsiteUrl: string;
}): {
  normalizedUrl: string;
  authorityType: RegisteredSourceRow['authority_type'];
  authorityKey: string;
  unsupportedStatus?: 'unsupported' | 'authentication_required';
} {
  const sourceUrl = normalizeResearchUrl(input.submittedUrl);
  const companyUrl = normalizeResearchUrl(input.companyWebsiteUrl);
  const sourceHost = authorityHost(sourceUrl);
  const restrictedHost = RESTRICTED_PLATFORM_HOSTS.find(host =>
    sourceHost === host || sourceHost.endsWith(`.${host}`),
  );
  if (restrictedHost) {
    return {
      normalizedUrl: sourceUrl.toString(),
      authorityType: 'unknown',
      authorityKey: `restricted-platform:${restrictedHost}`,
      unsupportedStatus: 'authentication_required',
    };
  }
  if (isSameResearchSite(companyUrl.hostname, sourceUrl.hostname)) {
    const host = authorityHost(companyUrl);
    return {
      normalizedUrl: sourceUrl.toString(),
      authorityType: 'first_party_company',
      authorityKey: `first-party-site:${host}`,
    };
  }
  return {
    normalizedUrl: sourceUrl.toString(),
    // A public external location is not automatically an independent authority.
    authorityType: 'unknown',
    authorityKey: `unknown-site:${sourceHost}`,
  };
}

export async function registerPublicSource(
  client: SupabaseClient,
  input: {
    ownerId: string;
    onboardingSessionId: string;
    submittedUrl: string;
    companyWebsiteUrl: string;
  },
): Promise<{ sourceId: string; status: PublicSourceStatus; created: boolean }> {
  const classification = classifyRegisteredPublicSource(input);
  const registration = await client.rpc('zeya_register_direct_hire_public_source', {
    p_owner_id: input.ownerId,
    p_onboarding_session_id: input.onboardingSessionId,
    p_submitted_url: input.submittedUrl,
    p_normalized_url: classification.normalizedUrl,
    p_authority_type: classification.authorityType,
    p_authority_key: classification.authorityKey,
  });
  if (registration.error || !registration.data?.[0]) {
    throw new Error(`public_source_registration_failed:${registration.error?.code ?? 'unknown'}`);
  }
  const row = registration.data[0] as { source_id: string; source_status: PublicSourceStatus; created: boolean };
  if (classification.unsupportedStatus && row.source_status !== 'complete') {
    const failure = await client.rpc('zeya_fail_direct_hire_public_source', {
      p_owner_id: input.ownerId,
      p_source_id: row.source_id,
      p_status: classification.unsupportedStatus,
      p_failure_code: 'restricted_platform_not_acquired',
    });
    if (failure.error && failure.error.code !== 'PZ409') {
      throw new Error(`public_source_status_failed:${failure.error.code ?? 'unknown'}`);
    }
    return { sourceId: row.source_id, status: classification.unsupportedStatus, created: row.created };
  }
  return { sourceId: row.source_id, status: row.source_status, created: row.created };
}

function failureStatus(error: unknown): { status: PublicSourceStatus; code: string } {
  const code = error instanceof SafeFetchError ? error.code : 'request_failed';
  if (code === 'unsupported_site' || code === 'unsupported_content_type'
    || code === 'response_compressed' || code === 'response_too_large') {
    return { status: 'failed_permanent', code };
  }
  if (code === 'unsafe_destination' || code === 'redirect_blocked' || code === 'too_many_redirects') {
    return { status: 'failed_permanent', code };
  }
  return { status: 'failed_retryable', code };
}

async function robotsPermitRegisteredUrl(
  fetcher: typeof safeFetchPublicSite,
  sourceUrl: string,
  dependencies?: SafeFetchDependencies,
): Promise<boolean> {
  const parsed = new URL(sourceUrl);
  const robotsUrl = new URL('/robots.txt', parsed).toString();
  try {
    const robots = await fetcher(robotsUrl, {
      maxBytes: WEBSITE_RESEARCH_LIMITS.robotsMaxBytes,
      acceptedContentTypes: /^(?:text\/plain|text\/html)(?:;|$)/i,
      dependencies,
    });
    return robotsAllowsPath(robots.body.toString('utf8'), parsed.pathname || '/');
  } catch {
    // Unavailable robots.txt does not itself prohibit an explicitly registered URL.
    return true;
  }
}

export async function acquireRegisteredPublicSource(
  client: SupabaseClient,
  input: { ownerId: string; sourceId: string; refreshComplete?: boolean },
  dependencies: AcquisitionDependencies = {},
): Promise<{ sourceId: string; status: PublicSourceStatus; evidenceCount: number }> {
  const claim = await client.rpc('zeya_claim_direct_hire_public_source', {
    p_owner_id: input.ownerId,
    p_source_id: input.sourceId,
    p_refresh_complete: input.refreshComplete ?? false,
  });
  if (claim.error || !claim.data?.[0]) {
    throw new Error(`public_source_claim_failed:${claim.error?.code ?? 'unknown'}`);
  }
  const source = claim.data[0] as {
    source_id: string;
    submitted_url: string;
    source_status: PublicSourceStatus;
  };
  if (source.source_status === 'complete') {
    return { sourceId: source.source_id, status: 'complete', evidenceCount: 0 };
  }

  const fetcher = dependencies.safeFetch ?? safeFetchPublicSite;
  try {
    if (!await robotsPermitRegisteredUrl(fetcher, source.submitted_url, dependencies.safeFetchDependencies)) {
      const failed = await client.rpc('zeya_fail_direct_hire_public_source', {
        p_owner_id: input.ownerId,
        p_source_id: source.source_id,
        p_status: 'robots_disallowed',
        p_failure_code: 'robots_disallowed',
      });
      if (failed.error) throw new Error(`public_source_status_failed:${failed.error.code ?? 'unknown'}`);
      return { sourceId: source.source_id, status: 'robots_disallowed', evidenceCount: 0 };
    }

    const fetched = await fetcher(source.submitted_url, {
      dependencies: dependencies.safeFetchDependencies,
    });
    const retrievedAt = (dependencies.now ?? (() => new Date()))().toISOString();
    const page = extractWebsitePage({
      html: fetched.body,
      requestedUrl: fetched.requestedUrl,
      finalUrl: fetched.finalUrl,
      pageType: 'registered_public_page',
      retrievedAt,
    });
    const evidence = evidenceFromExtractedPage(page).map(item => ({
      sourceKey: hash([
        WEBSITE_EXTRACTION_VERSION,
        source.source_id,
        page.finalUrl,
        page.documentContentHash,
        item.kind,
        item.selector,
        hash(item.excerpt),
      ].join('|')),
      rawStatement: item.excerpt,
      kind: item.kind,
      selector: item.selector,
      affectedDomains: item.affectedDomains,
    }));
    if (evidence.length === 0) throw new SafeFetchError('request_failed');

    const finalized = await client.rpc('zeya_finalize_direct_hire_public_source', {
      p_owner_id: input.ownerId,
      p_source_id: source.source_id,
      p_canonical_url: page.finalUrl,
      p_retrieved_at: retrievedAt,
      p_content_hash: page.documentContentHash,
      p_extraction_version: WEBSITE_EXTRACTION_VERSION,
      p_evidence: evidence,
    });
    if (finalized.error || !finalized.data?.[0]) {
      throw new Error(`public_source_persistence_failed:${finalized.error?.code ?? 'unknown'}`);
    }
    return {
      sourceId: source.source_id,
      status: 'complete',
      evidenceCount: Number(finalized.data[0].evidence_count ?? evidence.length),
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('public_source_')) throw error;
    const failure = failureStatus(error);
    const failed = await client.rpc('zeya_fail_direct_hire_public_source', {
      p_owner_id: input.ownerId,
      p_source_id: source.source_id,
      p_status: failure.status,
      p_failure_code: failure.code,
    });
    if (failed.error) throw new Error(`public_source_status_failed:${failed.error.code ?? 'unknown'}`);
    return { sourceId: source.source_id, status: failure.status, evidenceCount: 0 };
  }
}

export async function acquirePendingRegisteredPublicSources(
  client: SupabaseClient,
  input: { ownerId: string; onboardingSessionId: string },
  dependencies: AcquisitionDependencies = {},
): Promise<Array<{ sourceId: string; status: PublicSourceStatus; evidenceCount: number }>> {
  const result = await client
    .from('direct_hire_public_sources')
    .select('id,submitted_url,status,authority_type,authority_key')
    .eq('owner_id', input.ownerId)
    .eq('direct_hire_onboarding_session_id', input.onboardingSessionId)
    .in('status', ['registered', 'ready_to_acquire', 'temporarily_unavailable', 'failed_retryable'])
    .order('created_at', { ascending: true });
  if (result.error) throw new Error(`public_source_lookup_failed:${result.error.code ?? 'unknown'}`);

  const outcomes = [];
  for (const row of (result.data ?? []) as RegisteredSourceRow[]) {
    outcomes.push(await acquireRegisteredPublicSource(
      client,
      { ownerId: input.ownerId, sourceId: row.id },
      dependencies,
    ));
  }
  return outcomes;
}
