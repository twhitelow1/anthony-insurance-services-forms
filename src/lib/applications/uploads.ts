import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Application } from "@/lib/db/schema";
import { type FormDefinition, type FormValues, isInputField, parseUploadRef } from "@/lib/forms/types";
import { LIBRARY_TYPES } from "@/lib/library";

/**
 * Applicant uploads (e.g. waivers). A file is stored when it's picked; the form keeps
 * "<id>|<file name>". On submit the files become the application's "applicant_upload"
 * documents, so staff open them next to the PDFs.
 */
const { uploads, applicationDocuments } = schema;

/** Same limit and file types as the document library (Vercel caps a request at 4.5 MB). */
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const UPLOAD_TYPES = LIBRARY_TYPES;

export const uploadRef = (id: string, filename: string) => `${id}|${filename}`;

/** A safe file name and its type from the extension, or an error for the applicant. */
export function checkUpload(name: string, size: number): { filename: string; contentType: string } | { error: string } {
  const filename = name.replace(/[\\/|\r\n"]/g, "_").replace(/^\.+/, "").slice(-120) || "upload";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const contentType = UPLOAD_TYPES[ext];
  if (!contentType) return { error: "Upload a PDF, Word document, or a JPG or PNG photo." };
  if (size <= 0) return { error: "That file is empty." };
  if (size > MAX_UPLOAD_BYTES) return { error: "That file is over 4 MB. Try a smaller file or a PDF." };
  return { filename, contentType };
}

export async function saveUpload(input: { formSlug: string; fieldId: string; filename: string; contentType: string; content: Uint8Array }) {
  const db = await getDb();
  const bytes = Buffer.from(input.content);
  const [row] = await db
    .insert(uploads)
    .values({ ...input, content: bytes, size: bytes.length })
    .returning({ id: uploads.id, filename: uploads.filename });
  return row;
}

/** Upload references in the answers to the form's file questions. */
export function uploadRefs(form: FormDefinition, values: FormValues) {
  return form.sections
    .flatMap((s) => s.fields)
    .filter((f) => isInputField(f) && f.type === "file")
    .flatMap((f) => {
      const v = values[f.id];
      return (Array.isArray(v) ? v : []).flatMap((ref) => {
        const parsed = parseUploadRef(ref);
        return parsed ? [{ ...parsed, fieldId: f.id }] : [];
      });
    });
}

/**
 * Attach the application's uploaded files as its documents and remove them from the
 * holding table. Only files uploaded for this form and question are taken.
 */
export async function attachUploads(form: FormDefinition, app: Application): Promise<number> {
  const refs = uploadRefs(form, app.values);
  if (!refs.length) return 0;
  const db = await getDb();
  const rows = await db
    .select()
    .from(uploads)
    .where(and(inArray(uploads.id, refs.map((r) => r.id)), eq(uploads.formSlug, form.slug)));
  const wanted = rows.filter((r) => refs.some((ref) => ref.id === r.id && ref.fieldId === r.fieldId));
  if (!wanted.length) return 0;
  await db.insert(applicationDocuments).values(
    wanted.map((r) => ({
      applicationId: app.id,
      kind: "applicant_upload",
      filename: r.filename,
      contentType: r.contentType,
      content: r.content,
      size: r.size,
    })),
  );
  await db.delete(uploads).where(inArray(uploads.id, wanted.map((r) => r.id)));
  return wanted.length;
}
