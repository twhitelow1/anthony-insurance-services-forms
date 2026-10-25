import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import { companyFieldMap } from "@/lib/ghl/company-fields";
import { ghlConfig } from "@/lib/ghl/client";
import { salesforceClient } from "@/lib/salesforce/client";

export const metadata = { title: "Company fields | AIS Connect" };
export const dynamic = "force-dynamic";

/** Which Lead Alchemist Company field each Salesforce Account field fills in. */
export default async function CompanyFieldsPage() {
  await requireStaff("/admin/settings/company-fields");
  const sf = await salesforceClient();
  let error: string | null = null;
  let map: Awaited<ReturnType<typeof companyFieldMap>> | null = null;
  if (!sf) error = "Salesforce isn't connected yet (Settings → Integrations).";
  else if (!(await ghlConfig())) error = "Lead Alchemist isn't connected yet (Settings → Integrations).";
  else map = await companyFieldMap(sf).catch((err) => ((error = err instanceof Error ? err.message : String(err)), null));
  return (
    <div>
      <p className="mb-2 text-sm">
        <Link className="btn-link" href="/admin/settings#tools">← Settings</Link>
      </p>
      <h1 className="mb-1 text-2xl font-semibold">Lead Alchemist Company fields</h1>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Every Lead Alchemist sync (account page, Contacts, Mapping, Accounts → Across all three) also copies the linked Salesforce Account&apos;s
        values into its Company&apos;s custom fields. Each Company field is matched to the Salesforce Account field with the same name; Account
        Owner Alias is the Account owner&apos;s alias. Salesforce wins when they differ, an empty Salesforce value never blanks Lead Alchemist, and
        nothing is written to Salesforce. To fill a field that shows &quot;No match&quot;, give it the same name as its Salesforce field.
      </p>
      {error && <p className="mb-4 rounded-lg bg-[var(--danger-bg)] p-3 text-sm text-[var(--danger)]" role="alert">{error}</p>}
      {map && (
        <div className="card overflow-x-auto !p-0">
          <table className="data-table">
            <thead>
              <tr>
                <th>Lead Alchemist Company field</th>
                <th>Type</th>
                <th>Filled from Salesforce Account field</th>
              </tr>
            </thead>
            <tbody>
              {map.matched.map((m) => (
                <tr key={m.la.fieldKey}>
                  <td>{m.la.name}</td>
                  <td className="text-xs text-[var(--muted)]">{m.la.dataType}</td>
                  <td>
                    {m.sfLabel} <span className="text-xs text-[var(--muted)]">({m.sf})</span>
                  </td>
                </tr>
              ))}
              {map.unmatched.map((f) => (
                <tr key={f.fieldKey}>
                  <td>{f.name}</td>
                  <td className="text-xs text-[var(--muted)]">{f.dataType}</td>
                  <td><span className="badge badge-warning">No match</span></td>
                </tr>
              ))}
              {!map.matched.length && !map.unmatched.length && (
                <tr><td colSpan={3} className="text-sm text-[var(--muted)]">The Company object has no custom fields yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
