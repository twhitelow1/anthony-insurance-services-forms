"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import type { NotificationStatus } from "@/lib/db/schema";
import { setFlash } from "@/lib/flash";
import { addNotificationNote, assignNotification, dismissAll, KIND_LABELS, setNotificationStatus } from "@/lib/notifications/repo";
import type { NotificationKind } from "@/lib/db/schema";

// Every action re-checks the staff session: server actions are reachable by direct POST.

const STATUS = new Set<NotificationStatus>(["open", "in_progress", "done", "dismissed"]);
const UUID = /^[0-9a-f-]{36}$/;

const backTo = (formData: FormData) => {
  const b = String(formData.get("back") ?? "");
  return /^\/admin\/(notifications|clients)(\/|\?|$)/.test(b) && !b.includes("//") ? b : "/admin/notifications";
};

async function finish(formData: FormData, tone: "ok" | "error", text: string): Promise<never> {
  const back = backTo(formData);
  const f = await setFlash({ tone, text });
  revalidatePath("/admin/notifications");
  redirect(`${back}${back.includes("?") ? "&" : "?"}f=${f}`);
}

export async function setNotificationStatusAction(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const status = String(formData.get("status") ?? "") as NotificationStatus;
  if (!UUID.test(id) || !STATUS.has(status)) return finish(formData, "error", "Unknown notification or status.");
  try {
    await setNotificationStatus(id, status, `staff:${staff.email}`, String(formData.get("note") ?? ""));
  } catch (err) {
    return finish(formData, "error", err instanceof Error ? err.message : String(err));
  }
  return finish(formData, "ok", "Updated.");
}

export async function addNotificationNoteAction(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (!UUID.test(id) || !note) return finish(formData, "error", "Type a note first.");
  await addNotificationNote(id, `staff:${staff.email}`, note);
  return finish(formData, "ok", "Note added.");
}

export async function assignToMeAction(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (!UUID.test(id)) return finish(formData, "error", "Unknown notification.");
  const mine = formData.get("unassign") ? null : staff.email;
  await assignNotification(id, mine, `staff:${staff.email}`);
  return finish(formData, "ok", mine ? "Assigned to you." : "Unassigned.");
}

/** Dismiss a whole board column (in the kind shown). Nothing is deleted: each card can be reopened. */
export async function dismissAllAction(formData: FormData) {
  const staff = await requireStaff();
  const from = String(formData.get("from") ?? "") as NotificationStatus;
  const kindRaw = String(formData.get("kind") ?? "");
  const kind = kindRaw in KIND_LABELS ? (kindRaw as NotificationKind) : undefined;
  if (!STATUS.has(from) || from === "dismissed") return finish(formData, "error", "Unknown column.");
  const n = await dismissAll(from, `staff:${staff.email}`, kind);
  return finish(formData, "ok", n ? `Dismissed ${n.toLocaleString("en-US")}. Find them under Dismissed if you need one back.` : "Nothing to dismiss.");
}
