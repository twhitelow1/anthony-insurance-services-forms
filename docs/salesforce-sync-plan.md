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

- **Admin → Clients**:
  - one record per client or prospect, grouped by email, with several emails allowed;
  - search by name, email or phone;
  - CSV export;
  - merge and split, with an audit log;
  - notes, and the sync status of both systems.
- **App → Salesforce on submit**, as described in the setup doc:
  - matching, then creating the Account, Contact and Opportunity;
  - the PDF as a File, and a Chatter note;
  - links in both directions;
  - mapped Account fields filled only while empty.
  - Test submissions never sync. The sync is queued and retried (5 attempts), never blocks the applicant, and has a
    dry-run mode and an on/off switch in Settings.
- **One-time backfill:** existing Accounts are linked to clients. A dry run produces a CSV report first. It writes only
  the link fields, is resumable and paced, and has an admin page and a CLI.
- **Lead Alchemist Companies:** not connected yet; see [lead-alchemist-companies-plan.md](lead-alchemist-companies-plan.md).

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
