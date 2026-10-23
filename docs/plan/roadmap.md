# Roadmap

A proposed build order, grouped so each phase ships something usable. Feature numbers match
[backlog.md](backlog.md); letters are the new ideas at the bottom of that file. Reorder freely.

## Now (from the Oct 16 call)
| Item | Status |
|---|---|
| Aerial Instructor live on dancestudioinsurance.com, replacing the Gravity Form | **Live** (by 2026-10-20). Caitlyn approved the test. |
| Aerial Instructor waiver upload, with the "required before coverage starts" popup | Built |
| Lead Alchemist: a fuller note per application, and links on every opportunity card | Built |
| Fitness Class / Health Club A on the DSI site | Next |
| "Prepare carrier email" → draft in Outlook with the PDF attached | After Aerial Instructor; needs the Microsoft 365 app |
| Retire the two equipment forms; "Email us" buttons; fix the yoga studio page's PDF link | Website work (Jordon / Todd) |

## Shipped 2026-10-16 (Oct 9 call with Caitlyn)
Gymnastics limits, auto-declines, compliance popups with sample documents, 12 ft silks limit, hired & non-owned auto tooltip · Staff testing mode (#7) · Branded applicant emails · One-"$" currency formatting · LARP auto total and no payment step

## Shipped 2026-10-10
Typed or drawn signature (#8) · Save progress + "Started" status (E) · Document library (B) · Branded embeds (#10)

## Phase 1: Quick wins and polish (days)
| Item | Why now |
|---|---|
| #6 Hired & non-owned auto tooltip on Sports Facility and Boxing Gym too (gymnastics done) | Caitlyn's final wording |
| ~~#7 Testing mode~~ | ✅ shipped (staff only) |
| #8 follow-up: "Signed electronically by …" line on the PDF | Small |

## Phase 2: Rules on the forms (1–2 weeks)
| Item | Needs |
|---|---|
| #4 More decline rules (gymnastics done); save declined attempts and tag them in Lead Alchemist | Caitlyn's master list |
| #5 Compliance popups on more forms (gymnastics done), managed in the admin | The real documents |
| ~~B Document library~~ | ✅ shipped |
| ~~E Save progress and "Started" status~~ | ✅ shipped |

## Phase 3: Websites
| Item | Needs |
|---|---|
| ~~#10 Branded embeds with a copy-embed-code button~~ | ✅ shipped |
| Swap the Lead Alchemist widgets on the three sites for the new embed codes | Todd or the web team, in WordPress: paste the codes from Admin → Forms |

## Phase 4: Carriers (2–3 weeks)
| Item | Needs |
|---|---|
| C Carrier registry, managed in the admin | The list of carriers and how each accepts submissions |
| #13 Carrier portal: 48-hour magic links, multiple carriers, staff approval, access log | Compliance sign-off |
| F Carrier replies and quotes land on the application | — |
| #9 Plain-English routing rules | Number fields for the rule questions (e.g. aerial height) |

## Phase 5: Lead Alchemist automation (1–2 weeks, mostly in Lead Alchemist)
| Item | Needs |
|---|---|
| D Two-way pipeline sync (Lead Alchemist stage ↔ app status) | A Lead Alchemist webhook |
| #14 Follow-up workflows: unfinished apps (trigger: tag `app-started`, now live), and quoted-not-bound on days 1, 3, 7 and 30; renewals at 60 and 30 days | Built as Lead Alchemist workflows |
| #15 Follow-up agents in Lead Alchemist, in approval mode | — |

## Phase 6: Admin form builder with AI (2–3 weeks)
| Item | Needs |
|---|---|
| A Edit forms in the admin, plus an AI assistant that changes a form from plain-English instructions; versioned, with preview and approval | Builds on phases 2 and 4 |

## Phase 7: Salesforce and the three-way bridge (nice to have)
| Item | Needs |
|---|---|
| #11 Accounts, contacts, opportunities and PDFs synced to Salesforce, with three-way links and Admin → Clients | 🟡 Built (feature/salesforce-sync). Next: Salesforce admin setup, sandbox dry run, live, then the backfill |
| G Two-way across all three systems (Salesforce → app and Lead Alchemist; Lead Alchemist Companies) | Companies scopes; the conflict rule (open question 8) |
| #15 Commission and revenue tracking | To learn where policy and premium data lives |

## Already done
#1 Admin portal, #2 Lead Alchemist links, #3 Magic-link sign-in and portal, #12 Ask AI, #8 Typed/drawn signature, #10 Branded embeds, B Document library, E Save progress + Started status, #7 Testing mode.

## Later (from the Oct 9 call; don't block)
Conditional carrier routing (e.g. aerial height over or under 10 ft), iframe embeds matched to the DSI site, Salesforce sync, extending Ask AI, and multi-carrier submission with checkboxes. These map to #9, #10, #11, #12 and #13.
