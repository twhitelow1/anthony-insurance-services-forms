"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { CLIENT_SEARCH_COOKIE } from "@/lib/clients/search-cookie";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { addClientEvent, getClient, listClientApplications, mergeClients, setPrimaryEmail, splitClientEmail } from "@/lib/clients/repo";
import { getApplication } from "@/lib/applications/repo";
import { syncNow } from "@/lib/salesforce/jobs";
import { defaultSyncDeps } from "@/lib/salesforce/sync";

// Every action re-checks the staff session: server actions are reachable by direct POST.

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const back = (clientId: string, params: Record<string, string>): never =>
  redirect(`/admin/clients/${clientId}?${new URLSearchParams(params).toString()}`);

/**
 * Results go on the application's and client's activity log (shown on return), not in the address:
 * they can name the client, and names, emails and phones never go in URLs.
 */

/** "Sync to Salesforce" on one application (retry). */
export async function syncApplicationAction(formData: FormData) {
  await requireStaff();
  const app = await getApplication(String(formData.get("id") ?? ""));
  if (!app) throw new Error("Application not found");
  const deps = await defaultSyncDeps();
  if ("off" in deps) redirect(`/admin/applications/${app.id}?sf=off`);
  const r = await syncNow(app.id);
  revalidatePath(`/admin/applications/${app.id}`);
  redirect(`/admin/applications/${app.id}?sf=${r.error ? "error" : "done"}`);
}

/** "Sync to Salesforce" on a client: every submitted, non-test application, oldest first. */
export async function syncClientAction(formData: FormData) {
  await requireStaff();
  const client = await getClient(String(formData.get("id") ?? ""));
  if (!client) throw new Error("Client not found");
  const deps = await defaultSyncDeps();
  if ("off" in deps) back(client.id, { sf: "off" });
  const apps = (await listClientApplications(client.id)).filter((a) => !a.isTest).reverse();
  if (!apps.length) back(client.id, { sf: "none" });
  let failed = 0;
  for (const a of apps) if ((await syncNow(a.id)).error) failed++;
  revalidatePath(`/admin/clients/${client.id}`);
  back(client.id, { sf: failed ? "error" : "done" });
}

export async function mergeClientAction(formData: FormData) {
  const staff = await requireStaff();
  const targetId = String(formData.get("id") ?? "");
  // Staff paste the other client's page link or ID.
  const sourceId = String(formData.get("other") ?? "").match(UUID_RE)?.[0] ?? "";
  if (!sourceId) back(targetId, { error: "Paste the other client's page link (or its ID) to merge it in." });
  try {
    await mergeClients(targetId, sourceId, `staff:${staff.email}`);
  } catch (err) {
    back(targetId, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath("/admin/clients");
  back(targetId, { saved: "merged" });
}

export async function splitEmailAction(formData: FormData) {
  const staff = await requireStaff();
  const clientId = String(formData.get("id") ?? "");
  let newId = "";
  try {
    newId = await splitClientEmail(clientId, String(formData.get("email") ?? ""), `staff:${staff.email}`);
  } catch (err) {
    back(clientId, { error: err instanceof Error ? err.message : String(err) });
  }
  revalidatePath("/admin/clients");
  back(newId, { saved: "split" });
}

export async function setPrimaryEmailAction(formData: FormData) {
  await requireStaff();
  const clientId = String(formData.get("id") ?? "");
  try {
    await setPrimaryEmail(clientId, String(formData.get("email") ?? ""));
  } catch (err) {
    back(clientId, { error: err instanceof Error ? err.message : String(err) });
  }
  back(clientId, { saved: "primary" });
}

export async function addClientNoteAction(formData: FormData) {
  const staff = await requireStaff();
  const client = await getClient(String(formData.get("id") ?? ""));
  const message = String(formData.get("message") ?? "").trim().slice(0, 4000);
  if (!client || !message) return;
  await addClientEvent(client.id, "staff_note", `staff:${staff.email}`, { message });
  revalidatePath(`/admin/clients/${client.id}`);
}

/**
 * The Clients search box. The query (often an email or phone) is kept in a short-lived,
 * staff-only cookie instead of the address, so it never lands in URLs, history or logs.
 */
export async function searchClientsAction(formData: FormData) {
  await requireStaff();
  const q = formData.get("clear") ? "" : String(formData.get("q") ?? "").trim().slice(0, 100);
  const sort = String(formData.get("sort") ?? "latest").replace(/[^a-z]/g, "");
  const jar = await cookies();
  if (q) jar.set(CLIENT_SEARCH_COOKIE, q, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/admin/clients", maxAge: 3600 });
  else jar.delete({ name: CLIENT_SEARCH_COOKIE, path: "/admin/clients" });
  redirect(`/admin/clients?sort=${sort}`);
}
