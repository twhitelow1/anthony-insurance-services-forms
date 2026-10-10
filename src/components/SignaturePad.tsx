"use client";

import { useEffect, useRef, useState } from "react";
import { SIGNATURE_FONTS } from "@/lib/fonts/signature";

type Mode = "draw" | "type";

/**
 * Signature field with two modes, like DocuSign: draw it, or type your name and
 * pick a script style. Either way it emits a PNG data URL (or undefined when
 * cleared), so storage and PDFs don't care which was used.
 */
export function SignaturePad({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value?: string;
  onChange: (dataUrl: string | undefined) => void;
  invalid?: boolean;
}) {
  const [mode, setMode] = useState<Mode>("draw");

  const switchTo = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    onChange(undefined); // a new method means a new signature
  };

  return (
    <div>
      <div role="tablist" aria-label="How do you want to sign?" className="mb-2 inline-flex rounded-lg border border-[var(--border)] p-0.5 text-sm">
        {(["draw", "type"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            id={`${id}-tab-${m}`}
            aria-selected={mode === m}
            aria-controls={`${id}-panel-${m}`}
            onClick={() => switchTo(m)}
            className={`rounded-md px-3 py-1.5 font-medium ${mode === m ? "bg-[var(--brand)] text-white" : "text-[var(--muted)] hover:text-[var(--text)]"}`}
          >
            {m === "draw" ? "Draw" : "Type"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel-${mode}`} aria-labelledby={`${id}-tab-${mode}`}>
        {mode === "draw" ? (
          <DrawPad id={id} value={value} onChange={onChange} invalid={invalid} />
        ) : (
          <TypePad id={id} onChange={onChange} invalid={invalid} />
        )}
      </div>
    </div>
  );
}

/** Draw-to-sign canvas. */
function DrawPad({ id, value, onChange, invalid }: { id: string; value?: string; onChange: (v: string | undefined) => void; invalid?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // Size the backing store for crisp lines on high-DPI screens; restore any existing signature.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      const { width, height } = canvas.getBoundingClientRect();
      const prev = dirty.current ? canvas.toDataURL("image/png") : value;
      canvas.width = width * ratio;
      canvas.height = height * ratio;
      const ctx = canvas.getContext("2d")!;
      ctx.scale(ratio, ratio);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0f172a";
      if (prev) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, width, height);
        img.src = prev;
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount; `value` is read for restore
  }, []);

  const point = (e: React.PointerEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    canvasRef.current!.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.arc(last.current.x, last.current.y, 1.1, 0, Math.PI * 2);
    ctx.fillStyle = "#0f172a";
    ctx.fill();
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current || !last.current) return;
    const p = point(e);
    const ctx = canvasRef.current!.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    dirty.current = true;
    onChange(canvasRef.current!.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current!;
    canvas.getContext("2d")!.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange(undefined);
  };

  return (
    <div>
      <div className={`signature-box ${invalid ? "is-invalid" : ""}`}>
        <canvas
          ref={canvasRef}
          id={id}
          aria-label="Signature area. Draw your signature with a mouse, finger, or stylus."
          role="img"
          className="h-40 w-full touch-none cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
        />
        <span className="signature-line" aria-hidden="true">
          Sign here
        </span>
      </div>
      <div className="mt-2 flex justify-end">
        <button type="button" className="btn-link" onClick={clear}>
          Clear signature
        </button>
      </div>
    </div>
  );
}

/** Type your name and pick a style; rendered to a PNG the same size as a drawn signature. */
function TypePad({ id, onChange, invalid }: { id: string; onChange: (v: string | undefined) => void; invalid?: boolean }) {
  const [name, setName] = useState("");
  const [font, setFont] = useState<string>(SIGNATURE_FONTS[0].id);

  useEffect(() => {
    const text = name.trim();
    if (!text) {
      onChange(undefined);
      return;
    }
    const family = SIGNATURE_FONTS.find((f) => f.id === font)!.family;
    let cancelled = false;
    // Wait for the web font, or the canvas would draw in a fallback font.
    document.fonts.load(`64px ${family}`).finally(() => {
      if (!cancelled) onChange(renderTyped(text, family));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-render only when the name or style changes
  }, [name, font]);

  return (
    <div>
      <label htmlFor={id} className="sr-only">Type your full name</label>
      <input
        id={id}
        className={`input ${invalid ? "is-invalid" : ""}`}
        value={name}
        onChange={(e) => setName(e.target.value.slice(0, 80))}
        placeholder="Type your full name"
        autoComplete="name"
      />
      <fieldset className="mt-3">
        <legend className="mb-2 text-sm text-[var(--muted)]">Select a style</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {SIGNATURE_FONTS.map((f) => (
            <label
              key={f.id}
              className={`signature-box flex h-20 cursor-pointer items-center justify-center overflow-hidden px-3 ${font === f.id ? "!border-solid !border-[var(--accent)] ring-2 ring-[var(--accent)]/30" : ""}`}
            >
              <input type="radio" name={`${id}-style`} value={f.id} checked={font === f.id} onChange={() => setFont(f.id)} className="sr-only" />
              <span className="sr-only">{f.label}</span>
              <span aria-hidden="true" className="truncate text-3xl text-[#0f172a]" style={{ fontFamily: f.family }}>
                {name.trim() || "Your Name"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <p className="mt-2 text-xs text-[var(--muted)]">
        By typing your name you agree it is your electronic signature, with the same effect as a handwritten one.
      </p>
    </div>
  );
}

/** Draw the typed name on a transparent canvas, scaled to fit. */
function renderTyped(text: string, family: string): string {
  const W = 600;
  const H = 160;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  let size = 72;
  ctx.font = `${size}px ${family}`;
  while (ctx.measureText(text).width > W - 40 && size > 20) {
    size -= 4;
    ctx.font = `${size}px ${family}`;
  }
  ctx.fillStyle = "#0f172a";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(text, 20, H * 0.68);
  return canvas.toDataURL("image/png");
}
