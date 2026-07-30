import { NextResponse } from "next/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ProvisionOwnerBusinessRow = {
  business_id: string;
  business_representation_id: string;
};

export function parseProvisionOwnerBusinessResult(data: unknown): ProvisionOwnerBusinessRow | null {
  if (!Array.isArray(data) || data.length !== 1) return null;
  const row: unknown = data[0];
  if (!row || typeof row !== "object") return null;

  const businessId = Reflect.get(row, "business_id");
  const businessRepresentationId = Reflect.get(row, "business_representation_id");
  if (
    typeof businessId !== "string" ||
    !UUID.test(businessId) ||
    typeof businessRepresentationId !== "string" ||
    !UUID.test(businessRepresentationId)
  ) {
    return null;
  }

  return {
    business_id: businessId,
    business_representation_id: businessRepresentationId,
  };
}

export function provisioningFailureResponse(error: unknown): NextResponse {
  const code =
    error && typeof error === "object"
      ? Reflect.get(error, "code")
      : undefined;

  if (code === "PZ409") {
    return NextResponse.json(
      {
        error: "Select the Business you want to use.",
        code: "business_selection_required",
      },
      { status: 409 },
    );
  }

  if (code === "PZ404") {
    return NextResponse.json(
      {
        error: "Business setup could not be completed.",
        code: "business_not_found",
      },
      { status: 404 },
    );
  }

  return NextResponse.json(
    { error: "The Experience is temporarily unavailable." },
    { status: 503 },
  );
}
