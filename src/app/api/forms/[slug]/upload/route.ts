import type { NextRequest } from "next/server";
import { getForm } from "@/forms";
import { isInputField } from "@/lib/forms/types";
import { checkUpload, MAX_UPLOAD_BYTES, saveUpload, uploadRef } from "@/lib/applications/uploads";

/** An applicant attaches a file (e.g. a waiver) while filling in a form. */

// Best-effort per-instance throttle, like the submit route.
const recent = new Map<string, number[]>();
function throttled(ip: string) {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60_000);
  hits.push(now);
  recent.set(ip, hits);
  return hits.length > 20;
}

export async function POST(req: NextRequest, ctx: RouteContext<"/api/forms/[slug]/upload">) {
  const { slug } = await ctx.params;
  const form = getForm(slug);
  if (!form) return Response.json({ error: "Form not found" }, { status: 404 });

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (throttled(ip)) return Response.json({ error: "Too many uploads. Please wait a few minutes." }, { status: 429 });
  if (Number(req.headers.get("content-length") ?? 0) > MAX_UPLOAD_BYTES + 64 * 1024) {
    return Response.json({ error: "That file is over 4 MB. Try a smaller file or a PDF." }, { status: 413 });
  }

  const data = await req.formData().catch(() => null);
  const file = data?.get("file");
  const fieldId = String(data?.get("field") ?? "");
  const field = form.sections.flatMap((s) => s.fields).find((f) => isInputField(f) && f.id === fieldId);
  if (!field || field.type !== "file") return Response.json({ error: "This form doesn't take uploads there." }, { status: 400 });
  if (!(file instanceof File)) return Response.json({ error: "Choose a file to upload." }, { status: 400 });

  const checked = checkUpload(file.name, file.size);
  if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });

  const row = await saveUpload({ formSlug: slug, fieldId, ...checked, content: new Uint8Array(await file.arrayBuffer()) });
  return Response.json({ ref: uploadRef(row.id, row.filename), filename: row.filename });
}
