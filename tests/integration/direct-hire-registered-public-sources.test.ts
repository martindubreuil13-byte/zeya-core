import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  acquireRegisteredPublicSource,
  classifyRegisteredPublicSource,
  registerPublicSource,
} from '../../lib/onboarding/registered-public-sources';
import { buildReasoningPrompt } from '../../lib/onboarding/hypothesis-reasoning-service';
import { normalizeEffectivePreparationEvidence, toEvidenceInput } from '../../lib/onboarding/persist-hypotheses-orchestration';
import type { DatabaseEvidence } from '../../lib/onboarding/persist-hypotheses-types';
import type { SafeFetchResult } from '../../lib/research/safe-public-site-fetch';
import { SafeFetchError } from '../../lib/research/safe-public-site-fetch';

const migrationPath = 'supabase/migrations/20260811000000_direct_hire_registered_public_sources.sql';

function fetched(url: string, html: string): SafeFetchResult {
  return {
    requestedUrl: url,
    finalUrl: url,
    status: 200,
    contentType: 'text/html',
    body: Buffer.from(html),
    redirectCount: 0,
    totalBytes: Buffer.byteLength(html),
  };
}

function websiteEvidence(overrides: Partial<DatabaseEvidence>): DatabaseEvidence {
  return {
    id: 'artifact-1',
    business_representation_id: 'representation-1',
    direct_hire_onboarding_session_id: 'session-1',
    source_type: 'public_website',
    raw_statement: 'Business architecture services',
    affected_domains: ['whatYouSell'],
    requested_source_url: 'https://example.com/',
    canonical_source_url: 'https://example.com/',
    source_retrieved_at: '2026-08-11T00:00:00.000Z',
    source_content_hash: 'hash-one',
    source_page_type: 'homepage',
    source_evidence_kind: 'primary_heading',
    source_selector: 'h1',
    created_at: '2026-08-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('M0 artifact/source/authority semantics', () => {
  it('groups homepage artifacts into one source and company pages into one authority', () => {
    const inputs = toEvidenceInput([
      websiteEvidence({ id: 'title', source_evidence_kind: 'title', source_selector: 'title' }),
      websiteEvidence({ id: 'h1' }),
      websiteEvidence({ id: 'meta', source_evidence_kind: 'meta_description', source_selector: 'meta[name=description]' }),
      websiteEvidence({
        id: 'services',
        canonical_source_url: 'https://example.com/services',
        requested_source_url: 'https://example.com/services',
        source_page_type: 'products_services',
      }),
    ]);
    expect(new Set(inputs.slice(0, 3).map(item => item.logical_source_key)).size).toBe(1);
    expect(inputs[3].logical_source_key).not.toBe(inputs[0].logical_source_key);
    expect(new Set(inputs.map(item => item.authority_key)).size).toBe(1);
    expect(inputs.every(item => item.authority_type === 'first_party_company')).toBe(true);
  });

  it('preserves owner origin separately and excludes historical URL-only Evidence', () => {
    const owner = websiteEvidence({
      id: 'owner',
      source_type: 'direct_hire_induction',
      raw_statement: 'We sell advisory services',
      induction_material_type: 'description',
      induction_material_label: 'What the business sells',
      canonical_source_url: null,
      requested_source_url: null,
    });
    const legacyLink = websiteEvidence({
      id: 'legacy-link',
      source_type: 'direct_hire_induction',
      raw_statement: 'https://example.com/article',
      induction_material_type: 'link',
      canonical_source_url: null,
      requested_source_url: null,
    });
    expect(normalizeEffectivePreparationEvidence([owner, legacyLink]).map(row => row.id)).toEqual(['owner']);
    const [input] = toEvidenceInput([owner]);
    expect(input.authority_type).toBe('owner');
    expect(input.authority_key).toBe('owner');
    expect(input.logical_source_key).toBe('owner-origin:owner');
  });

  it('places explicit source semantics and conservative independence rules in the provider prompt', () => {
    const evidence = toEvidenceInput([websiteEvidence({})]);
    const prompt = buildReasoningPrompt({
      onboardingSessionId: 'session-1',
      businessRepresentationId: 'representation-1',
      businessId: 'business-1',
      ownerName: 'Owner',
      businessName: 'Business',
      requestTraceId: 'trace-1',
    }, evidence, []);
    expect(prompt).toContain('Logical Source: webpage:https://example.com/');
    expect(prompt).toContain('Authority Type: first_party_company');
    expect(prompt).toContain('Artifact count is not source count');
    expect(prompt).toContain('Source count is not authority count');
    expect(prompt).toContain('not automatically independent third-party confirmation');
  });
});

describe('M1 registered public-source ingestion', () => {
  it('classifies company pages as one first-party authority and external pages conservatively', () => {
    const company = classifyRegisteredPublicSource({
      submittedUrl: 'https://www.example.com/services',
      companyWebsiteUrl: 'https://example.com/',
    });
    expect(company.authorityType).toBe('first_party_company');
    expect(company.authorityKey).toBe('first-party-site:example.com');
    const external = classifyRegisteredPublicSource({
      submittedUrl: 'https://publication.test/article',
      companyWebsiteUrl: 'https://example.com/',
    });
    expect(external.authorityType).toBe('unknown');
    expect(external.authorityKey).toBe('unknown-site:publication.test');
  });

  it('registers restricted social locations without treating them as acquired', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === 'zeya_register_direct_hire_public_source') {
          return { data: [{ source_id: 'source-1', source_status: 'registered', created: true }], error: null };
        }
        return { data: null, error: null };
      },
    };
    const result = await registerPublicSource(client as never, {
      ownerId: 'owner-1',
      onboardingSessionId: 'session-1',
      submittedUrl: 'https://linkedin.com/company/example',
      companyWebsiteUrl: 'https://example.com/',
    });
    expect(result.status).toBe('authentication_required');
    expect(calls.map(call => call.name)).toEqual([
      'zeya_register_direct_hire_public_source',
      'zeya_fail_direct_hire_public_source',
    ]);
    expect(calls.some(call => call.name === 'zeya_finalize_direct_hire_public_source')).toBe(false);
  });

  it('acquires an ordinary page and persists extracted content with stable provenance', async () => {
    let finalizeArgs: Record<string, unknown> | undefined;
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'zeya_claim_direct_hire_public_source') {
          return { data: [{ source_id: 'source-1', submitted_url: 'https://example.com/useful', source_status: 'acquiring' }], error: null };
        }
        if (name === 'zeya_finalize_direct_hire_public_source') {
          finalizeArgs = args;
          return { data: [{ source_id: 'source-1', source_status: 'complete', evidence_count: 4 }], error: null };
        }
        return { data: null, error: null };
      },
    };
    const safeFetch = async (url: string) => url.endsWith('/robots.txt')
      ? fetched(url, 'User-agent: *\nAllow: /')
      : fetched(url, '<title>Useful research</title><meta name="description" content="A useful description"><main><h1>New business finding</h1><p>' + 'Meaningful public business information. '.repeat(8) + '</p></main>');
    const result = await acquireRegisteredPublicSource(client as never, {
      ownerId: 'owner-1', sourceId: 'source-1',
    }, { safeFetch: safeFetch as never, now: () => new Date('2026-08-11T10:00:00.000Z') });
    expect(result).toEqual({ sourceId: 'source-1', status: 'complete', evidenceCount: 4 });
    expect(finalizeArgs?.p_canonical_url).toBe('https://example.com/useful');
    expect(String(finalizeArgs?.p_content_hash)).toHaveLength(64);
    const evidence = finalizeArgs?.p_evidence as Array<Record<string, unknown>>;
    expect(evidence.map(item => item.kind)).toEqual([
      'title', 'meta_description', 'primary_heading', 'registered_page_excerpt',
    ]);
    expect(evidence.every(item => typeof item.rawStatement === 'string' && item.rawStatement !== 'https://example.com/useful')).toBe(true);
  });

  it('uses stable keys for idempotent content and new keys when content changes', async () => {
    const captured: string[][] = [];
    let html = '<title>Version one</title><main><h1>Offer</h1><p>' + 'Original useful content. '.repeat(8) + '</p></main>';
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === 'zeya_claim_direct_hire_public_source') {
          return { data: [{ source_id: 'source-1', submitted_url: 'https://example.com/page', source_status: 'acquiring' }], error: null };
        }
        if (name === 'zeya_finalize_direct_hire_public_source') {
          captured.push((args.p_evidence as Array<{ sourceKey: string }>).map(item => item.sourceKey));
          return { data: [{ source_id: 'source-1', source_status: 'complete', evidence_count: 3 }], error: null };
        }
        return { data: null, error: null };
      },
    };
    const safeFetch = async (url: string) => url.endsWith('/robots.txt')
      ? fetched(url, 'User-agent: *\nAllow: /')
      : fetched(url, html);
    await acquireRegisteredPublicSource(client as never, { ownerId: 'owner-1', sourceId: 'source-1', refreshComplete: true }, { safeFetch: safeFetch as never });
    await acquireRegisteredPublicSource(client as never, { ownerId: 'owner-1', sourceId: 'source-1', refreshComplete: true }, { safeFetch: safeFetch as never });
    expect(captured[1]).toEqual(captured[0]);
    html = '<title>Version two</title><main><h1>Changed offer</h1><p>' + 'Changed useful content. '.repeat(8) + '</p></main>';
    await acquireRegisteredPublicSource(client as never, { ownerId: 'owner-1', sourceId: 'source-1', refreshComplete: true }, { safeFetch: safeFetch as never });
    expect(captured[2]).not.toEqual(captured[1]);
  });

  it('records an inaccessible source without finalizing fabricated Evidence', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === 'zeya_claim_direct_hire_public_source') {
          return { data: [{ source_id: 'source-1', submitted_url: 'https://example.com/private', source_status: 'acquiring' }], error: null };
        }
        return { data: null, error: null };
      },
    };
    const safeFetch = async (url: string) => {
      if (url.endsWith('/robots.txt')) return fetched(url, 'User-agent: *\nAllow: /');
      throw new SafeFetchError('request_timeout');
    };
    const result = await acquireRegisteredPublicSource(client as never, {
      ownerId: 'owner-1', sourceId: 'source-1',
    }, { safeFetch: safeFetch as never });
    expect(result).toEqual({ sourceId: 'source-1', status: 'failed_retryable', evidenceCount: 0 });
    expect(calls.some(call => call.name === 'zeya_fail_direct_hire_public_source'
      && call.args.p_failure_code === 'request_timeout')).toBe(true);
    expect(calls.some(call => call.name === 'zeya_finalize_direct_hire_public_source')).toBe(false);
  });

  it('defines additive tenant isolation, governed transitions, and no canonical writes', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE TABLE public.direct_hire_public_sources');
    expect(sql).toContain('owner_id = auth.uid()');
    expect(sql).toContain('UNIQUE (direct_hire_onboarding_session_id, normalized_url)');
    expect(sql).toContain('registered_public_source_id uuid');
    expect(sql).toContain("evidence.induction_material_type = 'link'");
    expect(sql).toContain("SET status = 'acquiring'");
    expect(sql).toContain("status = 'complete'");
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.zeya_finalize_direct_hire_public_source');
    expect(sql).not.toContain('INSERT INTO public.representation_versions');
    expect(sql).not.toContain('INSERT INTO public.approvals');
    const route = readFileSync('app/api/onboarding/direct-hire/induction/route.ts', 'utf8');
    expect(route).toContain('registerPublicSource(service');
    expect(route).toContain('if (material.type !== "link")');
    expect(route).not.toContain('raw_statement =\n      material.type === "link"');
  });
});
