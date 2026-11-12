import type { NextRequest } from "next/server";
import { withApiKey } from "@/lib/api/http";
import { listForms } from "@/lib/api/service";

/** AIS Connect API: the application forms. */
export const GET = (req: NextRequest) => withApiKey(req, async () => ({ forms: listForms() }));
