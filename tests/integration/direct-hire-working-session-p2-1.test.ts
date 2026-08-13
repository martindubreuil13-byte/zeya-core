import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  isValidIanaTimezone,
  localDateTimeInTimezoneToIso,
  parseFutureScheduledAt,
} from "../../lib/onboarding/direct-hire-working-session";
import { projectDirectHireCount } from "../../lib/onboarding/direct-hire-contract";

const migrationPath = "supabase/migrations/20260813000000_direct_hire_first_working_sessions.sql";

describe("P2.1 Direct Hire journey sequencing", () => {
  it("does not trigger Preparation from initial profile submission", async () => {
    const component = await readFile("components/onboarding/DirectHireOnboarding.tsx", "utf8");
    expect(component).not.toContain('"/api/onboarding/direct-hire/preparation"');
    expect(component).toContain('body.data?.state !== "preparation"');
    expect(component).toContain("Accept employment");
  });

  it("completes induction before exposing scheduling and never loads the owner summary", async () => {
    const page = await readFile("app/onboarding/preparation/page.tsx", "utf8");
    expect(page).toContain("inductionState !== 'preparation_pending'");
    expect(page).toContain("DirectHireInduction");
    expect(page).toContain("DirectHireWorkingSessionScheduler");
    expect(page).not.toContain("DirectHirePreparationSummary");
    expect(page).not.toContain("preparation/summary");
  });

  it("derives routing precedence without adding onboarding-state values", async () => {
    const resolver = await readFile("lib/owner/owner-route.ts", "utf8");
    expect(resolver).toContain('state.onboardingState === "employment_accepted"');
    expect(resolver).toContain("DIRECT_HIRE_PREPARATION_PATH");
    expect(resolver).toContain("DIRECT_HIRE_ONBOARDING_PATH");
    const contract = await readFile("lib/onboarding/direct-hire-contract.ts", "utf8");
    expect(contract).not.toContain("working_session_scheduled");
    expect(contract).not.toContain("preparing_for_meeting");
  });

  it("leaves research and registered-source acquisition for a later slice", async () => {
    const induction = await readFile("app/api/onboarding/direct-hire/induction/route.ts", "utf8");
    const completion = induction.slice(induction.indexOf('if (action === "complete")'), induction.indexOf('if (session.induction_state !== "not_started")'));
    expect(completion).not.toContain("ensurePreparationIntelligence");
    expect(completion).not.toContain("acquirePendingRegisteredPublicSources");
    expect(completion).toContain('"preparation_pending"');
  });
});

describe("P2.1 scheduling contract", () => {
  it("validates IANA zones and converts wall-clock input to UTC", () => {
    expect(isValidIanaTimezone("Asia/Bangkok")).toBe(true);
    expect(isValidIanaTimezone("Not/A_Zone")).toBe(false);
    expect(localDateTimeInTimezoneToIso("2026-08-14T09:30", "Asia/Bangkok"))
      .toBe("2026-08-14T02:30:00.000Z");
    expect(localDateTimeInTimezoneToIso("2026-01-15T09:30", "America/New_York"))
      .toBe("2026-01-15T14:30:00.000Z");
    expect(localDateTimeInTimezoneToIso("2026-07-15T09:30", "America/New_York"))
      .toBe("2026-07-15T13:30:00.000Z");
    expect(localDateTimeInTimezoneToIso("2026-01-15T09:30", "Europe/London"))
      .toBe("2026-01-15T09:30:00.000Z");
    expect(localDateTimeInTimezoneToIso("2026-07-15T09:30", "Europe/London"))
      .toBe("2026-07-15T08:30:00.000Z");
    expect(new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date("2026-07-15T08:30:00.000Z"))).toBe("09:30");
    expect(localDateTimeInTimezoneToIso("2026-03-08T02:30", "America/New_York"))
      .toBeNull();
    expect(localDateTimeInTimezoneToIso("2026-11-01T01:30", "America/New_York"))
      .toBeNull();
    expect(localDateTimeInTimezoneToIso("2026-03-29T01:30", "Europe/London"))
      .toBeNull();
    expect(localDateTimeInTimezoneToIso("2026-10-25T01:30", "Europe/London"))
      .toBeNull();
  });

  it("rejects malformed and past absolute timestamps", () => {
    const now = Date.parse("2026-08-13T00:00:00.000Z");
    expect(parseFutureScheduledAt("invalid", now)).toBeNull();
    expect(parseFutureScheduledAt("2026-08-12T23:59:59.000Z", now)).toBeNull();
    expect(parseFutureScheduledAt("2026-08-14T00:00:00+07:00", now))
      .toBe("2026-08-13T17:00:00.000Z");
  });

  it("uses owner authentication and a narrow atomic RPC for create/reschedule/cancel", async () => {
    const route = await readFile("app/api/onboarding/direct-hire/working-session/route.ts", "utf8");
    expect(route).toContain("createAuthenticatedRepresentationContext(request)");
    expect(route).toContain('rpc("zeya_schedule_direct_hire_working_session"');
    expect(route).toContain('rpc("zeya_cancel_direct_hire_working_session")');
    expect(route).toContain('.eq("owner_id", auth.user.id)');
    expect(route).not.toContain("businessId");
    expect(route).not.toContain("ownerId");
  });

  it("persists exact lineage, one active appointment, and nullable Formation linkage", async () => {
    const sql = await readFile(migrationPath, "utf8");
    for (const column of [
      "owner_id", "business_id", "business_representation_id",
      "direct_hire_onboarding_session_id", "formation_session_id",
      "session_kind", "scheduled_at", "scheduling_timezone", "status",
    ]) expect(sql).toContain(column);
    expect(sql).toContain("WHERE status = 'scheduled'");
    expect(sql).toContain("direct_hire_working_sessions_one_active_idx");
    expect(sql).toContain("onboarding.induction_state <> 'preparation_pending'");
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("auth.uid()");
    expect(sql).toContain("auth.role() <> 'authenticated'");
    expect(sql).toContain("pg_catalog.pg_timezone_names");
    expect(sql).toContain("direct_hire_onboarding_sessions(id) ON DELETE CASCADE");
    expect(sql).toContain("representation_formation_sessions(id) ON DELETE SET NULL");
  });

  it("serializes create, reschedule, and cancel on the onboarding row", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const schedule = sql.slice(
      sql.indexOf("CREATE FUNCTION public.zeya_schedule_direct_hire_working_session"),
      sql.indexOf("CREATE FUNCTION public.zeya_cancel_direct_hire_working_session"),
    );
    const cancel = sql.slice(
      sql.indexOf("CREATE FUNCTION public.zeya_cancel_direct_hire_working_session"),
      sql.indexOf("-- Employment acceptance"),
    );
    expect(schedule).toContain("FROM public.direct_hire_onboarding_sessions");
    expect(schedule).toContain("FOR UPDATE");
    expect(cancel).toContain("FROM public.direct_hire_onboarding_sessions");
    expect(cancel).toContain("FOR UPDATE");
    expect(sql).toContain("direct_hire_working_sessions_one_active_idx");
  });

  it("makes POST retry and cancellation retry idempotent on the logical active row", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const schedule = sql.slice(
      sql.indexOf("CREATE FUNCTION public.zeya_schedule_direct_hire_working_session"),
      sql.indexOf("CREATE FUNCTION public.zeya_cancel_direct_hire_working_session"),
    );
    const cancel = sql.slice(
      sql.indexOf("CREATE FUNCTION public.zeya_cancel_direct_hire_working_session"),
      sql.indexOf("-- Employment acceptance"),
    );
    expect(schedule).toContain("IF v_session.id IS NULL THEN");
    expect(schedule).toContain("UPDATE public.direct_hire_working_sessions");
    expect(cancel).toContain("IF v_session.status = 'cancelled' THEN");
    expect(cancel).toContain("IF v_session.status = 'completed' THEN");
    expect(cancel).toContain("completed working session cannot be cancelled");
  });

  it("allows a replacement after cancel but never revives historical rows", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("WHERE working_session.direct_hire_onboarding_session_id = v_onboarding.id\n    AND working_session.status = 'scheduled'");
    expect(sql).toContain("INSERT INTO public.direct_hire_working_sessions");
    expect(sql).not.toContain("SET status = 'scheduled'");
  });

  it("validates future time on scheduling transitions rather than a volatile CHECK", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const table = sql.slice(sql.indexOf("CREATE TABLE"), sql.indexOf("CREATE UNIQUE INDEX"));
    expect(table).not.toContain("scheduled_at > now()");
    expect(table).not.toContain("scheduled_at <= now()");
    expect(sql).toContain("NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at");
    expect(sql).toContain("p_scheduled_at <= now()");
  });

  it("permits owner reads but routes all mutations through authenticated RPCs", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FOR SELECT TO authenticated");
    expect(sql).toContain("USING (owner_id = auth.uid())");
    expect(sql).toContain("REVOKE ALL ON TABLE public.direct_hire_working_sessions FROM PUBLIC, anon, authenticated");
    expect(sql).toContain("GRANT SELECT ON TABLE public.direct_hire_working_sessions TO authenticated");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.zeya_schedule_direct_hire_working_session(timestamptz, text) TO authenticated");
  });

  it("does not create or advance Formation when scheduling", async () => {
    const sql = await readFile(migrationPath, "utf8");
    const scheduler = sql.slice(sql.indexOf("CREATE FUNCTION public.zeya_schedule_direct_hire_working_session"), sql.indexOf("CREATE FUNCTION public.zeya_cancel_direct_hire_working_session"));
    expect(scheduler).not.toContain("INSERT INTO public.representation_formation_sessions");
    expect(scheduler).not.toContain("zeya_initiate_formation_session");
    expect(scheduler).not.toContain("zeya_advance_formation_status");
  });
});

describe("P1 page-count compatibility", () => {
  it("projects valid page counts through ten while attempt counts remain capped at three", async () => {
    const route = await readFile("app/api/onboarding/direct-hire/route.ts", "utf8");
    for (let count = 0; count <= 10; count += 1) {
      expect(projectDirectHireCount(count)).toBe(count);
    }
    for (const invalid of [-1, 11, 1.5, "10", null]) {
      expect(projectDirectHireCount(invalid)).toBe(0);
    }
    expect(projectDirectHireCount(4, 3)).toBe(0);
    expect(route).toContain("projectDirectHireCount(onboarding.preparation_attempt_count, 3)");
    expect(route).toContain("projectDirectHireCount(onboarding.preparation_successful_page_count)");
    expect(route).toContain("projectDirectHireCount(onboarding.preparation_failed_page_count)");
  });
});

describe("P2.1 manual migration verification bundle", () => {
  it("provides read-only catalog-based preflight and postcheck scripts", async () => {
    const [preflight, postcheck] = await Promise.all([
      readFile("supabase/manual/20260813_direct_hire_first_working_sessions_preflight.sql", "utf8"),
      readFile("supabase/manual/20260813_direct_hire_first_working_sessions_postcheck.sql", "utf8"),
    ]);
    for (const sql of [preflight, postcheck]) {
      expect(sql).toContain("pg_catalog");
      expect(sql).toContain("PASS");
      expect(sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE)\s+(TABLE|INTO|public\.)/i);
      expect(sql).not.toContain("has_function_privilege('PUBLIC'");
      expect(sql).toContain("pg_catalog.aclexplode");
      expect(sql).toContain("pg_catalog.acldefault('f'");
    }
    expect(preflight).toContain("preparation_status NOT IN");
    expect(postcheck).toContain("direct_hire_working_sessions_one_active_idx");
    expect(postcheck).toContain("old_gate=false");
  });
});
