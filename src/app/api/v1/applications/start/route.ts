import type { NextRequest } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { startApplication } from "@/lib/api/service";

/** AIS Connect API: start an application for someone; they get a link to check, finish and sign it. */
export const POST = (req: NextRequest) => withApiKey(req, (actor, body) => startApplication(body, actor));
