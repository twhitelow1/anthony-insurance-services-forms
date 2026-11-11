import type { NextRequest } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { findApplications } from "@/lib/api/service";

/** AIS Connect API: find applications (POST, so emails never go in a URL). */
export const POST = (req: NextRequest) => withApiKey(req, (_actor, body) => findApplications(body));
