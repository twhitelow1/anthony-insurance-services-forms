import Link from "next/link";

/**
 * The one way every admin list pages: "Showing 51–100 of 1,234 accounts", numbered page links,
 * and a per-page choice. Plain links, so it works without JavaScript and keeps the list's other
 * query parameters (`href` builds each link).
 */
export const PAGE_SIZES = [25, 50, 100, 200] as const;

export interface PageState {
  page: number;
  pageSize: number;
  offset: number;
}

/**
 * Read `page` and `size` from the search params (bad values fall back to page 1 and the default
 * size). `prefix` names them apart when a page has more than one list, e.g. "activity" reads
 * `activityPage` and `activitySize`.
 */
export function pageState(sp: Record<string, string | string[] | undefined>, defaultSize = 50, prefix = ""): PageState {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const pageSize = PAGE_SIZES.find((n) => n === Number(one(paramName(prefix, "size")))) ?? defaultSize;
  const page = Math.max(1, Math.floor(Number(one(paramName(prefix, "page"))) || 1));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

const paramName = (prefix: string, key: "page" | "size") => (prefix ? `${prefix}${key[0].toUpperCase()}${key.slice(1)}` : key);

/** Slice an in-memory list to the current page (for lists that are loaded whole). */
export function pageOf<T>(all: T[], { offset, pageSize }: PageState): T[] {
  return all.slice(offset, offset + pageSize);
}

const fmt = (n: number) => n.toLocaleString("en-US");
const IRREGULAR: Record<string, string> = { person: "people" };
const plural = (n: number, noun: string) =>
  n === 1 ? noun : (IRREGULAR[noun] ?? (noun.endsWith("y") && !/[aeiou]y$/.test(noun) ? `${noun.slice(0, -1)}ies` : `${noun}s`));

/** "Showing 51–100 of 1,234 accounts" (or "No accounts"). */
export function ListSummary({ total, state, noun, className = "mb-2" }: { total: number; state: PageState; noun: string; className?: string }) {
  if (!total) return <p className={`${className} text-sm text-[var(--muted)]`} role="status">No {plural(0, noun)}</p>;
  const from = Math.min(state.offset + 1, total);
  const to = Math.min(state.offset + state.pageSize, total);
  return (
    <p className={`${className} text-sm`} role="status">
      Showing <strong>{fmt(from)}–{fmt(to)}</strong> of <strong>{fmt(total)}</strong> {plural(total, noun)}
    </p>
  );
}

/** Page links and per-page choice, under the list. `href(page, size)` returns the link for that page. */
export function Pagination({
  total,
  state,
  noun,
  href,
}: {
  total: number;
  state: PageState;
  noun: string;
  href: (page: number, size: number) => string;
}) {
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  const current = Math.min(state.page, pages);
  const around = [...new Set([1, current - 2, current - 1, current, current + 1, current + 2, pages])].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  return (
    <nav className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm" aria-label={`${noun} pages`}>
      <div className="flex flex-wrap items-center gap-2">
        {current > 1 && <Link className="btn-secondary !px-3 !py-1" href={href(current - 1, state.pageSize)}>← Previous</Link>}
        {pages > 1 &&
          around.map((p, i) => (
            <span key={p} className="flex items-center gap-2">
              {i > 0 && p - around[i - 1] > 1 && <span className="text-[var(--muted)]">…</span>}
              {p === current ? (
                <span className="badge badge-active" aria-current="page">{p}</span>
              ) : (
                <Link className="btn-link" href={href(p, state.pageSize)}>{p}</Link>
              )}
            </span>
          ))}
        {current < pages && <Link className="btn-secondary !px-3 !py-1" href={href(current + 1, state.pageSize)}>Next →</Link>}
        <span className="text-[var(--muted)]">
          Page {fmt(current)} of {fmt(pages)} · {fmt(total)} {plural(total, noun)}
        </span>
      </div>
      {total > PAGE_SIZES[0] && (
        <div className="flex items-center gap-2 text-[var(--muted)]">
          Per page:
          {PAGE_SIZES.map((n) =>
            n === state.pageSize ? (
              <strong key={n} className="text-[var(--text)]">{n}</strong>
            ) : (
              <Link key={n} className="btn-link" href={href(1, n)}>{n}</Link>
            ),
          )}
        </div>
      )}
    </nav>
  );
}

/**
 * Builds `href` for <Pagination>: the current query string with `page` and `size` set (defaults
 * dropped). `prefix` matches pageState's; `hash` scrolls back to the list.
 */
export function pageHref(base: string, params: Record<string, string | undefined>, defaultSize = 50, prefix = "", hash = "") {
  return (page: number, size: number) => {
    const p = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]));
    if (page > 1) p.set(paramName(prefix, "page"), String(page));
    else p.delete(paramName(prefix, "page"));
    if (size !== defaultSize) p.set(paramName(prefix, "size"), String(size));
    else p.delete(paramName(prefix, "size"));
    const s = p.toString();
    return `${s ? `${base}?${s}` : base}${hash ? `#${hash}` : ""}`;
  };
}
