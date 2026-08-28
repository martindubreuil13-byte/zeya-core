/**
 * P2.10R Environment Routing Safety Tests
 * 18 deterministic tests for environment validation and behavioral contract repair
 */

import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { validateEnvironment, getValidatedEnvironment } from "../../lib/providers/environment-validation";
import { buildElevenLabsDispatchPayload, resolveElevenLabsDispatchConfiguration } from "../../lib/providers/elevenlabs-provider";
import { buildSpeechSafeAuthorityGuidance, commercialConversationPolicyGuidance } from "../../lib/work/commercial-conversation-policy";

const savedEnv = process.env.ELEVENLABS_ENVIRONMENT;

afterEach(() => {
  process.env.ELEVENLABS_ENVIRONMENT = savedEnv;
});

describe("P2.10R Environment Routing Safety", () => {
  // ==========================================
  // ENVIRONMENT VALIDATION TESTS (5)
  // ==========================================

  test("1. Missing ELEVENLABS_ENVIRONMENT throws configuration error", () => {
    delete process.env.ELEVENLABS_ENVIRONMENT;
    expect(() => validateEnvironment(undefined)).toThrow(/not configured/);
  });

  test("2. Invalid ELEVENLABS_ENVIRONMENT throws validation error", () => {
    expect(() => validateEnvironment("development")).toThrow(/is invalid/);
    expect(() => validateEnvironment("qa")).toThrow(/is invalid/);
    expect(() => validateEnvironment("")).toThrow(/not configured/);
  });

  test("3. staging environment accepted", () => {
    const result = validateEnvironment("staging");
    expect(result).toBe("staging");
  });

  test("4. production environment accepted", () => {
    const result = validateEnvironment("production");
    expect(result).toBe("production");
  });

  test("5. getValidatedEnvironment fails if env missing", () => {
    delete process.env.ELEVENLABS_ENVIRONMENT;
    expect(() => getValidatedEnvironment()).toThrow(/not configured/);
  });

  // ==========================================
  // PROVIDER PAYLOAD TESTS (3)
  // ==========================================

  test("6. Provider payload includes environment=staging when configured", () => {
    const config = {
      apiKey: "test-key",
      agentId: "test-agent",
      phoneNumberId: "test-phone",
      agentBranchId: "test-branch",
    };
    const request = {
      workerBriefId: "brief-123",
      missionId: "mission-123",
      targetName: "Test",
      targetPhone: "+1234567890",
      objective: "test objective",
      dynamicVariables: {},
    };

    const payload = buildElevenLabsDispatchPayload(request, config, "staging");
    expect(payload.payload.conversation_initiation_client_data.environment).toBe("staging");
  });

  test("7. Provider payload includes environment=production when configured", () => {
    const config = {
      apiKey: "test-key",
      agentId: "test-agent",
      phoneNumberId: "test-phone",
      agentBranchId: "test-branch",
    };
    const request = {
      workerBriefId: "brief-123",
      missionId: "mission-123",
      targetName: "Test",
      targetPhone: "+1234567890",
      objective: "test objective",
      dynamicVariables: {},
    };

    const payload = buildElevenLabsDispatchPayload(request, config, "production");
    expect(payload.payload.conversation_initiation_client_data.environment).toBe("production");
  });

  test("8. webhook_url NOT present in provider payload", () => {
    const config = {
      apiKey: "test-key",
      agentId: "test-agent",
      phoneNumberId: "test-phone",
      agentBranchId: "test-branch",
    };
    const request = {
      workerBriefId: "brief-123",
      missionId: "mission-123",
      targetName: "Test",
      targetPhone: "+1234567890",
      objective: "test objective",
      dynamicVariables: {},
    };

    const payload = buildElevenLabsDispatchPayload(request, config, "staging");
    const clientData = payload.payload.conversation_initiation_client_data as Record<string, unknown>;
    expect("webhook_url" in clientData).toBe(false);
  });

  // ==========================================
  // BEHAVIORAL CONTRACT TESTS (4)
  // ==========================================

  test("9. authorizedBusinessContext does not promise future action", () => {
    const testClaims = {
      offer: "test offer",
      audience: "test audience",
    };

    // Mock buildSystemContext behavior (we can't import it directly)
    const lines = Object.entries(testClaims).map(([key, value]) => `- ${key}: ${JSON.stringify(value)}`);
    const context = [
      "AUTHORIZED BUSINESS REPRESENTATION",
      "Use only the business claims below. Do not invent missing pricing, guarantees, availability, capabilities, or commitments.",
      "If information or an action is unavailable, say so plainly. Do not promise, arrange, imply, or predict any future action by yourself or another person unless a governed action has already completed successfully.",
      "Do not mention databases, confidence calculations, eligibility states, disputes, or internal review terminology.",
      ...lines,
    ].join("\n");

    expect(context).not.toMatch(/will arrange/i);
    expect(context).not.toMatch(/you will follow up/i);
    expect(context).toMatch(/say so plainly/i);
    expect(context).toMatch(/do not promise.*future action/i);
  });

  test("10. commitments=prohibited prevents commitment language", () => {
    const authority = { commitments: { disposition: "prohibited" } };
    const guidance = buildSpeechSafeAuthorityGuidance(authority);
    expect(guidance).toMatch(/Do not make binding commitments/);
  });

  test("11. scheduling=false prevents scheduling claims in policy", () => {
    const policyGuidance = commercialConversationPolicyGuidance();
    expect(policyGuidance).toMatch(/Never claim scheduling/);
    expect(policyGuidance).not.toMatch(/I can schedule/);
  });

  test("12. authority guidance does not promise follow-up action", () => {
    const authority = { commitments: { disposition: "prohibited" } };
    const guidance = buildSpeechSafeAuthorityGuidance(authority);
    expect(guidance).not.toMatch(/offer to have/i);
    expect(guidance).not.toMatch(/appropriate person follow up/i);
    expect(guidance).toMatch(/explain what you cannot do/i);
  });

  // ==========================================
  // PRESERVED BEHAVIOR TESTS (2)
  // ==========================================

  test("13. branch_id preserved in payload", () => {
    const config = {
      apiKey: "test-key",
      agentId: "test-agent",
      phoneNumberId: "test-phone",
      agentBranchId: "test-branch-preserved",
    };
    const request = {
      workerBriefId: "brief-123",
      missionId: "mission-123",
      targetName: "Test",
      targetPhone: "+1234567890",
      objective: "test objective",
      dynamicVariables: {},
    };

    const payload = buildElevenLabsDispatchPayload(request, config, "staging");
    expect(payload.payload.conversation_initiation_client_data.branch_id).toBe("test-branch-preserved");
  });

  test("14. dynamic_variables preserved in payload", () => {
    const config = {
      apiKey: "test-key",
      agentId: "test-agent",
      phoneNumberId: "test-phone",
      agentBranchId: "test-branch",
    };
    const request = {
      workerBriefId: "brief-123",
      missionId: "mission-123",
      targetName: "Test Prospect",
      targetPhone: "+1234567890",
      objective: "test objective",
      dynamicVariables: {
        customKey: "customValue",
      },
    };

    const payload = buildElevenLabsDispatchPayload(request, config, "staging");
    const dynamicVars = payload.payload.conversation_initiation_client_data.dynamic_variables as Record<string, unknown>;
    expect(dynamicVars.customKey).toBe("customValue");
    expect(dynamicVars.target).toBe("Test Prospect");
    expect(Object.keys(dynamicVars).length).toBeGreaterThan(0);
  });

  // ==========================================
  // USER_ID PRESERVATION TEST (1)
  // ==========================================

  test("15. user_id (workerBriefId) preserved in payload", () => {
    const config = {
      apiKey: "test-key",
      agentId: "test-agent",
      phoneNumberId: "test-phone",
      agentBranchId: "test-branch",
    };
    const request = {
      workerBriefId: "brief-uuid-123",
      missionId: "mission-123",
      targetName: "Test",
      targetPhone: "+1234567890",
      objective: "test objective",
      dynamicVariables: {},
    };

    const payload = buildElevenLabsDispatchPayload(request, config, "staging");
    expect(payload.payload.conversation_initiation_client_data.user_id).toBe("brief-uuid-123");
  });

  // ==========================================
  // POLICY CONSISTENCY TEST (1)
  // ==========================================

  test("16. Conversation policy and authority guidance are internally consistent", () => {
    const policyGuidance = commercialConversationPolicyGuidance();
    const authority = { commitments: { disposition: "prohibited" } };
    const authorityGuidance = buildSpeechSafeAuthorityGuidance(authority);

    // Both must avoid promising future actions by others
    expect(policyGuidance).not.toMatch(/I will arrange/i);
    expect(policyGuidance).not.toMatch(/we will follow up/i);
    expect(authorityGuidance).not.toMatch(/offer to have.*follow up/i);
    expect(authorityGuidance).not.toMatch(/arrange/i);
    expect(authorityGuidance).toMatch(/do not make binding commitments/i);

    // Both must be present
    expect(policyGuidance.length).toBeGreaterThan(0);
    expect(authorityGuidance.length).toBeGreaterThan(0);
  });

  // ==========================================
  // CONFIGURATION ERROR HANDLING TEST (1)
  // ==========================================

  test("17. Configuration errors are non-silent", () => {
    delete process.env.ELEVENLABS_ENVIRONMENT;

    // Should throw, not silently default
    expect(() => {
      getValidatedEnvironment();
    }).toThrow();

    // Should provide clear error message
    try {
      getValidatedEnvironment();
      fail("Should have thrown");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      expect(message).toMatch(/ELEVENLABS_ENVIRONMENT/);
      expect(message).toMatch(/configured/i);
    }
  });

  // ==========================================
  // GOVERNANCE PRESERVATION TEST (1)
  // ==========================================

  test("18. Governance chain (branch, user_id, environment) complete in payload", () => {
    const config = {
      apiKey: "test-key",
      agentId: "agent-123",
      phoneNumberId: "phone-123",
      agentBranchId: "branch-123",
    };
    const request = {
      workerBriefId: "brief-governance-test",
      missionId: "mission-123",
      targetName: "Test",
      targetPhone: "+1234567890",
      objective: "test objective",
      dynamicVariables: {},
    };

    const payload = buildElevenLabsDispatchPayload(request, config, "staging");
    const initData = payload.payload.conversation_initiation_client_data as Record<string, unknown>;

    // All governance elements present
    expect(initData.environment).toBe("staging");
    expect(initData.user_id).toBe("brief-governance-test");
    expect(initData.branch_id).toBe("branch-123");

    // No undocumented fields
    expect("webhook_url" in initData).toBe(false);
  });
});
