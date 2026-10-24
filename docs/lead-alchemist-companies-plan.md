# Lead Alchemist Companies

**Status (2026-10-24): built, waiting on the token's scopes.** Each business account in the app can be linked to one
Lead Alchemist Company, and its contacts are put in that Company. Lead Alchemist's API calls Companies "businesses".

## What the app does

- **Admin → Settings → Data mapping → App Accounts → Lead Alchemist Companies.**
  - **Scan** reads every Company once and lists every app account next to its proposed Company:
    - already linked;
    - one Company with the same name (ignoring punctuation and LLC/Inc) or the same website;
    - "Check": several Companies look alike, so pick one;
    - create a new Company.

    Individuals are skipped by default.
  - Staff change any row, then **Confirm and apply**. Nothing is written until then.
- **Applying** creates or links each Company and saves its ID on the account. It then puts the account's contacts in it:
  - It finds each contact by their saved Lead Alchemist ID, else by email.
  - A contact can only be in one Company. Contacts already in a different Company are left there unless "move" is
    ticked, and the result lists them.
  - People who aren't in Lead Alchemist yet are only created when "Also create Lead Alchemist contacts" is ticked,
    because creating contacts can start Lead Alchemist workflows.
- **New applications.** When an account has a Company, each new applicant's contact is added to it.
  - With **Settings → Lead Alchemist Companies for new accounts** on (or `LA_COMPANIES_SYNC=1`), a new business also
    gets a Company: the one with the same name, else a new one.
  - Individuals never get a Company.

## What's needed in Lead Alchemist

1. **Scopes on the token.** Go to Lead Alchemist (sub-account) → Settings → Private Integrations, edit the app's token,
   and add **Businesses (view, edit)**. Keep the existing scopes; Contacts edit is already there and covers attaching
   contacts. The token stays in Vercel (`LA_API_TOKEN`); paste nothing into chat.
2. **Try it on one record first.** Run the mapping, set every row but one to Skip, confirm, and check that Company in
   Lead Alchemist. Some developers report that creating a Company with a sub-account Private Integration token returns
   "LocationId is not specified". The app sends `locationId` as the API documents. If it still fails, the row shows
   the error, and the fallback is to create those Companies by hand and link them on the mapping screen.
3. **Company page address.** Open any Company and copy the address bar to confirm the link pattern. The app's guess is
   `/v2/location/<location>/businesses/detail/<id>`; that guess was broken, so Company links now open the Contacts page (`src/lib/integrations/urls.ts`, a one-line fix once the real address is known).

## API calls used

| Call | For |
|---|---|
| `GET /businesses/?locationId=…&limit=100&skip=…` | Reading every Company for the scan |
| `POST /businesses/` | Creating a Company (name, phone, email, website, address) |
| `POST /contacts/bulk/business` | Putting contacts in a Company (up to 50 per call) |
| `GET /contacts/:id`, `GET /contacts/search/duplicate` | A contact's current Company; finding a contact by email |
