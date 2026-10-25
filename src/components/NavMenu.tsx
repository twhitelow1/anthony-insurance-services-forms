"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * A top-bar menu with a dropdown (e.g. Applications → View all, Unfinished, Forms, Documents).
 * Built on <details>, so it works with the keyboard; it closes when a link is followed, on a
 * click elsewhere and on Escape.
 */
export function NavMenu({ label, items, badge }: { label: string; items: { href: string; label: string }[]; badge?: React.ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const active = items.some((i) => (i.href === "/admin" ? pathname === "/admin" || pathname.startsWith("/admin/applications") : pathname.startsWith(i.href.split("?")[0])));

  useEffect(() => {
    ref.current?.removeAttribute("open");
  }, [pathname]);

  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !el.contains(e.target as Node)) el.removeAttribute("open");
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <details ref={ref} className="relative">
      <summary className={`cursor-pointer list-none hover:underline ${active ? "underline underline-offset-4" : ""}`}>
        {label}
        {badge}
        <span aria-hidden="true" className="ml-1 text-xs">▾</span>
      </summary>
      <ul className="absolute left-0 z-30 mt-2 min-w-48 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 font-normal text-[var(--text)] shadow-lg">
        {items.map((i) => (
          <li key={i.href}>
            <Link href={i.href} className="block rounded px-3 py-2 hover:bg-[var(--bg)]" onClick={() => ref.current?.removeAttribute("open")}>
              {i.label}
            </Link>
          </li>
        ))}
      </ul>
    </details>
  );
}
