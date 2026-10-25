"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useRef, useState } from "react";

/**
 * A thin bar across the top of the admin while a save or another action is running: it starts when
 * any form is submitted (or an internal link is followed), creeps towards the end while the server
 * works, and fills and fades once the new page (with its result message) has loaded.
 */
function Bar({ stamp }: { stamp: number }) {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const [progress, setProgress] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const started = useRef(false);
  const giveUp = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const start = () => {
      started.current = true;
      setProgress(8);
      if (timer.current) clearInterval(timer.current);
      // Slows down as it goes, so a long sync never looks finished before it is.
      timer.current = setInterval(() => setProgress((p) => (p === null ? p : Math.min(p + (95 - p) * 0.06, 95))), 300);
      // Never stuck: a long sync's own page shows its progress; the bar gives up after two minutes.
      if (giveUp.current) clearTimeout(giveUp.current);
      giveUp.current = setTimeout(() => {
        if (timer.current) clearInterval(timer.current);
        started.current = false;
        setProgress(null);
      }, 120_000);
    };
    // Capture phase: React form actions and Next links cancel the default before a bubbling listener runs.
    const onSubmit = () => start();
    const onClick = (e: MouseEvent) => {
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || (url.pathname === location.pathname && url.search === location.search)) return;
      start();
    };
    document.addEventListener("submit", onSubmit, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      document.removeEventListener("click", onClick, true);
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  // A new page arrived from the server (a save redirects back with its result, even to the same
  // address): finish.
  useEffect(() => {
    if (!started.current) return;
    started.current = false;
    if (timer.current) clearInterval(timer.current);
    if (giveUp.current) clearTimeout(giveUp.current);
    setProgress(100);
    const t = setTimeout(() => setProgress(null), 400);
    return () => clearTimeout(t);
  }, [pathname, search, stamp]);

  if (progress === null) return null;
  return (
    <div
      role="progressbar"
      aria-label="Saving"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(progress)}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1"
    >
      <div className="h-full bg-[var(--brand)] transition-[width,opacity] duration-300 ease-out" style={{ width: `${progress}%`, opacity: progress >= 100 ? 0 : 1 }} />
    </div>
  );
}

/** `stamp`: when the server rendered the page (changes on every save, even back to the same address). */
export function SaveProgress({ stamp }: { stamp: number }) {
  return (
    <Suspense fallback={null}>
      <Bar stamp={stamp} />
    </Suspense>
  );
}
