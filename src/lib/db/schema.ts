import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";
import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uuid } from "drizzle-orm/pg-core";
import type { FormValues } from "@/lib/forms/types";
import type { ApplicationStatus } from "@/lib/applications/status";
import type { AiReview } from "@/lib/ai/review";

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
    submittedIp: text("submitted_ip"),
    submittedUserAgent: text("submitted_user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("applications_email_idx").on(t.applicantEmail),
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
  | "answers_edited";

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
