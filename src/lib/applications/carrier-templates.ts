import "server-only";
import { eq } from "drizzle-orm";
import { getForm } from "@/forms";
import { getDb, schema } from "@/lib/db";
import type { Application } from "@/lib/db/schema";
import { buildCarrierPdf, carrierFormFor } from "@/lib/pdf/carrier";
import { buildUploadedCarrierPdf, readPdfFields, suggestMapping } from "@/lib/pdf/carrier/uploaded";

/** Uploaded carrier PDFs, one per web form (Forms → Carrier PDF). Nothing here touches Salesforce or Lead Alchemist. */

export const MAX_CARRIER_PDF_BYTES = 4 * 1024 * 1024;

export async function getCarrierTemplate(formSlug: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.carrierTemplates).where(eq(schema.carrierTemplates.formSlug, formSlug)).limit(1);
  return row;
}

/** Which forms have an uploaded carrier PDF (no file bytes). */
export async function listCarrierTemplates() {
  const db = await getDb();
  return db
    .select({ formSlug: schema.carrierTemplates.formSlug, name: schema.carrierTemplates.name, mapping: schema.carrierTemplates.mapping, updatedAt: schema.carrierTemplates.updatedAt })
    .from(schema.carrierTemplates);
}

/**
 * Upload (or replace) a form's carrier PDF. Its boxes are read now; on a first upload the mapping
 * starts from suggestions, and on a replacement the boxes that kept their names keep their mapping.
 */
export async function saveCarrierTemplate(formSlug: string, file: { name: string; filename: string; content: Buffer }, actor: string) {
  const form = getForm(formSlug);
  if (!form) throw new Error("Unknown form.");
  if (file.content.length > MAX_CARRIER_PDF_BYTES) throw new Error("That PDF is over 4 MB. Upload a smaller version.");
  const fields = await readPdfFields(file.content);
  if (!fields.length) {
    throw new Error(
      "That PDF has no fillable boxes, so AIS Connect can't fill it in. Ask the carrier for the fillable version, or make it fillable in Adobe Acrobat (Prepare Form) and upload that.",
    );
  }
  const existing = await getCarrierTemplate(formSlug);
  const names = new Set(fields.map((f) => f.name));
  const kept = existing ? Object.fromEntries(Object.entries(existing.mapping).filter(([k]) => names.has(k))) : {};
  const mapping = { ...suggestMapping(form, fields), ...kept };
  const db = await getDb();
  const row = { name: file.name, filename: file.filename, content: file.content, size: file.content.length, fields, mapping, updatedBy: actor, updatedAt: new Date() };
  await db
    .insert(schema.carrierTemplates)
    .values({ formSlug, ...row, uploadedBy: actor })
    .onConflictDoUpdate({ target: schema.carrierTemplates.formSlug, set: { ...row, uploadedBy: actor } });
  return { fields: fields.length, suggested: Object.keys(mapping).length };
}

export async function saveCarrierMapping(formSlug: string, mapping: Record<string, string>, fillBlanks: boolean, name: string | null, actor: string) {
  const tpl = await getCarrierTemplate(formSlug);
  if (!tpl) throw new Error("This form has no carrier PDF yet.");
  const names = new Set(tpl.fields.map((f) => f.name));
  const clean = Object.fromEntries(Object.entries(mapping).filter(([k, v]) => names.has(k) && v));
  const db = await getDb();
  await db
    .update(schema.carrierTemplates)
    .set({ mapping: clean, fillBlanks, ...(name?.trim() ? { name: name.trim() } : {}), updatedBy: actor, updatedAt: new Date() })
    .where(eq(schema.carrierTemplates.formSlug, formSlug));
  return Object.keys(clean).length;
}

/** Stop using the uploaded PDF for this form (applications already made keep their copies). */
export async function removeCarrierTemplate(formSlug: string) {
  const db = await getDb();
  await db.delete(schema.carrierTemplates).where(eq(schema.carrierTemplates.formSlug, formSlug));
}

/**
 * The carrier PDF for an application's form, if it has one: the uploaded PDF when there is one,
 * else a built-in carrier form. `build` fills it from the application.
 */
export async function carrierPdfFor(app: Pick<Application, "formSlug">) {
  const tpl = await getCarrierTemplate(app.formSlug);
  const form = getForm(app.formSlug);
  if (tpl && form) {
    return { name: tpl.name, build: (a: Application) => buildUploadedCarrierPdf({ name: tpl.name, content: tpl.content, mapping: tpl.mapping, fillBlanks: tpl.fillBlanks }, form, a) };
  }
  const spec = carrierFormFor(app.formSlug);
  if (spec) return { name: spec.name, build: (a: Application) => buildCarrierPdf(spec, a) };
  return undefined;
}
