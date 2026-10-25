import { after, type NextRequest } from "next/server";
import { enqueueInbound, isWebhookToken, outboundAck, parseOutboundMessage } from "@/lib/salesforce/inbound";
import { runDueJobs } from "@/lib/salesforce/jobs";

export const maxDuration = 60;

const xml = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/xml; charset=utf-8" } });

/**
 * Salesforce Outbound Messages (a Flow on Account and Contact changes). The address carries a
 * secret only AIS Connect and Salesforce know; the change is queued and acknowledged at once,
 * then read back from Salesforce right after the response is sent.
 */
export async function POST(req: NextRequest, { params }: RouteContext<"/api/webhooks/salesforce/[token]">) {
  if (!isWebhookToken((await params).token)) return new Response("Not found", { status: 404 });
  const body = (await req.text()).slice(0, 2_000_000);
  const { items } = parseOutboundMessage(body);
  try {
    const queued = await enqueueInbound(items);
    console.info(`[salesforce] webhook: ${items.length} change(s), ${queued} queued`);
  } catch (err) {
    console.error("[salesforce] webhook couldn't queue the change:", err instanceof Error ? err.message : err);
    return xml(outboundAck(false), 500); // Salesforce sends it again later
  }
  after(() => runDueJobs(10).catch((err) => console.error("[salesforce] webhook run failed", err)));
  return xml(outboundAck(true));
}
