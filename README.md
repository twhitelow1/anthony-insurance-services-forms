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
                            ├─ create the application PDF, store it privately
                            ├─ GHL: upsert contact + tags + 4 custom fields (incl. PDF link) + opportunity
                            ├─ Resend: confirmation email to the applicant
                            └─ Claude: AI pre-review for staff (optional)

Staff  ──► /admin (email sign-in link) ──► search · view · status · notes · PDF · Ask AI
                         status change ──► GHL field + tag + opportunity stage; optional client email
                         "Prepare carrier email" ──► Outlook draft (.eml) with PDF + [encrypt] subject

Client ──► /portal ──► email → one-time link → their applications, status, notes, PDF download
```

### What GoHighLevel receives
- **Contact fields:** first and last name, email, phone, website, mailing address, company.
- **Tags:** `form:sports-facility-application` and `app-status:<status>`. The status tag is swapped on every change, so a "Contact Tag Added" workflow can text or email the client.
- **Custom fields:** create these in GHL as single-line text. They're matched by name.
  - `Application Reference`: e.g. `AIS-7K3Q-9XF2`
  - `Application Status`: e.g. "Information needed"
  - `Application Link`: opens that application in `/admin`. Staff click it from the contact.
  - `Application PDF`: opens the stored PDF. Staff must be signed in; the PDF is never public.
- **An opportunity** in `GHL_PIPELINE_ID`, at stage `GHL_PIPELINE_STAGE_ID`. If `GHL_STAGE_IDS` maps statuses to stages, status changes move it. Bound marks it won, declined marks it lost, withdrawn marks it abandoned.
- **One note** with the reference and the link.

None of the application answers go to GHL.

### Statuses
Received → In review → Information needed → Submitted to carrier → Quote ready → Coverage bound / Declined / Withdrawn. The wording clients see is in `src/lib/applications/status.ts`.

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
- **Next:** fill the carrier's own fillable PDF (5 pages, 295 fields) from the answers once the updated version arrives; it replaces the summary PDF as the carrier attachment.
- ~~**Phase 3:**~~ Done. Claude pre-review and Ask AI are built (see above).
