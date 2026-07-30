import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  parseProvisionOwnerBusinessResult,
  provisioningFailureResponse,
} from "../../lib/experience/atomic-provisioning";

const BUSINESS_ID = "11111111-1111-4111-8111-111111111111";
const REPRESENTATION_ID = "22222222-2222-4222-8222-222222222222";

describe("RF-B atomic Public Experience provisioning", () => {
  it("accepts exactly one valid table-returning RPC row", () => {
    expect(parseProvisionOwnerBusinessResult([{
      business_id: BUSINESS_ID,
      business_representation_id: REPRESENTATION_ID,
    }])).toEqual({
      business_id: BUSINESS_ID,
      business_representation_id: REPRESENTATION_ID,
    });
  });

  it("rejects empty and multi-row RPC responses", () => {
    const valid = {
      business_id: BUSINESS_ID,
      business_representation_id: REPRESENTATION_ID,
    };
    expect(parseProvisionOwnerBusinessResult([])).toBeNull();
    expect(parseProvisionOwnerBusinessResult([valid, valid])).toBeNull();
  });

  it("rejects malformed objects and invalid UUIDs", () => {
    expect(parseProvisionOwnerBusinessResult(null)).toBeNull();
    expect(parseProvisionOwnerBusinessResult({})).toBeNull();
    expect(parseProvisionOwnerBusinessResult([{
      business_id: "invalid",
      business_representation_id: REPRESENTATION_ID,
    }])).toBeNull();
    expect(parseProvisionOwnerBusinessResult([{
      business_id: BUSINESS_ID,
      business_representation_id: "invalid",
    }])).toBeNull();
  });

  it("maps provisioning conflicts without exposing database details", async () => {
    const conflict = provisioningFailureResponse({
      code: "PZ409",
      message: "internal database detail",
    });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({
      error: "Select the Business you want to use.",
      code: "business_selection_required",
    });

    const missing = provisioningFailureResponse({ code: "PZ404" });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: "Business setup could not be completed.",
      code: "business_not_found",
    });

    expect(provisioningFailureResponse({ code: "XX000" }).status).toBe(503);
    expect(provisioningFailureResponse(null).status).toBe(503);
  });

  it("uses the RPC and propagates both returned identities unchanged", async () => {
    const route = await readFile(
      "app/api/experience/session/route.ts",
      "utf8",
    );

    expect(route).toContain('db.rpc("zeya_provision_owner_business"');
    expect(route).toContain("p_owner_id: tenantUserId");
    expect(route).toContain("p_business_id: null");
    expect(route).toContain("businessId = provision.business_id");
    expect(route).toContain(
      "businessRepresentationId = provision.business_representation_id",
    );
    expect(route).toContain("businessRepresentationId,");
    expect(route).toContain("p_business_id: businessId");
    expect(route).toContain(
      "p_business_representation_id: businessRepresentationId",
    );
    expect(route).toContain(
      "voiceContext.lineage.businessId !== businessId",
    );
    expect(route).toContain(
      "voiceContext.lineage.businessRepresentationId !== businessRepresentationId",
    );
  });

  it("preserves the scoped anonymous shared-Experience lookup", async () => {
    const route = await readFile(
      "app/api/experience/session/route.ts",
      "utf8",
    );
    const anonymousBranch = route.slice(
      route.indexOf("if (auth instanceof NextResponse)"),
      route.indexOf("} else {", route.indexOf("if (auth instanceof NextResponse)")),
    );

    expect(anonymousBranch).toContain("ZEYA_EXPERIENCE_BUSINESS_ID");
    expect(anonymousBranch).toContain('.from("businesses")');
    expect(anonymousBranch).toContain('.from("business_representations")');
    expect(anonymousBranch).toContain('.eq("business_id", businessId)');
    expect(anonymousBranch).toContain('.eq("user_id", tenantUserId)');
    expect(anonymousBranch).toContain(
      "businessRepresentationId = representation.data.id",
    );
  });

  it("contains no legacy provisioning or placeholder Version creation", async () => {
    const route = await readFile(
      "app/api/experience/session/route.ts",
      "utf8",
    );

    expect(route).not.toContain("initialize_business_representation");
    expect(route).not.toContain(".from('representation_versions')");
    expect(route).not.toContain('.from("representation_versions")');
    expect(route).not.toContain("version_number: 0");
    expect(route).not.toContain("existingBusiness");
    expect(route).not.toContain("newBusiness");
  });
});
