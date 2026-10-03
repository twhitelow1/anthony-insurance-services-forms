import Link from "next/link";
import { forms } from "@/forms";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-14">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
        Anthony Insurance Services
      </p>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight sm:text-4xl">Online applications</h1>
      <ul className="space-y-3">
        {Object.values(forms).map((f) => (
          <li key={f.slug}>
            <Link href={`/forms/${f.slug}`} className="card block transition hover:border-[var(--accent)]">
              <span className="block text-lg font-semibold">{f.title}</span>
              {f.subtitle && <span className="text-[var(--muted)]">{f.subtitle}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
