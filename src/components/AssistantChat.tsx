"use client";

import Link from "next/link";
import { Fragment, useRef, useState, useTransition } from "react";
import type { AssistantReply, ChatTurn } from "@/lib/ai/assistant";

type Ask = (history: ChatTurn[]) => Promise<AssistantReply | { error: string }>;
type Entry = ChatTurn & { seen?: AssistantReply["seen"]; error?: boolean };

const EXAMPLES = [
  "Which applications have high flags and are still in review?",
  "Gymnastics gyms in Texas with trampolines",
  "Who answered yes to a prior sexual abuse allegation?",
  "Summarize AIS-XXXX-XXXX",
];

const REF = /(AIS-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4})/g;

/** Turn reference numbers in a reply into links to the application page. */
function Linked({ text, seen }: { text: string; seen?: AssistantReply["seen"] }) {
  const ids = new Map((seen ?? []).map((s) => [s.reference, s.id]));
  return (
    <>
      {text.split(REF).map((part, i) =>
        ids.has(part) ? (
          <Link key={i} href={`/admin/applications/${ids.get(part)}`} className="font-mono font-semibold text-[var(--accent-strong)] underline">
            {part}
          </Link>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        ),
      )}
    </>
  );
}

export function AssistantChat({ ask, enabled }: { ask: Ask; enabled: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);

  const send = (text: string) => {
    const q = text.trim();
    if (!q || pending) return;
    const history: ChatTurn[] = [
      ...entries.filter((e) => !e.error).map(({ role, content }) => ({ role, content })),
      { role: "user", content: q },
    ];
    setEntries((e) => [...e, { role: "user", content: q }]);
    setInput("");
    start(async () => {
      const res = await ask(history);
      setEntries((e) => [
        ...e,
        "error" in res
          ? { role: "assistant", content: res.error, error: true }
          : { role: "assistant", content: res.reply, seen: res.seen },
      ]);
      requestAnimationFrame(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }));
    });
  };

  return (
    <div className="card flex min-h-[60vh] flex-col !p-0">
      <div className="flex-1 space-y-4 overflow-y-auto p-5" aria-live="polite">
        {entries.length === 0 && (
          <div className="py-6 text-center">
            <p className="mb-4 text-[var(--muted)]">
              {enabled ? "Ask about any application in plain English. Try:" : "AI isn't set up yet — add ANTHROPIC_API_KEY in Vercel to turn this on."}
            </p>
            {enabled && (
              <div className="flex flex-wrap justify-center gap-2">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="choice text-sm" onClick={() => send(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {entries.map((e, i) => (
          <div key={i} className={e.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[0.95rem] leading-relaxed ${
                e.role === "user"
                  ? "bg-[var(--brand)] text-white"
                  : e.error
                    ? "bg-[var(--danger-bg)] text-[var(--danger)]"
                    : "border border-[var(--border)] bg-[#fafbfd]"
              }`}
            >
              {e.role === "assistant" ? <Linked text={e.content} seen={e.seen} /> : e.content}
            </div>
          </div>
        ))}
        {pending && <p className="text-sm text-[var(--muted)]">Searching applications…</p>}
        <div ref={endRef} />
      </div>
      <form
        className="flex gap-2 border-t border-[var(--border)] p-3"
        onSubmit={(ev) => {
          ev.preventDefault();
          send(input);
        }}
      >
        <label htmlFor="ask" className="sr-only">Ask about applications</label>
        <input
          id="ask"
          className="input"
          value={input}
          onChange={(ev) => setInput(ev.target.value)}
          placeholder={enabled ? "e.g. Which pools applications are missing lifeguard answers?" : "AI not configured"}
          disabled={!enabled}
          autoComplete="off"
        />
        <button className="btn-primary" disabled={!enabled || pending || !input.trim()}>
          Ask
        </button>
      </form>
    </div>
  );
}
