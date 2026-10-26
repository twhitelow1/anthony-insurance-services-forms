"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { clearSelectionRun, type SelectionScope } from "@/lib/bulk/selection-run";

const SCOPES: SelectionScope[] = ["contacts", "mapping", "accounts", "la_import"];

/** Clear a finished bulk run's progress bar from its list (the run itself is already done). */
export async function clearRunAction(formData: FormData) {
  await requireStaff();
  const scope = String(formData.get("scope") ?? "") as SelectionScope;
  const back = String(formData.get("back") ?? "/admin");
  if (SCOPES.includes(scope)) await clearSelectionRun(scope);
  const to = back.startsWith("/admin") && !back.includes("//") ? back : "/admin";
  revalidatePath(to.split("?")[0]);
  redirect(to);
}
