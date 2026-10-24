import { isAutomationRequest } from "@/lib/auth/automation";
import { runDueJobs } from "@/lib/salesforce/jobs";

export const maxDuration = 60;

/** Vercel Cron (vercel.json): run Salesforce sync retries that are due. Admin page loads do this too. */
export async function GET(req: Request) {
  if (!isAutomationRequest(req)) return new Response("Unauthorized", { status: 401 });
  const results = await runDueJobs(10);
  return Response.json({ ran: results.length, failed: results.filter((r) => r.error).length });
}
