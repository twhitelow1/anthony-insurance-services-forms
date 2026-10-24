import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth/session";
import { getClientIdForEmail, normalizeEmail } from "@/lib/clients/repo";

/** Old email-based links (e.g. in earlier Lead Alchemist notes) → the client's page, which never has the email in its address. */
export default async function Applicant({ params }: PageProps<"/admin/applicants/[email]">) {
  await requireStaff("/admin/clients");
  const { email } = await params;
  const clientId = await getClientIdForEmail(normalizeEmail(decodeURIComponent(email)));
  if (!clientId) notFound();
  redirect(`/admin/clients/${clientId}`);
}
