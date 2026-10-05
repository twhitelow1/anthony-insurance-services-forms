# Anthony Insurance Services — Applications Portal

Online insurance applications plus a portal around them. Clients apply and track their status without a password. Staff sign in with Microsoft 365 to search and manage every application. **GoHighLevel holds only the contact**, with a link back to the full application. Next.js on Vercel, Postgres (Neon).

| Who | URL | Sign-in |
| --- | --- | --- |
| Applicant | `/forms/sports-facility-application` | none |
| Applicant | `/portal` | one-time email link (no password) |
| Staff | `/admin` | Microsoft 365, `@anthonyinsuranceservices.com` only |

## How it fits together

```
Applicant ──► form ──► POST /api/forms/<slug>/submit
                         1. validate on the server
                         2. save to Postgres  ◄── system of record (nothing lost if GHL is down)
                         3. after response:
                            ├─ GHL: upsert contact + tags + 3 custom fields + short note with link
                            └─ Graph: confirmation email from the agency mailbox

Staff  ──► /admin (Microsoft sign-in) ──► search · view · change status · notes
                         status change ──► GHL custom field + tag swap (workflows react)
                                       └─► optional email to the client

Client ──► /portal ──► email → one-time link → their applications, status, agent notes
```

### What GoHighLevel receives
- **Contact fields:** first and last name, email, phone, website, mailing address, company.
- **Tags:** `form:sports-facility-application` and `app-status:<status>`. The status tag is swapped on every change, so a "Contact Tag Added" workflow can text or email the client.
- **Custom fields:** create these in GHL as single-line text. They're matched by name.
  - `Application Reference`: e.g. `AIS-7K3Q-9XF2`
  - `Application Status`: e.g. "Information needed"
  - `Application Link`: opens that application in `/admin`. Staff click it from the contact.
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
- **Staff sign-in:** Microsoft 365 sign-in (OpenID Connect with PKCE). It checks the tenant ID and the email domain, so other Microsoft accounts are rejected.
- **Client sign-in:** one-time links.
  - Only a SHA-256 hash of each link token is stored.
  - Links expire after 20 minutes, work once, and are limited to 3 per 15 minutes.
  - The link opens a "Continue" page, so Safe Links scanners can't use it up.
  - The response is the same whether or not an email is on file.
- **Access checks:**
  - Every page and server action checks the session itself.
  - Clients can only open applications whose email matches theirs. Any other ID returns 404.
- **Sessions:** HTTP-only, SameSite cookies, signed with `SESSION_SECRET`. Staff sessions last 10 hours, clients 24 hours.
- **Encrypted email:** mail goes out through Exchange Online, so the agency's subject-tag encryption rule applies. Pass `encrypt: true` to `sendMail`, which adds `MAIL_ENCRYPT_TAG`.
- **Audit trail:** every submission, status change, note, sync, and email is recorded on the application's activity log.

## Setup

1. **Database:** Vercel → Storage → add **Neon Postgres** to the project. `DATABASE_URL` is set automatically. Migrations run on every deploy (`npm run build` runs `scripts/migrate.mjs` first).
2. **Microsoft Entra app registration.** An Entra admin at Anthony Insurance creates it:
   - **Supported accounts:** single tenant (this organization only).
   - **Redirect URI (Web):** `https://<APP_URL>/api/auth/microsoft/callback`
   - **API permissions:** Microsoft Graph delegated `openid`, `profile`, `email`, with admin consent. Do **not** add the `Mail.Send` application permission.
   - **Email sending:** Exchange Online **RBAC for Applications** grants the `Application Mail.Send` role, scoped to the sending mailbox only.
   - **Copy** the tenant ID, client ID, and a client secret into Vercel.

   The step-by-step guide, including the PowerShell commands, is in the shared setup doc.
3. **GHL:** create a sub-account Private Integration token and the three custom fields above.
4. **Environment variables:** see `.env.example`.

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
- **Phase 2:** fill the carrier's PDF application from the answers and email it to the carrier through Graph, with the encryption tag.
- ~~**Phase 3:**~~ Done. Claude pre-review and Ask AI are built (see above).
