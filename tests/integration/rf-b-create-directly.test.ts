import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';

/**
 * RF-B Representation Experience (Safe Path) Tests
 * Verifies that new owners only use the Representation Experience flow
 * Confirms no unsafe automatic Business/Representation provisioning
 */

describe('RF-B Representation Experience (Safe Path)', () => {
  it('should verify new owners are directed to Representation Experience', async () => {
    const filePath = './app/formation/entry/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify OwnerOnboarding is rendered for new_owner status
    expect(content).toContain("ownerState.status === 'new_owner'");
    expect(content).toContain('<OwnerOnboarding');

    // Verify OwnerOnboarding component exists
    const onboardingPath = './components/owner/OwnerOnboarding.tsx';
    const onboardingContent = await fs.readFile(onboardingPath, 'utf-8');
    expect(onboardingContent).toContain('Representation Experience');

    console.log('✓ New owners shown Representation Experience');
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

    // Verify shows FormationEntry for active Formation
    expect(content).toContain("<FormationEntry onComplete={() => {}} />");

    console.log('✓ Active Formation resumes correctly');
  });

  it('should verify existing Representation redirects', async () => {
    const filePath = './app/formation/entry/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify representation check
    expect(content).toContain('has_representation');

    // Verify redirect to Living Representation
    expect(content).toContain("router.replace('/representation/living')");

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

  it('should verify OwnerOnboarding shows Representation Experience language', async () => {
    const filePath = './components/owner/OwnerOnboarding.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Verify premium language, not SaaS cards
    expect(content).toContain('Begin with Zeya');
    expect(content).toContain('understand what you do');
    expect(content).toContain('Representation Experience');

    // Verify no SaaS comparison language
    expect(content).not.toContain('Recommended');
    expect(content).not.toContain('Guided first conversation');
    expect(content).not.toContain('Full control');
    expect(content).not.toContain('Create Directly');

    // Verify single button, not dual cards
    expect(content).not.toContain('blue/purple');
    expect(content).not.toContain('two options');

    console.log('✓ OwnerOnboarding uses premium Representation Experience language');
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
