import { afterEach, describe, expect, it, vi } from "vitest";
import { isStaffEmail } from "@/lib/auth/staff";
import { staffNotifyList } from "@/lib/applications/pipeline";
import { pipelineConfig } from "@/lib/ghl/sync";
import { getSettings, saveSettings } from "./settings";

afterEach(async () => {
  vi.unstubAllEnvs();
  // Clear everything saved so other tests see only environment values.
  await saveSettings(
    {
      staffEmails: null,
      staffEmailDomains: null,
      notifyEmails: null,
      mailFrom: null,
      mailReplyTo: null,
      carrierEmails: null,
      ghlPipeline: null,
      ghlPipelineStage: null,
      ghlLeadPipeline: null,
      ghlLeadStage: null,
      ghlStageMap: null,
    },
    "test",
  );
});

describe("settings", () => {
  it("falls back to Vercel environment variables, and saved values win", async () => {
    vi.stubEnv("NOTIFY_EMAILS", "env@example.com");
    vi.stubEnv("MAIL_FROM", "Env <env@example.com>");
    expect(await staffNotifyList()).toEqual(["env@example.com"]);
    expect((await getSettings()).mailFrom).toBe("Env <env@example.com>");

    await saveSettings({ notifyEmails: ["melanie@anthonyinsuranceservices.com"], mailFrom: "AIS <apps@anthonyinsuranceservices.com>" }, "staff:test");
    expect(await staffNotifyList()).toEqual(["melanie@anthonyinsuranceservices.com"]);
    expect((await getSettings()).mailFrom).toBe("AIS <apps@anthonyinsuranceservices.com>");

    await saveSettings({ notifyEmails: null }, "staff:test");
    expect(await staffNotifyList()).toEqual(["env@example.com"]);
  });

  it("uses a default sender when nothing is set", async () => {
    vi.stubEnv("MAIL_FROM", "");
    expect((await getSettings()).mailFrom).toBe("Anthony Insurance Services <applications@anthonyinsuranceservices.com>");
  });

  it("adds admins saved here to STAFF_EMAILS instead of replacing it", async () => {
    vi.stubEnv("STAFF_EMAILS", "owner@example.com");
    await saveSettings({ staffEmails: ["melanie@anthonyinsuranceservices.com"] }, "staff:test");
    expect(await isStaffEmail("owner@example.com")).toBe(true);
    expect(await isStaffEmail("Melanie@AnthonyInsuranceServices.com")).toBe(true);
    // An explicit list turns off "anyone at the domain".
    expect(await isStaffEmail("amy@anthonyinsuranceservices.com")).toBe(false);
  });

  it("drives the GHL pipeline from saved settings", async () => {
    expect(await pipelineConfig()).toBeNull();
    await saveSettings(
      { ghlPipeline: "pipe1", ghlPipelineStage: "stage-new", ghlLeadPipeline: "Leads", ghlStageMap: { quoted: "stage-q" } },
      "staff:test",
    );
    expect(await pipelineConfig()).toEqual({
      pipelineId: "pipe1",
      initialStage: "stage-new",
      stages: { quoted: "stage-q" },
      leadPipeline: "Leads",
      leadStage: null,
    });
  });
});
