import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Application, ApplicationDocument } from "@/lib/db/schema";
import type { FormDefinition } from "@/lib/forms/types";
import { buildApplicationPdf } from "@/lib/pdf/summary";

const { applicationDocuments } = schema;

export const documentUrl = (doc: Pick<ApplicationDocument, "id">) =>
  `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/documents/${doc.id}`;

const fileBase = (app: Application) =>
  `${app.reference} ${app.businessName ?? app.applicantName}`.replace(/[^\w .&-]+/g, "").trim();

/** Generate the application PDF from the stored answers and save it. */
export async function createApplicationPdf(form: FormDefinition, app: Application): Promise<ApplicationDocument> {
  const bytes = Buffer.from(await buildApplicationPdf(form, app));
  const db = await getDb();
  const [doc] = await db
    .insert(applicationDocuments)
    .values({
      applicationId: app.id,
      kind: "application_pdf",
      filename: `${fileBase(app)}.pdf`,
      contentType: "application/pdf",
      content: bytes,
      size: bytes.length,
    })
    .returning();
  return doc;
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

export async function latestDocument(applicationId: string, kind = "application_pdf"): Promise<ApplicationDocument | undefined> {
  const db = await getDb();
  const [doc] = await db
    .select()
    .from(applicationDocuments)
    .where(and(eq(applicationDocuments.applicationId, applicationId), eq(applicationDocuments.kind, kind)))
    .orderBy(desc(applicationDocuments.createdAt))
    .limit(1);
  return doc;
}
