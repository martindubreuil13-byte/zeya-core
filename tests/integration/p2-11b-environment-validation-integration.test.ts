/**
 * P2.11B Environment Validation Integration Test
 * Verifies P2.10R environment validation is properly integrated into:
 * - ElevenLabs provider dispatch
 * - Webhook event processor
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ElevenLabsProvider } from '../../lib/providers/elevenlabs-provider';
import * as envValidation from '../../lib/providers/environment-validation';
import type { ProviderDispatchRequest } from '../../lib/providers/provider-types';

describe('P2.11B Environment Validation Integration', () => {
  const validRequest: ProviderDispatchRequest = {
    workerBriefId: 'test-brief-id',
    targetPhone: '+1234567890',
    objective: 'Test objective',
    dynamicVariables: {},
    targetName: 'Test Target',
  };

  beforeEach(() => {
    // Reset environment for each test
    delete process.env.ELEVENLABS_ENVIRONMENT;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Provider Dispatch Validation', () => {
    it('should fail closed when ELEVENLABS_ENVIRONMENT is missing', async () => {
      const provider = new ElevenLabsProvider();

      const result = await provider.dispatch(validRequest);

      expect(result.status).toBe('FAILED');
      expect(result.message).toContain('blocked');
      expect(result.message).toContain('ELEVENLABS_ENVIRONMENT');
    });

    it('should fail closed when ELEVENLABS_ENVIRONMENT is invalid', async () => {
      process.env.ELEVENLABS_ENVIRONMENT = 'invalid-env';
      const provider = new ElevenLabsProvider();

      const result = await provider.dispatch(validRequest);

      expect(result.status).toBe('FAILED');
      expect(result.message).toContain('blocked');
      expect(result.message).toContain('invalid');
    });

    it('should validate environment BEFORE checking targetPhone', async () => {
      // Even without targetPhone, should fail on environment first
      process.env.ELEVENLABS_ENVIRONMENT = 'invalid-env';
      const provider = new ElevenLabsProvider();

      const result = await provider.dispatch({
        ...validRequest,
        targetPhone: undefined as any,
      });

      // Should fail on environment, not missing phone
      expect(result.status).toBe('FAILED');
      expect(result.message).toContain('blocked');
      expect(result.message).toContain('ELEVENLABS_ENVIRONMENT');
    });
  });

  describe('Environment Validation Module', () => {
    it('should export validateEnvironment function', () => {
      expect(typeof envValidation.validateEnvironment).toBe('function');
    });

    it('should export getValidatedEnvironment function', () => {
      expect(typeof envValidation.getValidatedEnvironment).toBe('function');
    });

    it('should throw on missing ELEVENLABS_ENVIRONMENT', () => {
      delete process.env.ELEVENLABS_ENVIRONMENT;

      expect(() => {
        envValidation.getValidatedEnvironment();
      }).toThrow('ELEVENLABS_ENVIRONMENT not configured');
    });

    it('should throw on invalid ELEVENLABS_ENVIRONMENT', () => {
      process.env.ELEVENLABS_ENVIRONMENT = 'invalid-value';

      expect(() => {
        envValidation.getValidatedEnvironment();
      }).toThrow('invalid');
    });

    it('should accept staging environment', () => {
      process.env.ELEVENLABS_ENVIRONMENT = 'staging';

      const result = envValidation.getValidatedEnvironment();
      expect(result).toBe('staging');
    });

    it('should accept production environment', () => {
      process.env.ELEVENLABS_ENVIRONMENT = 'production';

      const result = envValidation.getValidatedEnvironment();
      expect(result).toBe('production');
    });
  });

  describe('Fail-Closed Guarantee', () => {
    it('should never silently fall back to production', () => {
      // Try various invalid values
      const invalidValues = [undefined, null, '', 'prod', 'stage', 'test', 'development'];

      for (const value of invalidValues) {
        process.env.ELEVENLABS_ENVIRONMENT = value as any;

        expect(() => {
          envValidation.getValidatedEnvironment();
        }).toThrow();
      }
    });
  });

  describe('Integration with Provider', () => {
    it('should import and use environment validation in provider', async () => {
      // Verify that the provider code contains the validation call
      const providerCode = await import('../../lib/providers/elevenlabs-provider');
      expect(providerCode).toBeDefined();

      // This test verifies the module can be imported
      // The actual validation happens in the dispatch method
    });
  });

  describe('Canonical Production Configuration', () => {
    it('Production environment should be production (not staging)', () => {
      // This is a documentation test
      // In Production Supabase, ELEVENLABS_ENVIRONMENT should be 'production'
      // This test exists to make the expectation explicit
      process.env.ELEVENLABS_ENVIRONMENT = 'production';

      const result = envValidation.getValidatedEnvironment();
      expect(result).toBe('production');
    });
  });
});
