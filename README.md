# Anthony Insurance Services — Online Applications

Custom, multi-step insurance applications that submit straight into **GoHighLevel**: the contact record, its **custom fields**, and **tags** that start workflows. Built with Next.js and hosted on **Vercel**. Every push to `main` deploys automatically.

| Form | URL |
| --- | --- |
| Sports & Recreation Facility Application (GL + A&H) | `/forms/sports-facility-application` |

## How a submission flows

```
Browser (wizard, validation, tooltips, signature)
   │  POST /api/forms/<slug>/submit
   ▼
Vercel serverless function
   1. Re-validates every answer against the form definition (never trusts the browser)
   2. Drops answers to hidden questions (e.g. pool questions when "Do you have a pool?" = No)
   3. GET  /locations/{id}/customFields      → resolves field names → GHL custom field IDs
   4. POST /contacts/upsert                  → standard fields + custom fields + tags + source
   5. POST /forms/upload-custom-files        → signature PNG → "Applicants Signature" field
   6. POST /contacts/{id}/notes              → full plain-text copy of the application (audit trail)
```

The GHL token only exists on the server. The browser never sees it.

### Why the API instead of inbound webhooks

An inbound-webhook workflow makes you map every field to its custom field by hand in the GHL workflow builder. This application has ~190 fields. Instead, this app maps fields **in code**, by name, and checks the mapping against the live GHL account (see *Mapping audit*). GHL workflows still fire: trigger them on the **tag** `form:sports-facility-application` ("Contact Tag Added").

## Setup

### 1. GHL credentials
In the Anthony Insurance sub-account:
1. **Settings → Private Integrations → Create new integration.** Grant contact view/edit, custom field view, and forms write (forms write is used to upload the signature). Copy the token.
2. **Settings → Business Profile** → copy the **Location ID**.

### 2. Vercel environment variables
Project → Settings → Environment Variables (see `.env.example`):

| Name | Value |
| --- | --- |
| `GHL_API_TOKEN` | Private Integration token |
| `GHL_LOCATION_ID` | Sub-account location ID |
| `ADMIN_SECRET` | Long random string; protects the mapping audit |

### 3. Mapping audit (do this before going live)
After deploying, open:

```
https://<your-domain>/api/admin/ghl-mapping?secret=<ADMIN_SECRET>
```

For every question it shows the GHL custom field it resolved to (`ok`), or `MISSING` / `AMBIGUOUS`. It also lists GHL fields no question uses. Fix a problem in one of two ways:
- Set `ghl: { name: "Exact GHL Field Name" }` (or `ghl: { key: "contact.field_key" }`) on the field in `src/forms/sports-facility-application.ts`, **or**
- rename the field in GHL.

Matching ignores case, spaces, and punctuation, so `Business Website:` matches `business website`.

Answers with no matching GHL field are **not lost**. They are always included in the contact note.

## Features
- **Interactive tooltips**: the (i) icon next to a question opens on hover or keyboard focus, and on tap on phones. Escape or tapping outside closes it.
- **Conditional questions** that appear only when relevant (locations 1–5, non-renewal details, HNOA questions, pools, climbing walls, aerial equipment, trampolines, and more).
- **Dropdowns synced from GHL**: fields marked `syncOptionsFromGhl` use the picklist options from GHL (refreshed every 10 minutes), so the form can't drift from the CRM.
- **Autosave**: progress is saved on the device, so applicants can leave and come back.
- **Drawn e-signature**, captured as a PNG, uploaded to GHL, and timestamped with IP and user agent in the note.
- **Spam protection**: a honeypot field plus per-IP throttling. For hard limits, add a Vercel Firewall rate-limit rule on `/api/forms/*`.
- Mobile-first and accessible (labels, fieldsets, `aria-invalid`, focus management, reduced motion).

## Embedding on another website / GHL funnel

```html
<div data-ais-form="sports-facility-application"
     data-ais-redirect="https://anthonyinsuranceservices.com/thank-you"></div>
<script src="https://<your-domain>/embed.js" async></script>
```

The iframe resizes itself to fit its content. `data-ais-redirect` is optional.

## Adding a new form
1. Copy `src/forms/sports-facility-application.ts` and edit the sections and fields (the helpers `yesNo`, `text`, `num`, `money`, `isYes`, … keep it short).
2. Register it in `src/forms/index.ts`.
3. Deploy, then run the mapping audit.

## Development

```bash
npm install
cp .env.example .env.local   # without GHL creds, submissions are a logged dry run in dev
npm run dev                  # http://localhost:3000
npm test                     # mapping + validation unit tests
npm run lint && npm run typecheck
```
