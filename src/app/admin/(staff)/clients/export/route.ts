import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { listClients, type ClientSort } from "@/lib/clients/repo";
import { clientsCsv } from "@/lib/clients/export";
import { CLIENT_SEARCH_COOKIE } from "@/lib/clients/search-cookie";
import { links } from "@/lib/integrations/links";

const MAX_ROWS = 20_000;

/** Export the current Clients list (with the staff member's search) as CSV. Staff only. */
export async function GET(req: NextRequest) {
  // Route handlers don't get the staff layout's check, so it's done here.
  if ((await getSession())?.role !== "staff") return new Response("Sign in as staff to export clients.", { status: 401 });
  const q = (await cookies()).get(CLIENT_SEARCH_COOKIE)?.value ?? "";
  const sortParam = req.nextUrl.searchParams.get("sort");
  const sort: ClientSort = sortParam === "name" || sortParam === "applications" ? sortParam : "latest";
  const rows = [];
  for (let page = 1; rows.length < MAX_ROWS; page++) {
    const { rows: batch } = await listClients({ q, sort, page, pageSize: 500 });
    rows.push(...batch);
    if (batch.length < 500) break;
  }
  const date = new Date().toISOString().slice(0, 10);
  console.info(`[clients] CSV export: ${rows.length} rows`);
  return new Response(clientsCsv(rows, await links()), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="clients-${date}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
