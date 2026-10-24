import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { clearCredentialCache, credentialStatus, credentials, decrypt, encrypt, saveCredentials } from "./credentials";

describe("integration credentials", () => {
  afterEach(async () => {
    delete process.env.LA_LOCATION_ID;
    delete process.env.GHL_LOCATION_ID;
    const db = await getDb();
    await db.delete(schema.appSettings).where(eq(schema.appSettings.key, "integration_credentials"));
    clearCredentialCache();
  });

  it("encrypts with AES-GCM and rejects a tampered blob", () => {
    const blob = encrypt({ laApiToken: "pit-secret" });
    expect(blob.data).not.toContain("pit-secret");
    expect(decrypt(blob).laApiToken).toBe("pit-secret");
    expect(() => decrypt({ ...blob, tag: Buffer.alloc(16).toString("base64") })).toThrow();
  });

  it("stores secrets encrypted and never returns them on the dashboard", async () => {
    await saveCredentials({ laApiToken: "pit-abc", laLocationId: "Loc123" }, "staff:amy@example.com");
    const db = await getDb();
    const [row] = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, "integration_credentials"));
    expect(JSON.stringify(row.value)).not.toContain("pit-abc");
    expect(JSON.stringify(row.value)).not.toContain("Loc123");

    const { status } = await credentialStatus();
    expect(status.laApiToken).toMatchObject({ source: "dashboard", value: null, savedBy: "staff:amy@example.com" });
    expect(status.laLocationId).toMatchObject({ source: "dashboard", value: "Loc123" });
    expect((await credentials()).laApiToken).toBe("pit-abc");
  });

  it("keeps a saved secret when the field is left blank, and removes it on null", async () => {
    await saveCredentials({ laApiToken: "pit-abc" }, "staff:a");
    await saveCredentials({ laApiToken: "", laLocationId: "Loc9" }, "staff:a");
    expect((await credentials()).laApiToken).toBe("pit-abc");
    await saveCredentials({ laApiToken: null }, "staff:a");
    expect((await credentials()).laApiToken).toBe("");
    expect((await credentials()).laLocationId).toBe("Loc9");
  });

  it("prefers the dashboard value, then the Vercel variable (LA_ before GHL_)", async () => {
    process.env.GHL_LOCATION_ID = "old";
    clearCredentialCache();
    expect((await credentials()).laLocationId).toBe("old");
    expect((await credentialStatus()).status.laLocationId.source).toBe("vercel");
    process.env.LA_LOCATION_ID = "new";
    expect((await credentials()).laLocationId).toBe("new");
    await saveCredentials({ laLocationId: "dash" }, "staff:a");
    expect((await credentials()).laLocationId).toBe("dash");
  });
});
