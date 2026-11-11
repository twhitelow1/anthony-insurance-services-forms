import type { NextRequest } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { describeForm } from "@/lib/api/service";

/** AIS Connect API: one form's questions. */
export async function GET(req: NextRequest, ctx: RouteContext<"/api/v1/forms/[slug]">) {
  const { slug } = await ctx.params;
  return withApiKey(req, async () => describeForm(slug));
}
