import Link from "next/link";
import { notFound } from "next/navigation";
import { getForm } from "@/forms";
import { FormWizard } from "@/components/FormWizard";
import { requireStaff } from "@/lib/auth/session";
import { getApplication } from "@/lib/applications/repo";

export default async function EditApplication({ params }: PageProps<"/admin/applications/[id]/edit">) {
  const { id } = await params;
  await requireStaff(`/admin/applications/${id}/edit`);
  const app = await getApplication(id);
  const form = app && getForm(app.formSlug);
  if (!app || !form) notFound();

  return (
    <div className="mx-auto max-w-3xl">
      <Link href={`/admin/applications/${app.id}`} className="btn-link">← Back without saving</Link>
      <h1 className="mb-1 mt-3 text-2xl font-semibold">Edit {app.reference}</h1>
      <p className="mb-6 text-sm text-[var(--muted)]">
        Jump to any section with the step buttons. Saving records what changed on the activity log and rebuilds the PDFs.
      </p>
      <FormWizard
        slug={form.slug}
        edit={{
          initial: { ...app.values, ...(app.signature ? { signature: app.signature } : {}) },
          saveUrl: `/api/admin/applications/${app.id}`,
          doneHref: `/admin/applications/${app.id}?saved=1`,
        }}
      />
    </div>
  );
}
