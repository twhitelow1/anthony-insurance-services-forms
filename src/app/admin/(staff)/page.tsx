import Link from "next/link";
import { forms } from "@/forms";
import { fmtDate, StatusBadge } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { searchApplications } from "@/lib/applications/repo";
import { STATUSES, STATUS_KEYS, isStatus } from "@/lib/applications/status";
import { applicantPath } from "@/lib/applications/links";

export const metadata = { title: "Applications | Anthony Insurance Services" };

export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  await requireStaff("/admin");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = isStatus(sp.status) ? sp.status : undefined;
  const results = await searchApplications({ q, status, limit: 100 });

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Applications</h1>
          <p className="text-sm text-[var(--muted)]">Search any answer: business name, city, activity, email, reference number…</p>
        </div>
      </div>

      {typeof sp.deleted === "string" && (
        <p className="callout mb-6 text-sm" role="status">Application {sp.deleted} was deleted.</p>
      )}
      <form className="card mb-6 grid gap-3 !p-4 sm:grid-cols-[1fr_220px_auto]" role="search">
        <label className="sr-only" htmlFor="q">Search applications</label>
        <input id="q" name="q" defaultValue={q} className="input" placeholder='e.g. "trampoline" Austin, AIS-7K3Q, jane@…' />
        <label className="sr-only" htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={status ?? ""} className="input">
          <option value="">All statuses</option>
          {STATUS_KEYS.map((s) => (
            <option key={s} value={s}>{STATUSES[s].label}</option>
          ))}
        </select>
        <button className="btn-primary">Search</button>
      </form>

      <div className="card overflow-x-auto !p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Business / applicant</th>
              <th>Form</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {results.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link className="row-link font-mono" href={`/admin/applications/${a.id}`}>{a.reference}</Link>
                </td>
                <td>
                  <div className="font-medium">{a.businessName ?? a.applicantName}</div>
                  <div className="text-xs text-[var(--muted)]">
                    {a.applicantName} ·{" "}
                    <Link className="hover:underline" href={applicantPath(a.applicantEmail)}>{a.applicantEmail}</Link>
                    {a.state ? ` · ${a.state}` : ""}
                  </div>
                </td>
                <td className="text-sm">{forms[a.formSlug]?.title ?? a.formSlug}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={a.status} />
                    {a.aiHighFlags ? (
                      <span className="badge badge-danger" title="High-severity flags from the AI pre-review">
                        {a.aiHighFlags} high flag{a.aiHighFlags > 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="whitespace-nowrap text-sm">{fmtDate(a.createdAt)}</td>
              </tr>
            ))}
            {!results.length && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-[var(--muted)]">
                  {q || status ? "No applications match that search." : "No applications yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {results.length === 100 && <p className="mt-3 text-sm text-[var(--muted)]">Showing the first 100 results — refine your search to narrow it down.</p>}
    </div>
  );
}
