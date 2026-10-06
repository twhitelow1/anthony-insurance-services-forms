import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { answerSections } from "@/lib/forms/flatten";
import type { FormDefinition } from "@/lib/forms/types";
import type { Application } from "@/lib/db/schema";
import { embedSignature } from "@/lib/pdf/signature";

/**
 * A clean, printable PDF of a submitted application (every answer + signature).
 * Used as the carrier attachment until the carrier's own fillable form is mapped.
 */

const PAGE = { w: 612, h: 792 }; // US Letter
const M = 50; // margin
const BRAND = rgb(0.075, 0.161, 0.294);
const MUTED = rgb(0.34, 0.39, 0.48);
const RULE = rgb(0.86, 0.88, 0.92);

type Fonts = { regular: PDFFont; bold: PDFFont };

/** Standard PDF fonts only cover WinAnsi; swap anything else for a close ASCII stand-in. */
export function safeText(font: PDFFont, text: string): string {
  const supported = new Set(font.getCharacterSet());
  return [...text.replace(/\r/g, "")]
    .map((ch) => {
      if (ch === "\n" || supported.has(ch.codePointAt(0)!)) return ch;
      const map: Record<string, string> = { "≤": "<=", "≥": ">=", "→": "->", "✓": "x", "×": "x" };
      return map[ch] ?? "?";
    })
    .join("");
}

export function wrap(font: PDFFont, text: string, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const para of safeText(font, text).split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= width) {
        line = candidate;
        continue;
      }
      if (line) lines.push(line);
      // Break words longer than a full line (URLs, long numbers).
      let rest = word;
      while (font.widthOfTextAtSize(rest, size) > width) {
        let i = rest.length;
        while (i > 1 && font.widthOfTextAtSize(rest.slice(0, i), size) > width) i--;
        lines.push(rest.slice(0, i));
        rest = rest.slice(i);
      }
      line = rest;
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  page!: PDFPage;
  y = 0;
  constructor(
    private doc: PDFDocument,
    private fonts: Fonts,
    private header: string,
  ) {
    this.newPage();
  }
  newPage() {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.y = PAGE.h - M;
    this.page.drawText(safeText(this.fonts.regular, this.header), { x: M, y: PAGE.h - 30, size: 8, font: this.fonts.regular, color: MUTED });
  }
  ensure(height: number) {
    if (this.y - height < M + 20) this.newPage();
  }
  text(str: string, opts: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; x?: number; width?: number; gap?: number } = {}) {
    const size = opts.size ?? 10;
    const font = opts.bold ? this.fonts.bold : this.fonts.regular;
    const lines = wrap(font, str, size, opts.width ?? PAGE.w - 2 * M);
    for (const l of lines) {
      this.ensure(size + 3);
      this.y -= size + 3;
      this.page.drawText(l, { x: opts.x ?? M, y: this.y, size, font, color: opts.color ?? rgb(0.06, 0.11, 0.18) });
    }
    this.y -= opts.gap ?? 0;
  }
  /** Label/value row in two columns; wraps both and keeps them together. */
  row(label: string, value: string, group?: string) {
    const size = 9.5;
    const labelW = 230;
    const valueX = M + labelW + 14;
    const valueW = PAGE.w - M - valueX;
    const labelLines = wrap(this.fonts.regular, group ? `${group} — ${label}` : label, size, labelW);
    const valueLines = wrap(this.fonts.bold, value, size, valueW);
    const h = Math.max(labelLines.length, valueLines.length) * (size + 3) + 6;
    this.ensure(h);
    const top = this.y;
    labelLines.forEach((l, i) => this.page.drawText(l, { x: M, y: top - (i + 1) * (size + 3), size, font: this.fonts.regular, color: MUTED }));
    valueLines.forEach((l, i) => this.page.drawText(l, { x: valueX, y: top - (i + 1) * (size + 3), size, font: this.fonts.bold }));
    this.y = top - h;
    this.page.drawLine({ start: { x: M, y: this.y + 3 }, end: { x: PAGE.w - M, y: this.y + 3 }, thickness: 0.5, color: RULE });
  }
}

export async function buildApplicationPdf(form: FormDefinition, app: Application): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${form.title} — ${app.businessName ?? app.applicantName} (${app.reference})`);
  doc.setAuthor("Anthony Insurance Services");
  doc.setSubject(form.title);
  doc.setCreationDate(new Date(app.createdAt));
  const fonts = { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
  const w = new Writer(doc, fonts, `Anthony Insurance Services · ${app.reference} · CONFIDENTIAL`);

  w.text("ANTHONY INSURANCE SERVICES", { size: 9, bold: true, color: rgb(0.094, 0.349, 0.769) });
  w.text(form.title, { size: 18, bold: true, color: BRAND, gap: 4 });
  w.text(
    `Reference ${app.reference} · Submitted ${new Date(app.createdAt).toUTCString()} · ${app.applicantName} <${app.applicantEmail}>`,
    { size: 9, color: MUTED, gap: 10 },
  );

  for (const section of answerSections(form, app.values)) {
    w.ensure(40);
    w.y -= 8;
    w.page.drawRectangle({ x: M, y: w.y - 18, width: PAGE.w - 2 * M, height: 18, color: rgb(0.91, 0.94, 0.996) });
    w.page.drawText(safeText(fonts.bold, section.title.toUpperCase()), { x: M + 6, y: w.y - 13, size: 9.5, font: fonts.bold, color: BRAND });
    w.y -= 22;
    for (const r of section.rows) w.row(r.label, r.value, r.group);
  }

  // Signature block
  w.ensure(150);
  w.y -= 14;
  w.text("Representations & signature", { size: 11, bold: true, color: BRAND, gap: 2 });
  w.text(
    "The applicant declared that the statements in this application are true, complete and accurate, and acknowledged that signing does not bind coverage.",
    { size: 9, color: MUTED, gap: 6 },
  );
  const png = await embedSignature(doc, app.signature);
  if (png) {
    const scale = Math.min(220 / png.width, 70 / png.height);
    w.ensure(png.height * scale + 30);
    w.y -= png.height * scale;
    w.page.drawImage(png, { x: M, y: w.y, width: png.width * scale, height: png.height * scale });
  }
  w.page.drawLine({ start: { x: M, y: w.y - 2 }, end: { x: M + 240, y: w.y - 2 }, thickness: 0.8, color: MUTED });
  w.y -= 4;
  w.text(
    `Signed electronically by ${app.applicantName} on ${new Date(app.createdAt).toUTCString()} from IP ${app.submittedIp ?? "unknown"}.`,
    { size: 8.5, color: MUTED },
  );

  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Page ${i + 1} of ${pages.length}`, { x: PAGE.w - M - 60, y: 25, size: 8, font: fonts.regular, color: MUTED }),
  );
  return doc.save();
}
