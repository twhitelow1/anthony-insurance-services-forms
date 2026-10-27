# Feature backlog

Status key: ✅ built · 🟡 partly built · ⬜ not started.
"Decided" records the answers Todd gave on 2026-10-10. Last updated 2026-10-16 (Oct 9 call with Caitlyn: gymnastics limits and rules, staff testing mode, branded emails, LARP changes). Anything still unknown is listed in
[decisions-and-questions.md](decisions-and-questions.md).

| # | Feature | Status |
|---|---|---|
| 1 | Admin portal: statuses, notes, PDF downloads | ✅ |
| 2 | Lead Alchemist submission links on contact records | ✅ |
| 3 | Magic-link sign-in for staff and applicants; applicant status portal | ✅ |
| 4 | Auto-decline for certain answers | 🟡 gymnastics rules built |
| 5 | Compliance popups with sample-document attachments | 🟡 gymnastics, placeholder documents |
| 6 | Hired & non-owned auto tooltip | 🟡 aerial forms + gymnastics (placeholder wording) |
| 7 | Testing mode for required fields | ✅ staff only |
| 8 | Click-to-type signature | ✅ draw or type, switchable |
| 9 | Conditional carrier routing based on answers | ⬜ |
| 10 | Embeddable, branded forms for the websites | ✅ |
| 11 | Salesforce sync, including PDFs on account records | 🟡 built (accounts, contacts, mapping, Salesforce screen, keys in the admin); Salesforce set up 2026-10-24, waiting on the keys and a test |
| 12 | Ask AI for querying application data | ✅ |
| 13 | Carrier-submission portal with multiple carriers | 🟡 Outlook draft only |
| 14 | Automated follow-up and reactivation for unconverted leads | 🟡 app-started trigger ready; workflows still to build in Lead Alchemist |
| 15 | AI agents: follow-up, renewals, review, workflows, commissions | 🟡 AI review only |

New ideas raised while answering the questions (A to G) are at the bottom.

---

## ✅ 1. Admin portal
Built:
- **Applications:** list and search; each application has status, notes, PDFs, editable answers, delete, and an activity log.
- **Applicants:** grouped by email.
- **Settings:** admins, notifications, sender, reply-to, carrier email, Lead Alchemist pipeline.
- **Switch to user mode:** staff can view the portal as an applicant.

## ✅ 2. Lead Alchemist links on contacts
Built:
- **Contact custom fields:** Application Reference, Status, Link and PDF.
- **A note per application**, and tags for the form type and the current status.
- **One opportunity per application**, carrying the same four fields.
- **Lead moved over:** if the applicant has an open opportunity in the lead pipeline, it moves into the applications pipeline.
- **Saved contact ID:** each applicant email is linked to its Lead Alchemist contact by ID.

## ✅ 3. Magic-link sign-in and applicant portal
Built:
- **One-time email links**, valid 20 minutes, limited to 3 per 15 minutes.
- **Staff access:** controlled by the Admins list in Settings.
- **Microsoft 365 single sign-on for staff (built 2026-10-23, switched on once the Entra ID app exists):** staff already signed in to Microsoft 365 in their browser go straight into the admin with no screen at all. Anyone else sees the sign-in page with "Sign in with Microsoft" and the email link. Signing out doesn't sign them straight back in. A Microsoft account that isn't on the Admins list gets a clear message. **Any organisation's Microsoft 365** can sign in (2026-10-24) when the email or its domain is approved in Admin → Settings; personal Microsoft accounts can't.
- **Applicant portal:** shows their applications, a status timeline and PDFs.

## 🟡 4. Auto-decline answers
**Built (2026-10-16), gymnastics:** answering **Yes** to "Are any players paid to participate?" or "Do any activities take place on a residential property?" shows a red "We can't offer coverage" popup next to the answer. The applicant can't continue or submit, and the server refuses it too.
- It's a setting on the question (`decline` in the form definition), so more rules are a line each.
- Other forms still only explain ineligible situations in tooltips and notices.

**Still to do:** save declined attempts and send them to Lead Alchemist tagged `declined`, and let Caitlyn manage the rules in the admin.

**Decided**
- A disqualifying answer **stops** the application: the applicant can't continue.
- Build it as a field setting, a **"required answer"**. For example, "Max aerial height must be 12 ft or less" or "Health-club services must be No". The wrong answer shows a decline message and blocks submit.
- **Declined attempts are saved** and sent to Lead Alchemist tagged `declined`, so staff can follow up or offer another program.
- **Caitlyn will provide the master list** of decline rules. She should be able to set them herself in the admin; see feature A.

## 🟡 5. Compliance popups with sample documents
For example: "No waiver?" shows a popup with the sample waiver.

**Built (2026-10-16), gymnastics:** answering **No** to the concussion & return-to-play policy or the background-check policy shows "Required before coverage starts". The applicant can carry on. The matching sample policy is **attached to their confirmation email**.
- The sample files are placeholders in `compliance-docs/` in the code. Replace them with the real documents, using the same file names. Which document goes with which answer is set in `src/forms/config.ts`.

**Still to do:** manage the triggers and documents in the admin, using the document library (B).

**Decided**
- The popup **shows the document and also emails it** to the applicant.
- Documents (sample waiver, risk-management guide and so on) are **uploaded and managed in Settings**, not in code.
- **Custom waivers:** staff can upload more waivers and **assign them to specific policies or forms**; see feature B.
- **Caitlyn assigns the triggers** (which answer shows which document) in the admin.

## 🟡 6. Hired & non-owned auto tooltip
The aerial forms explain it. **Gymnastics now does too (2026-10-16)**, using placeholder wording from the aerial forms, kept in one place (`HNOA_TOOLTIP` in `src/forms/config.ts`). Sports Facility and Boxing Gym still have no explanation.

**Open:** Caitlyn is sending the final wording.

## ✅ 7. Testing mode
**Built (2026-10-16), staff only** (changed from the earlier "special link" idea; see decisions):
- Signed-in staff see a **"Testing mode: skip required fields"** switch at the top of every form. It's off by default.
- Required fields stay marked with *; untick the switch to check them again. An email address is still needed.
- **The server checks the staff sign-in**, so a public applicant can't turn it on.
- Test submissions go to Lead Alchemist tagged **`test`**, are labeled **TEST** in the admin, and the staff alert subject starts with **[TEST]**.

## ✅ 8. Click-to-type signature
**Built (2026-10-10):** the signature field has **Draw** and **Type** tabs, and the applicant can switch between them like DocuSign.
- **Type:** enter your name and pick one of three script styles. It's saved as the same signature image as a drawn one, so PDFs and storage work the same.
- **Audit record:** the IP address and browser are already kept with each application.

**Still to do:** add a "Signed electronically by [name] on [date and time]" line under the signature on the PDF.

## ⬜ 9. Conditional carrier routing
Example: an Aerial Yoga Studio with height over 10 ft can only go to two specific carriers; 10 ft or under can go to three.

**Decided**
- Rules are written in **plain English**, for example "Aerial yoga studios over 10 feet only go to Carrier A and Carrier B". Claude turns each into a structured rule, and staff confirm it before it saves.
- Rules rely on a **carrier registry** (feature C).
- Routing **suggests** carriers; staff approve for now (see #13). Automatic sending is a later nice-to-have.

**Prerequisite:** questions used in rules must be number or choice fields, not free text. For example, aerial height becomes a number.

## ✅ 10. Embeddable, branded forms
**Built (2026-10-10):**
- **Admin → Forms** lists every form with its **embed code** and a **Copy** button, plus a branded preview and the direct link.
- **Branding:** the embedded form takes the site's colors and font (Raleway).
  - **AIS:** orange.
  - **DSI:** purple and navy, with orange buttons.
  - **MASI:** dark charcoal with a red accent.

  Each form defaults to its own site (dance, fitness and aerial → DSI; martial arts and boxing → MASI; everything else → AIS), and `data-ais-brand` overrides it.
- **Self-sizing:** the iframe resizes itself and scrolls the page to the form on each step. Several forms can share a page.
- **Security:** only the three agency websites can frame the forms, and the admin, portal and PDFs can't be framed at all.

**To confirm:**
- MASI's exact brand colors: the site's theme colors couldn't be read, so MASI uses its dark section color plus a red accent.
- The AIS logo file, which is only needed for the standalone branded page.

**Decided**
- These **replace the Lead Alchemist widgets** on the websites. Submissions still sync to Lead Alchemist.
- Each form is **branded to its site**: AIS, Dance Studio Insurance (DSI) and Martial Arts School Insurance (MASI) colors and logo.
- Each form's admin page has a **"Copy embed code"** button.
- The iframe resizes to fit its content automatically, with no inner scrollbars.

## 🟡 11. Salesforce sync
**Built (2026-10-23; live in production since 2026-10-24), off until the keys are entered and tested.** Salesforce itself was set up on 2026-10-24 (`docs/salesforce-setup.md`; SharePoint file 7):
- **Every submitted application** (never test ones) syncs to Salesforce.
  - The business's Account is matched by exact name and phone (an individual: their Contact's email first).
  - An uncertain match is marked **Needs review** and nothing is created.
  - A new client gets an Account (Type Customer, Legal Entity, address, phone), a Contact, and an Opportunity named "<Account Name> - <year>" in an open stage.
  - The person who filled it out is the Opportunity's primary contact role (2026-10-24).
  - The application PDF goes to the Account's Files, and a Chatter note is posted.
  - Mapped Account fields (Program, participants, GL aggregate, effective date) are filled only while empty. Picklist values are checked against the org.
- **Three-way links**: on the Salesforce Account, Contact and Opportunity; on the Lead Alchemist contact and opportunity (fields created automatically, plus a note); and buttons on the app's Client page.
- **Reliability**: queued after the submission is saved, retried 5 times with backoff, with failures and a retry button in the admin. It's idempotent, has dry-run mode, an on/off switch and stage mapping in Settings, and a Health panel that lists missing fields.
- **Admin → Accounts** (replaces Applicants; organised by business since 2026-10-24):
  - an **Account per business** (individuals get one in their own name) with its **Contacts**;
  - each application shows **who filled it out**, and Applications can be grouped by account;
  - same business = same name plus the same phone, business email domain or website; a name-only match is flagged **Possible duplicate** for staff to merge or keep separate;
  - search, CSV export, merge accounts, split a contact off, an audit log, notes, and Salesforce and Lead Alchemist buttons;
  - the account page's address is never an email.
- **Data mapping** (Settings → Data mapping, 2026-10-24): visual mapping screens. Each scans read-only, shows every record next to its proposed match (link, create, skip, or "Check" for a name-only match), lets staff change any row, and writes nothing until staff confirm:
  - **Salesforce Accounts → app**: imports every Salesforce Account and its Contacts (replaces the one-time backfill);
  - **App → Lead Alchemist Companies**: links or creates Companies and puts the contacts in them;
  - **Past applications → Salesforce**: picks each account's Salesforce Account and queues its applications.
- **Settings → Integrations** (2026-10-24): enter and test the Salesforce and Lead Alchemist keys in the admin. Encrypted, secrets write-only, and they take the place of the Vercel variables.
- **Admin → Salesforce** (2026-10-24): every Salesforce Account with Sync, Unsync, Deactivate here (replaced Remove) and View in Salesforce; the same for each Contact; and Lead Alchemist matching by email or phone with Link, Unlink here and Create in Lead Alchemist.
- **Deactivate, reactivate and re-link** (2026-10-24): unsynced Accounts can be deactivated in this app (kept with their history, hidden from lists and syncs), reactivated, or linked to a different Salesforce Account; every step is in the account's activity. A new application reactivates the account.
- **Sync all matching** (2026-10-24): the Salesforce list shows its total with pages; ticking the header box offers "Select all N matching" to bring every matching Account in (by search and Account Type), with progress, Stop and Resume, pausing at 80% of the Salesforce API limit.
- **Accounts and contacts → Lead Alchemist** (fixed 2026-10-24): one "Sync selected to Lead Alchemist" on Mapping → Accounts (Company + contacts) and Mapping → Contacts (contacts + their Company), with "Create missing contacts". Production showed a 401 on Companies: the token needs the Companies scopes (businesses.readonly, businesses.write).
- **One Lead Alchemist sync everywhere** (2026-10-24, later): Mapping, Accounts → Across all three, the account page ("Sync to Lead Alchemist (Company + contacts)"), Contacts and every "Select all N matching" run use the same sync. "Create missing contacts" starts ticked on all of them (untick for link-only). The sync report counts every contact: linked, created, skipped with the reason (no email or phone, already in another Company, matches more than one Lead Alchemist contact, box unticked, no Companies access) or failed, one line per account; anything skipped or failed shows amber "Needs attention". "Contacts in Lead Alchemist" updates straight after the run.
- **Account Type, client tier and tags on Lead Alchemist contacts** (2026-10-24): every sync writes the Salesforce Account Type (full text) to the contact field "Account Type" and the tier to "Client Tier" (Primary / Secondary), never blanking a value, and tags the contact `ais-connect` plus `ais-business` or `ais-personal`. The same Type goes to Lead Alchemist's built-in Contact Type, whose options Todd set to the Salesforce Types. A changed Type shows in the report. Accounts → Across all three has an Account Type filter. ⬜ A Type on the Company waits on a decision (open question 17).
- **Client tier** (2026-10-24): each account has one primary contact (one column on the account, so never two) and any number of secondary ones. "Make primary" swaps them in one step and logs who did it. New accounts take the applicant; otherwise the only contact; otherwise the first, flagged "check". Accounts → "No primary contact (or one to check)" filter and a warning on the account page; Contacts shows the tier with a filter.
- **Lead Alchemist Companies → accounts** (2026-10-24): Mapping → Lead Alchemist Companies reads every Company (253 today) and suggests the matching account in this app (and so its Salesforce Account): "likely" for the same name, website, phone or business email domain, "possible" for a similar name. Staff pick per row and link in bulk (this app only), add unmatched Companies as new accounts, or link/create them in Salesforce. Needs the Companies scopes on the token.
- **No deletes** (2026-10-24): the app can't delete anything in Salesforce or Lead Alchemist (a guard refuses it on every request).
- 🟡 **Automatic sync**: Salesforce → AIS Connect built 2026-10-25 (webhook, read-only, with a per-contact change log). Still to do: synced accounts pull Salesforce changes (Salesforce wins) and pass them to Lead Alchemist, daily and with "Sync now", with a run log.
- **Lead Alchemist Companies**: built (2026-10-24). Linked accounts add new applicants to their Company; a setting creates Companies for new businesses. The token needs the Businesses scopes (`docs/lead-alchemist-companies-plan.md`).

**Decided**
- Anthony Insurance uses Salesforce. The goal is to **bridge all three**: this app, Lead Alchemist and Salesforce, with data moving in and out.
- Sync **Accounts, their Contacts, and the PDFs** to Files on the account. Anthony has a Salesforce admin who can create the API connection.
- Use the Salesforce API directly where possible; Zapier is the fallback for quick wins.
- **Priority: nice to have** (later phase).

**Default (2026-10-24, until Todd or Anthony changes it):** Salesforce wins for Account and Contact details; the app for application answers; Lead Alchemist for tags and conversations.

## ✅ 12. Ask AI
Built: Admin → Ask AI answers questions about applications, with read-only access and linked references. An AI pre-review also runs on every application.

## 🟡 13. Carrier-submission portal
Today staff can download an Outlook draft to the carrier with the filled PDF attached. The carrier email is set in Settings.

**Decided**
- **Carriers get a magic link**, not an attachment.
  - The link **expires after 48 hours**; the carrier then requests a new link.
  - Every open and download is logged.
- Choose **multiple carriers** per application, using the routing suggestions from #9.
- **Staff approval is required before sending, for now.** It can become automatic per carrier or form later.
- **Bring carrier replies and quotes back into the app** if possible. It is: each submission gets its own reply address, so replies and attachments land on the application. A carrier upload box on the portal page is another option.
- Built privacy-first: no applicant data in the email body, encrypted transport, access log. This follows GLBA and state insurance data-security expectations; to be confirmed by compliance.

## 🟡 14. Follow-up and reactivation for unconverted leads
**Decided**
- **Runs in Lead Alchemist workflows.** This app supplies the triggers: tags, stages and statuses.
- Two separate tracks:
  - **Unfinished applications:** started but never submitted. **Trigger built (E):** these contacts are tagged `app-started` in Lead Alchemist. The workflow itself is still to be built there.
  - **Quoted but not bound:** its own sequence.
- Timing: follow-ups on **days 1, 3, 7 and 30**, plus **renewal reminders 60 and 30 days** before expiration.

## 🟡 15. AI agents
**Decided**
- **Follow-up agents live in Lead Alchemist**, not in this app.
- Agents start in **approval mode**: they draft and staff approve. Some may be built with Claude if Lead Alchemist can't do it.
- Commission and revenue tracking: **unknown**. We need to know where policy and premium data lives today.

---

## From the Oct 26 call with Caitlyn
- ✅ Refresh from Salesforce on the account page (fixed 2026-10-26).
- ✅ Contacts search (now also by business name). 🟡 Accounts search: works in testing; waiting on an example of what failed.
- 🟡 Fewer buttons on the account views (Accounts list: Data mapping and Link to Lead Alchemist removed 2026-10-26; Across all three still to tidy).
- ✅ Bigger search boxes (Todd, 2026-10-26): every admin search box (Applications, Accounts, Across all three, Duplicates, Contacts, Mapping, Salesforce) has its own full-width row with larger text, filters underneath.
- ✅ Kind-of-application filter on Applications.
- ✅ Import old Lead Alchemist form and survey submissions, all at once or ticked forms or single ticked submissions.
- ✅ Import history: every import run listed, with Reverse (removes that run's applications from AIS Connect only).
- ✅ Messages, bulk-run bars and notification columns can be cleared (✕, Clear, Clear: dismiss all).
- ✅ Update in Lead Alchemist: review page to pick which fields to write.
- ✅ Dropdown filters apply without pressing Search.
- ✅ Imported applications keep the Lead Alchemist signature.
- ✅ Imported applications get their PDFs as they import; a catch-up button adds signatures and PDFs to ones imported earlier.
- ✅ Carrier PDF per form: upload the carrier's fillable PDF under Forms and match its boxes to the questions.
- ⬜ Approved AIS PDF layouts per form (waiting on the approved PDFs from Todd).
- ✅ Sport event and single event forms: same questions, AIS and martial arts branding (each shows its own logo from its link).
- ✅ Test submissions don't email the applicant.
- ⬜ Duplicate accounts found in the call: staff merge them with Compare & merge and set the current owner as primary contact.
- ⬜ Ideas from the call (not started): policies bought outside the forms still entered in Salesforce by hand; follow-up for new leads who don't re-engage; attaching PDFs to Salesforce from AIS Connect instead of from Outlook; Salesforce storage running low.

## Changes from the Oct 9 call with Caitlyn (built 2026-10-16)

**Gymnastics limits** (Sports Facility and Boxing Gym unchanged):
- **Products & completed operations:** no longer asked; the carrier PDF always ticks $1M.
- **General aggregate:** a choice of $3M, $4M or $5M.
- **Damage to premises rented:** a choice of $300K, $500K or $1M.
- **Medical payments:** $5,000 or $10,000.
- **Sexual abuse:** adds $1M / $2M. There's no N/A, because abuse coverage is required for youth facilities.
- **Personal & advertising injury:** printed on the carrier form as a fixed $1,000,000, so nothing to fill.
- **$1.5M occurrence:** no form offered it. It only appeared in the PDF mapping, and has been removed there.

**Gymnastics aerial:**
- Aerial silks are capped at **12 ft**, with a clear message (`SILKS_MAX_HEIGHT_FT` in `src/forms/config.ts`).
- The instructor-qualifications question is gone; old answers still show on the carrier PDF.

**Every form:**
- **Dollar amounts:** shown with exactly one "$" in the admin, portal, PDFs and AI review.
- **Typed signature:** already built (#8).

**Emails:** applicant emails use the application's own brand: name, logo, colors, site link, footer and sender name.
- **DSI:** dance, fitness, aerial and gymnastics.
- **MASI:** martial arts and boxing.
- **AIS:** everything else.
- Every email also has a plain-text version.
- A test checks every form's emails for the right brand and no cross-brand leakage.

**LARP:**
- The total participants is now worked out from the youth and adult counts.
- The payment step is replaced by a note that an agent will send a quote after submission.

## New ideas raised (2026-10-10)

### A. Admin form builder with AI ("tell it, and the form changes")
Every form becomes editable in the admin: questions, options, help text, required answers (#4), compliance triggers (#5) and the documents assigned (#5, B).

On each form, an **AI assistant** takes plain-English instructions. For example: "Add a question asking if they have a liquor license; if Yes, require the certificate". It shows the change as a preview, and staff approve before it goes live.

Every change is versioned, so it can be undone, and old applications keep the questions they were answered with.

### B. ✅ Document library, assigned to forms
**Built (2026-10-10):** **Admin → Documents** lets staff upload PDF, Word, PNG or JPG files (up to 4 MB), each with a title and a note for applicants, and pick which forms each document belongs to.
- **On the form:** assigned documents appear at the top under "Documents for this application".
- **In email:** they're linked in the applicant's confirmation email.
- **Access:** files are public by link, so upload only material meant for applicants.

**Next:** the compliance popups (#5) will use this library ("No waiver?" shows and emails the assigned sample waiver). Assigning to *policies*, not just forms, can come with the carrier registry (C).

### C. Carrier registry
A list of carriers managed in the admin, each with:
- name and contacts;
- products and states they write;
- how they accept submissions: magic-link portal, email or their own portal;
- their **own application PDF**, mapped like SFIC;
- which extra features apply to them.

Adding a new carrier, and building or mapping its application, happens in the admin. It powers #9 and #13.

### D. Two-way Lead Alchemist pipeline sync
Today the app pushes changes to Lead Alchemist. Two-way means:
- moving an opportunity's stage in Lead Alchemist updates the application's status in the app;
- changing the status in the app moves the stage in Lead Alchemist.

This needs a Lead Alchemist webhook pointed at the app, and a stage ↔ status map in Settings.

### E. ✅ Save progress and "Started" status
**Built (2026-10-10):**
- **Saved as they go:** each section is saved on the server. The signature is never saved until they submit.
- **Lead Alchemist trigger:** once the applicant gives an email, their contact is created or updated and tagged **`app-started`** and **`app-started:<form>`**. Both tags come off when they submit. This is the trigger for the "unfinished application" follow-up workflow (#14).
- **Save & finish later:** emails a private link that reopens the application on any device.
- **Admin → Unfinished** lists everyone who started but hasn't submitted: section reached, last saved, whether they asked for a resume link, and whether they're tagged in Lead Alchemist. Staff can delete test or duplicate entries.

### F. Carrier replies into the app
Part of #13: carrier replies and quotes are attached to the application automatically.

### G. 🟡 Three-way bridge: app, Lead Alchemist and Salesforce
The long-term shape of #11 and D: one record of each business, person and application, kept in step across all three systems.
**Built (2026-10-24):** Accounts and Contacts in the app mirror Salesforce; Salesforce Accounts can be pulled in and app accounts pushed to Lead Alchemist Companies through the mapping screens; Admin → Salesforce picks what syncs and matches people to Lead Alchemist contacts. **Also built (2026-10-24, later):** Admin → Contacts lists every person across all three systems (filter by any combination, see each person's account, Lead Alchemist Company and same-name look-alikes before syncing, fill in Lead Alchemist from AIS Connect); Accounts → "Across all three" does the same for businesses (Salesforce Accounts and Lead Alchemist Companies not yet linked, contact counts in each, suggested matches, add / sync / link-only); every list has select all matching (runs in batches) and shift-click ranges; Lead Alchemist Companies can be made before their contacts. **Built (2026-10-25):** Salesforce edits come in by webhook (Outbound Message from a Flow; AIS Connect reads the Account or Contact back and updates its copy), and every contact has a change log (account page "Change history", Settings → Tools → Change log). **Built (2026-10-25):** every Lead Alchemist sync fills the Company's custom fields (policy, renewal, Inland Marine, owner alias, …) from the Salesforce Account, matched by field name (Settings → Tools → Company fields). **Next:** passing those Salesforce changes on to Lead Alchemist automatically (today a staff sync).

**Goal (Todd, 2026-10-24):** AIS Connect is the bridge for contacts: push them from Salesforce to Lead Alchemist and from Lead Alchemist to Salesforce, make it easy to come in and do sweeps, and compare the data in all three side by side. Lead Alchemist automations should be able to call AIS Connect (webhooks), which then updates Salesforce (see H).

### H. ⬜ Lead Alchemist automations → AIS Connect → Salesforce
Lead Alchemist workflows send a webhook to AIS Connect (signed, with a shared secret kept in Settings → Integrations); AIS Connect finds the person and account and updates the linked Salesforce records (for example a field on the Contact or Account, or a note), logs it on the account, and adds it to the sync reports. Never deletes; Account Type stays Salesforce-only. To decide: which events and fields (open question 18).
