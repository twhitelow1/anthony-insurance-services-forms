import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFCheckBox, PDFDocument, type PDFForm, PDFTextField, rgb, StandardFonts } from "pdf-lib";
import type { Application } from "@/lib/db/schema";
import { safeText, wrap } from "@/lib/pdf/summary";
import { embedSignature } from "@/lib/pdf/signature";
import { sportsFacilityCarrierForm } from "./sports-facility";
import { Filler, type CarrierFormSpec } from "./types";

export type { CarrierFormSpec } from "./types";

const SPECS: CarrierFormSpec[] = [sportsFacilityCarrierForm];

export const carrierFormFor = (formSlug: string) => SPECS.find((s) => s.formSlugs.includes(formSlug));

const templates = new Map<string, Promise<Buffer>>();
/** Path to a template in carrier-forms/ (kept to that folder so the server bundle only traces it). */
export const templatePath = (file: string) => path.join(process.cwd(), "carrier-forms", path.basename(file));
const loadTemplate = (file: string) => {
  if (!templates.has(file)) templates.set(file, readFile(templatePath(file)));
  return templates.get(file)!;
};

/** Which answers go where. Exposed for tests and for checking a new template version. */
export function mapAnswers(spec: CarrierFormSpec, values: Application["values"]) {
  const fill = new Filler(values);
  spec.map(values, fill);
  return fill;
}

const FIELD_FONT = 8; // the template's own default appearance
const MIN_FONT = 6;

/**
 * Fill the carrier's own fillable PDF from a submission. Fields stay editable so
 * staff can correct anything before sending. Text too long for its box goes on an
 * addendum page at the end, as the form's instructions allow.
 */
export async function buildCarrierPdf(spec: CarrierFormSpec, app: Application) {
  const doc = await PDFDocument.load(await loadTemplate(spec.template));
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const form = doc.getForm();
  const fill = mapAnswers(spec, app.values);
  const addendum = [...fill.addendum];
  const unknownFields: string[] = [];

  for (const [name, { value, label }] of fill.text) {
    const field = form.getFieldMaybe(name);
    if (!(field instanceof PDFTextField)) {
      unknownFields.push(name);
      continue;
    }
    const text = safeText(helv, value).replace(/\s*\n\s*/g, " ");
    const box = field.acroField.getWidgets()[0].getRectangle().width - 4;
    const max = field.getMaxLength() ?? Infinity;
    const fits = (size: number) => helv.widthOfTextAtSize(text, size) <= box && text.length <= max;
    if (fits(FIELD_FONT)) {
      field.setText(text);
    } else if (fits(MIN_FONT)) {
      field.setFontSize(MIN_FONT);
      field.setText(text);
    } else {
      field.setText("See addendum");
      addendum.push({ label, value });
    }
  }

  for (const name of fill.checked) {
    const field = form.getFieldMaybe(name);
    if (field instanceof PDFCheckBox) field.check();
    else unknownFields.push(name);
  }
  if (unknownFields.length) console.warn(`[carrier-pdf] ${spec.template} has no field(s): ${unknownFields.join(", ")}`);

  const defaulted = fillBlanks(form, spec.blanks);

  form.updateFieldAppearances(helv);

  // Signature and date on the signature line.
  const pages = doc.getPages();
  const png = await embedSignature(doc, app.signature);
  if (png) {
    const { x, y, width, height, page } = spec.signature;
    const scale = Math.min(width / png.width, height / png.height);
    pages[page].drawImage(png, { x, y, width: png.width * scale, height: png.height * scale });
  }
  pages[spec.date.page].drawText(signedDate(app.createdAt), { x: spec.date.x, y: spec.date.y, size: 10, font: helv });

  drawAddendum(doc, { helv, bold }, app, addendum);

  doc.setTitle(`${spec.name} — ${app.businessName ?? app.applicantName} (${app.reference})`);
  doc.setAuthor("Anthony Insurance Services");
  return { bytes: await doc.save(), unknownFields, addendumCount: addendum.length, defaulted };
}

/**
 * Skipped questions: tick "No" on every Yes/No pair left empty and write "N/A" in
 * every empty text box, except `keepBlank`. Returns how many of each it filled.
 */
export function fillBlanks(form: PDFForm, { yesNoPair, keepBlank }: CarrierFormSpec["blanks"]) {
  const kept = (name: string) => keepBlank.some((re) => re.test(name));
  let no = 0;
  let na = 0;
  for (const field of form.getFields()) {
    const name = field.getName();
    if (kept(name)) continue;
    const pair = name.match(yesNoPair);
    if (pair && field instanceof PDFCheckBox) {
      const noBox = form.getFieldMaybe(`No_${Number(pair[1]) + 1}`);
      if (noBox instanceof PDFCheckBox && !kept(noBox.getName()) && !field.isChecked() && !noBox.isChecked()) {
        noBox.check();
        no++;
      }
    } else if (field instanceof PDFTextField && !field.getText()?.trim()) {
      field.setText("N/A");
      na++;
    }
  }
  return { no, na };
}

function signedDate(d: Date) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.APP_TIMEZONE ?? "America/Chicago",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }).format(new Date(d));
}

function drawAddendum(
  doc: PDFDocument,
  fonts: { helv: Awaited<ReturnType<PDFDocument["embedFont"]>>; bold: Awaited<ReturnType<PDFDocument["embedFont"]>> },
  app: Application,
  rows: { label: string; value: string }[],
) {
  const W = 612, H = 792, M = 40;
  const ink = rgb(0.1, 0.1, 0.1);
  const muted = rgb(0.4, 0.4, 0.4);
  let page = doc.addPage([W, H]);
  let y = H - M;
  const header = (cont: boolean) => {
    page.drawText(`ADDENDUM${cont ? " (continued)" : ""} — ADDITIONAL INFORMATION`, { x: M, y: y - 12, size: 12, font: fonts.bold, color: ink });
    y -= 30;
    page.drawText(
      safeText(fonts.helv, `Applicant: ${app.businessName ?? app.applicantName} · Anthony Insurance Services reference ${app.reference}`),
      { x: M, y, size: 9, font: fonts.helv, color: muted },
    );
    y -= 22;
  };
  header(false);
  if (!rows.length) rows = [{ label: "Additional information", value: "None." }];
  for (const { label, value } of rows) {
    const lines = wrap(fonts.helv, value, 10, W - 2 * M);
    if (y - 14 - lines.length * 13 < M) {
      page = doc.addPage([W, H]);
      y = H - M;
      header(true);
    }
    page.drawText(safeText(fonts.bold, label), { x: M, y, size: 9.5, font: fonts.bold, color: ink });
    y -= 13;
    for (const line of lines) {
      if (y < M) {
        page = doc.addPage([W, H]);
        y = H - M;
        header(true);
      }
      page.drawText(line, { x: M, y, size: 10, font: fonts.helv, color: ink });
      y -= 13;
    }
    y -= 8;
  }
}
