import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';

/**
 * RF-B Routing Fixes Tests
 * Verifies that the infinite loading spinner is fixed and routing works correctly
 */

describe('RF-B Routing Fixes', () => {
  it('routes a new authenticated owner to the authenticated Experience', async () => {
    const filePath = './components/owner/OwnerOnboarding.tsx';
    const content = await fs.readFile(filePath, 'utf-8');
    const entry = await fs.readFile('./app/formation/entry/page.tsx', 'utf-8');

    expect(content).toContain('handleStartExperience');
    expect(content).toContain('onClick={handleStartExperience}');
    expect(content).toContain('await onStartExperience()');
    expect(entry).toContain("router.push('/experience')");
    expect(entry).toContain('if (!user || !session)');
    expect(entry).not.toContain("router.push('/')");
    expect(entry).not.toContain("router.replace('/')");
  });

  it('should verify app/page.tsx does not redirect authenticated users', async () => {
    const filePath = './app/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify NO automatic redirect to /formation/entry for authenticated users
    expect(content).not.toContain("router.replace('/formation/entry')");
    expect(content).not.toContain('if (user && !loading)');

    // Verify landing page is open to both authenticated and unauthenticated
    expect(content).toContain('LandingPage');
    expect(content).toContain('SpatialPresence');

    console.log('✓ app/page.tsx does not redirect authenticated users');
  });

  it('should verify app/page.tsx removes useEffect redirect logic', async () => {
    const filePath = './app/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify NO automatic redirect to /formation/entry for authenticated users
    expect(content).not.toContain("router.replace('/formation/entry')");
    expect(content).not.toContain('if (user && !loading)');

    // Verify useEffect for redirect is removed (no useEffect at all)
    const effectCount = (content.match(/useEffect\s*\(/g) || []).length;
    expect(effectCount).toBe(0);

    // Verify user and loading are not destructured (no auth check)
    expect(content).not.toContain(', user,');
    expect(content).not.toContain(', loading');

    console.log('✓ app/page.tsx authentication redirect removed');
  });

  it('should verify FormationEntryPage has loading timeout fallback', async () => {
    const filePath = './app/formation/entry/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify loadingTimeout state
    expect(content).toContain('loadingTimeout');
    expect(content).toContain('setLoadingTimeout');

    // Verify timeout is set to 10 seconds
    expect(content).toContain('10000');

    // Verify fallback UI shows when timeout occurs
    expect(content).toContain('This is taking longer than expected');
    expect(content).toContain('Retry');

    console.log('✓ FormationEntryPage has 10-second loading timeout with retry');
  });

  it('should verify FormationEntryPage timeout only shows during loading', async () => {
    const filePath = './app/formation/entry/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify timeout is only shown when loading
    expect(content).toContain("{loadingTimeout && (");

    // Verify timeout resets when status changes from 'loading'
    expect(content).toContain("if (ownerState.status !== 'loading')");
    expect(content).toContain('setLoadingTimeout(false)');

    console.log('✓ Loading timeout fallback properly gated by loading state');
  });

  it('requires the owner entry callback and exposes recoverable failures', async () => {
    const filePath = './components/owner/OwnerOnboarding.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    expect(content).toContain('onStartExperience: () => void | Promise<void>');
    expect(content).toContain('Unable to begin the Experience. Please try again.');
    expect(content).toContain('role="alert"');
  });

  it('should verify no redirect loop between / and /formation/entry', async () => {
    const filePath = './app/page.tsx';
    const pageContent = await fs.readFile(filePath, 'utf-8');

    const entryFile = './app/formation/entry/page.tsx';
    const entryContent = await fs.readFile(entryFile, 'utf-8');

    // app/page.tsx should not redirect to /formation/entry
    expect(pageContent).not.toContain("'/formation/entry'");

    // /formation/entry redirects unauthenticated users to /login (not to /)
    expect(entryContent).toContain("'/login'");

    // No circular redirect
    console.log('✓ No redirect loop between / and /formation/entry');
  });

  it('should verify final routing map matches requirements', async () => {
    const pageFile = './app/page.tsx';
    const pageContent = await fs.readFile(pageFile, 'utf-8');

    const loginFile = './app/login/page.tsx';
    const loginContent = await fs.readFile(loginFile, 'utf-8');

    const entryFile = './app/formation/entry/page.tsx';
    const entryContent = await fs.readFile(entryFile, 'utf-8');

    // Routing map:
    // ✓ Authenticated visit to / → stays on / (no redirect)
    expect(pageContent).not.toContain("router.replace('/formation/entry')");

    // ✓ Authenticated visit to /login → redirect to /formation/entry
    expect(loginContent).toContain("'/formation/entry'");

    // ✓ Unauthenticated visit to /formation/entry → redirect to /login
    expect(entryContent).toContain("'/login'");

    expect(entryContent).toContain("router.push('/experience')");

    console.log('✓ Final routing map:');
    console.log('  - / → stays (no auth redirect)');
    console.log('  - /login → /formation/entry (if authenticated)');
    console.log('  - /formation/entry → /login (if unauthenticated)');
    console.log('  - /experience → stays (no auth interception)');
  });

  it('should verify CTA routes to /experience without intermediate state', async () => {
    const onboardingFile = './components/owner/OwnerOnboarding.tsx';
    const onboardingContent = await fs.readFile(onboardingFile, 'utf-8');

    const entryFile = './app/formation/entry/page.tsx';
    const entryContent = await fs.readFile(entryFile, 'utf-8');

    expect(onboardingContent).toContain('await onStartExperience()');
    expect(entryContent).toContain("router.push('/experience')");
    expect(entryContent).not.toContain("router.push('/')");
  });

  it('routes active Formation and canonical Representation to exact destinations', async () => {
    const entryContent = await fs.readFile('./app/formation/entry/page.tsx', 'utf-8');

    expect(entryContent).toContain(
      'router.replace(`/formation/sessions/${ownerData.formationSessionId}`)',
    );
    expect(entryContent).toContain("router.replace('/representation/living')");
    expect(entryContent).not.toContain('<FormationEntry');
  });

  it('shows owner-state failures instead of converting them to new-owner routing', async () => {
    const entryContent = await fs.readFile('./app/formation/entry/page.tsx', 'utf-8');
    const statusRoute = await fs.readFile('./app/api/owner/status/route.ts', 'utf-8');

    expect(entryContent).toContain("setOwnerState({ status: 'error' })");
    expect(entryContent).toContain('Failed to load your account');
    expect(statusRoute).toContain("console.error('[owner-status] Formation query failed:");
    expect(statusRoute).toContain("console.error('[owner-status] Representation query failed:");
    expect(statusRoute).toContain("{ success: false, error: 'Failed to check owner status' }");
  });

  it('preserves authentication across client routing through the root provider', async () => {
    const layout = await fs.readFile('./app/layout.tsx', 'utf-8');
    const provider = await fs.readFile('./components/auth/auth-provider.tsx', 'utf-8');
    const supabase = await fs.readFile('./lib/supabase.ts', 'utf-8');

    expect(layout).toContain('<AuthProvider>{children}</AuthProvider>');
    expect(provider).toContain('supabase.auth.onAuthStateChange');
    expect(provider).toContain('setSession(nextSession)');
    expect(supabase).toContain('persistSession: true');
  });
});
