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
3. The CRM is **Lead Alchemist**, initials **LA**, everywhere: UI, emails, notes, docs, PRs, commits and chat
   with Todd. Never write the underlying platform's name or "GHL". Its address is https://app.leadalchemist.io
   (all "Open in Lead Alchemist" links use it). Vercel variables use the `LA_` prefix (`LA_API_TOKEN`…);
   the old `GHL_` names are only read as a fallback. Some internal code identifiers still say `ghl`.

4. The app is called **AIS Connect** in the UI, messages, docs and chat with Todd (not "this app").

# Always give Todd a preview link

Whenever you push to a PR branch, include the Vercel preview link in your reply (and in the PR body), pointing at
the page that changed. The branch preview for `claude/anthony-insurance-ghl-forms-fni0pj` is
https://anthony-insurance-services-forms-git-claude-a-ec4b8f-twhitelow1.vercel.app — for other branches, take it from
the Vercel bot's comment on the PR. Production is https://anthony-insurance-services-forms.vercel.app.
