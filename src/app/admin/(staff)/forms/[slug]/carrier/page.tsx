import Link from "next/link";
import { notFound } from "next/navigation";
import { getForm } from "@/forms";
import { requireStaff } from "@/lib/auth/session";
import { getCarrierTemplate } from "@/lib/applications/carrier-templates";
import { readFlash } from "@/lib/flash";
import { carrierFormFor } from "@/lib/pdf/carrier";
import { formQuestions, SPECIAL_SOURCES } from "@/lib/pdf/carrier/uploaded";
import { FlashMessage } from "../../../salesforce/ui";
import { removeCarrierPdfAction, saveCarrierMappingAction, uploadCarrierPdfAction } from "./actions";

export const metadata = { title: "Carrier PDF | AIS Connect" };
export const dynamic = "force-dynamic";

const TYPE_LABEL = { text: "Text", checkbox: "Tick box", radio: "Choice", dropdown: "Dropdown", other: "Other" } as const;

/** Forms → Carrier PDF: upload the carrier's fillable PDF for a form and match its boxes to the form's questions. */
export default async function CarrierPdfPage({ params, searchParams }: PageProps<"/admin/forms/[slug]/carrier">) {
  const { slug } = await params;
  await requireStaff(`/admin/forms/${slug}/carrier`);
  const form = getForm(slug);
  if (!form) notFound();
  const flash = await readFlash((await searchParams).f);
  const tpl = await getCarrierTemplate(slug);
  const builtIn = carrierFormFor(slug);
  const questions = formQuestions(form);
  const matched = tpl ? tpl.fields.filter((f) => tpl.mapping[f.name]).length : 0;

  return (
    <div className="mx-auto max-w-5xl">
      <Link href="/admin/forms" className="btn-link">← Forms</Link>
      <h1 className="mb-1 mt-3 text-2xl font-semibold">Carrier PDF: {form.title}</h1>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Upload the carrier&apos;s own fillable application for this form. Every application on this form then fills it in automatically
        (with the applicant&apos;s signature and the date), next to the AIS Connect application PDF. Match each box on the PDF to the question
        that fills it; the obvious ones are matched for you.
      </p>
      <FlashMessage flash={flash} />

      {!tpl && builtIn && (
        <p className="callout mb-4 text-sm">
          This form already uses a built-in carrier PDF ({builtIn.name}). Uploading one here replaces it for new applications.
        </p>
      )}

      <form action={uploadCarrierPdfAction} className="card mb-6 space-y-3 !p-4">
        <input type="hidden" name="slug" value={slug} />
        <h2 className="font-semibold">{tpl ? "Replace the PDF" : "Upload the carrier's PDF"}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="field-label" htmlFor="file">Fillable PDF (up to 4 MB)</label>
            <input id="file" name="file" type="file" required accept=".pdf,application/pdf" className="input" />
          </div>
          <div>
            <label className="field-label" htmlFor="name">Name staff see</label>
            <input id="name" name="name" className="input" placeholder="e.g. Carrier application (ABC-123)" defaultValue={tpl?.name ?? ""} />
          </div>
        </div>
        <p className="text-xs text-[var(--muted)]">
          It must be the fillable version (boxes you can type in). A scanned or flat PDF can&apos;t be filled: ask the carrier for the fillable one,
          or make it fillable in Adobe Acrobat (Prepare Form).{tpl ? " Replacing keeps the matches for boxes that have the same names." : ""}
        </p>
        <button className="btn-primary">{tpl ? "Upload new version" : "Upload"}</button>
      </form>

      {tpl && (
        <>
          <form action={saveCarrierMappingAction} className="space-y-4">
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="name" value={tpl.name} />
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {tpl.name} <span className="text-sm font-normal text-[var(--muted)]">({tpl.filename})</span>
              </h2>
              <span className="text-sm text-[var(--muted)]">
                {matched} of {tpl.fields.length} boxes matched ·{" "}
                <a className="btn-link" href={`/admin/forms/${slug}/carrier/labelled`} target="_blank" rel="noopener">PDF with box names</a> ·{" "}
                <a className="btn-link" href={`/admin/forms/${slug}/carrier/test`} target="_blank" rel="noopener">Test with the newest application</a>
              </span>
            </div>
            <div className="card overflow-x-auto !p-0">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Box on the PDF</th>
                    <th>Kind</th>
                    <th>Page</th>
                    <th>Filled from</th>
                  </tr>
                </thead>
                <tbody>
                  {tpl.fields.map((f) => (
                    <tr key={f.name}>
                      <td className="font-mono text-xs">{f.name}</td>
                      <td className="text-xs">
                        {TYPE_LABEL[f.type]}
                        {f.options?.length ? <span className="block text-[var(--muted)]">{f.options.join(" / ")}</span> : null}
                      </td>
                      <td className="text-xs">{f.page + 1}</td>
                      <td>
                        <select name={`map:${f.name}`} defaultValue={tpl.mapping[f.name] ?? ""} className="input !w-full max-w-md text-sm" aria-label={`What fills ${f.name}`} data-no-auto>
                          <option value="">(leave blank)</option>
                          <optgroup label="Questions">
                            {questions.map((q) => (
                              <option key={q.id} value={`q:${q.id}`}>{q.label}</option>
                            ))}
                          </optgroup>
                          {f.type === "checkbox" && (
                            <optgroup label="Tick when this answer was picked">
                              {questions.flatMap((q) =>
                                "options" in q
                                  ? q.options.map((o) => (
                                      <option key={`${q.id}=${o.value}`} value={`q:${q.id}=${o.value}`}>{`${q.label}: ${o.label}`}</option>
                                    ))
                                  : [],
                              )}
                            </optgroup>
                          )}
                          <optgroup label="Other">
                            {SPECIAL_SOURCES.map((s) => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </optgroup>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="fillBlanks" value="yes" defaultChecked={tpl.fillBlanks} /> Write &quot;N/A&quot; in text boxes left empty
            </label>
            <p className="text-xs text-[var(--muted)]">
              A tick box matched to a question is ticked when the answer is anything but No; match it to an answer to tick it only for that
              answer (e.g. a Yes box and a No box). Answers too long for their box go on an addendum page at the end.
            </p>
            <button className="btn-primary">Save matches</button>
          </form>

          <form action={removeCarrierPdfAction} className="mt-8 flex flex-wrap items-center gap-3 border-t border-[var(--border)] pt-4 text-sm">
            <input type="hidden" name="slug" value={slug} />
            <label className="flex items-center gap-2">
              <input type="checkbox" name="confirm" value="yes" /> Sure
            </label>
            <button className="btn-secondary">Stop using this PDF for this form</button>
            <span className="text-[var(--muted)]">PDFs already made stay on their applications.</span>
          </form>
        </>
      )}
    </div>
  );
}
