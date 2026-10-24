# Lead Alchemist Associations: Company ↔ Contact (research, 2026-10-24)

## Two ways to tie a contact to a Company

| | Business field (built) | Association relation (proposed) |
|---|---|---|
| API | `POST /contacts/bulk/business` sets the contact's `businessId` | `POST /associations/relations` |
| Per contact | **One** Company | **Many** Companies (many-to-many, if the association allows it) |
| Labels | None | Single label ("Member") or a pair ("Owner ↔ Business", "Instructor ↔ Studio") |
| Scopes | Businesses (view, edit) | Associations (view) + Association relations (view, edit); Businesses for the Company itself |
| Workflows | The contact's Company field | Workflow actions can enrol, remove or auto-associate by association label |

The association route fixes the instructor-at-several-studios case: today the person stays in one
Company and gets "company: name" tags for the others.

## Endpoints (sub-account token, `Version` header)

| Call | Use |
|---|---|
| `GET /associations/?locationId=` | Every association in the sub-account (`associationType` SYSTEM_DEFINED or USER_DEFINED) |
| `GET /associations/objectKey/{objectKey}?locationId=` | Associations for one object, e.g. `business` or `contact` |
| `GET /associations/key/{key}?locationId=` | One association by its key |
| `POST /associations/` | Create a USER_DEFINED association; documented pairs are contact–contact, contact–custom object, **business–contact**. Body: `locationId, key, firstObjectLabel, firstObjectKey, secondObjectLabel, secondObjectKey` |
| `POST /associations/relations` | Link two records. Body: `locationId, associationId, firstRecordId, secondRecordId` (same order as the association's first/second objects) |
| `GET /associations/relations/{recordId}?locationId=&skip=&limit=&associationIds=` | The relations a record already has (used to skip duplicates) |
| `DELETE /associations/relations/{id}` | Exists; **the app's no-delete guard keeps refusing it**. Unlinking stays in Lead Alchemist. |

## Proposed build

1. **Setup (once, in Lead Alchemist):**
   - In Settings → Objects → Companies → Associations, create a business ↔ contact association.
   - Use the pair "Business ↔ Contact", or labels such as "Studio ↔ Instructor".
   - Make it Many-to-Many.
   - The app can create it through `POST /associations/` if staff prefer; key `business_contact`.
2. **Settings → Integrations** gets a read-only check: it finds the association by key or object key and shows its ID and type.
3. **Syncing an account** keeps setting the Business field for the main Company. It also creates a relation for every account a person belongs to, including the extra companies from `account_contacts`. Existing relations are read first, so nothing is duplicated.
4. **Multi-company people** (Mapping → Multi): relations replace the "company: name" tags. Tags can stay as a fallback until the association exists.
5. The no-delete guard allows `POST /associations/relations` and still refuses every `DELETE`.

## Still to confirm on the live account

- Whether Lead Alchemist already has a SYSTEM_DEFINED business ↔ contact association. Its `businessId` link may surface as one. This is a single read once the token has `associations.readonly`.
- The exact scope names on the Private Integration screen ("Associations" and "Association Relations", view and edit).
- Limits: the help docs mention up to 10 associations per contact and 1,000 records per association slot.
