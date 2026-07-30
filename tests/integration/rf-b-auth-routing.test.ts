import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_AUTHENTICATED_PATH,
  safeInternalPath,
} from "../../lib/auth/safe-next-path";

describe("RF-B authentication routing", () => {
  it("defaults successful password authentication to Formation entry", async () => {
    const modal = await readFile("components/auth/auth-modal.tsx", "utf8");
    const provider = await readFile("components/auth/auth-provider.tsx", "utf8");

    expect(modal).toContain("supabase.auth.signInWithPassword");
    expect(modal).toContain("if (signInError) throw signInError");
    expect(modal).toContain("onAuthenticated?.(data.session)");
    expect(provider).toContain("router.replace(safeInternalPath(requestedPath))");
    expect(DEFAULT_AUTHENTICATED_PATH).toBe("/formation/entry");
  });

  it("does not navigate after failed password authentication", async () => {
    const modal = await readFile("components/auth/auth-modal.tsx", "utf8");
    const signInError = modal.indexOf("if (signInError) throw signInError");
    const authenticated = modal.indexOf("onAuthenticated?.(data.session)");

    expect(signInError).toBeGreaterThan(-1);
    expect(authenticated).toBeGreaterThan(signInError);
    expect(modal).toContain("setError(friendlyAuthError(message))");
    expect(modal).not.toContain("router.push(");
    expect(modal).not.toContain("router.replace(");
  });

  it("honours safe internal next paths", () => {
    expect(safeInternalPath("/representation/living")).toBe(
      "/representation/living",
    );
    expect(safeInternalPath("/formation/entry?resume=1#owner")).toBe(
      "/formation/entry?resume=1#owner",
    );
  });

  it("rejects external and malformed next paths", () => {
    for (const value of [
      "https://evil.example/path",
      "//evil.example/path",
      "/\\evil.example/path",
      "/%5cevil.example/path",
      "/%2f%2fevil.example/path",
      "formation/entry",
      "\u0000/formation/entry",
      "%",
      null,
    ]) {
      expect(safeInternalPath(value)).toBe("/formation/entry");
    }
  });

  it("keeps the session available before client navigation", async () => {
    const provider = await readFile("components/auth/auth-provider.tsx", "utf8");
    const callbackStart = provider.indexOf("onAuthenticated={(nextSession)");
    const callback = provider.slice(callbackStart, callbackStart + 500);

    expect(callback.indexOf("setSession(nextSession)")).toBeGreaterThan(-1);
    expect(callback.indexOf("router.replace(")).toBeGreaterThan(
      callback.indexOf("setSession(nextSession)"),
    );
  });

  it("allows Formation entry without middleware rewriting it", async () => {
    const entry = await readFile("app/formation/entry/page.tsx", "utf8");

    expect(entry).toContain("if (!loading && !user)");
    expect(entry).toContain("router.replace('/login')");
    expect(entry).not.toContain("router.replace('/')");
  });

  it("derives reset callback origin from the active browser", async () => {
    const modal = await readFile("components/auth/auth-modal.tsx", "utf8");

    expect(modal).toContain(
      "`${window.location.origin}/auth/reset-password`",
    );
    expect(modal).not.toMatch(/https:\/\/[A-Za-z0-9.-]+\/auth\/reset-password/);
  });
});
