import { forms } from "@/forms";
import { fmtDate } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { libraryPath, listLibrary } from "@/lib/library";
import { deleteLibraryFileAction, updateLibraryFileAction, uploadLibraryFileAction } from "./actions";

export const metadata = { title: "Documents | Anthony Insurance Services" };

const allForms = Object.values(forms).sort((a, b) => a.title.localeCompare(b.title));
const kb = (n: number) => (n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

function FormPicker({ selected }: { selected: string[] }) {
  return (
    <fieldset>
      <legend className="field-label">Show on these forms</legend>
      <div className="grid gap-1 sm:grid-cols-2">
        {allForms.map((f) => (
          <label key={f.slug} className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="forms" value={f.slug} defaultChecked={selected.includes(f.slug)} />
            {f.title}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default async function DocumentsPage({ searchParams }: PageProps<"/admin/documents">) {
  await requireStaff("/admin/documents");
  const sp = await searchParams;
  const files = await listLibrary();

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold">Documents</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        Upload sample waivers, risk-management guides and other documents once, then choose which forms they belong to. Applicants
        see them on the form and get links in their confirmation email. Anyone with the link can open a document, so only upload
        files meant for applicants.
      </p>
      {typeof sp.saved === "string" && <p className="callout mb-4 text-sm" role="status">{sp.saved}</p>}
      {typeof sp.error === "string" && (
        <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">{sp.error}</p>
      )}

      <form action={uploadLibraryFileAction} className="card mb-8 space-y-4 !p-5">
        <h2 className="font-semibold">Upload a document</h2>
        <div>
          <label className="field-label" htmlFor="file">File (PDF, Word, PNG or JPG, up to 4 MB)</label>
          <input id="file" name="file" type="file" required accept=".pdf,.doc,.docx,.png,.jpg,.jpeg" className="input" />
        </div>
        <div>
          <label className="field-label" htmlFor="title">Title</label>
          <input id="title" name="title" className="input" placeholder="e.g. Sample Release and Waiver" />
        </div>
        <div>
          <label className="field-label" htmlFor="description">Note for applicants (optional)</label>
          <input id="description" name="description" className="input" placeholder="e.g. Use this if you don't have your own waiver yet." />
        </div>
        <FormPicker selected={[]} />
        <button className="btn-primary">Upload</button>
      </form>

      <h2 className="mb-3 font-semibold">Library ({files.length})</h2>
      {!files.length && <p className="text-sm text-[var(--muted)]">No documents yet.</p>}
      <div className="space-y-4">
        {files.map((f) => (
          <section key={f.id} className="card !p-5">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <a className="btn-link font-semibold" href={libraryPath(f)} target="_blank" rel="noopener">{f.filename}</a>
              <span className="text-xs text-[var(--muted)]">
                {kb(f.size)} · updated {fmtDate(f.updatedAt)}
                {f.updatedBy ? ` by ${f.updatedBy.replace(/^staff:/, "")}` : ""}
              </span>
            </div>
            <form action={updateLibraryFileAction} className="space-y-3">
              <input type="hidden" name="id" value={f.id} />
              <div>
                <label className="field-label" htmlFor={`title-${f.id}`}>Title</label>
                <input id={`title-${f.id}`} name="title" className="input" defaultValue={f.title} required />
              </div>
              <div>
                <label className="field-label" htmlFor={`desc-${f.id}`}>Note for applicants</label>
                <input id={`desc-${f.id}`} name="description" className="input" defaultValue={f.description ?? ""} />
              </div>
              <FormPicker selected={f.formSlugs} />
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn-secondary">Save</button>
                <span className="text-xs text-[var(--muted)]">
                  {f.formSlugs.length ? `On ${f.formSlugs.length} form${f.formSlugs.length === 1 ? "" : "s"}` : "Not on any form yet"}
                </span>
              </div>
            </form>
            <form action={deleteLibraryFileAction} className="mt-3 border-t border-[var(--border)] pt-3">
              <input type="hidden" name="id" value={f.id} />
              <button className="btn-link text-sm text-[var(--danger)]">Delete this document</button>
            </form>
          </section>
        ))}
      </div>
    </div>
  );
}
