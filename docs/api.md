# AIS Connect API and MCP connector

Lets an AI assistant (for example Ask AI in Lead Alchemist) or an automation work with AIS Connect:

- read the application forms;
- start an application for someone;
- look applications up;
- change their status and add notes.

It never submits an application. Every application needs the applicant's own signature, so `start_application` saves the answers given and emails the applicant a private link. On that link they check the answers, fill in anything still needed and sign. Nothing is ever deleted, and every change is logged on the application as `api:<key name>`.

## Keys

Make a key in **Settings → Integrations → AIS Connect API and MCP connector**.

- The key is shown once. Only its SHA-256 fingerprint is stored.
- Revoke a key there and it stops working at once.
- Send it as a header on every request: `Authorization: Bearer ais_live_…`
- Never put a key in a URL, a document or a chat.

## MCP connector (for Ask AI and other assistants)

- **URL:** `https://<app>/api/mcp`
- **Transport:** Streamable HTTP. It's stateless and replies with plain JSON (no event stream).
- **Auth:** the `Authorization: Bearer <key>` header.

| Tool | What it does |
| --- | --- |
| `list_forms` | The forms: id, title, website. |
| `describe_form` | One form's questions by section: ids, types, options, which are required or conditional. |
| `start_application` | Saves the answers given (question id → answer; `email` required) and emails the applicant the link to finish and sign. `sendEmail: false` returns the link without emailing it. Returns the questions still needed. |
| `find_applications` | Finds applications by `email`, `leadAlchemistContactId`, `reference` or `search`. Returns status, dates, admin and PDF links. |
| `get_application` | One application: status, every answer, recent activity. |
| `set_application_status` | Changes the status, with an optional note. The applicant is emailed only with `notifyApplicant: true`. |
| `add_application_note` | Adds a note, staff-only unless `clientVisible: true`. |

For choice questions, send the option's value or its label; AIS Connect stores the value. The signature is never accepted from the API.

## REST API

Same key and header. JSON in and out. Emails are only ever sent in request bodies, never in URLs.

| Method and path | Body |
| --- | --- |
| `GET /api/v1/forms` | |
| `GET /api/v1/forms/{form}` | |
| `POST /api/v1/applications/start` | `{ "form", "answers": {…}, "sendEmail"? }` |
| `POST /api/v1/applications/search` | `{ "email" \| "leadAlchemistContactId" \| "reference" \| "search", "limit"? }` |
| `GET /api/v1/applications/{id or reference}` | |
| `POST /api/v1/applications/{id or reference}/status` | `{ "status", "note"?, "notifyApplicant"? }` |
| `POST /api/v1/applications/{id or reference}/notes` | `{ "note", "clientVisible"? }` |

Errors come back as `{ "error": "…" }` with an HTTP status: 400, 401 (missing or revoked key), 404 or 500.
