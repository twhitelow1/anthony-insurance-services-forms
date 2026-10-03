import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { forms, getForm } from "@/forms";
import { FormWizard } from "@/components/FormWizard";
import { ghlConfig, listCustomFields } from "@/lib/ghl/client";
import { ghlOptionOverrides } from "@/lib/ghl/mapping";
import type { Option } from "@/lib/forms/types";

// Re-pull dropdown options from GHL at most every 10 minutes.
export const revalidate = 600;

export function generateStaticParams() {
  return Object.keys(forms).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/forms/[slug]">): Promise<Metadata> {
  const form = getForm((await params).slug);
  return { title: form ? `${form.title} | Anthony Insurance Services` : "Form not found" };
}

async function loadOptionOverrides(slug: string): Promise<Record<string, Option[]>> {
  if (!ghlConfig()) return {};
  try {
    return ghlOptionOverrides(getForm(slug)!, await listCustomFields());
  } catch (err) {
    console.error("[form page] couldn't load GHL options; using fallbacks", err);
    return {};
  }
}

export default async function FormPage({ params, searchParams }: PageProps<"/forms/[slug]">) {
  const { slug } = await params;
  const form = getForm(slug);
  if (!form) notFound();

  const optionOverrides = await loadOptionOverrides(slug);
  const embedded = (await searchParams).embed === "1";

  return (
    <main className={`mx-auto w-full max-w-3xl px-4 ${embedded ? "py-4" : "py-10 sm:py-14"}`}>
      {!embedded && (
        <header className="mb-8">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
            Anthony Insurance Services
          </p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{form.title}</h1>
          {form.subtitle && <p className="mt-2 text-lg text-[var(--muted)]">{form.subtitle}</p>}
        </header>
      )}
      <FormWizard slug={slug} optionOverrides={optionOverrides} />
    </main>
  );
}
