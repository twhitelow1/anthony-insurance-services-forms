import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Application, Client, Contact } from "@/lib/db/schema";
import { getForm } from "@/forms";
import { STATUSES } from "@/lib/applications/status";
import { addEvent, getApplication } from "@/lib/applications/repo";
import { mainDocument } from "@/lib/applications/documents";
import { addClientEvent, assignApplicationClient, clientGhlContactId, getClient, getContact, setClientSalesforce, setContactSalesforce, isIndividualForm } from "@/lib/clients/repo";
import { standardContactFields } from "@/lib/ghl/sync";
import { ghlLinks, type GhlLinkWriter } from "@/lib/ghl/links";
import { links as configuredLinks } from "@/lib/integrations/links";
import type { Links } from "@/lib/integrations/urls";
import { getSettings } from "@/lib/settings";
import { soqlString, type ObjectDescribe, type SalesforceApi } from "./api";
import { salesforceClient } from "./client";
import { dryRunApi, type PlannedWrite } from "./dry-run";
import {
  accountCandidates,
  chooseStage,
  closeDate,
  LINK_FIELDS,
  opportunityName,
  prepareFields,
  type OpportunityStage,
  type Skipped,
} from "./mapping";
import { matchContact, matchSalesforce } from "./match";

/**
 * App → Salesforce, for one submitted application (see docs/salesforce-sync-plan.md):
 * find or create the Account (the business) and the Contact who filled it out, create this
 * application's Opportunity with that Contact as its primary contact role, upload the
 * PDF to the Account, post a Chatter note, and write the three-way links on every record
 * (and back into Lead Alchemist). Safe to run again: stored IDs are reused, files and notes
 * aren't repeated, and new IDs are saved the moment they're created.
 */
export interface SyncDeps {
  sf: SalesforceApi;
  ghl: GhlLinkWriter | null;
  links: Links;
  dryRun: boolean;
  stageMap: Partial<Record<keyof typeof STATUSES, string>>;
  now?: Date;
}

export type SyncOutcome =
  | {
      status: "synced";
      accountId: string;
      contactId: string;
      opportunityId: string;
      created: string[];
      skipped: Skipped[];
      missingLinkFields: string[];
      warnings: string[];
    }
  | { status: "dry_run"; planned: PlannedWrite[]; skipped: Skipped[]; missingLinkFields: string[]; matched: string }
  | { status: "needs_review"; reason: string }
  | { status: "skipped"; reason: string };

/** A failure that retrying won't fix (bad setup, missing record). Not retried with backoff. */
export class PermanentSyncError extends Error {}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const describeErr = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Settings, the Salesforce client and the link bases. Null when Salesforce isn't set up or the sync is off. */
export async function defaultSyncDeps(): Promise<SyncDeps | { off: string }> {
  const s = await getSettings();
  if (!s.salesforceEnabled) return { off: "Salesforce sync is turned off in Admin → Settings." };
  const sf = await salesforceClient();
  if (!sf) return { off: "Salesforce isn't connected: add the connection keys in Admin → Settings → Integrations." };
  return { sf, ghl: await ghlLinks(), links: await configuredLinks(), dryRun: s.salesforceDryRun, stageMap: s.salesforceStageMap };
}

async function setAppSf(id: string, patch: Partial<Application>) {
  const db = await getDb();
  await db.update(schema.applications).set({ ...patch, updatedAt: new Date() }).where(eq(schema.applications.id, id));
}

/** The org's active Opportunity stages, with which ones are closed or won. */
async function opportunityStages(api: SalesforceApi): Promise<OpportunityStage[]> {
  const rows = await api.query<{ MasterLabel: string; ApiName?: string; IsClosed: boolean; IsWon: boolean; SortOrder: number }>(
    "SELECT MasterLabel, IsClosed, IsWon, SortOrder FROM OpportunityStage WHERE IsActive = true ORDER BY SortOrder",
  );
  return rows.map((r) => ({ label: r.MasterLabel, isClosed: r.IsClosed, isWon: r.IsWon, sortOrder: r.SortOrder }));
}

const hasField = (d: ObjectDescribe, name: string) => d.fields.some((f) => f.name.toLowerCase() === name.toLowerCase());

export async function syncApplicationToSalesforce(applicationId: string, deps: SyncDeps): Promise<SyncOutcome> {
  const app = await getApplication(applicationId);
  if (!app) throw new PermanentSyncError("That application no longer exists.");
  // Test submissions never reach Salesforce.
  if (app.isTest) {
    await setAppSf(app.id, { sfSyncStatus: "skipped", sfLastError: null });
    return { status: "skipped", reason: "Test submissions aren't sent to Salesforce." };
  }
  if ((app.status === "declined" || app.status === "withdrawn") && !app.sfOpportunityId) {
    await setAppSf(app.id, { sfSyncStatus: "skipped", sfLastError: null });
    return { status: "skipped", reason: `${STATUSES[app.status].label} applications aren't sent to Salesforce.` };
  }
  const form = getForm(app.formSlug);
  if (!form) throw new PermanentSyncError(`Unknown form "${app.formSlug}".`);

  const contactFields = standardContactFields(form, app.values);
  const details = {
    email: app.applicantEmail,
    firstName: contactFields.firstName,
    lastName: contactFields.lastName,
    contactName: app.applicantName,
    businessName: app.businessName,
    phone: contactFields.phone,
    website: contactFields.website,
    address: { street: contactFields.address1, city: contactFields.city, state: contactFields.state, postalCode: contactFields.postalCode },
    individual: isIndividualForm(app.formSlug),
  };
  let clientId = app.clientId;
  let appContactId = app.contactId;
  if (!clientId || !appContactId) {
    clientId = await assignApplicationClient(app.id, details);
    appContactId = (await getApplication(app.id))?.contactId ?? null;
  }
  const client = (await getClient(clientId)) as Client;
  // Unsynced on the Salesforce screen: leave it alone until it's synced again.
  if (client.sfSyncPaused) {
    await setAppSf(app.id, { sfSyncStatus: "skipped", sfLastError: null });
    return { status: "skipped", reason: `Salesforce sync is off for "${client.name}" (Salesforce → Accounts).` };
  }
  const person = appContactId ? ((await getContact(appContactId)) as Contact | undefined) : undefined;

  const live = !deps.dryRun;
  const api = deps.dryRun ? dryRunApi(deps.sf) : deps.sf;
  const created: string[] = [];
  const skipped: Skipped[] = [];
  const warnings: string[] = [];
  const now = deps.now ?? new Date();

  const [accountDescribe, contactDescribe, oppDescribe] = await Promise.all([
    deps.sf.describe("Account"),
    deps.sf.describe("Contact"),
    deps.sf.describe("Opportunity"),
  ]);

  // ── Account and Contact ───────────────────────────────────────────
  const accountName = client.name.trim() || (app.businessName ?? app.applicantName).trim() || app.applicantEmail;
  let accountId = client.sfAccountId;
  let contactId = person?.sfContactId ?? null;
  let matched = "saved link";
  // The Opportunity is named after the Account as it's called in Salesforce.
  let sfAccountName = accountName;
  if (accountId) {
    const [still] = await deps.sf.query<{ Id: string; Name: string }>(`SELECT Id, Name FROM Account WHERE Id = ${soqlString(accountId)} LIMIT 1`);
    if (still?.Name) sfAccountName = still.Name;
    if (!still) {
      warnings.push("The saved Salesforce Account no longer exists; matched again.");
      accountId = null;
      contactId = null;
    }
  }
  let isNewAccount = false;
  if (!accountId) {
    // Staff already confirmed "create new" on the mapping screen: don't match again.
    const m =
      client.sfStatus === "create_confirmed"
        ? ({ kind: "new" } as const)
        : await matchSalesforce(deps.sf, { email: app.applicantEmail, accountName, phone: contactFields.phone, isIndividual: client.isIndividual });
    if (m.kind === "review") {
      if (live) {
        await setAppSf(app.id, { sfSyncStatus: "needs_review", sfLastError: m.reason });
        await setClientSalesforce(client.id, { sfStatus: "needs_review", sfLastError: m.reason });
        await addEvent(app.id, "sf_needs_review", "system", { message: `Salesforce: needs review. ${m.reason}. Nothing was created.` });
        await addClientEvent(client.id, "sf_needs_review", "system", { message: `Salesforce: ${m.reason}` });
      }
      return { status: "needs_review", reason: m.reason };
    }
    if (m.kind === "contact") {
      accountId = m.accountId;
      contactId = contactId ?? m.contactId;
      sfAccountName = m.accountName;
      matched = "Contact with the same email";
    } else if (m.kind === "account") {
      accountId = m.accountId;
      sfAccountName = m.accountName;
      matched = "Account with the same name and phone";
    } else {
      const { data, skipped: s } = prepareFields(
        accountDescribe,
        {
          Name: accountName,
          // Type is the account's status and is only ever set in Salesforce.
          Phone: client.phones[0] ?? contactFields.phone,
          BillingStreet: contactFields.address1,
          BillingCity: contactFields.city,
          BillingState: contactFields.state,
          BillingPostalCode: contactFields.postalCode,
          Website: contactFields.website,
          ...accountCandidates({ formSlug: app.formSlug, values: app.values }),
        },
        "create",
      );
      skipped.push(...s);
      accountId = (await api.create("Account", data)).id;
      isNewAccount = true;
      created.push("Account");
      matched = "new client";
    }
    if (live) {
      await setClientSalesforce(client.id, { sfAccountId: accountId, sfStatus: "linked", sfLastError: null });
      if (person && contactId && !person.sfContactId) await setContactSalesforce(person.id, contactId);
    }
  }

  if (!isNewAccount) {
    // Existing client: only fill Account fields that are still empty (Salesforce owns policy data).
    const candidates = accountCandidates({ formSlug: app.formSlug, values: app.values });
    const present = Object.keys(candidates).filter((f) => hasField(accountDescribe, f));
    skipped.push(...Object.keys(candidates).filter((f) => !present.includes(f)).map((f) => ({ field: f, reason: `missing field: Account.${f}` })));
    if (present.length && !accountId!.startsWith("dry-run:")) {
      const [current] = await deps.sf.query<Record<string, unknown>>(`SELECT ${present.join(", ")} FROM Account WHERE Id = ${soqlString(accountId!)} LIMIT 1`);
      const blanks = Object.fromEntries(present.filter((f) => current && (current[f] === null || current[f] === "")).map((f) => [f, candidates[f]]));
      const { data, skipped: s } = prepareFields(accountDescribe, blanks, "update");
      skipped.push(...s);
      if (Object.keys(data).length) await api.update("Account", accountId!, data);
    }
  }

  if (!contactId) {
    // The person who filled it out: on this Account, else their one Contact elsewhere (they're
    // tied to this application by the Opportunity's contact role), else a new Contact here.
    const existing = accountId!.startsWith("dry-run:") ? null : await matchContact(deps.sf, accountId!, app.applicantEmail);
    if (existing) contactId = existing;
    else {
      const first = str(app.values.first_name);
      const last = str(app.values.last_name) || app.applicantName || app.applicantEmail;
      const { data, skipped: s } = prepareFields(
        contactDescribe,
        {
          AccountId: accountId,
          FirstName: first,
          LastName: last,
          Email: app.applicantEmail,
          Phone: contactFields.phone,
          MailingStreet: contactFields.address1,
          MailingCity: contactFields.city,
          MailingState: contactFields.state,
          MailingPostalCode: contactFields.postalCode,
        },
        "create",
      );
      skipped.push(...s);
      contactId = (await api.create("Contact", data)).id;
      created.push("Contact");
    }
    if (live && person) await setContactSalesforce(person.id, contactId);
  }

  // ── Opportunity (one per application / policy year) ───────────────
  const stage = chooseStage(await opportunityStages(deps.sf), app.status, deps.stageMap);
  if (!stage.stage) throw new PermanentSyncError("Salesforce has no active Opportunity stages to use.");
  if (stage.note) warnings.push(stage.note);
  const appLink = deps.links.appApplication(app.id);
  const clientLink = deps.links.appClient(client.id);
  const ghlContactId = app.ghlContactId ?? person?.ghlContactId ?? (await clientGhlContactId(client.id));
  const laOppLink = deps.links.ghlOpportunity(app.ghlOpportunityId);
  const missingLinkFields: string[] = [];
  const linkData = (describe: ObjectDescribe, wanted: Record<string, string | null>) => {
    const present = Object.fromEntries(Object.entries(wanted).filter(([, v]) => v));
    for (const f of Object.keys(present)) if (!hasField(describe, f)) missingLinkFields.push(`${describe.name}.${f}`);
    const { data } = prepareFields(describe, Object.fromEntries(Object.entries(present).filter(([f]) => hasField(describe, f))), "update");
    return data;
  };
  const oppLinks = linkData(oppDescribe, { [LINK_FIELDS.Opportunity.laOpportunity]: laOppLink, [LINK_FIELDS.Opportunity.application]: appLink });

  let opportunityId = app.sfOpportunityId;
  if (opportunityId) {
    await api.update("Opportunity", opportunityId, { StageName: stage.stage, ...oppLinks });
  } else {
    const { data, skipped: s } = prepareFields(
      oppDescribe,
      { AccountId: accountId, Name: opportunityName(sfAccountName, app.values, now), StageName: stage.stage, CloseDate: closeDate(app.values, now) },
      "create",
    );
    skipped.push(...s);
    opportunityId = (await api.create("Opportunity", { ...data, ...oppLinks })).id;
    created.push("Opportunity");
    if (live) await setAppSf(app.id, { sfOpportunityId: opportunityId });
  }

  // ── The person who filled it out, as the Opportunity's primary contact ──
  const realIds = !opportunityId!.startsWith("dry-run:") && !contactId!.startsWith("dry-run:");
  const [role] = realIds
    ? await deps.sf.query<{ Id: string }>(
        `SELECT Id FROM OpportunityContactRole WHERE OpportunityId = ${soqlString(opportunityId!)} AND ContactId = ${soqlString(contactId!)} LIMIT 1`,
      )
    : [];
  if (!role) {
    await api.create("OpportunityContactRole", { OpportunityId: opportunityId, ContactId: contactId, IsPrimary: true });
    created.push("Contact role");
  }

  // ── The application PDF, as a File on the Account (once per version) ──
  let pdfHash = app.sfPdfHash;
  let contentVersionId = app.sfContentVersionId;
  const doc = await mainDocument(app.id);
  if (doc) {
    const hash = createHash("sha256").update(doc.content).digest("hex");
    if (hash !== app.sfPdfHash) {
      contentVersionId = (
        await api.uploadFile({ parentId: accountId!, title: `${app.reference} ${form.title}`.slice(0, 255), filename: doc.filename, content: doc.content })
      ).id;
      pdfHash = hash;
      created.push("File");
      if (live) await setAppSf(app.id, { sfPdfHash: pdfHash, sfContentVersionId: contentVersionId });
    }
  } else warnings.push("No PDF yet, so nothing was uploaded; the next sync uploads it.");

  // ── Chatter note on the Account (once per application) ─────────────
  let feedItemId = app.sfFeedItemId;
  if (!feedItemId) {
    const submitted = new Intl.DateTimeFormat("en-US", { timeZone: process.env.APP_TIMEZONE ?? "America/Chicago", dateStyle: "medium" }).format(app.createdAt);
    feedItemId = (
      await api.postFeed(
        accountId!,
        [`Online application ${app.reference}: ${form.title}, submitted ${submitted}.`, appLink ? `Open it in the applications admin: ${appLink}` : null]
          .filter(Boolean)
          .join("\n"),
      )
    ).id;
    created.push("Chatter post");
    if (live) await setAppSf(app.id, { sfFeedItemId: feedItemId });
  }

  // ── Links on the Account and Contact ───────────────────────────────
  const accountLinks = linkData(accountDescribe, {
    [LINK_FIELDS.Account.applications]: clientLink,
    [LINK_FIELDS.Account.laContact]: deps.links.ghlContact(ghlContactId),
    [LINK_FIELDS.Account.laOpportunity]: laOppLink,
    [LINK_FIELDS.Account.laCompany]: deps.links.ghlCompany(client.ghlCompanyId),
  });
  if (Object.keys(accountLinks).length) await api.update("Account", accountId!, accountLinks);
  const contactLinks = linkData(contactDescribe, {
    [LINK_FIELDS.Contact.laContact]: deps.links.ghlContact(ghlContactId),
    [LINK_FIELDS.Contact.applications]: clientLink,
  });
  if (Object.keys(contactLinks).length) await api.update("Contact", contactId!, contactLinks);
  for (const f of missingLinkFields) console.warn(`[salesforce] missing field: ${f} (link skipped; see docs/salesforce-setup.md)`);

  if (deps.dryRun) {
    const planned = (api as ReturnType<typeof dryRunApi>).planned;
    console.info(`[salesforce] dry run for ${app.reference}: ${planned.map((p) => `${p.op} ${p.object}`).join(", ") || "nothing to write"}`);
    await addEvent(app.id, "sf_dry_run", "system", {
      message: `Salesforce dry run (nothing written): matched by ${matched}; would ${planned.map((p) => `${p.op} ${p.object}`).join(", ") || "write nothing"}.${
        missingLinkFields.length ? ` Missing fields: ${missingLinkFields.join(", ")}.` : ""
      }`,
      data: { planned, skipped, missingLinkFields },
    });
    return { status: "dry_run", planned, skipped, missingLinkFields, matched };
  }

  // ── Back into Lead Alchemist ──────────────────────────────────────
  const sfAccountLink = deps.links.salesforce("Account", accountId);
  const sfOppLink = deps.links.salesforce("Opportunity", opportunityId);
  let notedAt = app.ghlLinksNotedAt;
  if (deps.ghl && ghlContactId) {
    try {
      const a = await deps.ghl.contactLinks(ghlContactId, { salesforceAccount: sfAccountLink, clientPage: clientLink });
      const b = app.ghlOpportunityId ? await deps.ghl.opportunityLinks(app.ghlOpportunityId, { salesforceOpportunity: sfOppLink, application: appLink }) : { missing: [] };
      for (const m of [...a.missing, ...b.missing]) warnings.push(`Lead Alchemist field "${m}" is missing and couldn't be created`);
      if (!notedAt) {
        await deps.ghl.note(
          ghlContactId,
          [
            `🔗 ${app.reference}: linked to Salesforce`,
            sfAccountLink ? `Salesforce Account: ${sfAccountLink}` : null,
            sfOppLink ? `Salesforce Opportunity: ${sfOppLink}` : null,
            clientLink ? `Account page (all applications): ${clientLink}` : null,
            appLink ? `This application: ${appLink}` : null,
          ]
            .filter(Boolean)
            .join("\n"),
        );
        notedAt = new Date();
      }
    } catch (err) {
      warnings.push(`Lead Alchemist links: ${describeErr(err)}`);
    }
  }

  await setAppSf(app.id, {
    sfOpportunityId: opportunityId,
    sfSyncStatus: "synced",
    sfSyncedAt: now,
    sfLastError: null,
    sfPdfHash: pdfHash,
    sfContentVersionId: contentVersionId,
    sfFeedItemId: feedItemId,
    ghlLinksNotedAt: notedAt,
  });
  await setClientSalesforce(client.id, { sfAccountId: accountId, sfStatus: "linked", sfSyncedAt: now, sfLastError: null });
  if (person && person.sfContactId !== contactId) await setContactSalesforce(person.id, contactId);
  const summary = `Synced to Salesforce (${matched})${created.length ? `: created ${created.join(", ")}` : ": records already existed, links updated"}${
    missingLinkFields.length ? `. Missing fields: ${missingLinkFields.join(", ")}` : ""
  }${skipped.length ? `. Skipped: ${skipped.map((s) => s.reason).join("; ")}` : ""}${warnings.length ? `. ${warnings.join(" ")}` : ""}`;
  await addEvent(app.id, "sf_synced", "system", { message: summary, data: { accountId, contactId, opportunityId, created, skipped, missingLinkFields, warnings } });
  await addClientEvent(client.id, "sf_synced", "system", { message: `${app.reference}: ${summary}` });
  console.info(`[salesforce] ${app.reference} synced: Account ${accountId}, Opportunity ${opportunityId}${created.length ? `, created ${created.join(", ")}` : ""}`);
  return { status: "synced", accountId: accountId!, contactId: contactId!, opportunityId: opportunityId!, created, skipped, missingLinkFields, warnings };
}
