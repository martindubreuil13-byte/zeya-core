import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

describe('RF-B owner status contract', () => {
  it('uses the established Bearer-token authentication boundary', async () => {
    const entry = await readFile('app/formation/entry/page.tsx', 'utf8');
    const helper = await readFile('lib/auth/authenticated-fetch.ts', 'utf8');
    const route = await readFile('app/api/owner/status/route.ts', 'utf8');

    expect(entry).toContain("authenticatedFetch('/api/owner/status', session)");
    expect(helper).toContain("headers.set('Authorization', `Bearer ${session.access_token}`)");
    expect(route).toContain('createAuthenticatedRepresentationContext(request)');
    expect(route).toContain("ownerStatusFailure('authentication', 401)");
  });

  it('classifies a user with no Business as a new owner', async () => {
    const route = await readFile('app/api/owner/status/route.ts', 'utf8');

    expect(route).toContain("from('businesses')");
    expect(route).toContain(".eq('user_id', ownerId)");
    expect(route).toContain('if (businesses.length === 0) return newOwnerResponse()');
  });

  it('requires explicit selection when multiple Businesses exist', async () => {
    const route = await readFile('app/api/owner/status/route.ts', 'utf8');

    expect(route).toContain('if (businesses.length > 1)');
    expect(route).toContain("error: 'business_selection_required'");
    expect(route).toContain('{ status: 409 }');
  });

  it('treats expected missing Representation and Version pointer as new-owner state', async () => {
    const route = await readFile('app/api/owner/status/route.ts', 'utf8');

    expect(route).toContain('if (!representation) return newOwnerResponse()');
    expect(route).toContain(
      'if (!representation.current_version_id) return newOwnerResponse()',
    );
  });

  it('returns the exact active Formation identity with full tenant scope', async () => {
    const route = await readFile('app/api/owner/status/route.ts', 'utf8');

    expect(route).toContain("from('representation_formation_sessions')");
    expect(route).toContain(".eq('owner_id', ownerId)");
    expect(route).toContain(".eq('business_id', businessId)");
    expect(route).toContain(
      ".eq('business_representation_id', representation.id)",
    );
    expect(route).toContain('.limit(1)');
    expect(route).toContain('formationSessionId: activeFormation.id');
  });

  it('uses the canonical current-version pointer instead of a nonexistent marker', async () => {
    const route = await readFile('app/api/owner/status/route.ts', 'utf8');

    expect(route).toContain(".eq('id', representation.current_version_id)");
    expect(route).toContain(
      ".eq('business_representation_id', representation.id)",
    );
    expect(route).not.toContain("'is_canonical'");
    expect(route).toContain("status: 'has_representation'");
  });

  it('returns structured failures for real query errors', async () => {
    const route = await readFile('app/api/owner/status/route.ts', 'utf8');

    for (const stage of [
      'business_lookup',
      'representation_lookup',
      'formation_lookup',
      'version_lookup',
      'response_validation',
    ]) {
      expect(route).toContain(`'${stage}'`);
    }
    expect(route).toContain("error: 'owner_status_failed'");
  });

  it('logs only safe client failure fields and never redirects to root', async () => {
    const entry = await readFile('app/formation/entry/page.tsx', 'utf8');

    expect(entry).toContain("console.error('[formation-entry] owner status failed'");
    expect(entry).toContain('status: res.status');
    expect(entry).toContain('error: failure.error');
    expect(entry).toContain('stage: failure.stage');
    expect(entry).not.toContain("router.replace('/')");
    expect(entry).not.toContain("router.push('/')");
  });

  it('renders a dedicated multiple-Business state without selecting or navigating', async () => {
    const entry = await readFile('app/formation/entry/page.tsx', 'utf8');

    expect(entry).toContain('res.status === 409');
    expect(entry).toContain("failure.error === 'business_selection_required'");
    expect(entry).toContain("failure.stage === 'business_lookup'");
    expect(entry).toContain("setOwnerState({ status: 'business_selection_required' })");
    expect(entry).toContain('Business selection required');
    expect(entry).toContain('More than one business is connected to this account.');
    expect(entry).toContain('onClick={retryOwnerStatus}');

    const selectionState = entry.slice(
      entry.indexOf("if (ownerState.status === 'business_selection_required')"),
      entry.indexOf('// New owner - show Representation Experience onboarding'),
    );
    expect(selectionState).not.toContain('Failed to load your account');
    expect(selectionState).not.toContain('router.push');
    expect(selectionState).not.toContain('router.replace');
    expect(selectionState).not.toContain('businessId');
  });
});
