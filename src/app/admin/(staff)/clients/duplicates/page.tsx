import Link from "next/link";
import { cookies } from "next/headers";
import { ListSummary, pageHref, pageOf, pageState, Pagination } from "@/components/Pagination";
import { findDuplicateGroups, type DuplicateReason } from "@/lib/accounts/duplicates";
import { requireStaff } from "@/lib/auth/session";
import { CLIENT_SEARCH_COOKIE } from "@/lib/clients/search-cookie";
import { readFlash } from "@/lib/flash";
import { FlashMessage } from "../../salesforce/ui";
import { AccountTabs } from "../AccountTabs";
import { searchAcrossAction } from "../across-actions";
import { notDuplicateAction } from "../merge/actions";

export const metadata = { title: "Duplicate accounts | AIS Connect" };
export const dynamic = "force-dynamic";

const REASONS: { value: DuplicateReason; label: string }[] = [
  { value: "same name", label: "Same name" },
  { value: "same email", label: "Same email" },
  { value: "same phone", label: "Same phone" },
  { value: "same website", label: "Same website" },
  { value: "flagged when created", label: "Flagged when created" },
  { value: "same email domain", label: "Same business email domain (weaker)" },
];

/**
 * Accounts → Duplicates: AIS Connect accounts that are probably the same business, grouped, with
 * why. Each group opens Compare & merge (pick what stays) or is marked "Not the same business".
 */
export default async function Duplicates({ searchParams }: PageProps<"/admin/clients/duplicates">) {
  await requireStaff("/admin/clients");
  const sp = await searchParams;
  const reason = REASONS.find((r) => r.value === sp.reason)?.value ?? "";
  const q = (await cookies()).get(CLIENT_SEARCH_COOKIE)?.value ?? "";
  const paging = pageState(sp, 25);
  const [groups, flash] = await Promise.all([findDuplicateGroups({ q, reason }), readFlash(sp.f)]);
  const shown = pageOf(groups, paging);
  const href = pageHref("/admin/clients/duplicates", { reason: reason || undefined }, 25);
  const back = href(paging.page, paging.pageSize);
  const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { timeZone: process.env.APP_TIMEZONE ?? "America/Chicago" });

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">Accounts</h1>
      <AccountTabs view="duplicates" duplicates={groups.length} />
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        AIS Connect accounts that are probably the same business: same name (punctuation, LLC and Inc aside), email, phone or website, or flagged
        as a possible duplicate when they came in. Compare &amp; merge to pick the account and the details that stay (contacts, applications and
        history move over; nothing is deleted in Salesforce or Lead Alchemist), or mark them as different businesses so they stop showing here.
      </p>
      <FlashMessage flash={flash} />

      <div className="card mb-4 flex flex-wrap items-end gap-3 !p-4">
        <form action={searchAcrossAction} className="flex flex-1 flex-wrap gap-3" role="search">
          <input type="hidden" name="back" value={back} />
          <label className="sr-only" htmlFor="dup-q">Search accounts</label>
          <input id="dup-q" name="q" defaultValue={q} className="input min-w-[12rem] flex-1" placeholder="Account name" />
          <button className="btn-primary">Search</button>
          {q && (
            <button name="clear" value="1" className="btn-secondary">Clear</button>
          )}
        </form>
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="field-label !mb-1">Why</span>
            <select name="reason" defaultValue={reason} className="input">
              <option value="">Any strong match</option>
              {REASONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          <button className="btn-secondary">Filter</button>
        </form>
      </div>

      <ListSummary total={groups.length} state={paging} noun="group" />
      {!groups.length && <p className="card !p-4 text-sm text-[var(--muted)]">No likely duplicates{q || reason ? " for this search" : ""}. 🎉</p>}
      <div className="space-y-3">
        {shown.map((g) => {
          const keys = g.accounts.map((a) => `a:${a.id}`);
          const mergeHref = `/admin/clients/merge?${new URLSearchParams({ keys: keys.slice(0, 4).join(","), back })}`;
          return (
            <section key={keys.join()} className="card !p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 className="font-semibold">{g.accounts[0].name}</h2>
                <span className="text-sm text-[var(--muted)]">{g.accounts.length} accounts</span>
                {g.reasons.map((r) => (
                  <span key={r} className={`badge ${r === "same email domain" ? "badge-neutral" : "badge-warning"}`}>{r}</span>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="data-table text-sm">
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Email</th>
                      <th>Phone</th>
                      <th>Website</th>
                      <th>Contacts</th>
                      <th>Applications</th>
                      <th>Salesforce</th>
                      <th>Lead Alchemist</th>
                      <th>Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.accounts.map((a) => (
                      <tr key={a.id}>
                        <td>
                          <Link className="btn-link font-medium" href={`/admin/clients/${a.id}`}>{a.name}</Link>
                          {a.isIndividual && <span className="badge badge-neutral ml-1">Individual</span>}
                        </td>
                        <td>{a.email ?? "—"}</td>
                        <td className="whitespace-nowrap">{a.phone ?? "—"}</td>
                        <td>{a.website ?? "—"}</td>
                        <td>{a.contacts}</td>
                        <td>{a.applications}</td>
                        <td>{a.sfAccountId ? <span className="badge badge-success">Linked</span> : "—"}</td>
                        <td>{a.ghlCompanyId ? <span className="badge badge-success">Company</span> : "—"}</td>
                        <td className="whitespace-nowrap">{fmtDate(a.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Link className="btn-primary" href={mergeHref}>
                  Compare &amp; merge{g.accounts.length > 4 ? " (first 4)" : ""}
                </Link>
                <form action={notDuplicateAction}>
                  <input type="hidden" name="keys" value={keys.join(",")} />
                  <input type="hidden" name="back" value={back} />
                  <button className="btn-secondary" title="They look alike but are different businesses: stop showing them here">Not the same business</button>
                </form>
                {g.accounts.length > 4 && <span className="text-xs text-[var(--muted)]">Merge up to 4 at a time; the rest stay here until merged.</span>}
              </div>
            </section>
          );
        })}
      </div>
      <Pagination total={groups.length} state={paging} noun="group" href={href} />
    </div>
  );
}
