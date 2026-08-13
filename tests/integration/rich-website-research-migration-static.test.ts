import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const path = "supabase/migrations/20260812000000_rich_website_research.sql";

describe("P1 Rich Website Research migration", () => {
  it("widens only the website extraction vocabulary and preserves service authority", async () => {
    const sql = await readFile(path, "utf8");
    for (const pageType of [
      "pricing", "customers", "case_studies", "testimonials", "industries",
      "methodology", "team", "faq", "contact", "resources",
    ]) expect(sql).toContain(`'${pageType}'`);
    for (const kind of ["section_text", "section_list", "pricing_block", "testimonial", "quantitative_claim"]) {
      expect(sql).toContain(`'${kind}'`);
    }
    expect(sql).toContain("direct-hire-web-v2");
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.zeya_finalize_direct_hire_preparation(");
    expect(sql).toContain("p_successful_page_count smallint");
    expect(sql).toContain("p_failed_page_count smallint");
    expect(sql).toContain("p_successful_page_count NOT BETWEEN 0 AND 10");
    expect(sql).toContain("preparation_successful_page_count BETWEEN 0 AND 10");
    expect(sql).toContain("TO service_role");
    expect(sql).toContain("FROM PUBLIC, anon, authenticated");
    expect(sql).not.toMatch(/INSERT INTO public\.(?:hypotheses|representation_versions|approvals)/);
    expect(sql).not.toMatch(/(?:ADD|DROP) COLUMN/);
  });

  it("is explicit and does not rewrite installed function text dynamically", async () => {
    const sql = await readFile(path, "utf8");
    expect(sql).not.toContain("pg_get_functiondef");
    expect(sql).not.toContain("EXECUTE v_definition");
    expect(sql).not.toContain("replace(");
    expect(sql).toContain("BEGIN;");
    expect(sql).toContain("COMMIT;");
  });
});
