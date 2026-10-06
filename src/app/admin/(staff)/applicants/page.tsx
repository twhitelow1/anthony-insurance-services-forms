import Link from "next/link";
import { fmtDate } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { listApplicants } from "@/lib/applications/repo";
import { applicantPath } from "@/lib/applications/links";
import { linkAllGhlAction } from "@/app/admin/actions";
import { contactUrl, ghlConfig } from "@/lib/ghl/client";

export const metadata = { title: "Applicants | Anthony Insurance Services" };

export default async function Applicants({ searchParams }: PageProps<"/admin/applicants">) {
  await requireStaff("/admin/applicants");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const applicants = await listApplicants({ q });
  const message = typeof sp.ghl === "string" ? sp.ghl : null;

  return (
    <div>
      <h1 className="text-2xl font-semibold">Applicants</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        One row per email address. Open one to see all of their applications and PDFs. Each applicant is linked to one
        GoHighLevel contact by email.
      </p>
      {message && <p className="callout mb-4 text-sm" role="status">{message}</p>}
      {ghlConfig() && (
        <form action={linkAllGhlAction} className="mb-4">
          <button className="btn-secondary" title="Find the GHL contact for every applicant that isn't linked yet">
            Link unlinked applicants to GHL
          </button>
        </form>
      )}
      <form className="card mb-6 grid gap-3 !p-4 sm:grid-cols-[1fr_auto]" role="search">
        <label className="sr-only" htmlFor="q">Search applicants</label>
        <input id="q" name="q" defaultValue={q} className="input" placeholder="Name, business or email" />
        <button className="btn-primary">Search</button>
      </form>
      <div className="card overflow-x-auto !p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Applicant</th>
              <th>Email</th>
              <th>Applications</th>
              <th>Last applied</th>
              <th>GHL</th>
            </tr>
          </thead>
          <tbody>
            {applicants.map((a) => (
              <tr key={a.email}>
                <td>
                  <Link className="row-link font-medium" href={applicantPath(a.email)}>{a.name}</Link>
                  {a.businessName && <div className="text-xs text-[var(--muted)]">{a.businessName}</div>}
                </td>
                <td className="text-sm">{a.email}</td>
                <td>{a.applications}</td>
                <td className="whitespace-nowrap text-sm">{fmtDate(a.lastApplied)}</td>
                <td className="text-sm">
                  {a.ghlContactId ? (
                    <a className="btn-link" href={contactUrl(a.ghlContactId) ?? "#"} target="_blank" rel="noopener">Linked</a>
                  ) : (
                    <span className="text-[var(--muted)]">Not linked</span>
                  )}
                </td>
              </tr>
            ))}
            {!applicants.length && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-[var(--muted)]">
                  {q ? "No applicants match that search." : "No applicants yet."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
