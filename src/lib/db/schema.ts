import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";
import { boolean, index, integer, jsonb, pgTable, primaryKey, serial, text, timestamp, uniqueIndex, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { FormValues } from "@/lib/forms/types";
import type { ApplicationStatus } from "@/lib/applications/status";
import type { AiReview } from "@/lib/ai/review";
import type { ContactTally } from "@/lib/bulk/tally";

/**
 * An Account: the business behind one or more applications (an individual instructor's
 * Account is named after them). Its people are Contacts (below), and each application
 * records the Account it's for and the Contact who filled it out. Holds the IDs that link
 * it to the Salesforce Account and the Lead Alchemist Company. The table keeps its original
 * name, "clients".
 */
export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Business name, else the person's name. */
    name: text("name").notNull(),
    /** Superseded by contacts; kept for older rows. */
    contactName: text("contact_name"),
    /** The main contact's email, for display and search. Empty for Accounts imported without one. */
    primaryEmail: text("primary_email"),
    /** A person applying for themselves (no business name). */
    isIndividual: boolean("is_individual").notNull().default(false),
    /** Lower-cased business name without punctuation or LLC/Inc, for matching. */
    nameKey: text("name_key").notNull().default(""),
    website: text("website"),
    /** Set when a new Account shares a name with this one but nothing else: staff confirm or merge. */
    possibleDuplicateOf: uuid("possible_duplicate_of"),
    /** As typed on the applications, newest first. */
    phones: jsonb("phones").$type<string[]>().notNull().default([]),
    address: jsonb("address").$type<ClientAddress>(),
    /** Lower-cased name, business, emails and phone digits, for the Clients search. */
    searchText: text("search_text").notNull().default(""),

    sfAccountId: text("sf_account_id"),
    /** Superseded by contacts.sf_contact_id; kept for older rows. */
    sfContactId: text("sf_contact_id"),
    /** not_synced · linked · needs_review · error */
    sfStatus: text("sf_status").$type<SalesforceStatus>().notNull().default("not_synced"),
    sfSyncedAt: timestamp("sf_synced_at", { withTimezone: true }),
    sfLastError: text("sf_last_error"),
    /** Lead Alchemist Company (Business). Only set once Companies are connected. */
    ghlCompanyId: text("ghl_company_id"),
    /** Unsynced on the Salesforce screen: stays linked, but nothing syncs either way until synced again. */
    sfSyncPaused: boolean("sf_sync_paused").notNull().default(false),
    /** Last time this Account's Salesforce details were read (Refresh from Salesforce). */
    sfPulledAt: timestamp("sf_pulled_at", { withTimezone: true }),
    /** What Salesforce says about this Account, as last read. Shown beside the app's values, never copied over them. */
    sfSnapshot: jsonb("sf_snapshot").$type<SfAccountSnapshot>(),
    /**
     * The Salesforce Account Type (e.g. Customer, Prospect): the account's status everywhere.
     * Salesforce is the only place it changes; the app reads it and passes it to Lead Alchemist.
     */
    sfAccountType: text("sf_account_type"),
    /** Where this account first came from (see RecordSource). Set once, when it's created. */
    source: text("source").$type<RecordSource>().notNull().default("manual"),
    /**
     * Client tier: the account's one primary contact (every other contact on it is secondary).
     * One column, so an account can never have two primaries.
     */
    primaryContactId: uuid("primary_contact_id").references((): AnyPgColumn => contacts.id, { onDelete: "set null" }),
    /** The primary was picked automatically (first contact of several): staff should check it. */
    primaryReview: boolean("primary_review").notNull().default(false),

    /** Set when this record was merged into another; it no longer shows in lists. */
    mergedInto: uuid("merged_into"),
    /**
     * Deactivated in this app (never deleted): hidden from lists and imports, kept with its
     * Salesforce link and history, and can be reactivated. Only an unsynced account can be deactivated.
     */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    deactivatedBy: text("deactivated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("clients_updated_idx").on(t.updatedAt),
    index("clients_sf_account_idx").on(t.sfAccountId),
    index("clients_name_key_idx").on(t.nameKey),
    index("clients_ghl_company_idx").on(t.ghlCompanyId),
    index("clients_primary_contact_idx").on(t.primaryContactId),
  ],
);

/**
 * Where an account or contact first came into AIS Connect: imported from Salesforce or Lead
 * Alchemist, from an application (or unfinished one), or added by staff in AIS Connect.
 */
export type RecordSource = "salesforce" | "lead_alchemist" | "application" | "manual";
export const RECORD_SOURCE_LABEL: Record<RecordSource, string> = {
  salesforce: "Salesforce",
  lead_alchemist: "Lead Alchemist",
  application: "AIS Connect (application)",
  manual: "AIS Connect (added by staff)",
};

/** The Salesforce Account as last read: contact details and the policy fields used for renewals. */
export interface SfAccountSnapshot {
  name: string;
  type?: string | null;
  phone: string | null;
  website: string | null;
  address: string | null;
  program: string | null;
  legalEntity: string | null;
  effectiveDate: string | null;
  expirationDate: string | null;
  renewalStatus: string | null;
  annualPremium: number | null;
  ownerName: string | null;
}

export interface ClientAddress {
  street?: string;
  city?: string;
  state?: string;
  postalCode?: string;
}
/** create_confirmed: staff chose "create new" on the mapping screen, so the next sync creates the Account without matching. */
export type SalesforceStatus = "not_synced" | "linked" | "needs_review" | "error" | "create_confirmed";

/**
 * A person at an Account: whoever fills out an application, or a Contact imported from
 * Salesforce. One record per person (by email); their home Account is client_id, and
 * they can also have filled out applications for other Accounts.
 */
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    firstName: text("first_name"),
    lastName: text("last_name"),
    name: text("name").notNull(),
    title: text("title"),
    primaryEmail: text("primary_email"),
    phones: jsonb("phones").$type<string[]>().notNull().default([]),
    sfContactId: text("sf_contact_id"),
    /** Where this person first came from (see RecordSource). Set once, when they're created. */
    source: text("source").$type<RecordSource>().notNull().default("manual"),
    /** Unsynced on the Salesforce screen: stays linked, but isn't updated from Salesforce. */
    sfSyncPaused: boolean("sf_sync_paused").notNull().default(false),
    /** The linked Salesforce Contact's email and phone as last read. Shown beside the app's, never copied over them. */
    sfEmail: text("sf_email"),
    sfPhone: text("sf_phone"),
    /** The linked Lead Alchemist contact's email and phone as last read. */
    laEmail: text("la_email"),
    laPhone: text("la_phone"),
    /** When the Salesforce / Lead Alchemist values above were last read. */
    externalCheckedAt: timestamp("external_checked_at", { withTimezone: true }),
    /** The Lead Alchemist contact. */
    ghlContactId: text("ghl_contact_id"),
    /**
     * For contacts not linked yet: the Lead Alchemist contact found by "Find Lead Alchemist matches"
     * (one exact email or phone match), or null. Only a suggestion until staff link it.
     */
    laMatchId: text("la_match_id"),
    laMatchName: text("la_match_name"),
    /** "email", "phone", "email+phone", or "several" when more than one Lead Alchemist contact matched. */
    laMatchHow: text("la_match_how"),
    laMatchCheckedAt: timestamp("la_match_checked_at", { withTimezone: true }),
    /** A Lead Alchemist contact staff said is NOT this person: never suggested or auto-linked again. */
    laMatchDeniedId: text("la_match_denied_id"),
    searchText: text("search_text").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("contacts_client_idx").on(t.clientId),
    index("contacts_sf_idx").on(t.sfContactId),
    index("contacts_ghl_idx").on(t.ghlContactId),
    index("contacts_lower_name_idx").on(sql`lower(${t.name})`),
  ],
);

/**
 * A person who also works with another Account besides their home one (e.g. an instructor who
 * teaches at several studios). Added by staff, or by an application for that Account. In Lead
 * Alchemist a contact sits in one Company; the others go on the contact as "company:" tags.
 */
export const accountContacts = pgTable(
  "account_contacts",
  {
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    role: text("role"),
    addedBy: text("added_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.clientId, t.contactId] }), index("account_contacts_contact_idx").on(t.contactId)],
);

/**
 * The contacts directory: every Salesforce Contact and Lead Alchemist contact, as last imported
 * (Contacts page → Refresh), matched to the app's contact when there is one (by its saved link,
 * else the same email, else the same phone). A copy for listing and filtering only: the app
 * never edits Salesforce or Lead Alchemist from it except through the sync actions.
 */
export const directoryContacts = pgTable(
  "directory_contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** "salesforce" or "lead_alchemist". */
    source: text("source").$type<"salesforce" | "lead_alchemist">().notNull(),
    externalId: text("external_id").notNull(),
    name: text("name").notNull().default(""),
    /** Lower-cased. */
    email: text("email"),
    /** Last 10 digits. */
    phone: text("phone"),
    /** The Salesforce Account / Lead Alchemist Company the contact is attached to. */
    companyId: text("company_id"),
    companyName: text("company_name"),
    /** nameKey(companyName), to match it to a Lead Alchemist Company. */
    companyKey: text("company_key"),
    /** The app's contact for this person, if any. */
    appContactId: uuid("app_contact_id").references(() => contacts.id, { onDelete: "set null" }),
    /** "linked" (saved link), "email" or "phone". */
    matchHow: text("match_how"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("directory_contacts_source_ext_idx").on(t.source, t.externalId),
    index("directory_contacts_app_idx").on(t.appContactId),
    index("directory_contacts_email_idx").on(t.email),
    index("directory_contacts_phone_idx").on(t.phone),
    index("directory_contacts_lower_name_idx").on(sql`lower(${t.name})`),
    index("directory_contacts_company_idx").on(t.source, t.companyId),
  ],
);

export type DirectoryContact = typeof directoryContacts.$inferSelect;

/**
 * Records staff said are different businesses despite looking alike ("Not the same business" on
 * the merge screen), so they aren't suggested as a match again. `pair` is the two row keys
 * (e.g. "a:<id>" and "s:<id>"), sorted and joined with "|".
 */
export const notDuplicates = pgTable("not_duplicates", {
  pair: text("pair").primaryKey(),
  decidedBy: text("decided_by").notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Lead Alchemist Companies hidden in AIS Connect after a merge picked another Company (their
 * contacts were moved to the kept one). They stay in Lead Alchemist; nothing is deleted there.
 */
export const leadAlchemistHidden = pgTable("lead_alchemist_hidden", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  /** The Company kept instead. */
  keptId: text("kept_id"),
  hiddenBy: text("hidden_by").notNull(),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Salesforce Accounts, copied by Refresh on the Accounts page ("Across all three"), so it can list
 * and match Accounts that aren't in AIS Connect without calling Salesforce. Read-only copy.
 */
export const directoryAccounts = pgTable(
  "directory_accounts",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().default(""),
    /** nameKey(name). */
    nameKey: text("name_key").notNull().default(""),
    /** Last 10 digits. */
    phone: text("phone"),
    website: text("website"),
    type: text("type"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("directory_accounts_name_key_idx").on(t.nameKey), index("directory_accounts_phone_idx").on(t.phone)],
);

/**
 * Lead Alchemist Companies, copied when the Contacts page reads Lead Alchemist, so the list can
 * suggest a Company for each person without calling Lead Alchemist. Read-only copy.
 */
export const directoryCompanies = pgTable(
  "directory_companies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().default(""),
    /** nameKey(name). */
    nameKey: text("name_key").notNull().default(""),
    /** Last 10 digits. */
    phone: text("phone"),
    website: text("website"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("directory_companies_name_key_idx").on(t.nameKey), index("directory_companies_phone_idx").on(t.phone)],
);

/** Every email that belongs to a contact (lower-cased). An email belongs to one contact. */
export const contactEmails = pgTable(
  "contact_emails",
  {
    email: text("email").primaryKey(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contact_emails_contact_idx").on(t.contactId)],
);

/**
 * The visual mapping screens: one row per record to map, with the app's proposal and the
 * staff decision. Nothing is written until staff confirm a run.
 * - salesforce_import: a Salesforce Account → an app Account (link, create or skip).
 * - la_companies: an app Account → a Lead Alchemist Company (link, create or skip).
 * - salesforce_push: an app Account with submitted applications → a Salesforce Account.
 */
export const mappingRows = pgTable(
  "mapping_rows",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull(),
    kind: text("kind").$type<MappingKind>().notNull(),
    /** Salesforce Account ID, or the app Account ID. */
    sourceId: text("source_id").notNull(),
    sourceName: text("source_name").notNull(),
    /** Phone, website, contacts and so on, as shown on the mapping screen. */
    sourceDetail: jsonb("source_detail").$type<MappingDetail>().notNull().default({}),
    /** What the app suggests. */
    proposal: text("proposal").$type<MappingAction>().notNull(),
    /** exact · strong · name_only · none */
    confidence: text("confidence").$type<MappingConfidence>().notNull(),
    targetId: text("target_id"),
    targetName: text("target_name"),
    reason: text("reason"),
    /** Other possible targets for the dropdown. */
    candidates: jsonb("candidates").$type<{ id: string; name: string; note?: string }[]>().notNull().default([]),
    /** Staff choice; null means "use the proposal". */
    decision: text("decision").$type<MappingAction>(),
    decisionTargetId: text("decision_target_id"),
    /** pending · applied · error */
    status: text("status").$type<"pending" | "applied" | "error">().notNull().default("pending"),
    result: text("result"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("mapping_rows_run_idx").on(t.runId, t.id), index("mapping_rows_kind_idx").on(t.kind, t.createdAt)],
);
export type MappingKind = "salesforce_import" | "la_companies" | "salesforce_push";
export type MappingAction = "link" | "create" | "skip";
export type MappingConfidence = "exact" | "strong" | "name_only" | "none";
export interface MappingDetail {
  /** Salesforce Account Type (the account's status). */
  type?: string | null;
  phone?: string | null;
  website?: string | null;
  city?: string | null;
  state?: string | null;
  street?: string | null;
  postalCode?: string | null;
  contacts?: {
    name: string;
    email: string | null;
    sfId?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    title?: string | null;
    /** Already a Lead Alchemist contact (linked in the app). */
    inLa?: boolean;
  }[];
  applications?: number;
  sfAccountId?: string | null;
  ghlCompanyId?: string | null;
}
export type MappingRow = typeof mappingRows.$inferSelect;

/**
 * Salesforce records removed from this dashboard (never from Salesforce). The import and the
 * automatic sync leave them out until staff sync them again.
 */
export const salesforceHidden = pgTable("salesforce_hidden", {
  sfId: text("sf_id").primaryKey(),
  kind: text("kind").$type<"account" | "contact">().notNull(),
  name: text("name").notNull(),
  removedBy: text("removed_by").notNull(),
  removedAt: timestamp("removed_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Superseded by contact_emails (kept until the old rows are no longer needed). Every email that belonged to a client. */
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

export type ClientEventType =
  | "primary_changed"
  | "created"
  | "merged"
  | "split"
  | "staff_note"
  | "sf_synced"
  | "sf_sync_failed"
  | "sf_needs_review"
  | "sf_linked"
  | "contact_added"
  | "contact_moved"
  | "imported"
  | "la_company_linked"
  | "la_company_updated"
  | "duplicate_resolved"
  | "sf_sync_paused"
  | "sf_sync_resumed"
  | "sf_pulled"
  | "contact_removed"
  | "la_contact_linked"
  | "contact_pushed"
  | "contact_changed"
  | "sf_refreshed"
  | "deactivated"
  | "reactivated"
  | "sf_relinked";

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
    /** "salesforce_application" (target = application ID), "salesforce_inbound" (target = "Account:<id>" or "Contact:<id>", a change made in Salesforce) */
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
export type SyncJobKind = "salesforce_application" | "salesforce_inbound";

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
    /** The Account (business) this application is for. */
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    /** The Contact who filled it out. */
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),

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
    /** Brought in from an earlier system ("lead_alchemist": an old Lead Alchemist form or survey submission); null for applications made here. */
    importedFrom: text("imported_from").$type<"lead_alchemist">(),
    /** The Lead Alchemist submission it was imported from, so it's never imported twice. */
    laSubmissionId: text("la_submission_id"),
    submittedIp: text("submitted_ip"),
    submittedUserAgent: text("submitted_user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("applications_email_idx").on(t.applicantEmail),
    index("applications_client_idx").on(t.clientId),
    index("applications_contact_idx").on(t.contactId),
    index("applications_status_idx").on(t.status),
    index("applications_created_idx").on(t.createdAt),
    uniqueIndex("applications_la_submission_idx").on(t.laSubmissionId),
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
  | "sf_dry_run"
  | "imported";

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
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
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

/**
 * Admin notifications (the board at Admin → Notifications): things staff should look at, such as
 * a phone or email on an application that differs from Salesforce or Lead Alchemist. Never
 * deleted; dismissing is a status. Every change is in notification_log with who and when.
 */
export type NotificationKind = "contact_changed" | "sf_new_contact" | "unmapped" | "renewal_due" | "possible_duplicate" | "sync_issues" | "other";
export type NotificationStatus = "open" | "in_progress" | "done" | "dismissed";

/**
 * The result of one bulk sync (a button on a list, or a "select all matching" run): how many
 * were done, and every error, conflict and skipped item, so staff can see whether everything
 * synced. Shown at Admin → Sync reports.
 */
/**
 * Every change a sync makes or sees on a person, so staff can tell when something changed: a
 * value read from Salesforce or Lead Alchemist that differs from last time, a field AIS Connect
 * wrote to Lead Alchemist, a contact created or linked there, a Company joined, a tier change.
 */
export const contactChanges = pgTable(
  "contact_changes",
  {
    id: serial("id").primaryKey(),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    clientId: uuid("client_id"),
    /** Where the change is: "salesforce", "lead_alchemist" or "ais_connect". */
    system: text("system").$type<"salesforce" | "lead_alchemist" | "ais_connect">().notNull(),
    /** "read" (seen in that system) or "wrote" (AIS Connect changed it there). */
    direction: text("direction").$type<"read" | "wrote">().notNull(),
    /** e.g. "Email", "Phone", "Contact Type", "Company", "Client tier", "Created". */
    field: text("field").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    /** Who or what: "staff:<email>", "salesforce:change" (webhook), "system". */
    actor: text("actor").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("contact_changes_contact_idx").on(t.contactId, t.createdAt), index("contact_changes_created_idx").on(t.createdAt)],
);
export type ContactChangeRow = typeof contactChanges.$inferSelect;

export const syncReports = pgTable(
  "sync_reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** What ran, e.g. "Synced to Lead Alchemist". */
    title: text("title").notNull(),
    /** Which rows, e.g. "3 ticked on Contacts" or the filters of a select-all run. */
    scope: text("scope").notNull().default(""),
    /** The list page it ran from. */
    page: text("page"),
    actor: text("actor").notNull(),
    total: integer("total").notNull().default(0),
    done: integer("done").notNull().default(0),
    errors: jsonb("errors").$type<string[]>().notNull().default([]),
    conflicts: jsonb("conflicts").$type<string[]>().notNull().default([]),
    skipped: jsonb("skipped").$type<string[]>().notNull().default([]),
    notes: jsonb("notes").$type<string[]>().notNull().default([]),
    /** Lead Alchemist syncs: what happened to each contact (linked, created, skipped by reason, failed). */
    contactCounts: jsonb("contact_counts").$type<ContactTally>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sync_reports_created_idx").on(t.createdAt)],
);
export type SyncReport = typeof syncReports.$inferSelect;
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").$type<NotificationKind>().notNull(),
    status: text("status").$type<NotificationStatus>().notNull().default("open"),
    title: text("title").notNull(),
    detail: text("detail"),
    data: jsonb("data").$type<Record<string, unknown>>(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
    applicationId: uuid("application_id").references(() => applications.id, { onDelete: "set null" }),
    /** One open card per situation: the same key isn't raised twice while it's still open. */
    dedupeKey: text("dedupe_key"),
    assignedTo: text("assigned_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [index("notifications_status_idx").on(t.status, t.updatedAt), index("notifications_client_idx").on(t.clientId), index("notifications_dedupe_idx").on(t.dedupeKey)],
);

export const notificationLog = pgTable(
  "notification_log",
  {
    id: serial("id").primaryKey(),
    notificationId: uuid("notification_id")
      .notNull()
      .references(() => notifications.id, { onDelete: "cascade" }),
    /** "system" or "staff:<email>" */
    actor: text("actor").notNull(),
    action: text("action").$type<"created" | "status" | "note" | "pushed" | "assigned">().notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notification_log_notification_idx").on(t.notificationId, t.at)],
);
export type Notification = typeof notifications.$inferSelect;
export type NotificationLogEntry = typeof notificationLog.$inferSelect;

export type Application = typeof applications.$inferSelect;
export type ApplicationEvent = typeof applicationEvents.$inferSelect;
export type ApplicationDocument = typeof applicationDocuments.$inferSelect;
export type Applicant = typeof applicants.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type LibraryFile = typeof libraryFiles.$inferSelect;
export type Client = typeof clients.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type ClientEvent = typeof clientEvents.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
