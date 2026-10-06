import Link from "next/link";
import { notFound } from "next/navigation";
import { forms } from "@/forms";
import { fmtDate, StatusBadge } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { getApplication, listForEmail, normalizeEmail } from "@/lib/applications/repo";
import { userModeAction } from "@/app/admin/actions";

export default async function Applicant({ params }: PageProps<"/admin/applicants/[email]">) {
  const { email: raw } = await params;
  const email = normalizeEmail(decodeURIComponent(raw));
  await requireStaff(`/admin/applicants/${encodeURIComponent(email)}`);
  const apps = await listForEmail(email);
  if (!apps.length) notFound();
  // Contact details from their most recent application.
  const latest = await getApplication(apps[0].id);
  const phone = typeof latest?.values.phone === "string" ? latest.values.phone : null;

  return (
    <div>
      <Link href="/admin/applicants" className="btn-link">← All applicants</Link>
      <div className="mb-6 mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{apps[0].applicantName}</h1>
          <p className="text-sm text-[var(--muted)]">
            <a className="btn-link" href={`mailto:${email}`}>{email}</a>
            {phone && <> · <a className="btn-link" href={`tel:${phone}`}>{phone}</a></>}
            {" "}· {apps.length} application{apps.length > 1 ? "s" : ""}
          </p>
        </div>
        <form action={userModeAction}>
          <input type="hidden" name="email" value={email} />
          <button className="btn-secondary">View portal as this applicant</button>
        </form>
      </div>
      <div className="card overflow-x-auto !p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Business</th>
              <th>Status</th>
              <th>Submitted</th>
              <th>PDF</th>
            </tr>
          </thead>
          <tbody>
            {apps.map((a) => (
              <tr key={a.id}>
                <td>
                  <Link className="row-link font-mono" href={`/admin/applications/${a.id}`}>{a.reference}</Link>
                </td>
                <td>
                  <div className="font-medium">{a.businessName ?? "—"}</div>
                  <div className="text-xs text-[var(--muted)]">{forms[a.formSlug]?.title ?? a.formSlug}</div>
                </td>
                <td><StatusBadge status={a.status} /></td>
                <td className="whitespace-nowrap text-sm">{fmtDate(a.createdAt)}</td>
                <td>
                  <a className="btn-link text-sm" href={`/applications/${a.id}/pdf`} target="_blank" rel="noopener">Open PDF</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
