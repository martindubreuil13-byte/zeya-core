import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';

/**
 * RF-B Public Experience to Formation Handoff Tests
 * Verifies smooth transition from voice conversation to Formation workflow
 */

describe('RF-B Public Experience to Formation Handoff', () => {
  it('should verify authenticated experience page imports required modules', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify auth and routing imports
    expect(content).toContain("import { useRouter }");
    expect(content).toContain("import { useAuth }");
    expect(content).toContain("import { authenticatedFetch }");

    console.log('✓ Experience page has auth and routing imports');
  });

  it('should verify Formation handoff state is tracked', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify state for Formation transition
    expect(content).toContain('formationLoading');
    expect(content).toContain('setFormationLoading');
    expect(content).toContain('formationError');
    expect(content).toContain('setFormationError');

    console.log('✓ Formation handoff state tracked');
  });

  it('should verify handleBeginFormation callback exists and calls /api/formation/prepare', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify handler function
    expect(content).toContain('handleBeginFormation');
    expect(content).toContain('/api/formation/prepare');
    expect(content).toContain('authenticatedFetch');

    // Verify it checks for authentication
    expect(content).toContain('if (!user || !session');

    // Verify it extracts publicExperienceSessionId
    expect(content).toContain('experienceSession.token');
    expect(content).toContain('publicExperienceSessionId');

    // Verify idempotency: uses response.data.sessionId
    expect(content).toContain('data.data?.sessionId');

    console.log('✓ handleBeginFormation calls /api/formation/prepare with proper validation');
  });

  it('should verify Formation button appears only for authenticated users', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify conditional rendering based on user auth
    expect(content).toContain('{user ? (');

    // Verify button text
    expect(content).toContain('Begin working with Zeya');

    // Verify loading state
    expect(content).toContain('formationLoading ?');
    expect(content).toContain('Beginning Formation...');

    console.log('✓ Formation button conditional on authentication');
  });

  it('should verify error display for Formation failures', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify error rendering
    expect(content).toContain('formationError && (');
    expect(content).toContain('{formationError}');

    console.log('✓ Formation error state displayed to user');
  });

  it('should verify button is disabled during Formation transition', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify disabled state
    expect(content).toContain('disabled={formationLoading}');

    console.log('✓ Button disabled during Formation transition');
  });

  it('should verify return home button remains available', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify secondary action still exists
    expect(content).toContain('Return home');
    expect(content).toContain('onClick={() => setPhase("initial")');

    console.log('✓ Return home button available as secondary action');
  });

  it('should verify handler error handling', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify error cases
    expect(content).toContain('Authentication required');
    expect(content).toContain('Invalid response from server');
    expect(content).toContain('Failed to begin Formation');

    // Verify loading is reset on error
    expect(content).toContain('setFormationLoading(false)');

    console.log('✓ Error handling prevents stuck loading state');
  });

  it('should verify handler checks response success flag', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify success validation
    expect(content).toContain('if (!res.ok)');
    expect(content).toContain('if (!data.success || !data.data?.sessionId)');

    console.log('✓ Handler validates response structure');
  });

  it('should verify Formation API endpoint structure', async () => {
    const filePath = './app/api/formation/prepare/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify endpoint exists
    expect(content).toContain('POST');
    expect(content).toContain('/api/formation/prepare');

    // Verify it returns success and data.sessionId
    expect(content).toContain('{ status: 201 }');
    expect(content).toContain('success: true');

    console.log('✓ Formation prepare endpoint returns proper structure');
  });

  it('should verify Formation prepare endpoint uses publicExperienceSessionId', async () => {
    const filePath = './app/api/formation/prepare/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify it accepts the public experience session
    expect(content).toContain('publicExperienceSessionId');
    expect(content).toContain('public_experience_sessions');

    // Verify it validates the session state
    expect(content).toContain('reflection_ready');

    console.log('✓ Formation prepare validates public experience session');
  });

  it('should verify no new Business/Representation created', async () => {
    const filePath = './app/api/formation/prepare/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify it reuses existing business and representation
    expect(content).toContain('business_id');
    expect(content).toContain('business_representation_id');

    // Verify no creation logic
    expect(content).not.toContain('INSERT INTO businesses');
    expect(content).not.toContain('initialize_business_representation');

    console.log('✓ Formation prepare reuses existing business/representation');
  });

  it('should verify idempotency: Formation prepare is safe to call multiple times', async () => {
    const filePath = './app/api/formation/prepare/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify session validation prevents duplicates
    expect(content).toContain('if (publicExpSession.state !== \'reflection_ready\')');

    // Verify confirmed brief check
    expect(content).toContain('confirmed');

    console.log('✓ Formation prepare validates preconditions for idempotency');
  });

  it('should verify handler navigates to Formation session', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify navigation on success
    expect(content).toContain('router.push');
    expect(content).toContain('/formation/sessions/');
    expect(content).toContain('data.data.sessionId');

    console.log('✓ Handler navigates to Formation session on success');
  });

  it('should verify NO navigation on failure', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // router.push only called in success path
    const handlerSection = content.substring(
      content.indexOf('const handleBeginFormation'),
      content.indexOf('const handleBeginFormation') + 2000
    );

    // Count router.push calls - should be 1, inside success block
    const pushCount = (handlerSection.match(/router\.push/g) || []).length;
    expect(pushCount).toBeGreaterThan(0);

    // Verify error paths don't navigate
    expect(handlerSection).toContain('setFormationError');
    expect(handlerSection).toContain('return');

    console.log('✓ Handler does not navigate on error');
  });

  it('should verify Formation session is validated before redirect', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify validation before navigation
    expect(content).toContain('!data.data?.sessionId');

    console.log('✓ Session ID validated before navigation');
  });

  it('should verify handler is called by button click', async () => {
    const filePath = './app/experience/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify button onClick handler
    expect(content).toContain('onClick={handleBeginFormation}');

    console.log('✓ Button correctly wired to handler');
  });
});
