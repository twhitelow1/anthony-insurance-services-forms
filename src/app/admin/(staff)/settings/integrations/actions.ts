"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { saveCredentials, type CredentialKey } from "@/lib/integrations/credentials";

// Every action re-checks the staff session: server actions are reachable by direct POST.

const FIELDS: Record<"salesforce" | "lead_alchemist", CredentialKey[]> = {
  salesforce: ["salesforceLoginUrl", "salesforceClientId", "salesforceClientSecret", "salesforceLightningUrl", "salesforceApiVersion"],
  lead_alchemist: ["laApiToken", "laLocationId"],
};

const back = (params: Record<string, string>): never => redirect(`/admin/settings/integrations?${new URLSearchParams(params)}`);

const HTTPS_HOST = /^https:\/\/[a-z0-9.-]+(:\d+)?$/i;

/** Save the keys typed in one card. Blank fields keep what's saved; secrets are never shown back. */
export async function saveIntegrationAction(formData: FormData) {
  const staff = await requireStaff();
  const which = String(formData.get("integration") ?? "") as keyof typeof FIELDS;
  if (!FIELDS[which]) throw new Error("Unknown integration");
  const patch: Partial<Record<CredentialKey, string>> = {};
  for (const key of FIELDS[which]) {
    const v = String(formData.get(key) ?? "").trim();
    if (v) patch[key] = v;
  }
  for (const key of ["salesforceLoginUrl", "salesforceLightningUrl"] as const) {
    if (patch[key]) {
      patch[key] = patch[key]!.replace(/\/+$/, "");
      if (!HTTPS_HOST.test(patch[key]!)) back({ error: `${key === "salesforceLoginUrl" ? "My Domain URL" : "Lightning URL"} must look like https://yourcompany.my.salesforce.com (no path).` });
    }
  }
  if (patch.salesforceApiVersion && !/^v?\d{2,3}\.\d$/.test(patch.salesforceApiVersion)) back({ error: "API version must look like v62.0." });
  if (patch.laApiToken) patch.laApiToken = patch.laApiToken.replace(/^Bearer\s+/i, "");
  if (patch.laLocationId && !/^[A-Za-z0-9]{8,64}$/.test(patch.laLocationId)) back({ error: "The location ID is the letters and numbers after /location/ in the Lead Alchemist address." });
  if (!Object.keys(patch).length) back({ error: "Nothing to save: type the values to change." });
  try {
    await saveCredentials(patch, `staff:${staff.email}`);
  } catch (err) {
    back({ error: err instanceof Error ? err.message : String(err) });
  }
  // Which keys changed (names only, never values).
  console.info(`[integrations] ${staff.email} saved ${which} keys: ${Object.keys(patch).join(", ")}`);
  revalidatePath("/admin/settings/integrations");
  back({ saved: which, test: which });
}

/** Remove the keys saved here for one integration (the Vercel variables, if any, apply again). */
export async function clearIntegrationAction(formData: FormData) {
  const staff = await requireStaff();
  const which = String(formData.get("integration") ?? "") as keyof typeof FIELDS;
  if (!FIELDS[which]) throw new Error("Unknown integration");
  if (formData.get("confirm") !== "yes") back({ error: "Tick the box to confirm removing the saved keys." });
  await saveCredentials(Object.fromEntries(FIELDS[which].map((k) => [k, null])), `staff:${staff.email}`);
  console.info(`[integrations] ${staff.email} removed the saved ${which} keys`);
  revalidatePath("/admin/settings/integrations");
  back({ cleared: which });
}
