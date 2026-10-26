import { after } from "next/server";
import { isBulkStepToken, SCOPES, triggerSelectionRun, workSelectionRun } from "@/lib/bulk/background";
import type { SelectionScope } from "@/lib/bulk/selection-run";

export const maxDuration = 300;

/** Work on a list's bulk run in the background (see lib/bulk/background). Answers at once. */
export async function POST(req: Request) {
  if (!isBulkStepToken(req.headers.get("x-bulk-token"))) return new Response("Not found", { status: 404 });
  const scope = new URL(req.url).searchParams.get("scope") as SelectionScope;
  if (!SCOPES.includes(scope)) return new Response("Unknown list", { status: 400 });
  after(async () => {
    const run = await workSelectionRun(scope).catch((err) => {
      console.error(`[bulk] ${scope} step failed:`, err instanceof Error ? err.message : err);
      return null;
    });
    // More to do: hand on to a fresh request.
    if (run?.phase === "running") await triggerSelectionRun(scope);
  });
  return Response.json({ ok: true }, { status: 202 });
}
