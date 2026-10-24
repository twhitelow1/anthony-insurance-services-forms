import Link from "next/link";
import { requireStaff } from "@/lib/auth/session";
import type { MappingKind } from "@/lib/db/schema";
import { ghlConfig } from "@/lib/ghl/client";
import { getRun, MAPPING_TITLES, summarize } from "@/lib/mapping/runs";
import { salesforceClient } from "@/lib/salesforce/client";
import { slugFor } from "./kinds";

export const metadata = { title: "Data mapping | AIS Connect" };

const STEPS: { kind: MappingKind; what: string; needs: "salesforce" | "lead_alchemist" }[] = [
  {
    kind: "salesforce_import",
    what: "Every Salesforce Account and its Contacts become accounts and contacts in AIS Connect, matched to the ones already here.",
    needs: "salesforce",
  },
  {
    kind: "la_companies",
    what: "Each business account in AIS Connect is matched to a Lead Alchemist Company (or gets a new one), and its contacts are put in that Company.",
    needs: "lead_alchemist",
  },
  {
    kind: "salesforce_push",
    what: "Applications submitted before the Salesforce sync was turned on: pick each account's Salesforce Account, then their Opportunities, contact roles and PDFs are created.",
    needs: "salesforce",
  },
];

const PHASE: Record<string, string> = { scanning: "Scanning", review: "Ready to review", applying: "Applying", done: "Done" };

export default async function Mapping() {
  await requireStaff("/admin/settings/mapping");
  const runs = await Promise.all(STEPS.map(async (s) => {
    const run = await getRun(s.kind);
    return { run, summary: run ? await summarize(run.runId) : null };
  }));
  const connected = { salesforce: !!(await salesforceClient()), lead_alchemist: !!(await ghlConfig()) };
  return (
    <div>
      <Link href="/admin/settings" className="btn-link">← Settings</Link>
      <h1 className="mb-2 mt-3 text-2xl font-semibold">Data mapping</h1>
      <p className="mb-6 max-w-3xl text-sm text-[var(--muted)]">
        Work through these in order. Each one first <strong>scans</strong> (reads only, writes nothing), then shows every record next to the
        match it found, for you to check and change. Nothing is written to AIS Connect, Salesforce or Lead Alchemist until you <strong>confirm</strong>.
      </p>
      <ol className="space-y-4">
        {STEPS.map((s, i) => {
          const { run, summary } = runs[i];
          return (
            <li key={s.kind} className="card !p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="max-w-2xl">
                  <h2 className="font-semibold">{i + 1}. {MAPPING_TITLES[s.kind]}</h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">{s.what}</p>
                  {run && summary && (
                    <p className="mt-2 text-sm">
                      <span className="badge badge-neutral">{PHASE[run.phase]}</span>{" "}
                      {summary.total} record{summary.total === 1 ? "" : "s"}: {summary.link} to link, {summary.create} to create, {summary.skip} to skip
                      {summary.check ? `, ${summary.check} to check` : ""}
                      {summary.applied ? ` · ${summary.applied} applied` : ""}
                      {summary.errors ? ` · ${summary.errors} errors` : ""}
                    </p>
                  )}
                  {!connected[s.needs] && (
                    <p className="mt-2 text-sm text-[var(--danger)]">
                      {s.needs === "salesforce" ? "Connect Salesforce first (Settings → Integrations)." : "Connect Lead Alchemist first (Settings → Integrations)."}
                    </p>
                  )}
                </div>
                <Link className="btn-primary" href={`/admin/settings/mapping/${slugFor(s.kind)}`}>Open</Link>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
