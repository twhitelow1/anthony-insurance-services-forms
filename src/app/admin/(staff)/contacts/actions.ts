"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { addSelectedToApp, sendToLeadAlchemist, sendToSalesforce, startImport, stepImport, updateLeadAlchemistForSelected, type DirectorySource } from "@/lib/contacts/directory";
import { setFlash } from "@/lib/flash";
import { links } from "@/lib/integrations/links";
import { salesforceClient } from "@/lib/salesforce/client";
import { CONTACT_SEARCH_COOKIE } from "./search-cookie";

// Every action re-checks the staff session: server actions are reachable by direct POST.
// Nothing here deletes anything in Salesforce or Lead Alchemist.

const backTo = (formData: FormData) => {
  const b = String(formData.get("back") ?? "");
  return b.startsWith("/admin/contacts") && !b.includes("//") ? b : "/admin/contacts";
};

async function finish(to: string, tone: "ok" | "error", text: string): Promise<never> {
  const back = to.replace(/([?&])(f|importing)=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  const f = await setFlash({ tone, text });
  revalidatePath("/admin/contacts");
  redirect(`${back}${back.includes("?") ? "&" : "?"}f=${f}`);
}

const selected = (formData: FormData) => formData.getAll("ids").map(String);

async function bulk(formData: FormData, verb: string, work: (values: string[], actor: string) => Promise<{ done: number; notes: string[] }>): Promise<never> {
  const staff = await requireStaff();
  const values = selected(formData);
  if (!values.length) return finish(backTo(formData), "error", "Tick at least one person first.");
  let r: { done: number; notes: string[] };
  try {
    r = await work(values, `staff:${staff.email}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[contacts] bulk action failed:", message);
    return finish(backTo(formData), "error", message);
  }
  return finish(backTo(formData), "ok", `${verb}: ${r.done} of ${values.length}.${r.notes.length ? ` ${r.notes.slice(0, 6).join(" ")}` : ""}`);
}

export async function searchContactsAction(formData: FormData) {
  await requireStaff();
  const q = formData.get("clear") ? "" : String(formData.get("q") ?? "").trim().slice(0, 100);
  const jar = await cookies();
  if (q) jar.set(CONTACT_SEARCH_COOKIE, q, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/admin/contacts", maxAge: 3600 });
  else jar.delete({ name: CONTACT_SEARCH_COOKIE, path: "/admin/contacts" });
  redirect(backTo(formData).replace(/([?&])page=\d+&?/, "$1").replace(/[?&]$/, ""));
}

export async function addToAppAction(formData: FormData) {
  return bulk(formData, "Added to this app", async (values, actor) => addSelectedToApp(values, actor, { sf: await salesforceClient(), links: await links() }));
}

export async function sendToLeadAlchemistAction(formData: FormData) {
  const createMissing = formData.get("createMissing") === "yes";
  return bulk(formData, "Synced to Lead Alchemist", async (values, actor) =>
    sendToLeadAlchemist(values, actor, { sf: await salesforceClient(), links: await links() }, createMissing),
  );
}

export async function sendToSalesforceAction(formData: FormData) {
  return bulk(formData, "Linked or created in Salesforce", async (values, actor) => {
    const sf = await salesforceClient();
    if (!sf) throw new Error("Salesforce isn't connected. Add the keys in Settings → Integrations.");
    return sendToSalesforce(values, actor, { sf, links: await links() });
  });
}

export async function updateLaDetailsAction(formData: FormData) {
  const replace = formData.get("replace") === "yes";
  return bulk(formData, "Updated in Lead Alchemist", (values, actor) => updateLeadAlchemistForSelected(values, actor, replace));
}

const sourceOf = (formData: FormData): DirectorySource => (formData.get("source") === "lead_alchemist" ? "lead_alchemist" : "salesforce");

/** Refresh the directory from Salesforce or Lead Alchemist: starts (or continues) the import, one batch per call. */
export async function importAction(formData: FormData) {
  const staff = await requireStaff();
  const source = sourceOf(formData);
  if (formData.get("start") === "yes") await startImport(source, `staff:${staff.email}`);
  const run = await stepImport(source, { sf: source === "salesforce" ? await salesforceClient() : null });
  const back = backTo(formData).replace(/([?&])(f|importing)=[^&]*&?/g, "$1").replace(/[?&]$/, "");
  if (run?.phase === "running") {
    revalidatePath("/admin/contacts");
    redirect(`${back}${back.includes("?") ? "&" : "?"}importing=${source}`);
  }
  const label = source === "salesforce" ? "Salesforce" : "Lead Alchemist";
  if (run?.phase === "failed") return finish(back, "error", `Reading ${label} contacts stopped: ${run.error}. Press Refresh to start again.`);
  return finish(back, "ok", `Read ${run?.imported.toLocaleString("en-US") ?? 0} ${label} contacts.`);
}
