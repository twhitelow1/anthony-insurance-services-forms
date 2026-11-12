import type { NextRequest } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { applicationDetails } from "@/lib/api/service";

/** AIS Connect API: one application by id or reference. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/applications/[id]">) {
  const { id } = await ctx.params;
  return withApiKey(req, async () => applicationDetails(id));
}
