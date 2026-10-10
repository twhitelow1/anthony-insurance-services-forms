import type { NextRequest } from "next/server";
import { getForm } from "@/forms";
import { decodeRef, getDraft, markResumeEmailed, resumeUrl } from "@/lib/applications/drafts";
import { emailLayout, sendMail } from "@/lib/mail";

/** "Save & finish later": email the applicant a private link back to their application. */
export async function POST(req: NextRequest, ctx: RouteContext<"/api/forms/[slug]/draft/email">) {
  const { slug } = await ctx.params;
  const form = getForm(slug);
  if (!form) return Response.json({ error: "Form not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { ref?: unknown };
  const ref = decodeRef(body.ref);
  const draft = ref && (await getDraft(ref));
  if (!ref || !draft || draft.formSlug !== slug || draft.status !== "started") {
    return Response.json({ error: "Save your progress first." }, { status: 404 });
  }
  if (!draft.email) return Response.json({ error: "Enter your email address first, then try again." }, { status: 400 });
  if (draft.resumeEmailedAt && Date.now() - draft.resumeEmailedAt.getTime() < 2 * 60_000) {
    return Response.json({ ok: true, email: draft.email }); // already sent a moment ago
  }
  try {
    await sendMail({
      to: draft.email,
      subject: `Finish your ${form.title}`,
      html: emailLayout({
        heading: "Pick up where you left off",
        paragraphs: [
          `Your ${form.title}${draft.businessName ? ` for ${draft.businessName}` : ""} is saved.`,
          "Use the button below to finish it on any device. Keep this email private: the link opens your saved answers.",
        ],
        button: { label: "Finish my application", url: resumeUrl(slug, ref) },
      }),
    });
  } catch (err) {
    console.error("[draft] resume email failed", err);
    return Response.json({ error: "We couldn't send the email right now. Your progress is still saved on this device." }, { status: 502 });
  }
  await markResumeEmailed(draft.id);
  return Response.json({ ok: true, email: draft.email });
}
