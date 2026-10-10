import { getLibraryFile } from "@/lib/library";

/** Public download of a library document (sample waivers and similar, meant for applicants). */
export async function GET(_req: Request, ctx: RouteContext<"/library/[id]">) {
  const { id } = await ctx.params;
  const file = await getLibraryFile(id);
  if (!file) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(file.content), {
    headers: {
      "Content-Type": file.contentType,
      "Content-Disposition": `inline; filename="${file.filename.replace(/["\\\r\n]/g, "")}"`,
      "Content-Length": String(file.size),
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "public, max-age=300",
    },
  });
}
