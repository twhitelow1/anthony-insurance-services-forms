import { PDFDocument, type PDFFont, type PDFPage, rgb, StandardFonts } from "pdf-lib";
import { clampRows } from "@/lib/forms/validate";
import { isVisible } from "@/lib/forms/validate";
import {
  type ChoiceField,
  type Field,
  type FormDefinition,
  type FormValues,
  isInputField,
  tableCellId,
  tableRowCountId,
} from "@/lib/forms/types";
import type { Application } from "@/lib/db/schema";
import { embedSignature } from "@/lib/pdf/signature";

/**
 * The application as a carrier-ready PDF, for forms that have no carrier PDF of
 * their own: a branded application in Anthony Insurance Services' format with
 * every question the applicant saw, Yes/No as checkboxes, schedules as grids,
 * and the signature block.
 */

const PAGE = { w: 612, h: 792 }; // US Letter
const M = 40; // margin
const W = PAGE.w - 2 * M;
const NAVY = rgb(0.075, 0.161, 0.294);
const ACCENT = rgb(0.094, 0.349, 0.769);
const INK = rgb(0.08, 0.1, 0.14);
const MUTED = rgb(0.36, 0.4, 0.47);
const RULE = rgb(0.84, 0.86, 0.9);
const FILL = rgb(0.95, 0.96, 0.98);
const WHITE = rgb(1, 1, 1);
const FOOTER_H = 34;

type Fonts = { regular: PDFFont; bold: PDFFont; italic: PDFFont };

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

const str = (v: FormValues[string]) => (Array.isArray(v) ? v.join(", ") : (v ?? "")).trim();

const fmtDateTime = (d: Date) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: process.env.APP_TIMEZONE ?? "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(d));

const fmtDate = (iso: string) => {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
};

const isYesNo = (f: ChoiceField) =>
  f.type !== "checkboxes" && f.options.length === 2 && f.options.some((o) => o.value === "Yes") && f.options.some((o) => o.value === "No");

class Writer {
  page!: PDFPage;
  y = 0;
  pages: PDFPage[] = [];
  constructor(
    private doc: PDFDocument,
    readonly f: Fonts,
    private runningHead: string,
  ) {}

  newPage(first = false) {
    this.page = this.doc.addPage([PAGE.w, PAGE.h]);
    this.pages.push(this.page);
    if (first) {
      this.y = PAGE.h;
      return;
    }
    // Slim running header on continuation pages.
    this.page.drawRectangle({ x: 0, y: PAGE.h - 22, width: PAGE.w, height: 22, color: NAVY });
    this.page.drawText(safeText(this.f.bold, this.runningHead), { x: M, y: PAGE.h - 15, size: 8, font: this.f.bold, color: WHITE });
    this.y = PAGE.h - 40;
  }

  /** Start a new page if `h` points don't fit. */
  ensure(h: number) {
    if (this.y - h < M + FOOTER_H) this.newPage();
  }

  lines(text: string, size: number, font: PDFFont, width: number) {
    return wrap(font, text, size, width);
  }

  para(text: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; width?: number; after?: number } = {}) {
    const size = opts.size ?? 9;
    const font = opts.font ?? this.f.regular;
    const lh = size * 1.35;
    for (const l of this.lines(text, size, font, opts.width ?? W)) {
      this.ensure(lh);
      this.y -= lh;
      this.page.drawText(l, { x: opts.x ?? M, y: this.y + 2, size, font, color: opts.color ?? INK });
    }
    this.y -= opts.after ?? 0;
  }

  sectionBar(title: string) {
    this.ensure(48);
    this.y -= 12;
    this.page.drawRectangle({ x: M, y: this.y - 18, width: W, height: 18, color: NAVY });
    this.page.drawText(safeText(this.f.bold, title.toUpperCase()), { x: M + 7, y: this.y - 13, size: 9.5, font: this.f.bold, color: WHITE });
    this.y -= 22;
  }

  subheading(title: string) {
    this.ensure(30);
    this.y -= 6;
    this.page.drawText(safeText(this.f.bold, title), { x: M, y: this.y - 10, size: 9.5, font: this.f.bold, color: ACCENT });
    this.y -= 15;
  }

  /** A small square, ticked when `on`. */
  box(x: number, y: number, on: boolean) {
    this.page.drawRectangle({ x, y, width: 8, height: 8, borderColor: INK, borderWidth: 0.7 });
    if (on) {
      this.page.drawLine({ start: { x: x + 1.5, y: y + 4 }, end: { x: x + 3.4, y: y + 1.6 }, thickness: 1.2, color: INK });
      this.page.drawLine({ start: { x: x + 3.4, y: y + 1.6 }, end: { x: x + 7, y: y + 7 }, thickness: 1.2, color: INK });
    }
  }

  /** Question on the left, Yes/No boxes on the right — the layout carriers use. */
  yesNo(question: string, answer: string) {
    const size = 9;
    const lh = size * 1.35;
    const qLines = this.lines(question, size, this.f.regular, W - 110);
    const h = qLines.length * lh + 6;
    this.ensure(h);
    const top = this.y;
    qLines.forEach((l, i) => this.page.drawText(l, { x: M, y: top - (i + 1) * lh + 2, size, font: this.f.regular, color: INK }));
    const by = top - lh + 1;
    for (const [i, opt] of (["Yes", "No"] as const).entries()) {
      const bx = PAGE.w - M - 92 + i * 48;
      this.box(bx, by, answer === opt);
      this.page.drawText(opt, { x: bx + 12, y: by + 0.5, size: 8.5, font: answer === opt ? this.f.bold : this.f.regular, color: INK });
    }
    this.y = top - h;
    this.page.drawLine({ start: { x: M, y: this.y + 2 }, end: { x: PAGE.w - M, y: this.y + 2 }, thickness: 0.4, color: RULE });
  }

  /** Label above a shaded answer box (like a filled-in form field). */
  field(label: string, value: string, x = M, width = W) {
    const size = 9;
    const lh = size * 1.35;
    const labelLines = this.lines(label, 7.5, this.f.bold, width);
    const valueLines = this.lines(value || "—", size, this.f.regular, width - 10);
    const h = labelLines.length * 10 + valueLines.length * lh + 10;
    return { h, draw: (top: number) => {
      labelLines.forEach((l, i) => this.page.drawText(l, { x, y: top - (i + 1) * 10 + 2, size: 7.5, font: this.f.bold, color: MUTED }));
      const boxTop = top - labelLines.length * 10 - 1;
      const boxH = valueLines.length * lh + 5;
      this.page.drawRectangle({ x, y: boxTop - boxH, width, height: boxH, color: FILL, borderColor: RULE, borderWidth: 0.5 });
      valueLines.forEach((l, i) => this.page.drawText(l, { x: x + 5, y: boxTop - (i + 1) * lh + 1, size, font: this.f.regular, color: INK }));
    } };
  }

  /** Lay out short fields side by side (by their width hint), long ones full width. */
  fields(items: { label: string; value: string; width: "full" | "half" | "third" }[]) {
    const gap = 10;
    let row: typeof items = [];
    let used = 0;
    const span = { full: 6, half: 3, third: 2 } as const;
    const flush = () => {
      if (!row.length) return;
      const units = row.map((r) => span[r.width]);
      const total = 6;
      let x = M;
      const cells = row.map((r, i) => {
        const w = ((W + gap) * units[i]) / total - gap;
        const cell = this.field(r.label, r.value, x, w);
        x += w + gap;
        return cell;
      });
      const h = Math.max(...cells.map((c) => c.h));
      this.ensure(h + 4);
      const top = this.y;
      cells.forEach((c) => c.draw(top));
      this.y = top - h - 4;
      row = [];
      used = 0;
    };
    for (const it of items) {
      if (used + span[it.width] > 6) flush();
      row.push(it);
      used += span[it.width];
      if (used === 6) flush();
    }
    flush();
  }

  /** A schedule (repeatable rows) as a ruled grid with a header row. */
  grid(title: string, columns: string[], rows: string[][]) {
    const size = 8.5;
    const lh = size * 1.3;
    const colW = W / columns.length;
    this.subheading(title);
    const head = columns.map((c) => this.lines(c, 7.5, this.f.bold, colW - 8));
    const headH = Math.max(...head.map((l) => l.length)) * 10 + 6;
    const drawHead = () => {
      this.ensure(headH + 16);
      const top = this.y;
      this.page.drawRectangle({ x: M, y: top - headH, width: W, height: headH, color: FILL, borderColor: RULE, borderWidth: 0.5 });
      head.forEach((ls, c) =>
        ls.forEach((l, i) => this.page.drawText(l, { x: M + c * colW + 4, y: top - (i + 1) * 10, size: 7.5, font: this.f.bold, color: INK })),
      );
      this.y = top - headH;
    };
    drawHead();
    for (const r of rows) {
      const cells = r.map((v) => this.lines(v || "", size, this.f.regular, colW - 8));
      const h = Math.max(1, ...cells.map((l) => l.length)) * lh + 6;
      if (this.y - h < M + FOOTER_H) {
        this.newPage();
        drawHead();
      }
      const top = this.y;
      this.page.drawRectangle({ x: M, y: top - h, width: W, height: h, borderColor: RULE, borderWidth: 0.5 });
      cells.forEach((ls, c) => {
        if (c > 0) this.page.drawLine({ start: { x: M + c * colW, y: top }, end: { x: M + c * colW, y: top - h }, thickness: 0.5, color: RULE });
        ls.forEach((l, i) => this.page.drawText(l, { x: M + c * colW + 4, y: top - (i + 1) * lh - 1, size, font: this.f.regular, color: INK }));
      });
      this.y = top - h;
    }
    this.y -= 6;
  }
}

/** Notice/representation text from the form's last section, used above the signature. */
function representations(form: FormDefinition, values: FormValues): string[] {
  const last = form.sections.at(-1);
  if (!last) return [];
  return last.fields
    .filter((f) => f.type === "content" && f.variant !== "subheading" && isVisible(f, values))
    .flatMap((f) => (f.type === "content" ? [f.title ?? "", ...(Array.isArray(f.body) ? f.body : f.body ? [f.body] : [])] : []))
    .filter(Boolean);
}

export async function buildApplicationPdf(form: FormDefinition, app: Application): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`${form.title} — ${app.businessName ?? app.applicantName} (${app.reference})`);
  doc.setAuthor("Anthony Insurance Services");
  doc.setSubject(form.title);
  doc.setCreationDate(new Date(app.createdAt));
  const fonts: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  const v = app.values;
  const w = new Writer(doc, fonts, `ANTHONY INSURANCE SERVICES  ·  ${form.title.toUpperCase()}  ·  ${app.reference}`);

  // ── Title band
  w.newPage(true);
  const p = w.page;
  p.drawRectangle({ x: 0, y: PAGE.h - 96, width: PAGE.w, height: 96, color: NAVY });
  p.drawRectangle({ x: 0, y: PAGE.h - 100, width: PAGE.w, height: 4, color: ACCENT });
  p.drawText("ANTHONY INSURANCE SERVICES", { x: M, y: PAGE.h - 32, size: 9, font: fonts.bold, color: rgb(0.7, 0.8, 1) });
  const titleLines = wrap(fonts.bold, form.title.toUpperCase(), 17, W - 150);
  titleLines.forEach((l, i) => p.drawText(l, { x: M, y: PAGE.h - 54 - i * 19, size: 17, font: fonts.bold, color: WHITE }));
  p.drawText(safeText(fonts.regular, form.subtitle ?? "Application for Coverage"), {
    x: M,
    y: PAGE.h - 60 - titleLines.length * 19 + 4,
    size: 9.5,
    font: fonts.regular,
    color: rgb(0.85, 0.9, 1),
  });
  // Reference block, top right
  const refX = PAGE.w - M - 140;
  p.drawText("REFERENCE", { x: refX, y: PAGE.h - 32, size: 7, font: fonts.bold, color: rgb(0.7, 0.8, 1) });
  p.drawText(app.reference, { x: refX, y: PAGE.h - 46, size: 12, font: fonts.bold, color: WHITE });
  p.drawText(safeText(fonts.regular, `Submitted ${fmtDateTime(app.createdAt)}`), { x: refX, y: PAGE.h - 60, size: 7.5, font: fonts.regular, color: rgb(0.85, 0.9, 1) });
  w.y = PAGE.h - 112;

  // ── Applicant summary box
  const address = [str(v.mailing_address), [str(v.mailing_city), str(v.mailing_state)].filter(Boolean).join(", "), str(v.mailing_postal_code)]
    .filter(Boolean)
    .join(" ");
  const summary: [string, string][] = [
    ["Applicant / Named Insured", [app.businessName, str(v.dba) && `DBA ${str(v.dba)}`].filter(Boolean).join(" ") || app.applicantName],
    ["Contact", app.applicantName],
    ["Email", app.applicantEmail],
    ["Phone", str(v.phone)],
    ["Mailing Address", address],
    ["Requested Effective Date", str(v.requested_effective_date) ? fmtDate(str(v.requested_effective_date)) : ""],
  ];
  const colW = (W - 20) / 2;
  const rowsH = Math.ceil(summary.length / 2) * 26 + 12;
  p.drawRectangle({ x: M, y: w.y - rowsH, width: W, height: rowsH, color: FILL, borderColor: RULE, borderWidth: 0.6 });
  summary.forEach(([label, value], i) => {
    const x = M + 10 + (i % 2) * (colW + 0);
    const y = w.y - 16 - Math.floor(i / 2) * 26;
    p.drawText(label.toUpperCase(), { x, y, size: 6.5, font: fonts.bold, color: MUTED });
    const val = wrap(fonts.bold, value || "—", 9.5, colW - 14)[0];
    p.drawText(val, { x, y: y - 11, size: 9.5, font: fonts.bold, color: INK });
  });
  w.y -= rowsH + 4;

  // ── Sections, numbered like a carrier application. The last section (signature) is drawn separately.
  let shown = 0;
  form.sections.forEach((section) => {
    const visible = section.fields.filter((f) => isVisible(f, v));
    const hasAnswers = visible.some((f) => f.type === "table" || (isInputField(f) && f.type !== "signature"));
    if (!hasAnswers) return;
    w.sectionBar(`Section ${++shown}: ${section.title}`);
    let pending: { label: string; value: string; width: "full" | "half" | "third" }[] = [];
    const flush = () => {
      if (pending.length) w.fields(pending);
      pending = [];
    };
    for (const f of visible as Field[]) {
      if (f.type === "content") {
        if (f.variant === "subheading" && f.title) {
          flush();
          w.subheading(f.title);
        }
        continue; // instructions and notices aren't answers (the signature notice prints below)
      }
      if (f.type === "table") {
        flush();
        const n = clampRows(v[tableRowCountId(f.id)], f.maxRows);
        const rows = Array.from({ length: n }, (_, r) => f.columns.map((c) => str(v[tableCellId(f.id, r + 1, c.id)])))
          .filter((r) => r.some(Boolean));
        if (rows.length) w.grid(f.label, f.columns.map((c) => c.label), rows);
        continue;
      }
      if (f.type === "signature") continue;
      const value = str(v[f.id]);
      if ((f.type === "radio" || f.type === "select") && isYesNo(f)) {
        flush();
        w.yesNo(f.label, value);
        continue;
      }
      const shown =
        f.type === "date" && value ? fmtDate(value) : f.type === "currency" && value && /^\d/.test(value) ? `$${Number(value).toLocaleString("en-US")}` : value;
      const width = f.type === "textarea" || f.type === "checkboxes" ? "full" : (f.width ?? "full");
      pending.push({ label: f.label, value: shown, width });
    }
    flush();
  });

  // ── Representations & signature
  const reps = representations(form, v);
  w.sectionBar("Representations, Warranty & Signature");
  if (reps.length) for (const r of reps) w.para(r, { size: 8.5, after: 3 });
  else
    w.para(
      "The undersigned declares that the statements in this application are true, complete and accurate, and understands that this application does not bind coverage.",
      { size: 8.5, after: 3 },
    );
  w.ensure(110);
  w.y -= 8;
  const sigTop = w.y;
  const png = await embedSignature(doc, app.signature);
  if (png) {
    const scale = Math.min(230 / png.width, 50 / png.height);
    w.page.drawImage(png, { x: M + 4, y: sigTop - 52, width: png.width * scale, height: png.height * scale });
  }
  const lineY = sigTop - 56;
  w.page.drawLine({ start: { x: M, y: lineY }, end: { x: M + 290, y: lineY }, thickness: 0.8, color: INK });
  w.page.drawLine({ start: { x: M + 330, y: lineY }, end: { x: PAGE.w - M, y: lineY }, thickness: 0.8, color: INK });
  const signedOn = new Intl.DateTimeFormat("en-US", { timeZone: process.env.APP_TIMEZONE ?? "America/Chicago", dateStyle: "short" }).format(
    new Date(app.createdAt),
  );
  w.page.drawText(signedOn, { x: M + 334, y: lineY + 5, size: 10, font: fonts.regular, color: INK });
  w.page.drawText("Signature of Applicant / Authorized Representative", { x: M, y: lineY - 11, size: 7.5, font: fonts.bold, color: MUTED });
  w.page.drawText("Date", { x: M + 330, y: lineY - 11, size: 7.5, font: fonts.bold, color: MUTED });
  const printed = str(v.signer_name) || app.applicantName;
  const title = str(v.signer_title);
  w.page.drawText(safeText(fonts.regular, `Print name: ${printed}${title ? `   ·   Title: ${title}` : ""}`), {
    x: M,
    y: lineY - 26,
    size: 9,
    font: fonts.regular,
    color: INK,
  });
  w.page.drawText(
    safeText(fonts.italic, `Signed electronically on ${fmtDateTime(app.createdAt)}${app.submittedIp ? ` from IP ${app.submittedIp}` : ""}.`),
    { x: M, y: lineY - 39, size: 7.5, font: fonts.italic, color: MUTED },
  );
  w.y = lineY - 48;

  // ── Footer on every page
  const total = w.pages.length;
  w.pages.forEach((pg, i) => {
    pg.drawLine({ start: { x: M, y: M - 6 }, end: { x: PAGE.w - M, y: M - 6 }, thickness: 0.5, color: RULE });
    pg.drawText(safeText(fonts.regular, `Anthony Insurance Services  ·  anthonyinsuranceservices.com  ·  ${app.reference}  ·  Confidential`), {
      x: M,
      y: M - 18,
      size: 7,
      font: fonts.regular,
      color: MUTED,
    });
    pg.drawText(`Page ${i + 1} of ${total}`, { x: PAGE.w - M - 50, y: M - 18, size: 7, font: fonts.bold, color: MUTED });
  });
  return doc.save();
}
