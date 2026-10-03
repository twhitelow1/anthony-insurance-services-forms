"use server";

import { redirect } from "next/navigation";
import { consumeMagicLink, requestMagicLink } from "@/lib/auth/magic-link";
import { createSession } from "@/lib/auth/session";

export async function requestLinkAction(formData: FormData) {
  const email = String(formData.get("email") ?? "").slice(0, 320);
  try {
    await requestMagicLink(email);
  } catch (err) {
    console.error("[portal] sign-in link failed", err);
  }
  // Same response whether or not the email is on file.
  redirect("/portal/login?sent=1");
}

export async function verifyLinkAction(formData: FormData) {
  const email = await consumeMagicLink(String(formData.get("token") ?? ""));
  if (!email) redirect("/portal/login?expired=1");
  await createSession({ role: "client", email });
  redirect("/portal");
}
