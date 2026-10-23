import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { isAutomationRequest } from "@/lib/auth/automation";
import { backfillReportCsv, getBackfillState, runBackfillBatch, startBackfill, type BackfillMode } from "@/lib/salesforce/backfill";
import { salesforceClient } from "@/lib/salesforce/client";
import { links } from "@/lib/integrations/links";

export const maxDuration = 60;

/** Staff (signed in) or the CLI (Bearer CRON_SECRET). */
async function who(req: NextRequest): Promise<string | null> {
  if (isAutomationRequest(req)) return "system:backfill-cli";
  const s = await getSession();
  return s?.role === "staff" ? `staff:${s.email}` : null;
}

/** GET: the current state as JSON, or ?report=<runId> for that run's CSV. */
export async function GET(req: NextRequest) {
  if (!(await who(req))) return new Response("Unauthorized", { status: 401 });
  const run = req.nextUrl.searchParams.get("report");
  if (run) {
    if (!/^[0-9a-f-]{36}$/i.test(run)) return new Response("Bad run ID", { status: 400 });
    return new Response(await backfillReportCsv(run, await links()), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="salesforce-backfill-${run.slice(0, 8)}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }
  return Response.json({ state: await getBackfillState() });
}

/** POST { action: "start", mode: "dry_run" | "apply" } or { action: "continue" }: runs one time-boxed batch. */
export async function POST(req: NextRequest) {
  const actor = await who(req);
  if (!actor) return new Response("Unauthorized", { status: 401 });
  const sf = salesforceClient();
  if (!sf) return Response.json({ error: "Salesforce isn't connected (SALESFORCE_* in Vercel)." }, { status: 503 });
  const body = (await req.json().catch(() => ({}))) as { action?: string; mode?: string };
  if (body.action === "start") {
    const mode: BackfillMode = body.mode === "apply" ? "apply" : "dry_run";
    if (mode === "apply") {
      // Applying needs a finished dry run to have been reviewed first.
      const prev = await getBackfillState();
      if (!prev || prev.mode !== "dry_run" || !prev.done) return Response.json({ error: "Finish a dry run (and review its report) before applying." }, { status: 409 });
    }
    await startBackfill(mode, actor);
  } else if (body.action !== "continue") {
    return Response.json({ error: 'action must be "start" or "continue"' }, { status: 400 });
  }
  try {
    const state = await runBackfillBatch({ sf, links: await links(), timeBudgetMs: 45_000 }, actor);
    return Response.json({ state });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err), state: await getBackfillState() }, { status: 500 });
  }
}
