import { describe, expect, it } from "vitest";
import { invitesPerHour, normalizeEmail, parseInvite } from "../../../supabase/functions/_shared/users";
import { NO_ACCESS_MESSAGE, signInErrorMessage } from "../auth/sign-in-error";
import { normalizeDomain } from "./api";

describe("access rule input", () => {
  it("normalizes domains and refuses what is not one", () => {
    expect(normalizeDomain(" @Sophos.COM ")).toBe("sophos.com");
    expect(normalizeDomain("eu.sophos.com")).toBe("eu.sophos.com");
    expect(normalizeDomain("sophos")).toBeNull();
    expect(normalizeDomain("user@sophos.com")).toBeNull();
    expect(normalizeDomain("-bad.com")).toBeNull();
  });

  it("normalizes emails", () => {
    expect(normalizeEmail("  Ana.Silva@Sophos.com ")).toBe("ana.silva@sophos.com");
    expect(normalizeEmail("no-at-sign")).toBeNull();
    expect(normalizeEmail(42)).toBeNull();
  });
});

describe("manage-users input", () => {
  it("accepts an email, a role and an http(s) origin", () => {
    expect(parseInvite({ email: "A@B.com", role: "operator", redirect_to: "https://inventory.sophizo.com.br/settings?x=1" })).toEqual({
      email: "a@b.com",
      role: "operator",
      redirectTo: "https://inventory.sophizo.com.br/",
    });
    expect(parseInvite({ email: "a@b.com", role: "viewer" }).redirectTo).toBeNull();
  });

  it("refuses bad roles, emails and redirect targets", () => {
    expect(() => parseInvite({ email: "a@b.com", role: "owner" })).toThrow(/Role/);
    expect(() => parseInvite({ email: "nope", role: "viewer" })).toThrow(/email/);
    expect(() => parseInvite({ email: "a@b.com", role: "viewer", redirect_to: "javascript:alert(1)" })).toThrow(/http/);
    expect(() => parseInvite(null)).toThrow(/JSON/);
  });
});

describe("sign-in errors", () => {
  it("explains a refused sign-up", () => {
    expect(signInErrorMessage("Database error saving new user")).toBe(NO_ACCESS_MESSAGE);
    expect(signInErrorMessage("Signups not allowed for otp")).toBe(NO_ACCESS_MESSAGE);
    expect(signInErrorMessage("Email rate limit exceeded")).toBe("Email rate limit exceeded");
  });
});

describe("invitation limit", () => {
  it("reads RL_INVITES_PER_HOUR, 20 when missing or invalid", () => {
    expect(invitesPerHour("5")).toBe(5);
    expect(invitesPerHour(undefined)).toBe(20);
    expect(invitesPerHour("0")).toBe(20);
    expect(invitesPerHour("many")).toBe(20);
  });
});
