import { forms } from "@/forms";
import { CopyButton } from "@/components/CopyButton";
import { requireStaff } from "@/lib/auth/session";
import { BRANDS, defaultBrand, isBrand, type BrandId } from "@/lib/brands";

export const metadata = { title: "Forms & embed codes | Anthony Insurance Services" };

const appUrl = () => (process.env.APP_URL ?? "https://anthony-insurance-services-forms.vercel.app").replace(/\/$/, "");

export default async function FormsPage({ searchParams }: PageProps<"/admin/forms">) {
  await requireStaff("/admin/forms");
  const sp = await searchParams;
  const only = isBrand(sp.brand) ? sp.brand : null;
  const base = appUrl();
  const list = Object.values(forms)
    .map((f) => ({ form: f, brand: defaultBrand(f) as BrandId }))
    .filter((x) => !only || x.brand === only)
    .sort((a, b) => a.brand.localeCompare(b.brand) || a.form.title.localeCompare(b.form.title));

  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold">Forms &amp; embed codes</h1>
      <p className="mb-4 text-sm text-[var(--muted)]">
        To put a form on a website, copy its embed code into the page (in WordPress, a <strong>Custom HTML</strong> block) where the
        Lead Alchemist widget was. It sizes itself, takes that site&apos;s colors and font, and submissions arrive here and in Lead
        Alchemist as usual. Forms can only be embedded on anthonyinsuranceservices.com, dancestudioinsurance.com and
        martialartsschoolinsurance.com.
      </p>
      <nav className="mb-6 flex flex-wrap gap-2 text-sm" aria-label="Filter by website">
        <a className={`badge ${!only ? "badge-success" : ""}`} href="/admin/forms">All</a>
        {Object.values(BRANDS).map((b) => (
          <a key={b.id} className={`badge ${only === b.id ? "badge-success" : ""}`} href={`/admin/forms?brand=${b.id}`}>{b.name}</a>
        ))}
      </nav>
      <div className="space-y-4">
        {list.map(({ form, brand }) => {
          const snippet = `<div data-ais-form="${form.slug}" data-ais-brand="${brand}"></div>\n<script src="${base}/embed.js" async></script>`;
          const preview = `/forms/${form.slug}?brand=${brand}`;
          return (
            <section key={form.slug} className="card !p-5">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="font-semibold">{form.title}</h2>
                <span className="text-xs text-[var(--muted)]">{BRANDS[brand].name}</span>
              </div>
              <pre className="overflow-x-auto rounded-lg bg-[var(--track)] p-3 text-xs"><code>{snippet}</code></pre>
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <CopyButton text={snippet} label="Copy embed code" />
                <a className="btn-link" href={preview} target="_blank" rel="noopener">Preview with branding</a>
                <a className="btn-link" href={`/forms/${form.slug}`} target="_blank" rel="noopener">Direct link</a>
              </div>
              <details className="mt-3 text-xs text-[var(--muted)]">
                <summary className="cursor-pointer">Other websites or a plain iframe</summary>
                <p className="mt-2">
                  Change <code>data-ais-brand</code> to <code>ais</code>, <code>dsi</code> or <code>masi</code> to use another site&apos;s look. Add{" "}
                  <code>data-ais-redirect=&quot;https://…/thank-you&quot;</code> to send applicants to a thank-you page after they submit. Several
                  forms can share one page: one <code>div</code> each, one <code>script</code>. If a site
                  can&apos;t run scripts, use an iframe (it won&apos;t resize itself):
                </p>
                <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--track)] p-3"><code>{`<iframe src="${base}/forms/${form.slug}?embed=1&brand=${brand}" style="width:100%;height:1400px;border:0" title="${form.title}"></iframe>`}</code></pre>
              </details>
            </section>
          );
        })}
      </div>
    </div>
  );
}
