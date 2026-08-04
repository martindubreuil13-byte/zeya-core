import { describe, expect, it } from "vitest";
import {
  normalizeDirectHireWebsite,
  validateDirectHireProfile,
} from "../../lib/onboarding/direct-hire-validation";

const validProfile = {
  ownerName: "Martin",
  businessName: "AI Architecture Academy",
  website: "academy.example.com",
  phone: "+1 202 555 0123",
  growthPriority: "Practical AI architecture workshops",
};

describe("Direct Hire five-field validation", () => {
  it("normalizes the approved five fields", () => {
    expect(validateDirectHireProfile(validProfile)).toEqual({
      success: true,
      data: {
        ...validProfile,
        website: "https://academy.example.com/",
        phone: "+12025550123",
      },
    });
  });

  it("returns an inline error for every missing field", () => {
    const result = validateDirectHireProfile({});
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(Object.keys(result.errors).sort()).toEqual([
      "businessName",
      "growthPriority",
      "ownerName",
      "phone",
      "website",
    ]);
  });

  it("rejects unsafe or non-public website destinations", () => {
    for (const value of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "http://localhost",
      "http://service.internal",
      "http://127.0.0.1",
      "http://[::1]",
      "https://user:secret@example.com",
      "https://example.com:8443",
      "https://example.com\u0000.evil.test",
    ]) {
      expect(normalizeDirectHireWebsite(value), value).toBeNull();
    }
  });

  it("accepts HTTP(S) public hostnames and removes fragments", () => {
    expect(normalizeDirectHireWebsite("https://www.example.com/about#team"))
      .toBe("https://www.example.com/about");
    expect(normalizeDirectHireWebsite("example.co.uk/services"))
      .toBe("https://example.co.uk/services");
  });

  it("uses the established E.164 normalization boundary", () => {
    const invalid = validateDirectHireProfile({ ...validProfile, phone: "0812345678" });
    expect(invalid.success).toBe(false);
    if (!invalid.success) {
      expect(invalid.errors.phone).toContain("country code");
    }
  });
});
