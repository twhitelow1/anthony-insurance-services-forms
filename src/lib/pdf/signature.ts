import type { PDFDocument } from "pdf-lib";

/** The drawn signature, or null if missing or unreadable — a bad image must not stop the PDF. */
export async function embedSignature(doc: PDFDocument, signature: string | null) {
  const type = signature?.match(/^data:image\/(png|jpeg);base64,/)?.[1];
  if (!type) return null;
  try {
    const bytes = Buffer.from(signature!.split(",")[1], "base64");
    // Signatures drawn here are PNGs; ones brought over from Lead Alchemist may be JPEGs.
    return type === "png" ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch (err) {
    console.warn("[pdf] signature image could not be read", err);
    return null;
  }
}
