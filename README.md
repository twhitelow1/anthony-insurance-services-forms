# Anthony Insurance Services — Applications Portal

Online insurance applications plus a portal around them. Clients apply and track their status without a password. Staff sign in with Microsoft 365 to search and manage every application. **Lead Alchemist holds only the contact**, with a link back to the full application. Next.js on Vercel, Postgres (Neon).

| Who | URL | Sign-in |
| --- | --- | --- |
| Applicant | `/` lists every form; each is at `/forms/<slug>` (see `docs/forms-review.md`) | none |
| Applicant | `/portal` | one-time email link (no password) |
| Staff | `/admin` | one-time email link, `@anthonyinsuranceservices.com` only |

## How it fits together

```
Applicant ──► form ──► POST /api/forms/<slug>/submit
                         1. validate on the server
                         2. save to Postgres  ◄── system of record (nothing lost if Lead Alchemist is down)
                         3. after response:
                            ├─ fill the carrier's own PDF application + make an answer summary; store both privately
                            ├─ Lead Alchemist: upsert contact + tags + 4 custom fields (incl. PDF link) + opportunity
                            ├─ Resend: confirmation email to the applicant
                            └─ Claude: AI pre-review for staff (optional)

Staff  ──► /admin (email sign-in link) ──► search · view · edit · delete · status · notes · PDF · Ask AI
                         /admin/applicants ──► every applicant by email, with all their applications
                         "Switch to user mode" ──► the client portal, as yourself or as any applicant
                         status change ──► Lead Alchemist field + tag + opportunity stage; optional client email
                         "Prepare carrier email" ──► Outlook draft (.eml) with the filled carrier PDF + [encrypt] subject

Client ──► /portal ──► email → one-time link → their applications, status, notes, filled application PDF
```

### Admin → Settings
Day-to-day settings live in the app, not in Vercel. They take effect immediately:
- **Admins:** who can sign in to /admin. Removing someone signs them out at once, and you can't remove yourself. Addresses in `STAFF_EMAILS` (Vercel) are always admins, as a way back in.
- **Notifications:** who gets an email for every new application.
- **Email sender:** the From and Reply-To addresses. The domain must be verified in Resend. **Send me a test email** checks the setup.
- **Carrier email:** pre-filled on the carrier draft.
- **Lead Alchemist pipeline:** the applications pipeline and stage, the lead pipeline and stage, and status → stage moves. All are picked from dropdowns that Lead Alchemist fills.

Anything left blank falls back to its Vercel variable. Secrets stay in Vercel: `RESEND_API_KEY`, `GHL_API_TOKEN`, `ANTHROPIC_API_KEY`, `SESSION_SECRET` and the database URL.

### What Lead Alchemist receives
- **Contact fields:** first and last name, email, phone, website, mailing address, company.
- **Tags:** `form:sports-facility-application` and `app-status:<status>`. The status tag is swapped on every change, so a "Contact Tag Added" workflow can text or email the client.
- **Custom fields:** create these in Lead Alchemist as single-line text. They're matched by name.
  - `Application Reference`: e.g. `AIS-7K3Q-9XF2`
  - `Application Status`: e.g. "Information needed"
  - `Application Link`: opens that application in `/admin`. Staff click it from the contact.
  - `Application PDF`: `/applications/<id>/pdf`, which always opens the newest filled carrier application, including after an edit. Staff must be signed in; the PDF is never public.
- **One contact per applicant email.** The first sync matches the Lead Alchemist contact by email and saves its ID; every later application from that email updates that same contact by ID (its email in Lead Alchemist is left alone). **Admin → Applicants** shows who's linked, opens the contact in Lead Alchemist, and can link a contact by ID or link everyone by email. If the saved contact is deleted in Lead Alchemist, the next sync falls back to the email match.
- **One opportunity per application** in `GHL_PIPELINE_ID`, at stage `GHL_PIPELINE_STAGE_ID`. Both accept Lead Alchemist's ID or the name as shown in Lead Alchemist, e.g. `Applications` / `Application Submitted`. **Admin → Lead Alchemist setup** confirms what they resolve to. The opportunity carries the application's reference, status, link and PDF in opportunity custom fields with the same four names (create them in Lead Alchemist under the opportunity model). If `GHL_STAGE_IDS` maps statuses to stages, status changes move it. Bound marks it won, declined marks it lost, withdrawn marks it abandoned.
- **Leads leave the lead pipeline.** Set `GHL_LEAD_PIPELINE_ID` (and optionally `GHL_LEAD_STAGE_ID`, e.g. the booked-call stage). When someone applies, their open opportunity there is moved into the applications pipeline and becomes that application's opportunity. Later applications get new opportunities.
- **One note** with the reference, the application link, the PDF link, and a link to every application from that email address.

None of the application answers go to Lead Alchemist.

### Statuses
Received → In review → Information needed → Submitted to carrier → Quote ready → Coverage bound / Declined / Withdrawn. The wording clients see is in `src/lib/applications/status.ts`.

## Managing applications (staff)
- **Applicants** (`/admin/applicants`): one row per email address. Open one to see all of their applications, each with its PDF.
- **Edit answers:** the button on an application page opens the same form, already filled in, and you can jump to any section.
  - Saving runs the same checks as the public form.
  - The activity log records which questions changed.
  - Both PDFs are rebuilt, and the Lead Alchemist link opens the new version.
- **Delete:** at the bottom of an application page. You type the reference to confirm.
  - It permanently removes the application, its PDFs and its log.
  - The Lead Alchemist contact is left as it is.
- **User mode:** "Switch to user mode" opens the client portal for your own email.
  - "View portal as this applicant" on an applicant's page shows exactly what they see.
  - "Switch to admin" takes you back.
- **Applicant's copy:** the confirmation screen has a "View a copy of your application (PDF)" button. It works for one hour without signing in. After that, the applicant uses the portal.

## Staff alerts
Set `NOTIFY_EMAILS` (comma-separated) and those staff get an email for every new application, with links to the application and its PDF. This needs email (Resend) set up.

## Application PDFs
Every application gets a PDF in Anthony Insurance's format. It has a branded header, an applicant summary, numbered sections, Yes/No checkboxes, schedules as tables and the signature block. For forms without a carrier PDF, this is the one sent to the carrier.

## Carrier PDF
Each submission fills in the carrier's own fillable application (`carrier-forms/sfic-stl-app-001.pdf`, SFIC-STL-APP-001 04/2026).
- **What goes on it:** every web form answer is copied onto the matching box or field. The applicant's drawn signature and the date go on the signature line.
- **Addendum page:** answers that don't fit go on an extra last page, as the form's instructions allow. That covers:
  - text too long for its box
  - a third or later location
  - non-renewal details
  - the requested effective date
  - any answer with no matching box on the PDF
- **Skipped questions:** a question the applicant never saw, because an earlier answer hid it (e.g. the trampoline follow-ups after "No trampolines"), prints as **No** on Yes/No pairs and **N/A** in text boxes. The same applies to questions the web form doesn't ask, like Location Name or overnight events.
- **Left blank on purpose:** empty participant and camp table rows, the signer's Title, and "If either above is 'No', do you agree to do so going forward?", where a default "No" would read as a refusal. These exceptions are listed in `blanks.keepBlank` in the mapping.
- **Corporation:** the PDF's Form of Business has no Corporation box, so that answer goes on the addendum.
- **Still editable:** the fields stay fillable, so staff can correct anything before sending.
- **Answer summary:** a summary PDF of the answers is also created for reference.
- **Mapping:** lives in `src/lib/pdf/carrier/sports-facility.ts`. The PDF's field names are generic (`Yes_20`), so each one sits next to its question.
- **New version from the carrier:**
  1. Replace the file in `carrier-forms/`.
  2. Update the field names in the mapping.
  3. Run `npm test`. A test fails on any field name the new PDF doesn't have.
  4. To look at a filled sample, run `CARRIER_PDF_OUT=/tmp/filled.pdf npx vitest run src/lib/pdf/carrier`.

## AI features (Claude)
Both features are optional. They turn on when `ANTHROPIC_API_KEY` is set.
- **AI pre-review:** runs on every new submission (and on demand from the application page). It gives a 2–4 sentence summary, flags graded high / medium / low that each cite the answer they come from, missing or inconsistent answers, and follow-up questions for the applicant. High flags show as a badge in the application list. Staff only; clients never see it.
- **Ask AI** (`/admin/assistant`): staff ask in plain English ("gymnastics gyms in Texas with trampolines"). Claude searches through two **read-only** tools (search and open by reference) and answers with linked reference numbers.
- **Model:** `claude-opus-5-5` by default (`ANTHROPIC_MODEL` to change). Requests use `fallbacks: "default"`, so a declined request is retried on Anthropic's recommended fallback model.
- **What gets sent to Anthropic:** the answers are sent to the Anthropic API; signatures and Lead Alchemist data are not. Applicant text is treated as data, never as instructions.

## Security
- **Sign-in:** one-time links for staff and clients.
  - Only a SHA-256 hash of each token is stored.
  - Links expire after 20 minutes, work once, and are limited to 3 per 15 minutes.
  - The link opens a "Continue" page, so email link scanners can't use it up.
  - The page shows the same message whether or not the address is known.
- **Staff vs client links:** staff links are only sent to `STAFF_EMAIL_DOMAINS` addresses (or `STAFF_EMAILS`), and staff status is re-checked when the link is used. A client link can never open `/admin`.
- **Access checks:**
  - Every page and server action checks the session itself.
  - Clients only see applications and PDFs whose email matches theirs. Any other ID returns 404.
- **PDFs:** stored in Postgres and served only to staff or the applicant, `no-store`, sandboxed.
- **Sessions:** HTTP-only, SameSite cookies, signed with `SESSION_SECRET`. Staff sessions last 10 hours, clients 24 hours.
- **Encrypted carrier email:** staff send the prepared draft from Outlook, so the agency's subject-tag encryption rule applies.
- **Audit trail:** every submission, status change, note, sync, email, PDF and carrier draft is recorded on the application's activity log.

## Testing without sign-in
Set `OPEN_ACCESS=1` (or `true`) in Vercel for Production and redeploy. `/status` shows whether the running deployment sees it.
- Sign-in is switched off: everyone is treated as staff, so `/admin`, every application and every PDF open without a sign-in link.
- A red banner shows on every admin and portal page while it's on.
- Only `DATABASE_URL` is needed in this mode. Without `SESSION_SECRET` the app uses a fixed key, which is fine only because nothing is protected.

Delete the variable and redeploy to turn sign-in back on. Don't leave it on once real applicants use the form.

## Setup
The full step-by-step guide is the shared setup doc. In short:
1. **Database:** Vercel → Storage → Neon Postgres. Migrations run on every deploy.
2. **Resend:** create an account, add and verify the sending domain (DNS records), create an API key.
3. **Lead Alchemist:**
   - Create the 4 custom fields and a sub-account Private Integration token with contacts, custom fields and opportunities scopes.
   - Optional: copy the pipeline ID and stage IDs.
4. **Environment variables:** see `.env.example`, then redeploy.

Microsoft 365 sign-in and Graph mail are still in the code but switched off. Setting the `AZURE_*` variables turns them back on.

## Development

```bash
npm install
cp .env.example .env.local      # set DATABASE_URL=pglite:./.data/db and DEV_STAFF_LOGIN=1
npm run dev                     # emails print to the console when Microsoft isn't configured
npm test                        # unit + repository tests (embedded Postgres)
npm run lint && npm run typecheck
npm run db:generate             # after changing src/lib/db/schema.ts
```

## Adding a form
1. Copy `src/forms/sports-facility-application.ts` and edit the sections and fields. Keep the shared contact ids (`first_name`, `last_name`, `email`, `phone`, `legal_business_name`, `mailing_*`, `requested_effective_date`) and the final `signature` field.
2. Register the new form in `src/forms/index.ts`. `src/forms/forms.test.ts` then checks it automatically: contact fields, Lead Alchemist mappings, unique ids, and that a fully answered application validates, saves and builds its PDF.
3. Fields with `ghl: { standard: "…" }` are copied onto the Lead Alchemist contact.

## Embedding the form elsewhere
**Admin → Forms** has every form's embed code with a copy button.

```html
<div data-ais-form="sports-facility-application" data-ais-brand="ais"></div>
<script src="https://<APP_URL>/embed.js" async></script>
```
- **`data-ais-brand`** (`ais`, `dsi` or `masi`) gives the form that website's colors and font. Without it, a form uses its own site's look. The brand settings are in `src/lib/brands.ts`.
- **Who can embed:** forms can be framed only by anthonyinsuranceservices.com, dancestudioinsurance.com and martialartsschoolinsurance.com, set by `EMBED_ORIGINS` and the headers in `next.config.ts`. The admin, portal and PDFs refuse to load in any frame.
- **Sizing and redirect:** the iframe resizes itself. Add `data-ais-redirect="https://…/thank-you"` to send applicants to a thank-you page after they submit.

## Saved progress, documents and signatures
- **Saved progress:** each section is saved on the server as the applicant goes (in the `drafts` table; the signature is never saved there).
  - Once they give an email, their Lead Alchemist contact is tagged `app-started` and `app-started:<form>`. The tags come off when they submit, so a Lead Alchemist workflow can follow up on unfinished applications.
  - **Save & finish later** emails a private resume link.
  - **Admin → Unfinished** lists everyone who hasn't submitted.
- **Documents:** in **Admin → Documents**, upload sample waivers and similar files and assign them to forms. Applicants see them on the form, and they're linked in the confirmation email. Files are public by link, so upload only what's meant for applicants.
- **Signatures:** applicants can **draw** or **type** their name and pick a script style, like DocuSign. Either way the signature is saved as the same image.

## Roadmap
- ~~Fill the carrier's own fillable PDF.~~ Done (see Carrier PDF). Swap in the updated version when it arrives.
- **Next:** send to the carrier automatically. Today staff download the Outlook draft and press Send.
- ~~**Phase 3:**~~ Done. Claude pre-review and Ask AI are built (see above).
