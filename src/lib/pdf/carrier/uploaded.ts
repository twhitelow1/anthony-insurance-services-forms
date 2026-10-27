import { PDFCheckBox, PDFDocument, PDFDropdown, PDFRadioGroup, PDFTextField, rgb, StandardFonts, type PDFField } from "pdf-lib";
import type { Application, CarrierPdfField } from "@/lib/db/schema";
import type { FormDefinition, FormValues, InputField } from "@/lib/forms/types";
import { isInputField } from "@/lib/forms/types";
import { embedSignature } from "@/lib/pdf/signature";
import { drawAddendum, setFittedText, signedDate } from "./index";

/**
 * Carrier PDFs uploaded by staff (Forms → Carrier PDF). Any fillable PDF works: its boxes are read
 * on upload, staff match each box to a question of the web form (with suggestions), and every
 * application on that form fills it. A PDF with no fillable boxes can't be filled this way.
 */

/** The special sources a box can take besides a question's answer. */
export const SPECIAL_SOURCES = [
  { value: "signature", label: "Signature (drawn by the applicant)" },
  { value: "date", label: "Date signed" },
  { value: "applicant", label: "Applicant's full name" },
  { value: "business", label: "Business name" },
  { value: "na", label: 'Always "N/A"' },
] as const;

/** Read a PDF's fillable boxes. Throws a message staff can act on when it can't be used. */
export async function readPdfFields(bytes: Uint8Array): Promise<CarrierPdfField[]> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(/encrypt/i.test(msg) ? "That PDF is password-protected or locked. Save an unlocked copy and upload that." : "That file couldn't be read as a PDF.");
  }
  const pageIndex = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]));
  return doc
    .getForm()
    .getFields()
    .map((f) => ({ name: f.getName(), type: typeOf(f), options: optionsOf(f), page: pageOf(f, pageIndex) }));
}

function typeOf(f: PDFField): CarrierPdfField["type"] {
  if (f instanceof PDFTextField) return "text";
  if (f instanceof PDFCheckBox) return "checkbox";
  if (f instanceof PDFRadioGroup) return "radio";
  if (f instanceof PDFDropdown) return "dropdown";
  return "other";
}
const optionsOf = (f: PDFField) => (f instanceof PDFRadioGroup || f instanceof PDFDropdown ? f.getOptions() : undefined);
const pageOf = (f: PDFField, pages: Map<string, number>) => {
  const ref = f.acroField.getWidgets()[0]?.P()?.toString();
  return ref ? (pages.get(ref) ?? 0) : 0;
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");

export const formQuestions = (form: FormDefinition): InputField[] =>
  form.sections.flatMap((s) => s.fields).filter(isInputField).filter((f) => f.type !== "signature" && f.type !== "file");

/**
 * Best guesses for a newly uploaded PDF: a box whose name matches a question's id or label, a
 * checkbox named after one of a question's options, and the signature and date boxes.
 */
export function suggestMapping(form: FormDefinition, fields: CarrierPdfField[]): Record<string, string> {
  const qs = formQuestions(form);
  const byKey = new Map<string, InputField>();
  for (const q of qs) {
    byKey.set(norm(q.id), q);
    if (!byKey.has(norm(q.label))) byKey.set(norm(q.label), q);
  }
  const out: Record<string, string> = {};
  // Longest first, so "mailing city" wins over "city".
  const keys = [...byKey.keys()].filter((k) => k.length >= 5).sort((a, b) => b.length - a.length);
  for (const f of fields) {
    // PDF tools number their boxes ("Email_Address:_2"): drop the number.
    const n = norm(f.name.replace(/[\s:_.-]*\d+$/, ""));
    if (!n) continue;
    // The box's name starting with a question's, else containing one (longest first), else a question's containing the box's.
    const loose =
      f.type !== "text"
        ? undefined
        : (keys.find((k) => n.startsWith(k)) ?? keys.find((k) => n.includes(k)) ?? (n.length >= 5 ? [...keys].reverse().find((k) => k.includes(n)) : undefined));
    if (/signature/.test(n) && f.type !== "checkbox") out[f.name] = "signature";
    else if (/^(date|datesigned|signaturedate|signeddate|todaysdate)$/.test(n)) out[f.name] = "date";
    else if (byKey.has(n)) out[f.name] = `q:${byKey.get(n)!.id}`;
    else if (loose) out[f.name] = `q:${byKey.get(loose)!.id}`;
    else if (f.type === "checkbox") {
      for (const q of qs) {
        if (!("options" in q)) continue;
        const o = q.options.find((opt) => n === norm(`${q.id}${opt.value}`) || n === norm(`${q.label}${opt.label}`));
        if (o) {
          out[f.name] = `q:${q.id}=${o.value}`;
          break;
        }
      }
    }
  }
  return out;
}

const NO = new Set(["", "no", "false", "n/a", "na", "none", "0"]);

/** An answer as text: choices by their label, lists joined. */
function answerText(q: InputField | undefined, v: FormValues[string]): string {
  const one = (x: string) => (q && "options" in q ? (q.options.find((o) => o.value === x)?.label ?? x) : x);
  if (Array.isArray(v)) return v.map(one).join(", ");
  return typeof v === "string" ? one(v.trim()) : "";
}

const picked = (v: FormValues[string], q: InputField | undefined, option: string) => {
  const want = option.toLowerCase();
  const label = q && "options" in q ? q.options.find((o) => o.value === option)?.label.toLowerCase() : undefined;
  const list = Array.isArray(v) ? v : typeof v === "string" ? [v] : [];
  return list.some((x) => x.toLowerCase() === want || (label !== undefined && x.toLowerCase() === label));
};

/** The PDF option matching an answer (by value or label, ignoring case and punctuation). */
const matchOption = (options: string[], q: InputField | undefined, v: FormValues[string]) => {
  const raw = Array.isArray(v) ? v[0] : v;
  if (!raw) return undefined;
  const wants = [norm(raw), norm(answerText(q, raw))];
  return options.find((o) => wants.includes(norm(o)));
};

export interface UploadedTemplate {
  name: string;
  content: Uint8Array;
  mapping: Record<string, string>;
  fillBlanks: boolean;
}

/** Fill an uploaded carrier PDF from an application, as its mapping says. Fields stay editable. */
export async function buildUploadedCarrierPdf(tpl: UploadedTemplate, form: FormDefinition, app: Application) {
  const doc = await PDFDocument.load(tpl.content, { updateMetadata: false });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const pdf = doc.getForm();
  const questions = new Map(formQuestions(form).map((q) => [q.id, q]));
  const addendum: { label: string; value: string }[] = [];
  const unknownFields: string[] = [];
  const pages = doc.getPages();
  const pageIndex = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  const used = new Set<string>();

  for (const [name, source] of Object.entries(tpl.mapping)) {
    if (!source) continue;
    const field = pdf.getFieldMaybe(name);
    if (!field) {
      unknownFields.push(name);
      continue;
    }
    // The signature and date boxes stay as they are when blanks get N/A.
    if (source === "signature" || source === "date") used.add(name);
    if (source === "signature") {
      const png = await embedSignature(doc, app.signature);
      const widget = field.acroField.getWidgets()[0];
      if (png && widget) {
        const r = widget.getRectangle();
        const scale = Math.min(r.width / png.width, r.height / png.height);
        pages[pageOf(field, pageIndex)].drawImage(png, { x: r.x + 2, y: r.y + 1, width: png.width * scale, height: png.height * scale });
      }
      continue;
    }
    const [, id, option] = source.match(/^q:([^=]+)(?:=(.*))?$/) ?? [];
    const q = id ? questions.get(id) : undefined;
    const value = id ? app.values[id] : undefined;
    const text =
      source === "date" ? signedDate(app.createdAt)
      : source === "applicant" ? app.applicantName
      : source === "business" ? (app.businessName ?? "")
      : source === "na" ? "N/A"
      : answerText(q, value);
    const label = q?.label ?? name;
    if (field instanceof PDFTextField) {
      if (text) setFittedText(field, helv, text, label, addendum);
    } else if (field instanceof PDFCheckBox) {
      const on = option !== undefined ? picked(value, q, option) : !NO.has(text.toLowerCase());
      if (on) field.check();
    } else if (field instanceof PDFRadioGroup || field instanceof PDFDropdown) {
      const choice = matchOption(field.getOptions(), q, value);
      if (choice) field.select(choice);
      else if (text) addendum.push({ label, value: text });
    }
  }

  if (tpl.fillBlanks) {
    for (const f of pdf.getFields()) {
      if (f instanceof PDFTextField && !used.has(f.getName()) && !f.getText()?.trim()) f.setText("N/A");
    }
  }
  pdf.updateFieldAppearances(helv);
  if (addendum.length) drawAddendum(doc, { helv, bold }, app, addendum);
  doc.setTitle(`${tpl.name} — ${app.businessName ?? app.applicantName} (${app.reference})`);
  doc.setAuthor("Anthony Insurance Services");
  return { bytes: await doc.save(), unknownFields, addendumCount: addendum.length };
}

/** The PDF with each box's name printed where it sits, so staff can tell "Yes_9" from "No_10" while matching. */
export async function labelledPdf(content: Uint8Array) {
  const doc = await PDFDocument.load(content, { updateMetadata: false });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  const pageIndex = new Map(pages.map((p, i) => [p.ref.toString(), i]));
  const labels: { page: number; x: number; y: number; text: string; small: boolean }[] = [];
  for (const field of doc.getForm().getFields()) {
    for (const w of field.acroField.getWidgets()) {
      const ref = w.P()?.toString();
      const r = w.getRectangle();
      const small = r.height < 14 && r.width < 20; // a tick box: label just above it
      labels.push({ page: (ref && pageIndex.get(ref)) || 0, x: r.x, y: small ? r.y + r.height + 0.5 : r.y + 2, text: field.getName(), small });
    }
  }
  doc.getForm().flatten();
  for (const l of labels) {
    const size = l.small ? 4 : 6;
    const width = font.widthOfTextAtSize(l.text, size);
    pages[l.page].drawRectangle({ x: l.x, y: l.y - 0.5, width: width + 1, height: size + 0.5, color: rgb(1, 1, 0.75) });
    pages[l.page].drawText(l.text, { x: l.x + 0.5, y: l.y, size, font, color: rgb(0.8, 0, 0) });
  }
  return doc.save();
}
