import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { getContact } from "@/lib/clients/repo";
import { laDetailDifferences, type LaDetailRow } from "@/lib/contacts/external";
import { readFlash } from "@/lib/flash";
import { links } from "@/lib/integrations/links";
import { FlashMessage } from "../../../../../salesforce/ui";
import { updateLaPickedAction } from "../../../../actions";

export const metadata = { title: "Update in Lead Alchemist | AIS Connect" };
export const dynamic = "force-dynamic";

const STATUS: Record<LaDetailRow["status"], { text: string; tone: string }> = {
  differs: { text: "Different", tone: "badge-warning" },
  fill: { text: "Empty in Lead Alchemist", tone: "badge-active" },
  same: { text: "Same", tone: "badge-success" },
  nothing: { text: "Not in AIS Connect", tone: "badge-neutral" },
};

/** Field by field: what AIS Connect has, what Lead Alchemist has; staff tick what to write. */
export default async function ReviewLeadAlchemist({ params, searchParams }: PageProps<"/admin/clients/[id]/contacts/[contactId]/lead-alchemist">) {
  const { id, contactId } = await params;
  await requireStaff(`/admin/clients/${id}`);
  const contact = await getContact(contactId);
  if (!contact || contact.clientId !== id) notFound();
  const flash = await readFlash((await searchParams).f);
  let rows: LaDetailRow[] = [];
  let error: string | null = null;
  try {
    rows = (await laDetailDifferences(contactId)).rows;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  const l = await links();
  const changeable = rows.filter((r) => r.status === "fill" || r.status === "differs");

  return (
    <div className="max-w-4xl">
      <Link href={`/admin/clients/${id}`} className="btn-link">← Back to the account</Link>
      <h1 className="mb-2 mt-3 text-2xl font-semibold">Update {contact.name} in Lead Alchemist</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        AIS Connect&apos;s details next to the Lead Alchemist contact&apos;s. Tick what to write to Lead Alchemist and press Update; anything not ticked stays as it is
        there. Nothing is deleted, and the change is logged on the account.
        {contact.ghlContactId && (
          <>
            {" "}
            <a className="btn-link" href={l.ghlContact(contact.ghlContactId) ?? undefined} target="_blank" rel="noopener">Open in Lead Alchemist</a>
          </>
        )}
      </p>
      <FlashMessage flash={flash} />
      {error ? (
        <p className="callout text-sm" role="alert">{error}</p>
      ) : (
        <form action={updateLaPickedAction}>
          <input type="hidden" name="contactId" value={contact.id} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-[var(--muted)]">
                  <th className="py-2 pr-2">Update</th>
                  <th className="py-2 pr-2">Field</th>
                  <th className="py-2 pr-2">AIS Connect</th>
                  <th className="py-2 pr-2">Lead Alchemist now</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const can = r.status === "fill" || r.status === "differs";
                  return (
                    <tr key={r.field} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-2">
                        {can ? (
                          <input type="checkbox" name="field" value={r.field} defaultChecked={r.status === "fill"} aria-label={`Update ${r.label}`} />
                        ) : null}
                      </td>
                      <td className="py-2 pr-2 capitalize">{r.label}</td>
                      <td className="py-2 pr-2 font-medium">{r.ais ?? <span className="text-[var(--muted)]">(empty)</span>}</td>
                      <td className="py-2 pr-2">{r.la ?? <span className="text-[var(--muted)]">(empty)</span>}</td>
                      <td className="py-2">
                        <span className={`badge ${STATUS[r.status].tone}`}>{STATUS[r.status].text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button className="btn-primary">Update ticked fields in Lead Alchemist</button>
            <span className="text-sm text-[var(--muted)]">
              {changeable.length ? `${changeable.length} field${changeable.length === 1 ? "" : "s"} can be updated. Empty ones are ticked; tick the differences you want replaced.` : "Lead Alchemist already matches AIS Connect."}
            </span>
          </div>
        </form>
      )}
    </div>
  );
}
