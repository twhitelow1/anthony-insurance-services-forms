import type { NextRequest } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { changeStatus } from "@/lib/api/service";

/** AIS Connect API: change an application's status. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/v1/applications/[id]/status">) {
  const { id } = await ctx.params;
  return withApiKey(req, (actor, body) => changeStatus({ ...body, application: id }, actor));
}
