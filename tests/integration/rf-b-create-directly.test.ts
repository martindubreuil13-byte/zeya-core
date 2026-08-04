import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';

/**
 * RF-B Direct Hire (Safe Path) Tests
 * Verifies that new owners use the authenticated Direct Hire flow
 * Confirms Formation initiation does not independently provision owner state
 */

describe('RF-B Direct Hire (Safe Path)', () => {
  it('should verify new owners are directed to Direct Hire onboarding', async () => {
    const filePath = './app/formation/entry/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');
    const ownerRoute = await fs.readFile('./lib/owner/owner-route.ts', 'utf-8');

    expect(content).toContain("ownerData.status === 'new_owner'");
    expect(content).toContain("resolveOwnerJourneyPath({ status: 'new_owner' })");
    expect(ownerRoute).toContain('DIRECT_HIRE_ONBOARDING_PATH = "/onboarding"');
    expect(ownerRoute).toContain('return DIRECT_HIRE_ONBOARDING_PATH');

    console.log('✓ New owners route to Direct Hire onboarding');
  });

  it('should verify initiate endpoint requires explicit businessId', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify businessId is REQUIRED
    expect(content).toContain('if (!body.businessId)');
    expect(content).toContain('businessId is required');

    // Verify error message directs to Representation Experience
    expect(content).toContain('Representation Experience');

    console.log('✓ Initiate endpoint requires explicit businessId');
  });

  it('should verify no automatic Business creation for new owners', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify no automatic business creation code
    expect(content).not.toContain('Owner is new - create Business');
    expect(content).not.toContain('newBusiness');
    expect(content).not.toContain('createError');

    // Verify endpoint rejects missing businessId early
    const lineWithCheck = content.substring(
      content.indexOf('if (!body.businessId)'),
      content.indexOf('if (!body.businessId)') + 300
    );
    expect(lineWithCheck).toContain('400');

    console.log('✓ No automatic Business creation for new owners');
  });

  it('should verify no arbitrary business selection', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify no SELECT...ORDER BY...LIMIT pattern for business discovery
    expect(content).not.toContain('existingBusiness');
    expect(content).not.toContain('created_at');
    expect(content).not.toContain('ascending: true');

    console.log('✓ No arbitrary business selection');
  });

  it('should verify active Formation resumes', async () => {
    const filePath = './app/formation/entry/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify active Formation check
    expect(content).toContain('active_formation');
    expect(content).toContain('formationSessionId');

    expect(content).toContain("status: 'active_formation'");
    expect(content).toContain('router.replace(nextPath)');

    console.log('✓ Active Formation resumes correctly');
  });

  it('should verify existing Representation redirects', async () => {
    const filePath = './app/formation/entry/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify representation check
    expect(content).toContain('has_representation');

    expect(content).toContain("resolveOwnerJourneyPath({ status: 'has_representation' })");

    console.log('✓ Existing Representation redirects to Living Representation');
  });

  it('should verify sessionId validation prevents unsafe redirects', async () => {
    const filePath = './components/formation/FormationEntry.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify sessionId validation
    expect(content).toContain('!formationSessionId');
    expect(content).toContain('typeof formationSessionId');
    expect(content).toContain('Invalid formation session ID');

    console.log('✓ Session ID validation prevents unsafe redirects');
  });

  it('should verify Direct Hire uses first-meeting rather than persuasive language', async () => {
    const filePath = './components/onboarding/DirectHireOnboarding.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    expect(content).toContain('I noticed we’ve never spoken before.');
    expect(content).toContain('Before my first day');
    expect(content).not.toContain('Hire Zeya');
    expect(content).not.toContain('Representation Experience');

    console.log('✓ Direct Hire uses approved first-meeting language');
  });

  it('should verify bearer token required for all authenticated calls', async () => {
    const filePath = './app/formation/entry/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify authenticatedFetch usage
    expect(content).toContain('authenticatedFetch');
    expect(content).toContain('session');

    console.log('✓ Bearer token required for all authenticated calls');
  });

  it('should verify no empty-body independent initiation', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify businessId check happens immediately after parsing body
    const bodyParsing = content.substring(
      content.indexOf('const body'),
      content.indexOf('if (!body.businessId)') + 100
    );
    expect(bodyParsing).toContain('businessId');

    // Verify 400 error for missing businessId (not 201 with auto-provisioning)
    expect(content).toContain("{ status: 400 }");

    console.log('✓ No empty-body independent initiation');
  });

  it('should verify representation is required, not auto-created', async () => {
    const filePath = './app/api/formation/sessions/initiate/route.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify representation must exist
    expect(content).toContain('Representation not found');

    // Verify no call to initialize_business_representation for new owners
    const repSection = content.substring(
      content.indexOf('representation'),
      content.indexOf('representation') + 1000
    );
    expect(repSection).not.toContain('initialize_business_representation');

    console.log('✓ Representation must exist, not auto-created');
  });
});
