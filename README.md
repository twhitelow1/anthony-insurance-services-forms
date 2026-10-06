# Anthony Insurance Services — Applications Portal

Online insurance applications plus a portal around them. Clients apply and track their status without a password. Staff sign in with Microsoft 365 to search and manage every application. **GoHighLevel holds only the contact**, with a link back to the full application. Next.js on Vercel, Postgres (Neon).

| Who | URL | Sign-in |
| --- | --- | --- |
| Applicant | `/forms/sports-facility-application` | none |
| Applicant | `/portal` | one-time email link (no password) |
| Staff | `/admin` | one-time email link, `@anthonyinsuranceservices.com` only |

## How it fits together

```
Applicant ──► form ──► POST /api/forms/<slug>/submit
                         1. validate on the server
                         2. save to Postgres  ◄── system of record (nothing lost if GHL is down)
                         3. after response:
                            ├─ fill the carrier's own PDF application + make an answer summary; store both privately
                            ├─ GHL: upsert contact + tags + 4 custom fields (incl. PDF link) + opportunity
                            ├─ Resend: confirmation email to the applicant
                            └─ Claude: AI pre-review for staff (optional)

Staff  ──► /admin (email sign-in link) ──► search · view · edit · delete · status · notes · PDF · Ask AI
                         /admin/applicants ──► every applicant by email, with all their applications
                         "Switch to user mode" ──► the client portal, as yourself or as any applicant
                         status change ──► GHL field + tag + opportunity stage; optional client email
                         "Prepare carrier email" ──► Outlook draft (.eml) with the filled carrier PDF + [encrypt] subject

Client ──► /portal ──► email → one-time link → their applications, status, notes, filled application PDF
```

### What GoHighLevel receives
- **Contact fields:** first and last name, email, phone, website, mailing address, company.
- **Tags:** `form:sports-facility-application` and `app-status:<status>`. The status tag is swapped on every change, so a "Contact Tag Added" workflow can text or email the client.
- **Custom fields:** create these in GHL as single-line text. They're matched by name.
  - `Application Reference`: e.g. `AIS-7K3Q-9XF2`
  - `Application Status`: e.g. "Information needed"
  - `Application Link`: opens that application in `/admin`. Staff click it from the contact.
  - `Application PDF`: `/applications/<id>/pdf`, which always opens the newest filled carrier application, including after an edit. Staff must be signed in; the PDF is never public.
- **An opportunity** in `GHL_PIPELINE_ID`, at stage `GHL_PIPELINE_STAGE_ID`. If `GHL_STAGE_IDS` maps statuses to stages, status changes move it. Bound marks it won, declined marks it lost, withdrawn marks it abandoned.
- **One note** with the reference, the application link, the PDF link, and a link to every application from that email address.

None of the application answers go to GHL.

### Statuses
Received → In review → Information needed → Submitted to carrier → Quote ready → Coverage bound / Declined / Withdrawn. The wording clients see is in `src/lib/applications/status.ts`.

## Managing applications (staff)
- **Applicants** (`/admin/applicants`): one row per email address. Open one to see all of their applications, each with its PDF.
- **Edit answers:** the button on an application page opens the same form, already filled in, and you can jump to any section.
  - Saving runs the same checks as the public form.
  - The activity log records which questions changed.
  - Both PDFs are rebuilt, and the GHL link opens the new version.
- **Delete:** at the bottom of an application page. You type the reference to confirm.
  - It permanently removes the application, its PDFs and its log.
  - The GHL contact is left as it is.
- **User mode:** "Switch to user mode" opens the client portal for your own email.
  - "View portal as this applicant" on an applicant's page shows exactly what they see.
  - "Switch to admin" takes you back.
- **Applicant's copy:** the confirmation screen has a "View a copy of your application (PDF)" button. It works for one hour without signing in. After that, the applicant uses the portal.

## Carrier PDF
Each submission fills in the carrier's own fillable application (`carrier-forms/sfic-stl-app-001.pdf`, SFIC-STL-APP-001 04/2026).
- **What goes on it:** every web form answer is copied onto the matching box or field. The applicant's drawn signature and the date go on the signature line.
- **Addendum page:** answers that don't fit go on an extra last page, as the form's instructions allow. That covers:
  - text too long for its box
  - a third or later location
  - non-renewal details
  - the requested effective date
  - any answer with no matching box on the PDF
- **Left blank:** questions the web form doesn't ask: Location Name, overnight events and Title.
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
- **What gets sent to Anthropic:** the answers are sent to the Anthropic API; signatures and GHL data are not. Applicant text is treated as data, never as instructions.

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

## Setup
The full step-by-step guide is the shared setup doc. In short:
1. **Database:** Vercel → Storage → Neon Postgres. Migrations run on every deploy.
2. **Resend:** create an account, add and verify the sending domain (DNS records), create an API key.
3. **GHL:**
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
1. Copy `src/forms/sports-facility-application.ts` and edit the sections and fields.
2. Register the new form in `src/forms/index.ts`.
3. Fields with `ghl: { standard: "…" }` are copied onto the GHL contact.

## Embedding the form elsewhere

```html
<div data-ais-form="sports-facility-application"></div>
<script src="https://<APP_URL>/embed.js" async></script>
```

## Roadmap
- ~~Fill the carrier's own fillable PDF.~~ Done (see Carrier PDF). Swap in the updated version when it arrives.
- **Next:** send to the carrier automatically. Today staff download the Outlook draft and press Send.
- ~~**Phase 3:**~~ Done. Claude pre-review and Ask AI are built (see above).
