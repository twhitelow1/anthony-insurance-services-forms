import Link from "next/link";

const TABS = [
  { view: "app", href: "/admin/clients", label: "AIS Connect accounts" },
  { view: "all", href: "/admin/clients?view=all", label: "Across all three (Salesforce, Lead Alchemist)" },
  { view: "duplicates", href: "/admin/clients/duplicates", label: "Duplicates" },
] as const;

/** The Accounts page's views. */
export function AccountTabs({ view, duplicates }: { view: (typeof TABS)[number]["view"]; duplicates?: number }) {
  return (
    <nav className="mb-4 flex flex-wrap gap-2" aria-label="Account views">
      {TABS.map((t) => (
        <Link key={t.view} href={t.href} className={view === t.view ? "btn-primary" : "btn-secondary"} aria-current={view === t.view ? "page" : undefined}>
          {t.label}
          {t.view === "duplicates" && duplicates ? <span className="badge badge-warning ml-2">{duplicates}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
