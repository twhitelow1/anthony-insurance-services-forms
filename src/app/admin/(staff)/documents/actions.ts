"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { forms } from "@/forms";
import { requireStaff } from "@/lib/auth/session";
import { LIBRARY_TYPES, MAX_LIBRARY_BYTES, addLibraryFile, deleteLibraryFile, getLibraryFile, updateLibraryFile } from "@/lib/library";

const back = (q: string) => redirect(`/admin/documents?${q}`);
const fail = (message: string): never => back(`error=${encodeURIComponent(message)}`);
const text = (fd: FormData, name: string, max = 300) => String(fd.get(name) ?? "").trim().slice(0, max);
/** Only real form slugs. */
const slugs = (fd: FormData) => fd.getAll("forms").map(String).filter((s) => s in forms);

export async function uploadLibraryFileAction(formData: FormData) {
  const staff = await requireStaff("/admin/documents");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) fail("Choose a file to upload.");
  const f = file as File;
  if (f.size > MAX_LIBRARY_BYTES) fail("That file is over 4 MB. Compress it or upload a smaller version.");
  const ext = f.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = LIBRARY_TYPES[ext];
  if (!contentType) fail("Upload a PDF, Word document (.doc/.docx), PNG or JPG.");
  const title = text(formData, "title") || f.name.replace(/\.[^.]+$/, "");
  await addLibraryFile({
    title,
    description: text(formData, "description", 1000) || null,
    filename: f.name.replace(/[^\w.\- ()]/g, "_").slice(0, 150),
    contentType,
    content: Buffer.from(await f.arrayBuffer()),
    formSlugs: slugs(formData),
    updatedBy: `staff:${staff.email}`,
  });
  revalidatePath("/admin/documents");
  back(`saved=${encodeURIComponent(`Uploaded "${title}".`)}`);
}

export async function updateLibraryFileAction(formData: FormData) {
  const staff = await requireStaff("/admin/documents");
  const id = text(formData, "id");
  if (!(await getLibraryFile(id))) fail("That document no longer exists.");
  const title = text(formData, "title");
  if (!title) fail("A document needs a title.");
  await updateLibraryFile(id, {
    title,
    description: text(formData, "description", 1000) || null,
    formSlugs: slugs(formData),
    updatedBy: `staff:${staff.email}`,
  });
  revalidatePath("/admin/documents");
  back(`saved=${encodeURIComponent(`Saved "${title}".`)}`);
}

export async function deleteLibraryFileAction(formData: FormData) {
  await requireStaff("/admin/documents");
  const id = text(formData, "id");
  const file = await getLibraryFile(id);
  if (file) await deleteLibraryFile(id);
  revalidatePath("/admin/documents");
  back(`saved=${encodeURIComponent(file ? `Deleted "${file.title}".` : "Already deleted.")}`);
}
