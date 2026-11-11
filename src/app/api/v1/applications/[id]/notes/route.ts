import type { NextRequest } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { addNote } from "@/lib/api/service";

/** AIS Connect API: add a note to an application. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/v1/applications/[id]/notes">) {
  const { id } = await ctx.params;
  return withApiKey(req, (actor, body) => addNote({ ...body, application: id }, actor));
}
