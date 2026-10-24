import Link from "next/link";
import { notFound } from "next/navigation";
import { fmtDate } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import { getClient, getContact } from "@/lib/clients/repo";
import { SOURCE_LABEL, type ContactChange } from "@/lib/contacts/external";
import type { NotificationStatus } from "@/lib/db/schema";
import { readFlash } from "@/lib/flash";
import { getNotification, KIND_LABELS, notificationLogFor, STATUSES } from "@/lib/notifications/repo";
import { pushContactValueAction } from "../../clients/actions";
import { FlashMessage } from "../../salesforce/ui";
import { addNotificationNoteAction, assignToMeAction, setNotificationStatusAction } from "../actions";

export const metadata = { title: "Notification | AIS Connect" };
export const dynamic = "force-dynamic";

const who = (actor: string | null | undefined) => (actor ? actor.replace(/^staff:/, "") : "system");
const label = (s: string | null) => STATUSES.find((x) => x.value === s)?.label ?? s ?? "";

export default async function NotificationPage({ params, searchParams }: PageProps<"/admin/notifications/[id]">) {
  const { id } = await params;
  await requireStaff(`/admin/notifications/${id}`);
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const n = await getNotification(id);
  if (!n) notFound();
  const sp = await searchParams;
  const flash = await readFlash(sp.f);
  const [log, account, contact] = await Promise.all([
    notificationLogFor(n.id),
    n.clientId ? getClient(n.clientId) : undefined,
    n.contactId ? getContact(n.contactId) : undefined,
  ]);
  const back = `/admin/notifications/${n.id}`;
  const change = n.kind === "contact_changed" ? ((n.data?.change as ContactChange | undefined) ?? null) : null;

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/notifications" className="btn-link">← Notifications</Link>
      <div className="mb-2 mt-3 flex flex-wrap items-center gap-2">
        <span className="badge badge-neutral">{KIND_LABELS[n.kind]}</span>
        <span className="badge badge-active">{label(n.status)}</span>
        {n.assignedTo && <span className="text-xs text-[var(--muted)]">Assigned to {n.assignedTo}</span>}
      </div>
      <h1 className="mb-2 text-2xl font-semibold">{n.title}</h1>
      {n.detail && <p className="mb-3 text-sm">{n.detail}</p>}
      <p className="mb-4 flex flex-wrap gap-3 text-sm">
        {account && <Link className="btn-link" href={`/admin/clients/${account.id}`}>Account: {account.name}</Link>}
        {contact && <span>Contact: {contact.name}</span>}
        {n.applicationId && <Link className="btn-link" href={`/admin/applications/${n.applicationId}`}>The application</Link>}
      </p>
      <FlashMessage flash={flash} />

      {change && contact && (
        <section className="card mb-4 space-y-2 !p-4 text-sm" aria-labelledby="push">
          <h2 id="push" className="font-semibold">Update the other systems?</h2>
          <p className="text-[var(--muted)]">
            The application says <strong>{change.value}</strong>. Nothing has been changed anywhere yet. Send it only where it should replace what&apos;s there.
          </p>
          <ul className="space-y-2">
            {change.differsFrom.map((d) => (
              <li key={d.source} className="flex flex-wrap items-center gap-2">
                <span>
                  {SOURCE_LABEL[d.source]} has {d.value}
                </span>
                {d.source !== "app" && (
                  <form action={pushContactValueAction}>
                    <input type="hidden" name="contactId" value={contact.id} />
                    <input type="hidden" name="target" value={d.source} />
                    <input type="hidden" name="field" value={change.field} />
                    <input type="hidden" name="value" value={change.value} />
                    <input type="hidden" name="notificationId" value={n.id} />
                    <input type="hidden" name="back" value={back} />
                    <button className="btn-secondary !py-1 text-xs">Send {change.value} to {SOURCE_LABEL[d.source]}</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card mb-4 space-y-3 !p-4" aria-labelledby="act">
        <h2 id="act" className="font-semibold">Update</h2>
        <form action={setNotificationStatusAction} className="space-y-2">
          <input type="hidden" name="id" value={n.id} />
          <input type="hidden" name="back" value={back} />
          <label className="field-label" htmlFor="note">Note (optional, saved in the log)</label>
          <textarea id="note" name="note" rows={2} className="input" maxLength={2000} />
          <div className="flex flex-wrap gap-2">
            {STATUSES.filter((s) => s.value !== n.status).map((s) => (
              <button key={s.value} name="status" value={s.value as NotificationStatus} className={s.value === "done" ? "btn-primary" : "btn-secondary"}>
                {s.value === "open" ? "Reopen" : s.value === "in_progress" ? "Start" : s.value === "done" ? "Done" : "Dismiss"}
              </button>
            ))}
          </div>
        </form>
        <div className="flex flex-wrap gap-2">
          <form action={addNotificationNoteAction} className="flex flex-1 gap-2">
            <input type="hidden" name="id" value={n.id} />
            <input type="hidden" name="back" value={back} />
            <input name="note" className="input flex-1" placeholder="Add a note without changing the status" maxLength={2000} />
            <button className="btn-secondary">Add note</button>
          </form>
          <form action={assignToMeAction}>
            <input type="hidden" name="id" value={n.id} />
            <input type="hidden" name="back" value={back} />
            {n.assignedTo && <input type="hidden" name="unassign" value="1" />}
            <button className="btn-secondary">{n.assignedTo ? "Unassign" : "Assign to me"}</button>
          </form>
        </div>
      </section>

      <section aria-labelledby="hist">
        <h2 id="hist" className="mb-2 font-semibold">History</h2>
        <ol className="space-y-2 text-sm">
          {log.map((e) => (
            <li key={e.id} className="border-l-2 border-[var(--border)] pl-3">
              <div className="text-xs text-[var(--muted)]">
                {fmtDate(e.at)} · {who(e.actor)}
              </div>
              <div>
                {e.action === "status"
                  ? `${label(e.fromStatus)} → ${label(e.toStatus)}`
                  : e.action === "created"
                    ? "Raised"
                    : e.action === "pushed"
                      ? "Sent to another system"
                      : e.action === "assigned"
                        ? "Assignment"
                        : "Note"}
                {e.note && e.action !== "created" && <span className="text-[var(--muted)]">: {e.note}</span>}
              </div>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
