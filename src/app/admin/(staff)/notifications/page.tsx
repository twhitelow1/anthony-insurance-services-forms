import Link from "next/link";
import { fmtDate } from "@/components/portal";
import { requireStaff } from "@/lib/auth/session";
import type { NotificationKind, NotificationStatus } from "@/lib/db/schema";
import { readFlash } from "@/lib/flash";
import { countByStatus, countNotificationLog, countNotifications, KIND_LABELS, listNotifications, recentNotificationLog, STATUSES } from "@/lib/notifications/repo";
import { ListSummary, pageHref, pageState, Pagination } from "@/components/Pagination";
import { FlashMessage } from "../salesforce/ui";
import { setNotificationStatusAction } from "./actions";

export const metadata = { title: "Notifications | AIS Connect" };
export const dynamic = "force-dynamic";

const VIEWS = ["board", "list", "log"] as const;
type View = (typeof VIEWS)[number];

const TONE: Record<NotificationStatus, string> = {
  open: "badge-warning",
  in_progress: "badge-active",
  done: "badge-success",
  dismissed: "badge-neutral",
};

/** The buttons that move a card on from its current status. */
const NEXT: Record<NotificationStatus, { status: NotificationStatus; label: string }[]> = {
  open: [
    { status: "in_progress", label: "Start" },
    { status: "done", label: "Done" },
    { status: "dismissed", label: "Dismiss" },
  ],
  in_progress: [
    { status: "done", label: "Done" },
    { status: "dismissed", label: "Dismiss" },
    { status: "open", label: "Back to open" },
  ],
  done: [{ status: "open", label: "Reopen" }],
  dismissed: [{ status: "open", label: "Reopen" }],
};

const who = (actor: string | null | undefined) => (actor ? actor.replace(/^staff:/, "") : "system");

export default async function Notifications({ searchParams }: PageProps<"/admin/notifications">) {
  await requireStaff("/admin/notifications");
  const sp = await searchParams;
  const view: View = VIEWS.includes(sp.view as View) ? (sp.view as View) : "board";
  const kind = typeof sp.kind === "string" && sp.kind in KIND_LABELS ? (sp.kind as NotificationKind) : undefined;
  const flash = await readFlash(sp.f);
  const back = `/admin/notifications?view=${view}${kind ? `&kind=${kind}` : ""}`;
  const qs = (over: Record<string, string>) => `?${new URLSearchParams({ view, ...(kind ? { kind } : {}), ...over })}`;

  const paging = pageState(sp);
  const BOARD_CAP = 50;
  const [rows, total, columnTotals, log, logTotal] = await Promise.all([
    view === "board"
      ? Promise.all(STATUSES.map((s) => listNotifications({ kind, status: [s.value], limit: BOARD_CAP }))).then((cols) => cols.flat())
      : view === "list"
        ? listNotifications({ kind, limit: paging.pageSize, offset: paging.offset })
        : [],
    view === "list" ? countNotifications({ kind }) : 0,
    view === "board" ? countByStatus({ kind }) : null,
    view === "log" ? recentNotificationLog(paging.pageSize, paging.offset) : [],
    view === "log" ? countNotificationLog() : 0,
  ]);
  const href = pageHref("/admin/notifications", { view, kind });

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Notifications</h1>
        <nav className="flex flex-wrap gap-2" aria-label="View">
          {VIEWS.map((v) => (
            <Link key={v} href={qs({ view: v })} className={v === view ? "btn-primary" : "btn-secondary"} aria-current={v === view ? "page" : undefined}>
              {v === "board" ? "Board" : v === "list" ? "List" : "Log"}
            </Link>
          ))}
        </nav>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-[var(--muted)]">
        Things to check: contact details on an application that differ from Salesforce or Lead Alchemist, new Salesforce contacts, and
        similar. Move each card along or dismiss it; nothing is deleted, and the log keeps who did what and when.
      </p>
      <FlashMessage flash={flash} />

      {view !== "log" && (
        <div className="mb-4 flex flex-wrap gap-2 text-sm">
          <Link href={`?view=${view}`} className={!kind ? "badge badge-active" : "badge badge-neutral"}>All</Link>
          {(Object.keys(KIND_LABELS) as NotificationKind[]).map((k) => (
            <Link key={k} href={qs({ kind: k })} className={kind === k ? "badge badge-active" : "badge badge-neutral"}>
              {KIND_LABELS[k]}
            </Link>
          ))}
        </div>
      )}

      {view === "board" && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {STATUSES.map((s) => {
            const cards = rows.filter((r) => r.n.status === s.value);
            const columnTotal = columnTotals?.[s.value] ?? cards.length;
            return (
              <section key={s.value} className="rounded-xl border border-[var(--border)] bg-[var(--track)] p-3" aria-labelledby={`col-${s.value}`}>
                <h2 id={`col-${s.value}`} className="mb-3 flex items-center justify-between text-sm font-semibold">
                  {s.label} <span className={`badge ${TONE[s.value]}`}>{columnTotal.toLocaleString("en-US")}</span>
                </h2>
                <div className="space-y-3">
                  {!cards.length && <p className="text-xs text-[var(--muted)]">Nothing here.</p>}
                  {columnTotal > cards.length && (
                    <p className="text-xs text-[var(--muted)]">
                      Showing the newest {cards.length} of {columnTotal.toLocaleString("en-US")}.{" "}
                      <Link className="btn-link" href={qs({ view: "list" })}>See them all in the list</Link>
                    </p>
                  )}
                  {cards.map(({ n, accountName }) => (
                    <article key={n.id} className="card space-y-2 !p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="badge badge-neutral">{KIND_LABELS[n.kind]}</span>
                        {n.assignedTo && <span className="text-xs text-[var(--muted)]">{n.assignedTo}</span>}
                      </div>
                      <Link className="btn-link font-medium" href={`/admin/notifications/${n.id}`}>{n.title}</Link>
                      {accountName && n.clientId && (
                        <div className="text-xs">
                          <Link className="btn-link" href={`/admin/clients/${n.clientId}`}>{accountName}</Link>
                        </div>
                      )}
                      {n.detail && <p className="line-clamp-3 text-xs text-[var(--muted)]">{n.detail}</p>}
                      <p className="text-xs text-[var(--muted)]">
                        {fmtDate(n.updatedAt)} · {who(n.updatedBy)}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {NEXT[n.status].map((b) => (
                          <form key={b.status} action={setNotificationStatusAction}>
                            <input type="hidden" name="id" value={n.id} />
                            <input type="hidden" name="status" value={b.status} />
                            <input type="hidden" name="back" value={back} />
                            <button className="btn-secondary !px-2 !py-1 text-xs">{b.label}</button>
                          </form>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {view === "list" && <ListSummary total={total} state={paging} noun="notification" />}
      {view === "list" && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>Notification</th>
                <th>Account</th>
                <th>Status</th>
                <th>Last change</th>
              </tr>
            </thead>
            <tbody>
              {!rows.length && (
                <tr>
                  <td colSpan={4} className="text-[var(--muted)]">No notifications.</td>
                </tr>
              )}
              {rows.map(({ n, accountName }) => (
                <tr key={n.id}>
                  <td>
                    <Link className="btn-link font-medium" href={`/admin/notifications/${n.id}`}>{n.title}</Link>
                    <div className="text-xs text-[var(--muted)]">{KIND_LABELS[n.kind]}</div>
                  </td>
                  <td>{n.clientId && accountName ? <Link className="btn-link" href={`/admin/clients/${n.clientId}`}>{accountName}</Link> : "—"}</td>
                  <td>
                    <span className={`badge ${TONE[n.status]}`}>{STATUSES.find((s) => s.value === n.status)?.label}</span>
                  </td>
                  <td className="text-xs">
                    {fmtDate(n.updatedAt)}
                    <div className="text-[var(--muted)]">{who(n.updatedBy)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === "list" && <Pagination total={total} state={paging} noun="notification" href={href} />}

      {view === "log" && <ListSummary total={logTotal} state={paging} noun="log entry" />}
      {view === "log" && (
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>What</th>
                <th>Notification</th>
              </tr>
            </thead>
            <tbody>
              {!log.length && (
                <tr>
                  <td colSpan={4} className="text-[var(--muted)]">Nothing logged yet.</td>
                </tr>
              )}
              {log.map(({ entry, title }) => (
                <tr key={entry.id}>
                  <td className="whitespace-nowrap text-xs">{fmtDate(entry.at)}</td>
                  <td className="text-xs">{who(entry.actor)}</td>
                  <td className="text-sm">
                    {entry.action === "status"
                      ? `${STATUSES.find((s) => s.value === entry.fromStatus)?.label ?? entry.fromStatus} → ${STATUSES.find((s) => s.value === entry.toStatus)?.label ?? entry.toStatus}`
                      : entry.action === "created"
                        ? "Raised"
                        : entry.action === "pushed"
                          ? "Pushed"
                          : entry.action === "assigned"
                            ? "Assigned"
                            : "Note"}
                    {entry.note && entry.action !== "created" && <div className="text-xs text-[var(--muted)]">{entry.note}</div>}
                  </td>
                  <td>
                    <Link className="btn-link text-sm" href={`/admin/notifications/${entry.notificationId}`}>{title}</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {view === "log" && <Pagination total={logTotal} state={paging} noun="log entry" href={href} />}
    </div>
  );
}
