# Decisions and open questions

## Decisions so far

| Date | Decision |
|---|---|
| 2026-10 | The CRM is called **Lead Alchemist** everywhere staff or clients see it. GoHighLevel is the underlying platform. |
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
| 2026-10-16 | **The Fitness form fills the carrier's own PDF** (CTF 2/28/2023), like SFIC. The premium calculator, card details and agent signature are left for Acrobat, the agency and the agent. |
| 2026-10-16 | **The downloaded fitness PDF looks exactly like the carrier's blank form, filled in:** the same four pages, its own font, ticks and radio buttons. An addendum page is added only when an answer has no box. |

## Open questions

| # | Question | Who | Blocks |
|---|---|---|---|
| 1 | **Master list of decline rules:** which answers, on which forms, stop an application, and the message to show | Caitlyn | #4 |
| 2 | **Compliance triggers and documents:** which answers show which document. Send the files (sample waiver, risk-management guide, others). | Caitlyn | #5, B |
| 3 | **Hired & non-owned auto wording.** Caitlyn is sending it; placeholder text is live on gymnastics. | Caitlyn | #6 |
| 3b | **Real sample documents** for the concussion and background-check popups, to replace the placeholders | Caitlyn | #5 |
| 3c | Should the gymnastics **declines, compliance popups and 12 ft silks limit** also apply to Aerial Yoga / Aerial Dance, Sports Facility or Boxing Gym? | Caitlyn | #4, #5 |
| 3d | **The DSI email that linked to the martial arts page:** this app's emails never used DSI branding before 2026-10-16, so that email was probably a Lead Alchemist workflow. Which email was it? | Caitlyn / Todd | — |
| 4 | **Carrier list:** name, contact, products and states, how each accepts submissions, and their application PDFs | Anthony | C, #13, #9 |
| 5 | **Compliance sign-off** on the carrier magic-link design (48-hour links, access log) | Anthony / compliance | #13 |
| 6 | **Brand assets:** confirm MASI's brand colors (current: charcoal #262e37 with a red accent), and send the AIS logo file (PNG or SVG) | Todd / Anthony | #10 polish |
| 6b | **Lead Alchemist workflow** for unfinished applications: build it on the tag `app-started` (days 1, 3, 7, 30) | Todd | #14 |
| 6c | **Swap the website widgets** for the embed codes from Admin → Forms | Todd / web team | #10 rollout |
| 7 | **Lead Alchemist stage ↔ app status map** for the two-way sync | Todd | D |
| 8 | **Salesforce:** admin contact for the API connection, and which system wins when a record changes in two places | Anthony | #11 |
| 9 | **Commission and revenue data:** where policies and premiums live today (agency system, QuickBooks, spreadsheets), and the commission rates | Anthony | #15 |
| 10 | **Aerial forms' General Aggregate Limit options:** currently $1M–$5M, taken from the fitness PDF | Caitlyn | — |
| 11 | **Dropdown options** not visible in the original widgets: "How did you hear about us?", event type and level, and others (see `docs/forms-review.md`) | Caitlyn | — |
| 12 | **Fillable carrier PDFs** for LARP 2026, Martial Arts Instructor and MMA Events, so they fill like SFIC. Fitness is done (2026-10-16). | Anthony | — |
| 12b | **Fitness premium on the carrier PDF:** its premium boxes show $0.00 until someone edits a field in Acrobat. Leave them for the agent, or have the app work the premium out from the PDF's own rate table? | Todd | — |
| 13 | Should the **MMA / Boxing / Kickboxing / Wrestling Events** PDF become a web form? | Anthony | — |
