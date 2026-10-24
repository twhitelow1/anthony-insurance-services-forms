# Anthony Insurance Services: Online Applications App

The working reference for the Anthony Insurance Services applications app, built by DubLow Digital.
Read this first, then the other files in this folder:

| File | What's in it |
|---|---|
| [backlog.md](backlog.md) | All 15 planned features: status, what was decided, and how each will work |
| [roadmap.md](roadmap.md) | The order we'll build them in, grouped into phases |
| [decisions-and-questions.md](decisions-and-questions.md) | Decisions made so far, and open questions with who owes the answer |

Copies of these files live in the client folder on SharePoint:
DubLow Company Drive › 2. Clients › Anthony Insurance Services › Online Applications App.
The repository copy (`docs/plan/`) is the one kept up to date with each release.

## What the app does today

Applicants fill in an online application. The app then:

1. Saves the application.
2. Builds the PDF:
   - **Sports Facility, Gymnastics and Boxing Gym** fill the carrier's own SFIC-STL-APP-001 form.
   - **All other forms** get a clean, carrier-ready "Anthony Insurance format" PDF.
3. Emails the applicant a confirmation branded for their site (AIS, Dance Studio Insurance or Martial Arts School Insurance), and emails staff an alert.
4. Runs an AI pre-review for the agent.
5. Syncs to **Lead Alchemist**:
   - creates or updates the contact, matched by the saved contact ID or by email;
   - adds a note and tags, and fills the custom fields (reference, status, link, PDF);
   - creates one opportunity per application, moving the lead out of the lead pipeline if they had one.

Staff work in the **admin**:
- **Applications:** status, notes, PDFs, edit answers, activity log.
- **Accounts:** every business (or individual) with its contacts and applications, each application showing who filled it out. Searchable by business, person, email or phone, with CSV export, merge and split, and a "possible duplicate" check. Buttons open the account in Salesforce and Lead Alchemist.
- **Data mapping:** pull every Salesforce Account into the app, link accounts to Lead Alchemist Companies, and send past applications to Salesforce. Each shows the proposed matches side by side and writes nothing until staff confirm.
- **Salesforce screen (Admin → Salesforce):** every Salesforce Account and Contact with Sync, Unsync and Remove from this app, and matching people to Lead Alchemist contacts by email or phone. The app never deletes anything in Salesforce or Lead Alchemist.
- **Integrations (Settings → Integrations):** enter and test the Salesforce and Lead Alchemist keys (encrypted; secrets are never shown again).
- **Salesforce (built 2026-10-23; Salesforce set up 2026-10-24, waiting on the keys):** each submitted application creates or links the client's Account and Contact, adds an Opportunity, the PDF and a Chatter note, and links all three systems to each other. Setup: `docs/salesforce-setup.md`.
- **Ask AI:** questions about application data in plain English.
- **Lead Alchemist setup:** shows the connection and every pipeline and stage.
- **Settings:** admins, notifications, sender, carrier email, pipeline.

Applicants have a **portal** where they sign in by email link and see their applications, statuses and PDFs. **For now applicants aren't sent links to it** (2026-10-16); staff can still use it.

Applicants can also:
- **sign by drawing or typing**, like DocuSign;
- have **their progress saved** as they go, and use **Save & finish later** to resume on any device.

Staff also have:
- **Testing mode:** signed-in staff can skip required fields on any form. Test submissions are labeled TEST and tagged `test` in Lead Alchemist.
- **Unfinished:** applications started but not submitted. These contacts are tagged `app-started` in Lead Alchemist.
- **Forms:** the copyable, branded embed code for each website.
- **Documents:** sample waivers and other files, assigned to forms.

**16 application forms** are live, covering every form on the Master List of Applications.

## Links

| What | Link |
|---|---|
| Forms (public) | https://anthony-insurance-services-forms.vercel.app |
| Admin | https://anthony-insurance-services-forms.vercel.app/admin |
| Applicant portal | https://anthony-insurance-services-forms.vercel.app/portal/login |
| Setup check | https://anthony-insurance-services-forms.vercel.app/status |
| Code | https://github.com/twhitelow1/anthony-insurance-services-forms |

## How it's built

| Piece | Used for |
|---|---|
| Next.js on Vercel | The website, admin, portal and APIs. Merging to `main` deploys. |
| Neon Postgres | Applications, PDFs, applicants, settings, activity log |
| Lead Alchemist API | Contacts, notes, tags, custom fields, opportunities |
| Resend | Email from applications@anthonyinsuranceservices.com (domain verified) |
| Claude (Anthropic API) | AI pre-review and Ask AI |
| pdf-lib | Filling carrier PDFs and building the Anthony-format PDFs |

Secrets stay in Vercel: API keys, the database URL and the session secret. The Salesforce and Lead Alchemist keys can instead be entered in **Settings → Integrations** (encrypted; a value saved there takes the place of the Vercel one). Everything else is in **Admin → Settings**.
In Vercel, Lead Alchemist settings use the `LA_` prefix (e.g. `LA_API_TOKEN`); the older names still work until they are renamed. "Open in Lead Alchemist" links go to https://app.leadalchemist.io.
In everything staff or clients see, it is called **Lead Alchemist**.

## Key people

- **Todd (DubLow Digital):** owner of the build.
- **Caitlyn (Anthony Insurance):** owns the eligibility and decline rules, compliance documents and form wording.
- **Melanie (Anthony Insurance):** receives replies and waivers, and works applications.
