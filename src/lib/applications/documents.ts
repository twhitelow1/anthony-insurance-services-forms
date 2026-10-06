import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Application, ApplicationDocument } from "@/lib/db/schema";
import type { FormDefinition } from "@/lib/forms/types";
import { buildApplicationPdf } from "@/lib/pdf/summary";
import { buildCarrierPdf, carrierFormFor } from "@/lib/pdf/carrier";

const { applicationDocuments } = schema;

const appUrl = () => (process.env.APP_URL ?? "").replace(/\/$/, "");

/** One specific stored version. */
export const documentUrl = (doc: Pick<ApplicationDocument, "id">) => `${appUrl()}/documents/${doc.id}`;

/** Always the application's current PDF — the link to store in GHL. */
export const applicationPdfUrl = (app: Pick<Application, "id">) => `${appUrl()}/applications/${app.id}/pdf`;

const fileBase = (app: Application) =>
  `${app.reference} ${app.businessName ?? app.applicantName}`.replace(/[^\w .&-]+/g, "").trim();

export type DocumentKind = "carrier_form" | "application_pdf";

export const DOCUMENT_LABELS: Record<string, string> = {
  carrier_form: "Carrier application (filled)",
  application_pdf: "Application (Anthony Insurance format)",
};

async function saveDocument(app: Application, kind: DocumentKind, filename: string, data: Uint8Array) {
  const bytes = Buffer.from(data);
  const db = await getDb();
  const [doc] = await db
    .insert(applicationDocuments)
    .values({ applicationId: app.id, kind, filename, contentType: "application/pdf", content: bytes, size: bytes.length })
    .returning();
  return doc;
}

/**
 * Generate the application PDF in Anthony Insurance's format (every answer, in
 * the web form's order) and save it. For forms with no carrier PDF, this is the
 * one sent to the carrier.
 */
export async function createApplicationPdf(form: FormDefinition, app: Application): Promise<ApplicationDocument> {
  return saveDocument(app, "application_pdf", `${fileBase(app)} - application.pdf`, await buildApplicationPdf(form, app));
}

/**
 * Fill the carrier's own application from the answers and save it.
 * Returns undefined when this form has no carrier PDF mapped.
 */
export async function createCarrierPdf(app: Application) {
  const spec = carrierFormFor(app.formSlug);
  if (!spec) return undefined;
  const { bytes, unknownFields, addendumCount } = await buildCarrierPdf(spec, app);
  const doc = await saveDocument(app, "carrier_form", `${fileBase(app)} - carrier application.pdf`, bytes);
  return { doc, unknownFields, addendumCount };
}

/** Metadata only (no file bytes), newest first. */
export async function listDocuments(applicationId: string) {
  const db = await getDb();
  return db
    .select({
      id: applicationDocuments.id,
      kind: applicationDocuments.kind,
      filename: applicationDocuments.filename,
      size: applicationDocuments.size,
      createdAt: applicationDocuments.createdAt,
    })
    .from(applicationDocuments)
    .where(eq(applicationDocuments.applicationId, applicationId))
    .orderBy(desc(applicationDocuments.createdAt));
}

export async function getDocument(id: string): Promise<ApplicationDocument | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const db = await getDb();
  const [doc] = await db.select().from(applicationDocuments).where(eq(applicationDocuments.id, id)).limit(1);
  return doc;
}

export async function latestDocument(applicationId: string, kind: DocumentKind = "application_pdf"): Promise<ApplicationDocument | undefined> {
  const db = await getDb();
  const [doc] = await db
    .select()
    .from(applicationDocuments)
    .where(and(eq(applicationDocuments.applicationId, applicationId), eq(applicationDocuments.kind, kind)))
    .orderBy(desc(applicationDocuments.createdAt))
    .limit(1);
  return doc;
}

/** The PDF to share: the filled carrier application if there is one, else the summary. */
export async function mainDocument(applicationId: string) {
  return (await latestDocument(applicationId, "carrier_form")) ?? (await latestDocument(applicationId, "application_pdf"));
}
