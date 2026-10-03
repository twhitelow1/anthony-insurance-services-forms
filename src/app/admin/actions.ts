"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { getForm } from "@/forms";
import { requireStaff } from "@/lib/auth/session";
import { addStaffNote, getApplication, setStatus } from "@/lib/applications/repo";
import { onStatusChanged, pushToGhl } from "@/lib/applications/pipeline";
import { isStatus } from "@/lib/applications/status";

// Every action re-checks the staff session: server actions are reachable by direct POST.

export async function updateStatusAction(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const status = formData.get("status");
  const note = String(formData.get("note") ?? "").slice(0, 2000);
  const notifyClient = formData.get("notify") === "on";
  if (!isStatus(status)) throw new Error("Invalid status");

  const result = await setStatus(id, status, `staff:${staff.email}`, note);
  if (!result) throw new Error("Application not found");
  after(() => onStatusChanged(result.app, result.previous, { note, notifyClient }));
  revalidatePath(`/admin/applications/${id}`);
}

export async function addNoteAction(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const message = String(formData.get("message") ?? "").trim().slice(0, 4000);
  if (!message || !(await getApplication(id))) return;
  await addStaffNote(id, `staff:${staff.email}`, message, formData.get("clientVisible") === "on");
  revalidatePath(`/admin/applications/${id}`);
}

export async function resyncGhlAction(formData: FormData) {
  await requireStaff();
  const app = await getApplication(String(formData.get("id") ?? ""));
  const form = app && getForm(app.formSlug);
  if (!app || !form) throw new Error("Application not found");
  await pushToGhl(form, app);
  revalidatePath(`/admin/applications/${app.id}`);
}
