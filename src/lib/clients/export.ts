import type { Links } from "@/lib/integrations/urls";
import { STATUSES } from "@/lib/applications/status";
import type { ClientListRow } from "./repo";
import { toCsv } from "./text";

export const CLIENT_CSV_HEADER = [
  "Client",
  "Contact name",
  "Email",
  "Phone",
  "Street",
  "City",
  "State",
  "Postal code",
  "Applications",
  "Latest status",
  "Latest application",
  "Salesforce status",
  "Salesforce Account ID",
  "Salesforce Account link",
  "Lead Alchemist contact link",
  "Lead Alchemist company link",
  "Client page link",
];

/** The Clients list as a spreadsheet (Admin → Clients → Export CSV). */
export function clientsCsv(rows: ClientListRow[], l: Links): string {
  return toCsv(
    CLIENT_CSV_HEADER,
    rows.map((c) => [
      c.name,
      c.contactName,
      c.primaryEmail,
      c.phone,
      c.address?.street,
      c.address?.city,
      c.address?.state,
      c.address?.postalCode,
      c.applications,
      c.latestStatus ? STATUSES[c.latestStatus].label : c.prospect ? "Prospect: unfinished" : "",
      c.latestAt ? c.latestAt.toISOString().slice(0, 10) : "",
      c.sfStatus,
      c.sfAccountId,
      l.salesforce("Account", c.sfAccountId),
      l.ghlContact(c.ghlContactId),
      l.ghlCompany(c.ghlCompanyId),
      l.appClient(c.id),
    ]),
  );
}
