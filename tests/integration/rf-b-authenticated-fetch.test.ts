import { describe, it, expect } from 'vitest';
import fs from 'fs/promises';

/**
 * RF-B Authenticated Fetch Integration Tests
 * Verifies that all authenticated browser API calls include Bearer token
 */

describe('RF-B Authenticated Fetch Tests', () => {
  it('should verify authenticatedFetch helper exists', async () => {
    const filePath = './lib/auth/authenticated-fetch.ts';
    const content = await fs.readFile(filePath, 'utf-8');

    expect(content).toContain('authenticatedFetch');
    expect(content).toContain('Bearer');
    expect(content).toContain('access_token');
  });

  it('should verify FormationEntry uses authenticatedFetch', async () => {
    const filePath = './components/formation/FormationEntry.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    expect(content).toContain('authenticatedFetch');
    expect(content).toContain('useAuth');
    expect(content).toContain('session');
  });

  it('should verify FormationWorkflow uses authenticatedFetch for all API calls', async () => {
    const filePath = './components/formation/FormationWorkflow.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    expect(content).toContain('authenticatedFetch');
    expect(content).toContain('useAuth');
    expect(content).toContain('authSession');

    // Verify all 6 API calls use authenticatedFetch
    const authenticatedFetchCalls = content.match(/authenticatedFetch\(/g) || [];
    expect(authenticatedFetchCalls.length).toBeGreaterThanOrEqual(6);
  });

  it('should verify FormationEntry page uses authenticatedFetch', async () => {
    const filePath = './app/formation/entry/page.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    expect(content).toContain('authenticatedFetch');
    expect(content).toContain('useAuth');
    expect(content).toContain('session');
    expect(content).toContain('401');
  });

  it('should verify router.replace is used for auth redirects', async () => {
    const formationEntryPath = './app/formation/entry/page.tsx';
    const formationEntryContent = await fs.readFile(formationEntryPath, 'utf-8');

    expect(formationEntryContent).toContain("router.replace('/login')");
    expect(formationEntryContent).toContain("router.replace('/representation/living')");
  });

  it('should verify 401 error handling in FormationWorkflow', async () => {
    const filePath = './components/formation/FormationWorkflow.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    expect(content).toContain("res.status === 401");
    expect(content).toContain("router.replace('/login')");

    // Count how many times we check for 401
    const statusChecks = content.match(/res\.status === 401/g) || [];
    expect(statusChecks.length).toBeGreaterThanOrEqual(5); // One for each callback
  });

  it('should verify no unauthenticated fetch calls to formation APIs', async () => {
    const filesToCheck = [
      './components/formation/FormationWorkflow.tsx',
      './components/formation/FormationEntry.tsx',
      './app/formation/entry/page.tsx',
    ];

    for (const filePath of filesToCheck) {
      const content = await fs.readFile(filePath, 'utf-8');

      // Look for fetch calls that don't use authenticatedFetch
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Skip comments and non-fetch lines
        if (line.includes('//') || !line.includes('fetch(')) continue;

        // Check if this is a formation API call
        if (
          line.includes('/api/owner/status') ||
          line.includes('/api/formation/') ||
          line.includes('/api/representation/')
        ) {
          // Verify it uses authenticatedFetch, not bare fetch
          expect(line).toContain('authenticatedFetch');
        }
      }
    }
  });

  it('should verify useAuth hook returns session property', async () => {
    const filePath = './components/auth/auth-provider.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    expect(content).toContain('session');
    expect(content).toContain('AuthContextValue');
    expect(content).toContain('Session');
    expect(content).toContain('useAuth');
  });

  it('should verify authenticated callbacks check for authSession before API calls', async () => {
    const filePath = './components/formation/FormationWorkflow.tsx';
    const content = await fs.readFile(filePath, 'utf-8');

    // Each callback should check if authSession exists
    const callbacks = [
      'advanceState',
      'generateSummary',
      'submitCorrection',
      'approveSummary',
      'requestMoreTime',
    ];

    for (const callback of callbacks) {
      // Find the callback function
      const callbackStart = content.indexOf(`const ${callback} = useCallback`);
      expect(callbackStart).toBeGreaterThan(-1);

      // Get the next 500 chars and verify auth check
      const section = content.substring(callbackStart, callbackStart + 500);
      expect(section).toMatch(/(!authSession|!authSession\s*\))/);
    }
  });
});
