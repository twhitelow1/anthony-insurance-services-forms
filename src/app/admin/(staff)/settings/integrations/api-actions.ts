"use server";

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/lib/auth/session";
import { createApiKey, revokeApiKey } from "@/lib/api/keys";

// Every action re-checks the staff session: server actions are reachable by direct POST.

export interface NewKeyState {
  key?: string;
  name?: string;
  error?: string;
}

/** Make an AIS Connect API key. The key comes back once, to show on screen; it's never stored or shown again. */
export async function createApiKeyAction(_prev: NewKeyState, formData: FormData): Promise<NewKeyState> {
  const staff = await requireStaff();
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Name the key first, e.g. Lead Alchemist Ask AI." };
  const { key, record } = await createApiKey(name, `staff:${staff.email}`);
  revalidatePath("/admin/settings/integrations");
  return { key, name: record.name };
}

/** Turn a key off for good (whatever uses it stops working at once). */
export async function revokeApiKeyAction(formData: FormData) {
  const staff = await requireStaff();
  const id = String(formData.get("id") ?? "");
  if (/^[0-9a-f-]{36}$/i.test(id)) await revokeApiKey(id, `staff:${staff.email}`);
  revalidatePath("/admin/settings/integrations");
}
