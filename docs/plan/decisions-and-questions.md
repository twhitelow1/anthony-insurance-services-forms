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
| 2026-10-10 | Testing mode is a **special link**. Test submissions go to Lead Alchemist, tagged `test`. |
| 2026-10-10 | Typed signatures **work like DocuSign**. |
| 2026-10-10 | Embedded forms **replace the Lead Alchemist widgets**, are branded per site, and have a copy-embed-code button. |
| 2026-10-10 | **Staff approval before carrier sending, for now.** |
| 2026-10-10 | Follow-up sequences and follow-up agents **live in Lead Alchemist**. Agents start in approval mode. |
| 2026-10-10 | Salesforce is used by Anthony Insurance. Sync accounts, contacts and PDFs. The goal is to bridge the app, Lead Alchemist and Salesforce. |
| 2026-10-10 | "Started" (an unfinished application) and "Quoted but not bound" are **separate follow-up tracks**. |

## Open questions

| # | Question | Who | Blocks |
|---|---|---|---|
| 1 | **Master list of decline rules:** which answers, on which forms, stop an application, and the message to show | Caitlyn | #4 |
| 2 | **Compliance triggers and documents:** which answers show which document. Send the files (sample waiver, risk-management guide, others). | Caitlyn | #5, B |
| 3 | **Hired & non-owned auto wording.** Proposal: reuse the aerial forms' text. | Anthony or Caitlyn | #6 |
| 4 | **Carrier list:** name, contact, products and states, how each accepts submissions, and their application PDFs | Anthony | C, #13, #9 |
| 5 | **Compliance sign-off** on the carrier magic-link design (48-hour links, access log) | Anthony / compliance | #13 |
| 6 | **Brand assets** for AIS, DSI and MASI: logos and colors | Todd / Anthony | #10 |
| 7 | **Lead Alchemist stage ↔ app status map** for the two-way sync | Todd | D |
| 8 | **Salesforce:** admin contact for the API connection, and which system wins when a record changes in two places | Anthony | #11 |
| 9 | **Commission and revenue data:** where policies and premiums live today (agency system, QuickBooks, spreadsheets), and the commission rates | Anthony | #15 |
| 10 | **Aerial forms' General Aggregate Limit options:** currently $1M–$5M, taken from the fitness PDF | Caitlyn | — |
| 11 | **Dropdown options** not visible in the original widgets: "How did you hear about us?", event type and level, and others (see `docs/forms-review.md`) | Caitlyn | — |
| 12 | **Fillable carrier PDFs** for Fitness & Cross-Training, LARP 2026, Martial Arts Instructor and MMA Events, so they fill like SFIC | Anthony | — |
| 13 | Should the **MMA / Boxing / Kickboxing / Wrestling Events** PDF become a web form? | Anthony | — |
