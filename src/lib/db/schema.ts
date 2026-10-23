import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { FormValues } from "@/lib/forms/types";
import type { ApplicationStatus } from "@/lib/applications/status";
import type { AiReview } from "@/lib/ai/review";

/**
 * One client or prospect: the person or business behind one or more applications.
 * Grouped by email (client_emails), so a client can have several emails, and staff
 * can merge two records or split one. Holds the IDs that link it to Salesforce and
 * Lead Alchemist. Contact details are copied from their latest application.
 */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Business name, else the person's name. */
    name: text("name").notNull(),
    contactName: text("contact_name"),
    primaryEmail: text("primary_email").notNull(),
    /** As typed on the applications, newest first. */
    phones: jsonb("phones").$type<string[]>().notNull().default([]),
    address: jsonb("address").$type<ClientAddress>(),
    /** Lower-cased name, business, emails and phone digits, for the Clients search. */
    searchText: text("search_text").notNull().default(""),

    sfAccountId: text("sf_account_id"),
    sfContactId: text("sf_contact_id"),
    /** not_synced · linked · needs_review · error */
    sfStatus: text("sf_status").$type<SalesforceStatus>().notNull().default("not_synced"),
    sfSyncedAt: timestamp("sf_synced_at", { withTimezone: true }),
    sfLastError: text("sf_last_error"),
    /** Lead Alchemist Company (Business). Only set once Companies are connected. */
    ghlCompanyId: text("ghl_company_id"),

    /** Set when this record was merged into another; it no longer shows in lists. */
    mergedInto: uuid("merged_into"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("clients_updated_idx").on(t.updatedAt), index("clients_sf_account_idx").on(t.sfAccountId)],
);

export interface ClientAddress {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}
export type SalesforceStatus = "not_synced" | "linked" | "needs_review" | "error";

/** Every email that belongs to a client (lower-cased). An email belongs to one client. */
export const clientEmails = pgTable(
  "client_emails",
  {
    email: text("email").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("client_emails_client_idx").on(t.clientId)],
);

export type ClientEventType = "created" | "merged" | "split" | "staff_note" | "sf_synced" | "sf_sync_failed" | "sf_needs_review" | "sf_linked";

/** Audit log and notes for a client (merges, splits, syncs, staff notes). */
export const clientEvents = pgTable(
  "client_events",
  {
    id: serial("id").primaryKey(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    type: text("type").$type<ClientEventType>().notNull(),
    /** "system" or "staff:<email>" */
    actor: text("actor").notNull(),
    message: text("message"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("client_events_client_idx").on(t.clientId, t.createdAt)],
);

/**
 * Background work that must not hold up an applicant (Salesforce sync for now).
 * Retried with backoff; failures stay visible in the admin with a retry button.
 */
export const syncJobs = pgTable(
  "sync_jobs",
  {
    id: serial("id").primaryKey(),
    /** "salesforce_application" (target = application ID) */
    kind: text("kind").$type<SyncJobKind>().notNull(),
    targetId: text("target_id").notNull(),
    /** pending · running · done · failed */
    status: text("status").$type<"pending" | "running" | "done" | "failed">().notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    lastError: text("last_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_jobs_due_idx").on(t.status, t.nextAttemptAt), index("sync_jobs_target_idx").on(t.kind, t.targetId)],
);
export type SyncJobKind = "salesforce_application";

/**
 * The one-time Salesforce backfill's report: one row per Salesforce Account per run
 * (matched, new, ambiguous, skipped), downloaded as CSV for review before applying.
 */
export const salesforceBackfillRows = pgTable(
  "salesforce_backfill_rows",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull(),
    mode: text("mode").$type<"dry_run" | "apply">().notNull(),
    accountId: text("account_id").notNull(),
    accountName: text("account_name"),
    /** Contact emails on the Account (lower-cased). */
    emails: jsonb("emails").$type<string[]>().notNull().default([]),
    /** matched · new · ambiguous · skipped · error */
    outcome: text("outcome").$type<BackfillOutcome>().notNull(),
    clientId: uuid("client_id"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sf_backfill_run_idx").on(t.runId, t.id)],
);
export type BackfillOutcome = "matched" | "new" | "ambiguous" | "skipped" | "error";

/**
 * The application itself lives here — Lead Alchemist only gets the contact plus a link back.
 */
export const applications = pgTable(
  "applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-friendly, non-guessable reference shown to clients and staff, e.g. "AIS-7K3Q-9XF2". */
    reference: text("reference").notNull().unique(),
    formSlug: text("form_slug").notNull(),
    status: text("status").$type<ApplicationStatus>().notNull().default("received"),

    applicantEmail: text("applicant_email").notNull(), // lower-cased; the client's login identity
    applicantName: text("applicant_name").notNull(),
    businessName: text("business_name"),
    state: text("state"),

    values: jsonb("values").$type<FormValues>().notNull(),
    /** PNG data URL of the drawn signature. Kept apart from `values` so lists never load it. */
    signature: text("signature"),
    /** Flattened text of the whole application, used for full-text search. */
    searchText: text("search_text").notNull(),

    /** Claude's pre-review for the agent (summary, flags, follow-ups). Staff-only. */
    aiReview: jsonb("ai_review").$type<AiReview>(),
    /** Count of high-severity flags, so list views can show it without loading the review. */
    aiHighFlags: integer("ai_high_flags"),

    ghlContactId: text("ghl_contact_id"),
    ghlOpportunityId: text("ghl_opportunity_id"),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),

    /** Salesforce: this application's Opportunity (one per application / policy year). */
    sfOpportunityId: text("sf_opportunity_id"),
    /** not_synced · pending · synced · needs_review · error · skipped */
    sfSyncStatus: text("sf_sync_status").$type<ApplicationSfStatus>().notNull().default("not_synced"),
    sfSyncedAt: timestamp("sf_synced_at", { withTimezone: true }),
    sfLastError: text("sf_last_error"),
    /** SHA-256 of the PDF last uploaded to the Account, so the same file isn't uploaded twice. */
    sfPdfHash: text("sf_pdf_hash"),
    sfContentVersionId: text("sf_content_version_id"),
    sfFeedItemId: text("sf_feed_item_id"),
    /** When the "links" note went onto the Lead Alchemist contact (once per application). */
    ghlLinksNotedAt: timestamp("ghl_links_noted_at", { withTimezone: true }),
    /** Submitted by staff in testing mode (required fields skipped). Labeled TEST; tagged `test` in Lead Alchemist. */
    isTest: boolean("is_test").notNull().default(false),
    submittedIp: text("submitted_ip"),
    submittedUserAgent: text("submitted_user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("applications_email_idx").on(t.applicantEmail),
    index("applications_client_idx").on(t.clientId),
    index("applications_status_idx").on(t.status),
    index("applications_created_idx").on(t.createdAt),
    index("applications_search_idx").using("gin", sql`to_tsvector('english', ${t.searchText})`),
  ],
);

export type EventType =
  | "submitted"
  | "status_changed"
  | "staff_note"
  | "ghl_synced"
  | "ghl_sync_failed"
  | "email_sent"
  | "email_failed"
  | "ai_reviewed"
  | "ai_review_failed"
  | "carrier_email_prepared"
  | "pdf_created"
  | "pdf_failed"
  | "answers_edited"
  | "sf_synced"
  | "sf_sync_failed"
  | "sf_needs_review"
  | "sf_dry_run";

export type ApplicationSfStatus = "not_synced" | "pending" | "synced" | "needs_review" | "error" | "skipped";

/** Append-only history: status timeline for the client, audit log for staff. */
export const applicationEvents = pgTable(
  "application_events",
  {
    id: serial("id").primaryKey(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    type: text("type").$type<EventType>().notNull(),
    /** "system", "client:<email>", or "staff:<email>" */
    actor: text("actor").notNull(),
    /** Shown to the client on their timeline when true. */
    clientVisible: boolean("client_visible").notNull().default(false),
    message: text("message"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_events_app_idx").on(t.applicationId, t.createdAt)],
);

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (v) => Buffer.from(v),
});

/**
 * Generated files for an application (the application PDF; later the filled
 * carrier form). Stored in Postgres so they're private by default — served only
 * to staff or the applicant through /documents/<id>.
 */
export const applicationDocuments = pgTable(
  "application_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => applications.id, { onDelete: "cascade" }),
    /** "carrier_form" (the carrier's application, filled) or "application_pdf" (answer summary). */
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    content: bytea("content").notNull(),
    size: integer("size").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("application_documents_app_idx").on(t.applicationId, t.createdAt)],
);

/**
 * One row per applicant email, linking them to their Lead Alchemist contact so
 * every application from the same email lands on the same Lead Alchemist contact, even
 * if staff later change details in Lead Alchemist. (Each application has its own opportunity.)
 */
export const applicants = pgTable("applicants", {
  email: text("email").primaryKey(), // lower-cased, same as applications.applicant_email
  ghlContactId: text("ghl_contact_id"),
  ghlLinkedAt: timestamp("ghl_linked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Unfinished applications ("Started"): progress saved on the server so the
 * applicant can resume on any device, and Lead Alchemist can follow up. The
 * signature is never stored here. Resume links carry a token; only its hash is kept.
 */
export const drafts = pgTable(
  "drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull(),
    formSlug: text("form_slug").notNull(),
    email: text("email"), // lower-cased, once the applicant has typed a valid one
    name: text("name"),
    businessName: text("business_name"),
    values: jsonb("values").$type<FormValues>().notNull(),
    step: integer("step").notNull().default(0),
    /** "started" until submitted. */
    status: text("status").$type<"started" | "submitted">().notNull().default("started"),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "set null" }),
    ghlContactId: text("ghl_contact_id"),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    resumeEmailedAt: timestamp("resume_emailed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("drafts_status_idx").on(t.status, t.updatedAt), index("drafts_email_idx").on(t.email)],
);

/**
 * Document library (Admin → Documents): sample waivers, risk-management guides
 * and other files staff upload once and assign to forms. Assigned documents are
 * offered to applicants on the form and linked in their confirmation email.
 */
export const libraryFiles = pgTable("library_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  content: bytea("content").notNull(),
  size: integer("size").notNull(),
  /** Form slugs this document is assigned to. */
  formSlugs: jsonb("form_slugs").$type<string[]>().notNull().default([]),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Files an applicant attached while filling in a form (e.g. waivers), kept here until
 * they submit; then they're copied onto the application as "applicant_upload" documents
 * and removed from here. Unsubmitted ones can be cleared out after a while.
 */
export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  formSlug: text("form_slug").notNull(),
  fieldId: text("field_id").notNull(),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  content: bytea("content").notNull(),
  size: integer("size").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Settings staff edit in Admin → Settings (see src/lib/settings.ts). One row per setting. */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").$type<unknown>().notNull(),
  /** "staff:<email>" */
  updatedBy: text("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One-time sign-in links for clients. Only a SHA-256 hash of the token is stored. */
export const loginTokens = pgTable("login_tokens", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  /** "client" links open the client portal; "staff" links open the admin portal. Never interchangeable. */
  purpose: text("purpose").$type<"client" | "staff">().notNull().default("client"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Application = typeof applications.$inferSelect;
export type ApplicationEvent = typeof applicationEvents.$inferSelect;
export type ApplicationDocument = typeof applicationDocuments.$inferSelect;
export type Applicant = typeof applicants.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type LibraryFile = typeof libraryFiles.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type ClientEvent = typeof clientEvents.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
