import { after, type NextRequest } from "next/server";
import { getForm } from "@/forms";
import { getSession } from "@/lib/auth/session";
import { getApplication, updateAnswers } from "@/lib/applications/repo";
import { makePdf } from "@/lib/applications/pipeline";
import { pruneValues, validateForm } from "@/lib/forms/validate";
import type { FormValues } from "@/lib/forms/types";

export const maxDuration = 60;

function sanitize(input: unknown): FormValues {
  const out: FormValues = {};
  if (!input || typeof input !== "object") return out;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v.slice(0, k === "signature" ? 500_000 : 5_000);
    else if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === "string").slice(0, 50);
  }
  return out;
}

/** Staff edit of an application's answers. Same validation as the public form; the PDFs are rebuilt afterwards. */
export async function PUT(req: NextRequest, ctx: RouteContext<"/api/admin/applications/[id]">) {
  const session = await getSession();
  if (session?.role !== "staff") return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await ctx.params;
  const current = await getApplication(id);
  const form = current && getForm(current.formSlug);
  if (!current || !form) return Response.json({ error: "Not found" }, { status: 404 });

  const raw = await req.text();
  if (raw.length > 1_000_000) return Response.json({ error: "Too large" }, { status: 413 });
  let body: { values?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const values = pruneValues(form, sanitize(body.values));
  // The stored signature isn't sent back unless staff redrew it; don't fail validation on it.
  if (!values.signature && current.signature) values.signature = current.signature;
  const errors = validateForm(form, values);
  if (Object.keys(errors).length) return Response.json({ error: "Validation failed", errors }, { status: 422 });

  const result = await updateAnswers(form, id, values, `staff:${session.email}`);
  if (!result) return Response.json({ error: "Not found" }, { status: 404 });
  // Rebuild the carrier application and summary. The Lead Alchemist link always opens the newest.
  if (result.changed.length) after(() => makePdf(form, result.app));
  return Response.json({ ok: true, reference: result.app.reference, changed: result.changed });
}
