"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getForm } from "@/forms";
import { requireStaff } from "@/lib/auth/session";
import { MAX_CARRIER_PDF_BYTES, removeCarrierTemplate, saveCarrierMapping, saveCarrierTemplate } from "@/lib/applications/carrier-templates";
import { setFlash } from "@/lib/flash";

// Every action re-checks the staff session: server actions are reachable by direct POST.

const slugOf = (formData: FormData) => {
  const slug = String(formData.get("slug") ?? "");
  if (!getForm(slug)) throw new Error("Unknown form");
  return slug;
};

async function finish(slug: string, tone: "ok" | "warn" | "error", text: string): Promise<never> {
  const f = await setFlash({ tone, text });
  revalidatePath(`/admin/forms/${slug}/carrier`);
  revalidatePath("/admin/forms");
  redirect(`/admin/forms/${slug}/carrier?f=${f}`);
}

/** Upload (or replace) the carrier's fillable PDF for this form. */
export async function uploadCarrierPdfAction(formData: FormData) {
  const staff = await requireStaff();
  const slug = slugOf(formData);
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return finish(slug, "error", "Choose the carrier's PDF to upload.");
  if (file.size > MAX_CARRIER_PDF_BYTES) return finish(slug, "error", "That PDF is over 4 MB. Upload a smaller version.");
  if (!/\.pdf$/i.test(file.name)) return finish(slug, "error", "Upload a PDF.");
  const name = String(formData.get("name") ?? "").trim().slice(0, 150) || file.name.replace(/\.pdf$/i, "");
  try {
    const r = await saveCarrierTemplate(
      slug,
      { name, filename: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 150), content: Buffer.from(await file.arrayBuffer()) },
      `staff:${staff.email}`,
    );
    return finish(slug, "ok", `Uploaded. It has ${r.fields} fillable box${r.fields === 1 ? "" : "es"}; ${r.suggested} ${r.suggested === 1 ? "is" : "are"} matched already. Match the rest below and Save.`);
  } catch (err) {
    return finish(slug, "error", err instanceof Error ? err.message : String(err));
  }
}

/** Save which question fills each box. */
export async function saveCarrierMappingAction(formData: FormData) {
  const staff = await requireStaff();
  const slug = slugOf(formData);
  const mapping: Record<string, string> = {};
  for (const [k, v] of formData.entries()) {
    if (k.startsWith("map:") && typeof v === "string" && v) mapping[k.slice(4)] = v.slice(0, 300);
  }
  try {
    const n = await saveCarrierMapping(slug, mapping, formData.get("fillBlanks") === "yes", String(formData.get("name") ?? "").slice(0, 150), `staff:${staff.email}`);
    return finish(slug, "ok", `Saved: ${n} box${n === 1 ? "" : "es"} filled from the application. New applications use it straight away; for one already in, open it and click Create PDFs again.`);
  } catch (err) {
    return finish(slug, "error", err instanceof Error ? err.message : String(err));
  }
}

/** Stop using the uploaded PDF for this form. PDFs already made stay on their applications. */
export async function removeCarrierPdfAction(formData: FormData) {
  await requireStaff();
  const slug = slugOf(formData);
  if (formData.get("confirm") !== "yes") return finish(slug, "warn", "Tick the box next to Remove to confirm first.");
  await removeCarrierTemplate(slug);
  return finish(slug, "ok", "Removed. New applications on this form get only the AIS Connect application PDF. PDFs already made stay as they are.");
}
