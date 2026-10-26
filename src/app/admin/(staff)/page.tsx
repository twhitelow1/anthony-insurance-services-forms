import { Fragment } from "react";
import Link from "next/link";
import { forms } from "@/forms";
import { ListSummary, pageHref, pageState, Pagination } from "@/components/Pagination";
import { fmtDate, StatusBadge } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { countApplications, searchApplications } from "@/lib/applications/repo";
import { STATUSES, STATUS_KEYS, isStatus } from "@/lib/applications/status";
import { clientPath } from "@/lib/applications/links";

export const metadata = { title: "Applications | AIS Connect" };

export default async function AdminHome({ searchParams }: PageProps<"/admin">) {
  await requireStaff("/admin");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const status = isStatus(sp.status) ? sp.status : undefined;
  const order = sp.view === "accounts" ? "account" : "latest";
  const form = typeof sp.form === "string" && forms[sp.form] ? sp.form : undefined;
  const origin = sp.origin === "imported" || sp.origin === "new" ? sp.origin : undefined;
  const formOptions = Object.values(forms).sort((a, b) => a.title.localeCompare(b.title));
  const paging = pageState(sp);
  const [results, total] = await Promise.all([
    searchApplications({ q, status, form, origin, order, limit: paging.pageSize, offset: paging.offset }),
    countApplications({ q, status, form, origin }),
  ]);
  const href = pageHref("/admin", { q: q || undefined, status, form, origin, view: order === "account" ? "accounts" : undefined });

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
      <form className="card mb-6 grid gap-3 !p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]" role="search">
        <label className="sr-only" htmlFor="q">Search applications</label>
        <input id="q" name="q" defaultValue={q} className="input !py-3 !text-lg sm:col-span-2 lg:col-span-full" placeholder='e.g. "trampoline" Austin, AIS-7K3Q, jane@…' />
        <label className="sr-only" htmlFor="status">Status</label>
        <select id="status" name="status" defaultValue={status ?? ""} className="input">
          <option value="">All statuses</option>
          {STATUS_KEYS.map((s) => (
            <option key={s} value={s}>{STATUSES[s].label}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="form">Kind of application</label>
        <select id="form" name="form" defaultValue={form ?? ""} className="input">
          <option value="">All kinds of application</option>
          {formOptions.map((f) => (
            <option key={f.slug} value={f.slug}>{f.title}</option>
          ))}
        </select>
        <label className="sr-only" htmlFor="origin">Where it came from</label>
        <select id="origin" name="origin" defaultValue={origin ?? ""} className="input">
          <option value="">New and imported</option>
          <option value="new">Made in AIS Connect</option>
          <option value="imported">Imported from Lead Alchemist</option>
        </select>
        <label className="sr-only" htmlFor="view">View</label>
        <select id="view" name="view" defaultValue={order === "account" ? "accounts" : ""} className="input">
          <option value="">Newest first</option>
          <option value="accounts">Grouped by account</option>
        </select>
        <button className="btn-primary">Search</button>
      </form>

      <ListSummary total={total} state={paging} noun="application" />
      <div className="card overflow-x-auto !p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>Reference</th>
              <th>Account / filled out by</th>
              <th>Form</th>
              <th>Status</th>
              <th>Submitted</th>
            </tr>
          </thead>
          <tbody>
            {results.map((a, i) => (
              <Fragment key={a.id}>
              {order === "account" && (i === 0 || results[i - 1].clientId !== a.clientId || results[i - 1].accountName !== a.accountName) && (
                <tr className="bg-[var(--track)]">
                  <td colSpan={5} className="text-sm font-semibold">
                    {a.clientId ? <Link className="hover:underline" href={`/admin/clients/${a.clientId}`}>{a.accountName}</Link> : a.accountName}
                  </td>
                </tr>
              )}
              <tr>
                <td>
                  <Link className="row-link font-mono" href={`/admin/applications/${a.id}`}>{a.reference}</Link>
                </td>
                <td>
                  <div className="font-medium">
                    {a.clientId ? <Link className="hover:underline" href={`/admin/clients/${a.clientId}`}>{a.accountName}</Link> : a.accountName}
                  </div>
                  <div className="text-xs text-[var(--muted)]">
                    {a.contactName ?? a.applicantName} ·{" "}
                    <Link className="hover:underline" href={clientPath(a.clientId, a.applicantEmail)}>{a.applicantEmail}</Link>
                    {a.state ? ` · ${a.state}` : ""}
                  </div>
                </td>
                <td className="text-sm">{forms[a.formSlug]?.title ?? a.formSlug}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={a.status} />
                    {a.isTest && <span className="badge badge-danger" title="Submitted in staff testing mode">TEST</span>}
                    {a.importedFrom && <span className="badge badge-neutral ml-1" title="Brought in from an old Lead Alchemist form submission">Imported</span>}
                    {a.aiHighFlags ? (
                      <span className="badge badge-danger" title="High-severity flags from the AI pre-review">
                        {a.aiHighFlags} high flag{a.aiHighFlags > 1 ? "s" : ""}
                      </span>
                    ) : null}
                  </div>
                </td>
                <td className="whitespace-nowrap text-sm">{fmtDate(a.createdAt)}</td>
              </tr>
              </Fragment>
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
      <Pagination total={total} state={paging} noun="application" href={href} />
    </div>
  );
}
