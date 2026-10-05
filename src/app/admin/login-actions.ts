"use server";

import { redirect } from "next/navigation";
import { consumeMagicLink, requestStaffLink } from "@/lib/auth/magic-link";
import { createSession, safeReturnTo } from "@/lib/auth/session";

export async function requestStaffLinkAction(formData: FormData) {
  try {
    await requestStaffLink(String(formData.get("email") ?? "").slice(0, 320), String(formData.get("returnTo") ?? "") || undefined);
  } catch (err) {
    console.error("[admin] sign-in link failed", err);
  }
  // Same response whether or not the address is a staff address.
  redirect("/admin/login?sent=1");
}

export async function verifyStaffLinkAction(formData: FormData) {
  const email = await consumeMagicLink(String(formData.get("token") ?? ""), "staff");
  if (!email) redirect("/admin/login?expired=1");
  const local = email.split("@")[0].replace(/[._-]+/g, " ");
  const name = local.replace(/\b\w/g, (c) => c.toUpperCase());
  await createSession({ role: "staff", email, name });
  redirect(safeReturnTo(String(formData.get("returnTo") ?? ""), "/admin"));
}
