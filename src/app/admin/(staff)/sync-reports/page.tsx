import Link from "next/link";
import { ListSummary, pageHref, pageState, Pagination } from "@/components/Pagination";
import { requireStaff } from "@/lib/auth/session";
import { listSyncReports } from "@/lib/bulk/report";

export const metadata = { title: "Sync reports | AIS Connect" };
export const dynamic = "force-dynamic";

const when = (d: Date) => d.toLocaleString("en-US", { timeZone: process.env.APP_TIMEZONE ?? "America/Chicago" });

/** Every bulk sync's result, newest first: everything done, or how many conflicts and errors. */
export default async function SyncReports({ searchParams }: PageProps<"/admin/sync-reports">) {
  await requireStaff("/admin/sync-reports");
  const paging = pageState(await searchParams);
  const { rows, total } = await listSyncReports(paging.pageSize, paging.offset);
  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Sync reports</h1>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        The result of every bulk sync (the buttons on Contacts, Accounts, Mapping and Salesforce, and their &quot;select all matching&quot; runs):
        whether everything synced, or each conflict, error and skipped row. Syncs that need attention also raise a card on Notifications.
      </p>
      <ListSummary total={total} state={paging} noun="report" />
      <div className="card overflow-x-auto !p-0">
        <table className="data-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Sync</th>
              <th>Rows</th>
              <th>Result</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {!rows.length && (
              <tr>
                <td colSpan={5} className="py-8 text-center text-[var(--muted)]">No syncs yet.</td>
              </tr>
            )}
            {rows.map((r) => {
              const clean = r.done >= r.total && !r.errors.length && !r.conflicts.length;
              return (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-sm">
                    <Link className="row-link" href={`/admin/sync-reports/${r.id}`}>{when(r.createdAt)}</Link>
                  </td>
                  <td className="text-sm">
                    <span className="font-medium">{r.title}</span>
                    <div className="text-xs text-[var(--muted)]">{r.scope}</div>
                  </td>
                  <td className="text-sm">
                    {r.done} of {r.total} done
                  </td>
                  <td className="text-sm">
                    {clean ? (
                      <span className="badge badge-success">All synced</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {r.conflicts.length > 0 && <span className="badge badge-warning">{r.conflicts.length} conflict{r.conflicts.length === 1 ? "" : "s"}</span>}
                        {r.errors.length > 0 && <span className="badge badge-danger">{r.errors.length} error{r.errors.length === 1 ? "" : "s"}</span>}
                        {r.done < r.total && <span className="badge badge-neutral">{r.total - r.done} not done</span>}
                      </span>
                    )}
                  </td>
                  <td className="text-sm">{r.actor.replace(/^staff:/, "")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination total={total} state={paging} noun="report" href={pageHref("/admin/sync-reports", {})} />
    </div>
  );
}
