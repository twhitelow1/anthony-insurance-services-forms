# Lead Alchemist Companies: what's needed

**Status (2026-10-23): not connected.** The app keeps linking clients through Lead Alchemist **contacts** and
**opportunities**, which already carry the Salesforce and Client page links. The "View Company in Lead Alchemist"
button stays greyed out until this is done. Nothing in the current contact, note, tag or opportunity sync changes.

## Why it isn't built yet

The goal is one Lead Alchemist Company per Salesforce Account, with that Account's contacts attached to it.
The integration doesn't do this today, and three things stand in the way:

1. **Scopes.** The app's Private Integration token was set up for contacts, custom fields and opportunities.
   Companies use the **Businesses** API (`/businesses/`), which needs `businesses.readonly` and `businesses.write`.
2. **Creating Companies with a Private Integration token.** HighLevel documents `POST /businesses/` for Private
   Integration tokens, but developers report it rejecting location tokens with "LocationId is not specified" (401).
   Reading and updating existing Companies work. This needs a test against Anthony's sub-account before relying on it.
3. **Attaching a contact to a Company.** HighLevel's contact update documentation doesn't list a field for the
   Company. The documented route is the **Associations** API (contact ↔ business relation), which needs its own scopes.

The Company page's web address isn't documented either. The app's guess is
`/v2/location/<location>/businesses/detail/<id>` (in `src/lib/integrations/urls.ts`); confirm it by opening a Company.

## What to do

1. In Lead Alchemist (sub-account) → Settings → Private Integrations, edit the app's token and add **Businesses
   (view, edit)** and **Associations (view, edit)**. Keep the existing scopes. Paste nothing into chat; the token stays
   in Vercel (`GHL_API_TOKEN`).
2. Open any Company in Lead Alchemist and copy the address bar, to confirm the Company link pattern.
3. Test, in a test sub-account or with a clearly named test Company:
   - `POST /businesses/` (create) works with the token;
   - an association between a contact and that Company can be created.
4. Then the app can:
   - create or update one Company per Salesforce Account, individuals included;
   - attach each contact to it;
   - save the Company ID on the client (`clients.ghl_company_id` already exists);
   - add Company custom fields "Salesforce Account Link" and "Client Page Link";
   - fill `LA_Company_Link__c` on the Salesforce Account.

   The button and the CSV column light up on their own once the ID is saved.

If creating Companies only works with a full Marketplace OAuth app, the fallback is to keep contacts as the link
point (today's behaviour), and to have staff create Companies by hand for the few multi-contact businesses.
