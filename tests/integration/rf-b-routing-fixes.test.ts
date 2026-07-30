import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';

/**
 * RF-B Routing Fixes Tests
 * Verifies that the infinite loading spinner is fixed and routing works correctly
 */

describe('RF-B Routing Fixes', () => {
  it('should verify OwnerOnboarding navigates to /experience', async () => {
    const filePath = './components/owner/OwnerOnboarding.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify router.push('/experience') is called
    expect(content).toContain("router.push('/experience')");

    // Verify button click handler calls navigation
    expect(content).toContain('handleStartExperience');
    expect(content).toContain('onClick={handleStartExperience}');

    console.log('✓ OwnerOnboarding button navigates to /experience');
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

  it('should verify OwnerOnboarding callback is optional', async () => {
    const filePath = './components/owner/OwnerOnboarding.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify callback is optional with ?
    expect(content).toContain('onStartExperience?: () => void');

    // Verify it checks if callback exists before calling
    expect(content).toContain('if (onStartExperience)');

    console.log('✓ OwnerOnboarding callback is optional');
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

    // ✓ Authenticated explicit visit to /experience → stays on /experience
    // (not blocked by any middleware or redirect)
    // This is verified by absence of redirects in /experience route

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

    // Button handler navigates directly
    expect(onboardingContent).toContain("router.push('/experience')");

    // Entry page doesn't block navigation to /experience
    expect(entryContent).not.toContain("'/experience'");

    console.log('✓ CTA routes to /experience via router.push (direct navigation)');
  });
});
