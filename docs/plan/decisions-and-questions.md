# Decisions and open questions

## Decisions so far

| Date | Decision |
|---|---|
| 2026-10 | The CRM is called **Lead Alchemist** everywhere staff or clients see it. |
| 2026-10 | **The app is the record of each application.** Lead Alchemist gets the contact, a note, tags, links and an opportunity, not the answers. |
| 2026-10 | **One Lead Alchemist contact per applicant email**, linked by its saved contact ID. **One opportunity per application.** |
| 2026-10 | When someone applies, their open opportunity in the **lead pipeline moves** into the applications pipeline. |
| 2026-10 | Day-to-day settings live in **Admin → Settings**. Secrets live in Vercel only. |
| 2026-10 | Email is sent through Resend, from **applications@anthonyinsuranceservices.com**. Replies go to Melanie. |
| 2026-10 | **Sign-in is required.** Testing without sign-in (`OPEN_ACCESS`) is off. |
| 2026-10 | **Carrier delivery must be privacy-safe:** no raw applications by email. Carriers get magic links that expire in 48 hours. |
| 2026-10-10 | Disqualifying answers **stop** the application. Declined attempts are saved and sent to Lead Alchemist tagged `declined`. |
| 2026-10-10 | Compliance documents are **shown in a popup and emailed**, managed in Settings, and assignable to forms or policies. |
| 2026-10-10 | ~~Testing mode is a **special link**.~~ Replaced on 2026-10-16 (see below). Test submissions go to Lead Alchemist, tagged `test`. |
| 2026-10-10 | Typed signatures **work like DocuSign**. |
| 2026-10-10 | Embedded forms **replace the Lead Alchemist widgets**, are branded per site, and have a copy-embed-code button. |
| 2026-10-10 | **Staff approval before carrier sending, for now.** |
| 2026-10-10 | Follow-up sequences and follow-up agents **live in Lead Alchemist**. Agents start in approval mode. |
| 2026-10-10 | Salesforce is used by Anthony Insurance. Sync accounts, contacts and PDFs. The goal is to bridge the app, Lead Alchemist and Salesforce. |
| 2026-10-10 | "Started" (an unfinished application) and "Quoted but not bound" are **separate follow-up tracks**. |
| 2026-10-10 | Signatures: applicants can **switch between drawing and typing**, like DocuSign. |
| 2026-10-10 | Unfinished applications tag the Lead Alchemist contact **`app-started`** and **`app-started:<form>`**; the tags come off on submit. |
| 2026-10-10 | Library documents are **public by link** (meant for applicants) and assigned per form. |
| 2026-10-10 | Embedded forms default to their own website's branding; only the three agency domains may frame them. |
| 2026-10-16 | Oct 9 call with Caitlyn: **gymnastics** gets its own limits (see the backlog). Sports Facility and Boxing Gym share its questions but are unchanged. |
| 2026-10-16 | Gymnastics **auto-declines** paid players and residential-property activities. A missing concussion or background-check policy is allowed, but shows a popup and emails a sample policy. |
| 2026-10-16 | Gymnastics: aerial silks **12 ft maximum**; no aerial instructor-qualifications question. |
| 2026-10-16 | **Testing mode is staff only**, enforced on the server, and off by default. This replaces the "special link" decision. |
| 2026-10-16 | **Applicant emails are branded by the application's own site** (AIS, DSI or MASI). Gymnastics counts as DSI. The Microsoft 365 email path stays switched off. |
| 2026-10-16 | **LARP:** no payment at application time (the carrier doesn't publish rates). An agent quotes after submission. |
| 2026-10-16 (call) | **Go-live order for the website forms:** 1. Aerial Instructor (replaces the DSI Gravity Form once Caitlyn approves a test). 2. Fitness Class / Health Club A (DSI site). Then the rest of the Gravity Forms, a little each day. |
| 2026-10-16 (call) | **Sports equipment and production equipment forms are retired.** Their pages get an "Email us" button to Caitlyn instead of a form. |
| 2026-10-16 (call) | **"Prepare carrier email" should drop a draft, with the PDF attached, straight into Outlook Drafts.** Needs the Microsoft 365 connection; built after Aerial Instructor is live. |
| 2026-10-16 | **Each application is its own record in Lead Alchemist.** Contact custom fields only show the latest application. Each application gets a contact note (details plus links) and its own opportunity in the applications pipeline, whose card carries that application's reference, status, link and PDF. The app creates those four opportunity fields itself if they're missing. |
| 2026-10-16 | **Aerial Instructor takes waiver uploads** (up to 5 files: PDF, Word, JPG or PNG, 4 MB each). Optional: without one, a popup says a signed waiver is required before coverage starts but we can quote now. The same reminder goes in the confirmation email. Files show on the application in the admin. |
| 2026-10-16 | **Aerial Yoga Studio and Aerial Dance Studio** also take waiver uploads (same "required before coverage starts" popup), and "Is alcohol served or is BYOB allowed on site?" is a Yes/No question. |
| by 2026-10-20 | **Aerial Instructor is live** on dancestudioinsurance.com, replacing the Gravity Form (Caitlyn approved the test). |
| 2026-10-23 | **The Equipment Floater web application now matches the carrier PDF (Francis L. Dean form SL09/2021).** Added: the "single item $150K or more" question, custom-made items, Tenant Betterments (asked only when a tenant improvements value is entered), Trailers, and equipment left unattended in vehicles. These sections apply to annual policies, as on the PDF. The web form keeps the Lead Alchemist form's option amounts where they differ from the PDF (e.g. business income maximum $50,000 vs $10,000 on the PDF). |
| 2026-10-23 | **Staff sign in with Microsoft 365 single sign-on.** If the browser already has a Microsoft 365 session, the admin opens with no sign-in screen; otherwise staff get the email sign-in link (or click "Sign in with Microsoft"). The Admins list still decides who gets in. One Entra ID app registration will also carry the Outlook-drafts permission later. |
| 2026-10-23 | **Salesforce sync design** (feature #11): app → Salesforce on submit. One Account per client, Contacts under it, one Opportunity per application named "<Account Name> - <year>" in an open stage (never Closed Won until bound), the PDF as a File on the Account, and a Chatter note. The org has no duplicate rules, so the app matches Contact email first, then exact Account name plus phone, and anything uncertain is held for review instead of created. It only fills empty Account fields: Salesforce stays the source of truth for policy data. Off by default, dry run outside production. |
| 2026-10-23 | **Salesforce connection:** an integration user plus an External Client App (or Connected App) with the OAuth client credentials flow. It's simpler than JWT bearer (no certificate). Secrets live in Vercel only. |
| 2026-10-23 | **Three-way links** on every record: Salesforce URL fields (`Applications_Link__c`, `LA_Contact_Link__c`, `LA_Opportunity_Link__c`, `LA_Company_Link__c`, `Application_Link__c`), Lead Alchemist link fields, and buttons on the app's new **Client page** (`/admin/clients/<id>`). Admin → Clients replaces Applicants, and no email or phone ever goes in a URL (the search is kept in a cookie). |
| 2026-10-23 | **Lead Alchemist Companies** wait for the Businesses and Associations token scopes. Until then, contacts and opportunities carry the links. |
| 2026-10-24 | **Microsoft sign-in works for any organisation's Microsoft 365**, not just Anthony's, when the person's email or domain is approved. Domains saved under "Staff email domains" in Admin → Settings always count, even while individual admins are listed (e.g. add `dublowdigital.com` for DubLow). Personal Microsoft accounts are refused, and only Microsoft's verified email is trusted. The app is registered once as multi-tenant (`docs/microsoft-sso-setup.md`). |
| 2026-10-24 | **Lead Alchemist, initials LA, everywhere**, including docs, PRs and chat; never the underlying platform's name. Links open https://app.leadalchemist.io. Vercel variables are renamed to `LA_…` (the old names keep working as a fallback until renamed). |
| 2026-10-24 | **The app is organised by business, like Salesforce.** An Account is the business (someone applying for themselves gets an Account in their own name), its Contacts are the people, and each application records the Account and the Contact who filled it out. The same business = the same name plus the same phone, business email domain or website; a name-only match becomes a new account flagged "Possible duplicate" for staff. The Salesforce Opportunity's primary contact role is the person who filled out the application. |
| 2026-10-24 | **Salesforce ↔ app ↔ Lead Alchemist in both directions, through visual mapping.** Settings → Data mapping pulls every Salesforce Account (and Contacts) into the app, links or creates Lead Alchemist Companies for the app's accounts, and sends past submitted applications to Salesforce. Each scan only reads; staff see every record next to its proposed match, change any row, and nothing is written until they confirm. New Lead Alchemist contacts are only created when staff tick that option (it can start workflows); contacts already in another Company are only moved when asked. |
| 2026-10-16 | **Applicants aren't pointed to the portal yet.** The confirmation and status emails and the "submitted" screen have no portal link. The portal still works; turn the links back on with `APPLICANT_PORTAL_LINKS` in `src/forms/config.ts`. |

## Open questions

| # | Question | Who | Blocks |
|---|---|---|---|
| 1 | **Master list of decline rules:** which answers, on which forms, stop an application, and the message to show | Caitlyn | #4 |
| 2 | **Compliance triggers and documents:** which answers show which document. Send the files (sample waiver, risk-management guide, others). | Caitlyn | #5, B |
| 3 | **Hired & non-owned auto wording.** Caitlyn is sending it; placeholder text is live on gymnastics. | Caitlyn | #6 |
| 3b | **Real sample documents** for the concussion and background-check popups, to replace the placeholders | Caitlyn | #5 |
| 3c | Should the gymnastics **declines, compliance popups and 12 ft silks limit** also apply to Aerial Yoga / Aerial Dance, Sports Facility or Boxing Gym? | Caitlyn | #4, #5 |
| 3d | **The DSI email that linked to the martial arts page:** this app's emails never used DSI branding before 2026-10-16, so that email was probably a Lead Alchemist workflow. Which email was it? | Caitlyn / Todd | — |
| 3e | **Gravity Forms notifications stopped** on several sites (likely an expired license) | Todd | Website forms until replaced |
| 3f | **Microsoft 365 app registration (multi-tenant)** for staff single sign-on: steps in `docs/microsoft-sso-setup.md` (any organisation where you can register apps, e.g. DubLow's). Then the client ID and secret into Vercel, and approved domains into Admin → Settings. Later: delegated Mail.ReadWrite for Outlook drafts, which needs Anthony's tenant. | Todd | Staff SSO, #13 |
| 4 | **Carrier list:** name, contact, products and states, how each accepts submissions, and their application PDFs | Anthony | C, #13, #9 |
| 5 | **Compliance sign-off** on the carrier magic-link design (48-hour links, access log) | Anthony / compliance | #13 |
| 6 | **Brand assets:** confirm MASI's brand colors (current: charcoal #262e37 with a red accent), and send the AIS logo file (PNG or SVG) | Todd / Anthony | #10 polish |
| 6b | **Lead Alchemist workflow** for unfinished applications: build it on the tag `app-started` (days 1, 3, 7, 30) | Todd | #14 |
| 6c | **Swap the website widgets** for the embed codes from Admin → Forms | Todd / web team | #10 rollout |
| 7 | **Lead Alchemist stage ↔ app status map** for the two-way sync | Todd | D |
| 8 | **Salesforce:** who is Anthony's Salesforce admin (to do `docs/salesforce-setup.md`: 8 URL fields, integration user, External Client App), is there a sandbox, and which system wins when a record changes in two places (suggested: Salesforce for policy data, the app for answers, Lead Alchemist for tags and conversations) | Anthony | #11 go-live |
| 8b | **Salesforce picklists and edition:** confirm Program, Legal Entity, Renewal Status and Current Coverage values, the Opportunity stages, whether record types are used, and that the edition includes API access. The Health panel shows them once connected. | Todd / Anthony | #11 mapping |
| 8c | **Lead Alchemist Companies:** add the **Businesses (view, edit)** scopes to the token, try the Companies mapping on one record, and confirm a Company's page address (`docs/lead-alchemist-companies-plan.md`) | Todd | Companies mapping |
| 9 | **Commission and revenue data:** where policies and premiums live today (agency system, QuickBooks, spreadsheets), and the commission rates | Anthony | #15 |
| 10 | **Aerial forms' General Aggregate Limit options:** currently $1M–$5M, taken from the fitness PDF | Caitlyn | — |
| 11 | **Dropdown options** not visible in the original widgets: "How did you hear about us?", event type and level, and others (see `docs/forms-review.md`) | Caitlyn | — |
| 12 | **Fillable carrier PDFs** for Fitness & Cross-Training, LARP 2026, Martial Arts Instructor and MMA Events, so they fill like SFIC | Anthony | — |
| 13 | Should the **MMA / Boxing / Kickboxing / Wrestling Events** PDF become a web form? | Anthony | — |
