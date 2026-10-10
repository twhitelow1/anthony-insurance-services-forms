# Feature backlog

Status key: ✅ built · 🟡 partly built · ⬜ not started.
"Decided" records the answers Todd gave on 2026-10-10. Anything still unknown is listed in
[decisions-and-questions.md](decisions-and-questions.md).

| # | Feature | Status |
|---|---|---|
| 1 | Admin portal: statuses, notes, PDF downloads | ✅ |
| 2 | Lead Alchemist submission links on contact records | ✅ |
| 3 | Magic-link sign-in for staff and applicants; applicant status portal | ✅ |
| 4 | Auto-decline for certain answers | 🟡 warnings only |
| 5 | Compliance popups with sample-document attachments | ⬜ |
| 6 | Hired & non-owned auto tooltip | 🟡 aerial forms only |
| 7 | Testing mode for required fields | ⬜ |
| 8 | Click-to-type signature | ⬜ |
| 9 | Conditional carrier routing based on answers | ⬜ |
| 10 | Embeddable, branded forms for the websites | 🟡 `?embed=1` only |
| 11 | Salesforce sync, including PDFs on account records | ⬜ |
| 12 | Ask AI for querying application data | ✅ |
| 13 | Carrier-submission portal with multiple carriers | 🟡 Outlook draft only |
| 14 | Automated follow-up and reactivation for unconverted leads | ⬜ |
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
- **Applicant portal:** shows their applications, a status timeline and PDFs.

## 🟡 4. Auto-decline answers
Today ineligible situations are explained in tooltips and notices, but the applicant can still submit.

**Decided**
- A disqualifying answer **stops** the application: the applicant can't continue.
- Build it as a field setting, a **"required answer"**. For example, "Max aerial height must be 12 ft or less" or "Health-club services must be No". The wrong answer shows a decline message and blocks submit.
- **Declined attempts are saved** and sent to Lead Alchemist tagged `declined`, so staff can follow up or offer another program.
- **Caitlyn will provide the master list** of decline rules. She should be able to set them herself in the admin; see feature A.

## ⬜ 5. Compliance popups with sample documents
For example: "No waiver?" shows a popup with the sample waiver.

**Decided**
- The popup **shows the document and also emails it** to the applicant.
- Documents (sample waiver, risk-management guide and so on) are **uploaded and managed in Settings**, not in code.
- **Custom waivers:** staff can upload more waivers and **assign them to specific policies or forms**; see feature B.
- **Caitlyn assigns the triggers** (which answer shows which document) in the admin.

## 🟡 6. Hired & non-owned auto tooltip
The aerial forms explain it. Sports Facility, Gymnastics and Boxing Gym ask "Add $1M Hired or Non-Owned Auto?" with no explanation.

**Open:** wording. The default proposal is the aerial forms' text: covers rented, borrowed, hired and non-owned vehicles driven on business; not comp or collision; covers injury or damage to others. Anthony or Caitlyn to confirm.

## ⬜ 7. Testing mode
**Decided**
- Enabled by a **special test link**: anyone with the link can skip required fields.
- Test submissions **do go to Lead Alchemist**. They're tagged `test` so they're easy to filter and delete there.
- Test applications are labeled TEST in the admin.

## ⬜ 8. Click-to-type signature
**Decided:** works like DocuSign. The applicant can **type their name**, and it's rendered in a script font as the signature. Drawing stays available.

The PDF shows the signature plus a line: "Signed electronically by [name] on [date and time]". The audit record (time, IP address, browser) is kept with the application.

## ⬜ 9. Conditional carrier routing
Example: an Aerial Yoga Studio with height over 10 ft can only go to two specific carriers; 10 ft or under can go to three.

**Decided**
- Rules are written in **plain English**, for example "Aerial yoga studios over 10 feet only go to Carrier A and Carrier B". Claude turns each into a structured rule, and staff confirm it before it saves.
- Rules rely on a **carrier registry** (feature C).
- Routing **suggests** carriers; staff approve for now (see #13). Automatic sending is a later nice-to-have.

**Prerequisite:** questions used in rules must be number or choice fields, not free text. For example, aerial height becomes a number.

## 🟡 10. Embeddable, branded forms
Today `/forms/<form>?embed=1` hides the page header and can be put in an iframe.

**Decided**
- These **replace the Lead Alchemist widgets** on the websites. Submissions still sync to Lead Alchemist.
- Each form is **branded to its site**: AIS, Dance Studio Insurance (DSI) and Martial Arts School Insurance (MASI) colors and logo.
- Each form's admin page has a **"Copy embed code"** button.
- The iframe resizes to fit its content automatically, with no inner scrollbars.

## ⬜ 11. Salesforce sync
**Decided**
- Anthony Insurance uses Salesforce. The goal is to **bridge all three**: this app, Lead Alchemist and Salesforce, with data moving in and out.
- Sync **Accounts, their Contacts, and the PDFs** to Files on the account. Anthony has a Salesforce admin who can create the API connection.
- Use the Salesforce API directly where possible; Zapier is the fallback for quick wins.
- **Priority: nice to have** (later phase).

**Open:** which system wins when the same record changes in two places.

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

## ⬜ 14. Follow-up and reactivation for unconverted leads
**Decided**
- **Runs in Lead Alchemist workflows.** This app supplies the triggers: tags, stages and statuses.
- Two separate tracks:
  - **Unfinished applications:** started but never submitted. Needs a new **"Started" status**: the app saves progress to the server and tells Lead Alchemist; see feature E.
  - **Quoted but not bound:** its own sequence.
- Timing: follow-ups on **days 1, 3, 7 and 30**, plus **renewal reminders 60 and 30 days** before expiration.

## 🟡 15. AI agents
**Decided**
- **Follow-up agents live in Lead Alchemist**, not in this app.
- Agents start in **approval mode**: they draft and staff approve. Some may be built with Claude if Lead Alchemist can't do it.
- Commission and revenue tracking: **unknown**. We need to know where policy and premium data lives today.

---

## New ideas raised (2026-10-10)

### A. Admin form builder with AI ("tell it, and the form changes")
Every form becomes editable in the admin: questions, options, help text, required answers (#4), compliance triggers (#5) and the documents assigned (#5, B).

On each form, an **AI assistant** takes plain-English instructions. For example: "Add a question asking if they have a liquor license; if Yes, require the certificate". It shows the change as a preview, and staff approve before it goes live.

Every change is versioned, so it can be undone, and old applications keep the questions they were answered with.

### B. Custom waivers and documents assigned to policies
A document library in Settings: upload a waiver or sample document, then assign it to forms or policies. Used by #5 popups and emails.

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

### E. Save progress and "Started" status
- Save the application to the server as the applicant goes, so it can be resumed from any device.
- Mark it **Started / Unfinished** so Lead Alchemist can follow up (#14).

### F. Carrier replies into the app
Part of #13: carrier replies and quotes are attached to the application automatically.

### G. Three-way bridge: app, Lead Alchemist and Salesforce
The long-term shape of #11 and D: one record of each client and application, kept in step across all three systems.
