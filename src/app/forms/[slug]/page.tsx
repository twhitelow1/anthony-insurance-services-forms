import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { forms, getForm } from "@/forms";
import { FormWizard } from "@/components/FormWizard";
import { type LibraryItem, libraryForForm, libraryPath } from "@/lib/library";
import { BRANDS, brandCss, defaultBrand, isBrand } from "@/lib/brands";
import { raleway } from "@/lib/fonts/brand";

export function generateStaticParams() {
  return Object.keys(forms).map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: PageProps<"/forms/[slug]">): Promise<Metadata> {
  const form = getForm((await params).slug);
  return { title: form ? `${form.title} | Anthony Insurance Services` : "Form not found" };
}

export default async function FormPage({ params, searchParams }: PageProps<"/forms/[slug]">) {
  const { slug } = await params;
  const form = getForm(slug);
  if (!form) notFound();

  const sp = await searchParams;
  const embedded = sp.embed === "1";
  // Embedded forms take their website's branding (?brand=ais|dsi|masi overrides the form's default site).
  const brand = isBrand(sp.brand) ? BRANDS[sp.brand] : embedded ? BRANDS[defaultBrand(form)] : null;
  // Documents staff assigned to this form (Admin → Documents). A database hiccup mustn't block the form.
  const docs: LibraryItem[] = await libraryForForm(slug).catch((err) => {
    console.error("[form] couldn't load documents", err);
    return [];
  });

  return (
    <main className={`mx-auto w-full max-w-3xl px-4 ${embedded ? "py-4" : "py-10 sm:py-14"} ${brand ? raleway.className : ""}`}>
      {brand && <style>{brandCss(brand, embedded)}</style>}
      {!embedded && (
        <header className="mb-8">
          {brand?.logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- hot-linked from the brand's own site
            <img src={brand.logo} alt={brand.name} className="mb-4 h-14 w-auto" />
          ) : (
            <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
              {brand?.name ?? "Anthony Insurance Services"}
            </p>
          )}
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{form.title}</h1>
          {form.subtitle && <p className="mt-2 text-lg text-[var(--muted)]">{form.subtitle}</p>}
        </header>
      )}
      {docs.length > 0 && (
        <aside className="callout mb-6 text-sm" aria-labelledby="form-docs">
          <h2 id="form-docs" className="mb-1 font-semibold">Documents for this application</h2>
          <ul className="space-y-1">
            {docs.map((d) => (
              <li key={d.id}>
                <a className="btn-link" href={libraryPath(d)} target="_blank" rel="noopener">{d.title}</a>
                {d.description && <span className="text-[var(--muted)]"> — {d.description}</span>}
              </li>
            ))}
          </ul>
        </aside>
      )}
      <FormWizard slug={slug} />
    </main>
  );
}
