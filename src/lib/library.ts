import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { LibraryFile } from "@/lib/db/schema";

/** Document library: files staff upload once and assign to forms. */
const { libraryFiles } = schema;

export const MAX_LIBRARY_BYTES = 4 * 1024 * 1024;
/** What applicants may be sent: documents and images, never scripts or HTML. */
export const LIBRARY_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
};

export type LibraryItem = Omit<LibraryFile, "content">;
const listColumns = {
  id: libraryFiles.id,
  title: libraryFiles.title,
  description: libraryFiles.description,
  filename: libraryFiles.filename,
  contentType: libraryFiles.contentType,
  size: libraryFiles.size,
  formSlugs: libraryFiles.formSlugs,
  updatedBy: libraryFiles.updatedBy,
  createdAt: libraryFiles.createdAt,
  updatedAt: libraryFiles.updatedAt,
};

const appBase = () => (process.env.APP_URL ?? "").replace(/\/$/, "");
/** Public link (sample documents are meant for applicants). */
export const libraryPath = (f: Pick<LibraryFile, "id">) => `/library/${f.id}`;
export const libraryUrl = (f: Pick<LibraryFile, "id">) => `${appBase()}${libraryPath(f)}`;

export async function listLibrary(): Promise<LibraryItem[]> {
  const db = await getDb();
  return db.select(listColumns).from(libraryFiles).orderBy(desc(libraryFiles.createdAt));
}

/** Documents assigned to a form, oldest first (the order staff added them). */
export async function libraryForForm(slug: string): Promise<LibraryItem[]> {
  const db = await getDb();
  return db
    .select(listColumns)
    .from(libraryFiles)
    .where(sql`${libraryFiles.formSlugs} @> ${JSON.stringify([slug])}::jsonb`)
    .orderBy(libraryFiles.createdAt);
}

export async function getLibraryFile(id: string): Promise<LibraryFile | undefined> {
  if (!/^[0-9a-f-]{36}$/.test(id)) return undefined;
  const db = await getDb();
  const [row] = await db.select().from(libraryFiles).where(eq(libraryFiles.id, id)).limit(1);
  return row;
}

export async function addLibraryFile(input: {
  title: string;
  description?: string | null;
  filename: string;
  contentType: string;
  content: Buffer;
  formSlugs: string[];
  updatedBy: string;
}): Promise<LibraryItem> {
  const db = await getDb();
  const [row] = await db
    .insert(libraryFiles)
    .values({ ...input, size: input.content.length })
    .returning(listColumns);
  return row;
}

export async function updateLibraryFile(
  id: string,
  patch: { title?: string; description?: string | null; formSlugs?: string[]; updatedBy: string },
) {
  const db = await getDb();
  await db.update(libraryFiles).set({ ...patch, updatedAt: new Date() }).where(eq(libraryFiles.id, id));
}

export async function deleteLibraryFile(id: string) {
  const db = await getDb();
  await db.delete(libraryFiles).where(eq(libraryFiles.id, id));
}
