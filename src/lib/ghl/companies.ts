import "server-only";
import { addClientEvent, getClient, setClientSalesforce } from "@/lib/clients/repo";
import { laCompanyName, nameKey } from "@/lib/clients/text";
import { getSettings } from "@/lib/settings";
import { addContactsToBusiness, createBusiness, getContact, listBusinesses } from "./client";

/**
 * After an application syncs to Lead Alchemist: put the applicant's contact in their
 * Account's Company. Accounts linked on the mapping screen always do; new Accounts get a
 * Company (found by name, else created) only when "Keep Lead Alchemist Companies in step"
 * is on in Admin → Settings. Individuals get one too, named like their Salesforce Account. A contact already in a different
 * Company is left there. Returns a short note for the activity log, or null.
 */
export async function companyForApplicant(clientId: string | null | undefined, ghlContactId: string): Promise<string | null> {
  if (!clientId) return null;
  const account = await getClient(clientId);
  if (!account) return null;

  let companyId = account.ghlCompanyId;
  let how = "its Company";
  if (!companyId) {
    if (!(await getSettings()).ghlCompaniesSync) return null;
    const same = (await listBusinesses()).filter((b) => nameKey(b.name) === nameKey(laCompanyName(account)));
    if (same.length > 1) return `${same.length} Lead Alchemist Companies are named like "${account.name}": link one on the mapping screen`;
    companyId =
      same[0]?.id ??
      (
        await createBusiness({
          name: laCompanyName(account),
          phone: account.phones[0] ?? null,
          email: account.primaryEmail,
          website: account.website,
          address: account.address?.street ?? null,
          city: account.address?.city ?? null,
          state: account.address?.state ?? null,
          postalCode: account.address?.postalCode ?? null,
          country: "US",
        })
      ).id;
    how = same[0] ? "the existing Company with the same name" : "a new Company";
    await setClientSalesforce(account.id, { ghlCompanyId: companyId });
    await addClientEvent(account.id, "la_company_linked", "system", { message: `Linked to Lead Alchemist Company ${companyId} (${how})` });
  }
  const contact = await getContact(ghlContactId);
  if (contact?.businessId === companyId) return null;
  if (contact?.businessId) return "The Lead Alchemist contact is already in a different Company, so it was left there";
  await addContactsToBusiness([ghlContactId], companyId);
  return `Added the contact to ${how} in Lead Alchemist`;
}
