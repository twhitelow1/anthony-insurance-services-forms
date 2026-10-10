@AGENTS.md

# Project plan — keep it current

`docs/plan/` is the living plan for this app (overview, feature backlog, roadmap, decisions and open
questions). Whenever a conversation adds, changes or decides anything about features, priorities,
integrations or open questions:

1. Update the matching file(s) in `docs/plan/` in the same branch/PR as the related work (or in a
   docs-only commit if there's no code change). Record decisions with their date in
   `decisions-and-questions.md`, move answered questions out of "Open questions", and update feature
   statuses in `backlog.md` (✅ built · 🟡 partly built · ⬜ not started) when work ships.
2. Re-upload the changed files to the client folder on SharePoint (Microsoft 365 connector):
   DubLow Company Drive › 2. Clients › Anthony Insurance Services › Online Applications App
   (folder item id `01ZYJWYFGHFM6I27YFHBAZARM55ZBYNN4X`), replacing the existing copies:
   `1 - App Overview (README).md`, `2 - Feature Backlog.md`, `3 - Roadmap.md`,
   `4 - Decisions and Open Questions.md`.
3. Call the CRM "Lead Alchemist" in everything user-facing (it's white-labelled GoHighLevel; code and
   env vars keep the `ghl`/`GHL_` names).
