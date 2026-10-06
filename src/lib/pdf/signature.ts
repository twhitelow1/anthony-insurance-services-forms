import type { PDFDocument } from "pdf-lib";

/** The drawn signature, or null if missing or unreadable — a bad image must not stop the PDF. */
export async function embedSignature(doc: PDFDocument, signature: string | null) {
  if (!signature?.startsWith("data:image/png;base64,")) return null;
  try {
    return await doc.embedPng(Buffer.from(signature.split(",")[1], "base64"));
  } catch (err) {
    console.warn("[pdf] signature image could not be read", err);
    return null;
  }
}
