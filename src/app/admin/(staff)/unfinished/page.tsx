import Link from "next/link";
import { forms } from "@/forms";
import { fmtDate } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { listUnfinished } from "@/lib/applications/drafts";
import { applicantPath } from "@/lib/applications/links";
import { deleteDraftAction } from "@/app/admin/actions";

export const metadata = { title: "Unfinished applications | Anthony Insurance Services" };

export default async function Unfinished() {
  await requireStaff("/admin/unfinished");
  const drafts = await listUnfinished();
  return (
    <div>
      <h1 className="text-2xl font-semibold">Unfinished applications</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        People who started an application and gave their email but haven&apos;t submitted. Their Lead Alchemist contact is tagged{" "}
        <code>app-started</code> (and <code>app-started:&lt;form&gt;</code>) so a workflow can follow up; the tags come off when they submit.
      </p>
      <div className="card overflow-x-auto !p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Applicant</th>
              <th>Form</th>
              <th>Progress</th>
              <th>Last saved</th>
              <th>Lead Alchemist</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {drafts.map((d) => {
              const form = forms[d.formSlug];
              const total = form?.sections.length ?? 1;
              return (
                <tr key={d.id}>
                  <td>
                    <Link className="row-link font-medium" href={applicantPath(d.email!)}>{d.name ?? d.email}</Link>
                    <div className="text-xs text-[var(--muted)]">
                      <a className="btn-link" href={`mailto:${d.email}`}>{d.email}</a>
                      {d.businessName && <> · {d.businessName}</>}
                    </div>
                  </td>
                  <td className="text-sm">{form?.title ?? d.formSlug}</td>
                  <td className="whitespace-nowrap text-sm">
                    Section {Math.min(d.step + 1, total)} of {total}
                    {d.resumeEmailedAt && <div className="text-xs text-[var(--muted)]">Asked for a resume link</div>}
                  </td>
                  <td className="whitespace-nowrap text-sm">{fmtDate(d.updatedAt)}</td>
                  <td className="text-sm">{d.ghlContactId ? "Tagged app-started" : "Not synced"}</td>
                  <td>
                    <form action={deleteDraftAction}>
                      <input type="hidden" name="id" value={d.id} />
                      <button className="btn-link text-sm text-[var(--danger)]">Delete</button>
                    </form>
                  </td>
                </tr>
              );
            })}
            {!drafts.length && (
              <tr>
                <td colSpan={6} className="py-10 text-center text-[var(--muted)]">No unfinished applications right now.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
