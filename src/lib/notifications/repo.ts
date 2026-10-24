import "server-only";
import { and, count, desc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Notification, NotificationKind, NotificationStatus } from "@/lib/db/schema";

/**
 * Admin notifications (Admin → Notifications). Cards move Open → In progress → Done, or are
 * Dismissed; nothing is ever deleted, and every change is logged with who and when.
 */
export const STATUSES: { value: NotificationStatus; label: string }[] = [
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "done", label: "Done" },
  { value: "dismissed", label: "Dismissed" },
];
export const ACTIVE: NotificationStatus[] = ["open", "in_progress"];

export const KIND_LABELS: Record<NotificationKind, string> = {
  contact_changed: "Contact info changed",
  sf_new_contact: "New Salesforce contact",
  unmapped: "Not mapped",
  renewal_due: "Renewal due",
  other: "Other",
};

export interface NewNotification {
  kind: NotificationKind;
  title: string;
  detail?: string | null;
  data?: Record<string, unknown> | null;
  clientId?: string | null;
  contactId?: string | null;
  applicationId?: string | null;
  /** The same key isn't raised twice while a card for it is still open or in progress. */
  dedupeKey?: string | null;
}

/** Raise a card, or return the open one for the same situation (its details are refreshed). */
export async function raiseNotification(n: NewNotification, actor = "system"): Promise<{ notification: Notification; created: boolean }> {
  const db = await getDb();
  if (n.dedupeKey) {
    const [open] = await db
      .select()
      .from(schema.notifications)
      .where(and(eq(schema.notifications.dedupeKey, n.dedupeKey), inArray(schema.notifications.status, ACTIVE)))
      .limit(1);
    if (open) {
      const [updated] = await db
        .update(schema.notifications)
        .set({ title: n.title, detail: n.detail ?? null, data: n.data ?? null, updatedAt: new Date() })
        .where(eq(schema.notifications.id, open.id))
        .returning();
      return { notification: updated, created: false };
    }
  }
  const [created] = await db
    .insert(schema.notifications)
    .values({
      kind: n.kind,
      title: n.title,
      detail: n.detail ?? null,
      data: n.data ?? null,
      clientId: n.clientId ?? null,
      contactId: n.contactId ?? null,
      applicationId: n.applicationId ?? null,
      dedupeKey: n.dedupeKey ?? null,
      updatedBy: actor,
    })
    .returning();
  await db.insert(schema.notificationLog).values({ notificationId: created.id, actor, action: "created", toStatus: "open", note: n.title });
  return { notification: created, created: true };
}

export async function getNotification(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(schema.notifications).where(eq(schema.notifications.id, id)).limit(1);
  return row;
}

export async function setNotificationStatus(id: string, status: NotificationStatus, actor: string, note?: string | null) {
  const current = await getNotification(id);
  if (!current) throw new Error("That notification no longer exists.");
  if (current.status === status && !note) return current;
  const db = await getDb();
  const [updated] = await db
    .update(schema.notifications)
    .set({ status, updatedAt: new Date(), updatedBy: actor })
    .where(eq(schema.notifications.id, id))
    .returning();
  await db
    .insert(schema.notificationLog)
    .values({ notificationId: id, actor, action: "status", fromStatus: current.status, toStatus: status, note: note?.trim() || null });
  return updated;
}

export async function addNotificationNote(id: string, actor: string, note: string, action: "note" | "pushed" = "note") {
  const text = note.trim().slice(0, 2000);
  if (!text) return;
  const db = await getDb();
  await db.insert(schema.notificationLog).values({ notificationId: id, actor, action, note: text });
  await db.update(schema.notifications).set({ updatedAt: new Date(), updatedBy: actor }).where(eq(schema.notifications.id, id));
}

export async function assignNotification(id: string, assignee: string | null, actor: string) {
  const db = await getDb();
  await db.update(schema.notifications).set({ assignedTo: assignee, updatedAt: new Date(), updatedBy: actor }).where(eq(schema.notifications.id, id));
  await db.insert(schema.notificationLog).values({ notificationId: id, actor, action: "assigned", note: assignee ? `Assigned to ${assignee}` : "Unassigned" });
}

export interface NotificationFilter {
  status?: NotificationStatus[];
  kind?: NotificationKind;
  clientId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

function notificationWhere(f: NotificationFilter) {
  const where: SQL[] = [];
  if (f.status?.length) where.push(inArray(schema.notifications.status, f.status));
  if (f.kind) where.push(eq(schema.notifications.kind, f.kind));
  if (f.clientId) where.push(eq(schema.notifications.clientId, f.clientId));
  if (f.q?.trim()) {
    const like = `%${f.q.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(or(ilike(schema.notifications.title, like), ilike(schema.notifications.detail, like))!);
  }
  return where.length ? and(...where) : undefined;
}

export async function listNotifications(f: NotificationFilter = {}) {
  const db = await getDb();
  return db
    .select({ n: schema.notifications, accountName: schema.clients.name })
    .from(schema.notifications)
    .leftJoin(schema.clients, eq(schema.clients.id, schema.notifications.clientId))
    .where(notificationWhere(f))
    .orderBy(desc(schema.notifications.updatedAt))
    .limit(f.limit ?? 300)
    .offset(f.offset ?? 0);
}

export async function countNotifications(f: NotificationFilter = {}) {
  const db = await getDb();
  return db.$count(schema.notifications, notificationWhere(f));
}

/** How many notifications are in each status (for the board's column totals). */
export async function countByStatus(f: Omit<NotificationFilter, "status"> = {}) {
  const counts = await Promise.all(STATUSES.map(async (s) => [s.value, await countNotifications({ ...f, status: [s.value] })] as const));
  return Object.fromEntries(counts) as Record<NotificationStatus, number>;
}

export async function countActive(clientId?: string) {
  const db = await getDb();
  const [row] = await db
    .select({ n: count() })
    .from(schema.notifications)
    .where(and(inArray(schema.notifications.status, ACTIVE), clientId ? eq(schema.notifications.clientId, clientId) : undefined));
  return row.n;
}

export async function notificationLogFor(id: string) {
  const db = await getDb();
  return db.select().from(schema.notificationLog).where(eq(schema.notificationLog.notificationId, id)).orderBy(desc(schema.notificationLog.at));
}

/** The whole log, newest first, with each card's title. */
export async function countNotificationLog() {
  const db = await getDb();
  return db.$count(schema.notificationLog);
}

export async function recentNotificationLog(limit = 200, offset = 0) {
  const db = await getDb();
  return db
    .select({ entry: schema.notificationLog, title: schema.notifications.title, clientId: schema.notifications.clientId })
    .from(schema.notificationLog)
    .innerJoin(schema.notifications, eq(schema.notifications.id, schema.notificationLog.notificationId))
    .orderBy(desc(schema.notificationLog.at))
    .limit(limit)
    .offset(offset);
}
