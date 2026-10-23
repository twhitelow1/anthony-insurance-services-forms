import { afterEach, describe, expect, it, vi } from "vitest";
import { aerialInstructorApplication as form } from "@/forms/aerial-instructor-application";
import { createApplication, getApplication } from "@/lib/applications/repo";
import { pushToSalesforce } from "@/lib/applications/pipeline";
import { saveSettings } from "@/lib/settings";
import { jobsFor } from "./jobs";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  await saveSettings({ salesforceEnabled: null }, "test");
});

const connect = () => {
  vi.stubEnv("SALESFORCE_LOGIN_URL", "https://anthony.my.salesforce.com");
  vi.stubEnv("SALESFORCE_CLIENT_ID", "cid");
  vi.stubEnv("SALESFORCE_CLIENT_SECRET", "secret");
};

describe("Salesforce in the submission pipeline", () => {
  it("never throws when Salesforce is down; the application stays queued for a retry", async () => {
    connect();
    await saveSettings({ salesforceEnabled: true }, "test");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connect ECONNREFUSED"));
    const app = await createApplication(form, { email: "down@example.com", first_name: "Down", last_name: "Time" }, {});
    await expect(pushToSalesforce(app)).resolves.toBeUndefined();
    expect((await getApplication(app.id))!.sfSyncStatus).toBe("pending");
    expect((await jobsFor(app.id))[0]).toMatchObject({ status: "pending", attempts: 1 });
  });

  it("never queues test submissions, or anything while the sync is off", async () => {
    connect();
    const fetch = vi.spyOn(globalThis, "fetch");
    await saveSettings({ salesforceEnabled: true }, "test");
    const test = await createApplication(form, { email: "t@example.com", first_name: "T", last_name: "T" }, { isTest: true });
    await pushToSalesforce(test);
    expect(await jobsFor(test.id)).toHaveLength(0);

    await saveSettings({ salesforceEnabled: false }, "test");
    const off = await createApplication(form, { email: "o@example.com", first_name: "O", last_name: "O" }, {});
    await pushToSalesforce(off);
    expect(await jobsFor(off.id)).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });
});
