# Salesforce sync: plan and what's built

Mirrors "5 - Salesforce Setup and Sync Plan.md" in SharePoint (Clients › Anthony Insurance Services › Online
Applications App). It's based on a read-only review of the live org on 2026-10-23. Setup steps for Anthony's
Salesforce admin are in [salesforce-setup.md](salesforce-setup.md).

## How Anthony Insurance uses Salesforce

- **App and records:** Lightning, Service app.
  - **Account:** one per insured client. An individual instructor is an Account too (Legal Entity = Individual, Account Name = the person).
  - **Contacts:** one or more per Account.
  - **Opportunity:** one per policy year, named "<Account Name> - <year>", stage Closed Won, with Annualized Premium and Close Date.
- **Files:** carrier PDFs are Files under Notes & Attachments on the Account.
- **Notes:** staff leave Chatter posts on the Account.
- **Duplicates:** no duplicate rule is active, so the app does its own matching.

## The three-way link model

| Record | Links it carries |
|---|---|
| Salesforce Account | Applications_Link__c (app Client page), LA_Contact_Link__c, LA_Opportunity_Link__c (latest application), LA_Company_Link__c |
| Salesforce Contact | LA_Contact_Link__c, Applications_Link__c |
| Salesforce Opportunity | LA_Opportunity_Link__c, Application_Link__c (app application page) |
| Lead Alchemist contact | Salesforce Account Link, Client Page Link, plus the existing application fields and a note with every link |
| Lead Alchemist opportunity | Salesforce Opportunity Link, Application Link, plus the existing reference, status and PDF fields |
| App Client page | Buttons: View Account in Salesforce, View Company / Contact in Lead Alchemist, View Opportunity on each application |

## What's built (feature/salesforce-sync)

- **Admin → Accounts** (2026-10-24: organised like Salesforce):
  - one Account per business (or per individual), with its Contacts; each application records the Contact who filled it out;
  - same business = same name plus the same phone, business email domain or website; name-only matches are flagged
    "Possible duplicate" for staff;
  - search by business, person, email or phone; CSV export;
  - merge accounts and split a contact off, with an audit log;
  - notes, and the sync status of both systems.
- **App → Salesforce on submit**, as described in the setup doc:
  - matching, then creating the Account, Contact and Opportunity, with the applicant as the Opportunity's primary contact role;
  - the PDF as a File, and a Chatter note;
  - links in both directions;
  - mapped Account fields filled only while empty.
  - Test submissions never sync. The sync is queued and retried (5 attempts), never blocks the applicant, and has a
    dry-run mode and an on/off switch in Settings.
- **Data mapping (Settings → Data mapping)**: three resumable, visual mapping screens. Each scans (read-only), shows
  every record next to its proposed match for staff to change, and writes nothing until staff confirm:
  - Salesforce Accounts → app Accounts (import every Account and its Contacts; link fields written back);
  - app Accounts → Lead Alchemist Companies (link or create; contacts put in the Company);
  - past applications → Salesforce (pick each account's Salesforce Account; their syncs are queued).
- **Lead Alchemist Companies:** built; the token needs the Businesses scopes. See
  [lead-alchemist-companies-plan.md](lead-alchemist-companies-plan.md).

## Lead Alchemist mirror (2026-10-24)

| Salesforce / AIS Connect | Lead Alchemist | How |
|---|---|---|
| Account | Company (Businesses API) | One per account, linked or created by the sync; personal-lines accounts too |
| Contact | Contact, in the account's Company (Business field) | Linked by exact email or phone, else created ("Create missing contacts", on by default); never moved out of another Company |
| Account Type (read only, from Salesforce) | Contact field "Account Type" (full text) | Written on every sync, never blanked |
| Client tier (AIS Connect: one primary contact per account) | Contact field "Client Tier" (Primary / Secondary) | Written on every sync; not in Salesforce |
| Everyone AIS Connect syncs | Tags `ais-connect`, `ais-business` / `ais-personal` | Only ever added |
| Other accounts of a person at several | Tags `company: <name>` | Only ever added |

## Source of truth (suggested; open question 8)

- **Salesforce** owns policy data: premium, dates, coverage.
- **The app** owns application answers.
- **Lead Alchemist** owns marketing tags and conversations.

The sync follows this today: it only fills empty Account fields and never overwrites Salesforce data.

## Not verified yet (needs the API user)

- Exact picklist values for Legal Entity, Program, Renewal Status and Current Coverage, and the org's Opportunity
  stages. The app reads them from the org at run time and shows them in Settings → Salesforce → Health. Values in
  `src/lib/salesforce/mapping.ts` are candidates checked against the org.
- Whether Account record types are in use, and the Contact and Opportunity custom fields.
- The org's edition (API access is included in Enterprise and up; Professional needs the API add-on).
