"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";

export const CHANGE_SEARCH_COOKIE = "change_search";

/** The search is kept in a cookie, never the address (it may be an email or phone). */
export async function searchChangesAction(formData: FormData) {
  await requireStaff();
  const q = formData.get("clear") ? "" : String(formData.get("q") ?? "").trim().slice(0, 100);
  const system = String(formData.get("system") ?? "").replace(/[^a-z_]/g, "");
  const jar = await cookies();
  if (q) jar.set(CHANGE_SEARCH_COOKIE, q, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/admin/changes", maxAge: 3600 });
  else jar.delete({ name: CHANGE_SEARCH_COOKIE, path: "/admin/changes" });
  redirect(system ? `/admin/changes?system=${system}` : "/admin/changes");
}
