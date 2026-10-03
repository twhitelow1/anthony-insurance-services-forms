"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";

/**
 * Accessible info tooltip.
 *  - Desktop: opens on hover or keyboard focus
 *  - Touch: tap the (i) to toggle; tap outside to dismiss
 *  - Escape closes; content is announced via aria-describedby
 * Positioned with `position: fixed` and clamped to the viewport so it never
 * overflows on narrow screens or inside an embedded iframe.
 */
export function Tooltip({ content, label = "More info" }: { content: string; label?: string }) {
  const id = useId();
  const btnRef = useRef<HTMLButtonElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false); // opened by click/tap — stays until dismissed
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Small delay so the pointer can travel from the icon into the panel (to select/copy text).
  const show = () => {
    clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hideSoon = () => {
    if (pinned) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  };
  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const place = useCallback(() => {
    const btn = btnRef.current;
    const tip = tipRef.current;
    if (!btn || !tip) return;
    const r = btn.getBoundingClientRect();
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    const margin = 8;
    const left = Math.min(Math.max(r.left + r.width / 2 - w / 2, margin), window.innerWidth - w - margin);
    const above = r.bottom + h + margin > window.innerHeight && r.top - h - margin > 0;
    setPos({ left, top: above ? r.top - h - margin : r.bottom + margin, above });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!btnRef.current?.contains(t) && !tipRef.current?.contains(t)) {
        setOpen(false);
        setPinned(false);
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, place]);

  return (
    <span className="relative inline-flex align-middle">
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        className="tooltip-trigger"
        onPointerEnter={(e) => e.pointerType !== "touch" && show()}
        onPointerLeave={(e) => e.pointerType !== "touch" && hideSoon()}
        onFocus={show}
        onBlur={() => !pinned && setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          clearTimeout(closeTimer.current);
          if (pinned) {
            setPinned(false);
            setOpen(false);
          } else {
            setPinned(true);
            setOpen(true);
          }
        }}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true" className="h-4 w-4">
          <circle cx="10" cy="10" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
          <circle cx="10" cy="6.2" r="1.1" fill="currentColor" />
          <path d="M10 9v5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={tipRef}
          id={id}
          role="tooltip"
          className="tooltip-panel"
          data-side={pos?.above ? "top" : "bottom"}
          style={{ top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          onPointerEnter={show}
          onPointerLeave={(e) => e.pointerType !== "touch" && hideSoon()}
        >
          {content}
        </div>
      )}
    </span>
  );
}
