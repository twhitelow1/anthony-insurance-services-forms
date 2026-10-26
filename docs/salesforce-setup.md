# Salesforce setup (for Anthony Insurance's Salesforce admin)

This connects the online applications app to Anthony Insurance's Salesforce org. When an application
is submitted, the app finds or creates the business's **Account** and the **Contact** who filled it out, creates an
**Opportunity** for that application with that Contact as its primary contact role, attaches the application PDF to
the Account, and posts a short Chatter note. Every record also gets links to the matching records in the app and in
Lead Alchemist. Staff can also bring every existing Salesforce Account into the app, with a mapping screen to check
first (section 5).

Nothing here changes how agents use Salesforce today. Do it in a **sandbox first** if you have one.

Everything below needs a Salesforce admin. It takes about 30 to 45 minutes.

---

## 1. New fields

Create these fields (Setup → Object Manager → *object* → Fields & Relationships → New).
Every one is type **URL**, length 255. The app fills them; agents only click them.

| Object | Field label | API name | Type | Page layout |
|---|---|---|---|---|
| Account | Applications Link | `Applications_Link__c` | URL(255) | Account Document Links section |
| Account | LA Company Link | `LA_Company_Link__c` | URL(255) | Account Document Links section |
| Account | LA Contact Link | `LA_Contact_Link__c` | URL(255) | Account Document Links section |
| Account | LA Opportunity Link | `LA_Opportunity_Link__c` | URL(255) | Account Document Links section |
| Contact | LA Contact Link | `LA_Contact_Link__c` | URL(255) | Contact layout (any section) |
| Contact | Applications Link | `Applications_Link__c` | URL(255) | Contact layout |
| Opportunity | LA Opportunity Link | `LA_Opportunity_Link__c` | URL(255) | Opportunity layout |
| Opportunity | Application Link | `Application_Link__c` | URL(255) | Opportunity layout |

**Field-level security**, on each field:
- **Agent profiles** (the profiles Melanie and Caitlyn use): Visible. Read-only is recommended, so links aren't edited by hand.
- **The integration user's permission set** (step 2): Visible and editable.

**Page layouts:** add the four Account fields to the existing **Account Document Links** section of the Account layout
(or layouts, if there's more than one). Add the Contact and Opportunity fields to their layouts.

If a field is missing, the app skips that link and keeps syncing. The app's Admin → Settings → Salesforce → Health
lists any missing field as `missing field: Account.Applications_Link__c`.

The app also fills these **existing** Account fields, but only while they're empty, so nothing an agent entered is
overwritten. Picklist values are checked against the org first, and a value the org doesn't have is skipped.

| Field | API name | From the application |
|---|---|---|
| Program | `Program__c` | The form, e.g. Aerial Instructor application → "Aerial Instructor" |
| Legal Entity | `Legal_Entity__c` | "Form of Business" answer, or "Individual" for instructor applications |
| Number of Participants | `Number_of_Participants__c` | The participants answer, whichever way the form asks it |
| GL Aggregate Limit | `GL_Aggregate_Limit__c` | General aggregate limit chosen |
| Effective Date | `Effective_Date__c` | Requested effective date |
| Contact First Name | `Contact_First_Name__c` | First name |

A new Account also gets Name, Type = Customer, Phone, Billing address and Website. A new Contact gets first and
last name, email, phone and mailing address.

## 2. Integration user

Create a dedicated user the app signs in as, so its changes are easy to spot in history:

1. Setup → Users → New User. License **Salesforce Integration** (API-only). Name it, for example, "Applications App".
2. Create a permission set **DubLow Integration Access** (named "Applications App Integration" in earlier drafts of this guide):
   - Permission set license: **Salesforce API Integration**.
   - System permission: **API Enabled**.
   - Object permissions: **Account**, **Contact** and **Opportunity**: Read, Create, Edit (no Delete). Opportunity
     Edit also lets the app add the Opportunity's contact role (OpportunityContactRole).
   - Field permissions: edit on the eight link fields above and on the mapped fields in step 1.
   - Files: Create on Content (ContentVersion). Chatter must be on so the app can post to the Account feed.
3. Assign the permission set to the integration user.

The app never deletes anything in Salesforce.

## 3. External Client App (the app's sign-in)

Setup → **External Client App Manager** → New External Client App. If the org still lets you create
classic Connected Apps (App Manager → New Connected App), the same settings apply there.

- Name: **Anthony Applications App**. Contact email: Todd's.
- **Enable OAuth**. Callback URL: `https://login.salesforce.com/services/oauth2/success` (required but not used).
- OAuth scopes: **Manage user data via APIs (api)**.
- Check **Enable Client Credentials Flow**.
- Policies: set **Run As** (Client Credentials Flow) to the integration user from step 2. Permitted users: admin-approved users pre-authorized, with the integration user's permission set added.
- Save, then **Consumer Key and Secret** → copy both into Vercel (step 4).

**Why client credentials, not JWT bearer?** Both are server-to-server with no person signing in. Client
credentials needs only a key and secret stored in Vercel. JWT bearer also needs a certificate uploaded to
Salesforce and a private key kept by the app, which is more to set up, rotate and lose. The app only ever
acts as the one integration user, which is exactly what client credentials is for.

Note: the client credentials flow only works against the org's **My Domain** address (for example
`https://anthony.my.salesforce.com`), not `login.salesforce.com` or `test.salesforce.com`.

## 4. Vercel environment variables

Set these in Vercel → Settings → Environment Variables. Use **Preview** for the sandbox and **Production** for the real
org. Never paste them into chat or the code.

| Variable | Value |
|---|---|
| `SALESFORCE_LOGIN_URL` | The org's My Domain URL, e.g. `https://<domain>.my.salesforce.com`. Sandbox: `https://<domain>--<sandbox>.sandbox.my.salesforce.com` |
| `SALESFORCE_CLIENT_ID` | Consumer Key from step 3 |
| `SALESFORCE_CLIENT_SECRET` | Consumer Secret from step 3 |
| `SALESFORCE_LIGHTNING_URL` | Where staff open records: `https://dg0000000i7rimaa.lightning.force.com` (the sandbox has its own) |
| `CRON_SECRET` | 32+ random characters. Vercel Cron uses it for the daily retry run |
| `SALESFORCE_API_VERSION` | Optional. Default `v62.0` |

Turning the sync on, dry run or live, and the Opportunity stage for each status are all in **Admin → Settings →
Salesforce**, so they change without a redeploy.

## 5. Testing safely

1. **Sandbox, dry run.** Put the sandbox's values in Vercel **Preview**. Open the preview admin → Settings →
   Salesforce: Sync **On**, Mode **Dry run**. Check the Health panel says Connected and lists no missing fields.
2. Submit an application on the preview site. Use a real-looking submission, not staff testing mode: test submissions
   are never sent to Salesforce. On its admin page, the activity log shows **Salesforce dry run**, with what it would
   create. Nothing is written.
3. **Sandbox, live.** Switch Mode to **Live** and press **Sync to Salesforce** on that application. Check the sandbox:
   Account, Contact, Opportunity ("<Account Name> - <year>"), the PDF under Files, the Chatter post and the links.
   Press it again: nothing new is created.
4. **Production, dry run, then live.** Put the production values in Vercel **Production**. Start in Dry run, check a
   real submission's dry-run plan, then switch to Live.
5. **Bring in every Salesforce Account.** Admin → Settings → **Data mapping** → *Salesforce Accounts → app Accounts* →
   **Scan now**. The scan only reads Salesforce. It then lists every Salesforce Account next to the app account it
   matches ("Already linked", "Strong match", "Check" for a name-only match, or "No match"), with a choice per row:
   link to one of the listed accounts, create a new one, or skip. Save any changes, tick "I've reviewed the mapping",
   and **Confirm and apply**. Applying links or creates each account, adds its Contacts, and writes only the link
   fields back onto the Salesforce Account and Contacts.
6. **Send past applications.** Data mapping → *Past applications → Salesforce*: the same kind of screen, one row per
   account with applications not yet in Salesforce, matched to a Salesforce Account. Confirming queues each
   application's sync (Opportunity, contact role, PDF, Chatter note). Run them with **Run queued syncs now**, or let the
   daily run pick them up.

## 6. How the app decides who's who

The app is organised the same way as Salesforce: an **Account** is the business (someone applying for themselves gets
an Account in their own name, Legal Entity "Individual"), its **Contacts** are the people, and each application records
the Contact who filled it out. The org has no duplicate rules, so the app matches carefully and never guesses:

1. An app account already linked to a Salesforce Account (by the sync or the mapping screen) → that Account.
2. A business: an **Account with exactly the same name and the same phone number** (any format) → that Account. With
   no Account of that name, a Contact with the applicant's email whose Account has the same name (ignoring
   punctuation and LLC/Inc) → that Account.
3. An individual: a **Contact with their email** → that Contact's Account, then name and phone as above.
4. Anything uncertain → **Needs review**, and nothing is created. This covers a name match with a different or missing
   phone, or several Accounts or Contacts matching. Staff see it on the account's page in Admin → Accounts, and can
   pick the right Account on the *Past applications → Salesforce* mapping screen.
5. Otherwise a **new Account**, with the applicant as its Contact.

The applicant's **Contact**: the one with their email on that Account; else their one Contact elsewhere in Salesforce
(tied to this application by the Opportunity's contact role); else a new Contact on the Account. The Opportunity's
primary contact role is always the person who filled out the application.

Once linked, the Salesforce IDs are saved on the app's account and contact, so later applications go straight to the
same records. Running the sync twice never creates duplicates.

**Opportunity stage:** set per application status in Admin → Settings → Salesforce. When nothing is set, a submitted
application gets the org's first **open** stage (never Closed Won), "Coverage bound" gets the first won stage, and
"Declined" or "Withdrawn" get the first closed-lost stage.

## 7. Links between the three systems

| Link | Pattern | How it was checked |
|---|---|---|
| Salesforce record | `<SALESFORCE_LIGHTNING_URL>/lightning/r/<Object>/<Id>/view` | Salesforce's standard Lightning record URL |
| Lead Alchemist contact | `<Lead Alchemist address>/v2/location/<location ID>/contacts/detail/<id>` | Already used by the app; the address bar on a contact |
| Lead Alchemist opportunity | `<Lead Alchemist address>/v2/location/<location ID>/opportunities/list/<id>?tab=OpportunityDetails` | HighLevel changelog, "Dynamic Routing for Opportunity Modal" |
| Lead Alchemist company | `<Lead Alchemist address>/v2/location/<location ID>/contacts/smart_list/All` (Contacts page; Companies tab at the top) | A Company's own page address isn't known yet; the earlier guess `…/businesses/detail/<id>` was broken |
| App account page | `<APP_URL>/admin/clients/<account ID>` | The app's own route; never an email or phone in the address |
| App application | `<APP_URL>/admin/applications/<application ID>` | The app's own route |

The Lead Alchemist address is set in Admin → Settings (the white-label domain; default `https://app.leadalchemist.io`).
All patterns live in `src/lib/integrations/urls.ts`, so a wrong one is a one-line fix.

## 8. When something goes wrong

- **The applicant is never affected.** The sync runs after the application is saved. If Salesforce is down, it's retried
  after 1, 5 and 30 minutes and 2 hours, five attempts in all. Retries run when staff open the admin and once a day by
  Vercel Cron. After the last attempt the application shows **Sync failed** with the error and a **Sync to Salesforce**
  button.
- **Privacy.** No application answers are sent to Salesforce, only the fields listed above and the PDF. Logs carry
  record IDs, never names, emails or answers.
- **Health panel.** Admin → Settings → Salesforce shows sign-in problems, missing fields, the org's Opportunity stages
  and the picklist values the mapping checks against.
