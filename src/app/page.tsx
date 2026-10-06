import Link from "next/link";
import { forms } from "@/forms";
import { openAccess } from "@/lib/auth/session";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";

const CATEGORIES = [
  ["sports", "Sports facilities, teams, events & camps"],
  ["martial-arts", "Martial arts"],
  ["dance-fitness", "Dance, fitness & aerial"],
  ["special-event", "Special events"],
  ["equipment", "Equipment"],
  ["other", "Other applications"],
] as const;

const categoryOf = (tags: string[]) =>
  tags.includes("commercial-application") ? "sports" : (CATEGORIES.find(([t]) => tags.includes(t))?.[0] ?? "other");

export default function Home() {
  return (
    <>
    <OpenAccessBanner />
    <main className="mx-auto w-full max-w-3xl px-4 py-14">
      <p className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-[var(--accent-strong)]">
        Anthony Insurance Services
      </p>
      <h1 className="mb-8 text-3xl font-semibold tracking-tight sm:text-4xl">Online applications</h1>
      <div className="space-y-10">
        {CATEGORIES.map(([tag, heading]) => {
          const list = Object.values(forms).filter((f) => categoryOf(f.tags) === tag);
          if (!list.length) return null;
          return (
            <section key={tag}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">{heading}</h2>
              <ul className="space-y-3">
                {list.map((f) => (
                  <li key={f.slug}>
                    <Link href={`/forms/${f.slug}`} className="card block transition hover:border-[var(--accent)]">
                      <span className="block text-lg font-semibold">{f.title}</span>
                      {f.subtitle && <span className="text-[var(--muted)]">{f.subtitle}</span>}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      {openAccess() && (
        <p className="mt-8 text-sm">
          Testing: <Link className="btn-link" href="/admin">open the admin</Link> to see every submitted application and its PDF.
        </p>
      )}
    </main>
    </>
  );
}
