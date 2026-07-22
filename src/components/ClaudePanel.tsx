"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Artwork } from "@/lib/types";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent } from "@/components/ui/marker";

type Turn =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string }
  | { kind: "status"; label: string }
  | { kind: "error"; label: string };

interface StreamEvent {
  type: "text" | "status" | "selection" | "done" | "error";
  text?: string;
  tool?: string;
  input?: Record<string, unknown>;
  artworks?: Artwork[];
  note?: string;
  sessionId?: string;
  message?: string;
  error?: string;
}

/** localhost / loopback → the curator's Claude backend can run. Anything else
 *  (a Vercel domain, a LAN IP) is a deployed build where it can't. */
function isLocalHost(): boolean {
  if (typeof window === "undefined") return true;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/** The clone-and-run instructions shown in place of the chat on a deployed
 *  build — the curator spawns the Claude CLI with your own Anthropic auth, so
 *  it only works when Loupe runs on your machine. */
function SetupNotice() {
  const steps: { label: string; code?: string }[] = [
    { label: "Clone the repo", code: "git clone https://github.com/shaunlatip/loupe.git" },
    { label: "Install dependencies", code: "cd loupe && npm install" },
    {
      label: "Authenticate Claude — log in with the CLI or set a key",
      code: "claude   # or: export ANTHROPIC_API_KEY=sk-…",
    },
    { label: "Start it", code: "npm run dev" },
    { label: "Open Loupe", code: "http://localhost:4050" },
  ];
  return (
    <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 py-6">
      <p className="text-[13px] leading-relaxed">
        The curator is a Claude agent that browses the collections and proposes
        works for you. It runs Claude on your own machine — through the Claude
        Agent SDK and your Anthropic account — so it can’t run on this hosted
        build. Everything else here (search, categories, filters, color) works
        as normal.
      </p>
      <p className="caption">To use the curator, run Loupe locally:</p>
      <ol className="flex flex-col gap-4">
        {steps.map((step, i) => (
          <li key={i} className="flex flex-col gap-1.5">
            <div className="flex gap-2 text-[13px]">
              <span className="shrink-0 font-mono text-muted-foreground">
                {i + 1}.
              </span>
              <span>{step.label}</span>
            </div>
            {step.code && (
              <code className="ml-5 block border border-ink bg-wash px-3 py-2 font-mono text-[12px] break-all">
                {step.code}
              </code>
            )}
          </li>
        ))}
      </ol>
      <p className="caption leading-relaxed">
        Auth resolves from <span className="font-mono">ANTHROPIC_API_KEY</span>{" "}
        or a logged-in Claude CLI profile — the app never reads a key from code.
      </p>
    </div>
  );
}

function statusLabel(tool: string, input: Record<string, unknown> = {}): string {
  if (tool === "search_artworks") {
    const parts = [input.artist, input.q].filter(Boolean).join(" · ");
    const where = input.source ? String(input.source).toUpperCase() : "all museums";
    return `Searching ${where}${parts ? ` — ${parts}` : ""}`;
  }
  if (tool === "present_selection") {
    const n = Array.isArray(input.artworkIds) ? input.artworkIds.length : "";
    return `Presenting ${n} works`;
  }
  return tool;
}

export default function ClaudePanel({
  open,
  onClose,
  onSelection,
}: {
  open: boolean;
  onClose: () => void;
  onSelection: (artworks: Artwork[], note: string) => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [local] = useState(isLocalHost);
  const sessionRef = useRef<string | undefined>(undefined);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Stick to the bottom: new turns and streamed content grow downward and
  // stay in view, filling the empty space instead of scrolling up out of it.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [turns, busy]);

  const send = useCallback(
    async (message: string) => {
      setTurns((t) => [...t, { kind: "user", text: message }]);
      setBusy(true);
      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message, sessionId: sessionRef.current }),
        });
        if (!res.ok || !res.body) {
          throw new Error(`Curator unavailable (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { done, value: chunk } = await reader.read();
          if (done) break;
          buffer += decoder.decode(chunk, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            let ev: StreamEvent;
            try {
              ev = JSON.parse(line) as StreamEvent;
            } catch {
              continue;
            }
            if (ev.type === "text" && ev.text) {
              setTurns((t) => [...t, { kind: "assistant", text: ev.text! }]);
            } else if (ev.type === "status" && ev.tool) {
              setTurns((t) => [
                ...t,
                { kind: "status", label: statusLabel(ev.tool!, ev.input) },
              ]);
            } else if (ev.type === "selection" && ev.artworks) {
              onSelection(ev.artworks, ev.note ?? "");
            } else if (ev.type === "done") {
              if (ev.sessionId) sessionRef.current = ev.sessionId;
              if (ev.error) {
                setTurns((t) => [
                  ...t,
                  { kind: "error", label: `Turn ended: ${ev.error}` },
                ]);
              }
            } else if (ev.type === "error") {
              setTurns((t) => [
                ...t,
                { kind: "error", label: ev.message ?? "Something went wrong" },
              ]);
            }
          }
        }
      } catch (err) {
        setTurns((t) => [
          ...t,
          {
            kind: "error",
            label: err instanceof Error ? err.message : String(err),
          },
        ]);
      } finally {
        setBusy(false);
      }
    },
    [onSelection],
  );

  if (!open) return null;

  return (
    <aside className="animate-slide-in fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-ink bg-paper">
      <header className="flex items-center justify-between border-b border-ink px-4 py-3">
        <div className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold">Curator</span>
          <span className="caption">powered by Claude</span>
        </div>
        <button
          onClick={onClose}
          className="invert-hover border border-ink px-3 py-1 text-[12px] font-semibold"
        >
          Close
        </button>
      </header>

      {!local ? (
        <SetupNotice />
      ) : (
        <>
      <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
        {turns.length === 0 && (
          <p className="caption pt-8 text-center leading-relaxed">
            Describe a vibe — “Dutch Golden Age still life with a dark ground”,
            “misty like a Whistler nocturne” — then refine: “warmer”, “more
            abstract”, “just Monet”.
          </p>
        )}
        {turns.map((turn, i) => (
          <div key={i}>
            {turn.kind === "user" && (
              <Bubble variant="default" align="end">
                <BubbleContent className="border-ink text-[13px]">
                  {turn.text}
                </BubbleContent>
              </Bubble>
            )}
            {turn.kind === "assistant" && (
              <Bubble variant="ghost">
                <BubbleContent className="text-[13px] leading-relaxed">
                  {turn.text}
                </BubbleContent>
              </Bubble>
            )}
            {turn.kind === "status" && (
              <Marker>
                <MarkerContent className="caption">{turn.label}</MarkerContent>
              </Marker>
            )}
            {turn.kind === "error" && (
              <Marker>
                <MarkerContent className="caption text-destructive">
                  {turn.label}
                </MarkerContent>
              </Marker>
            )}
          </div>
        ))}
        {busy && (
          <Marker>
            <MarkerContent className="caption animate-pulse">
              Working…
            </MarkerContent>
          </Marker>
        )}
        <div ref={bottomRef} />
      </div>

      <form
        className="flex items-end border-t border-ink"
        onSubmit={(e) => {
          e.preventDefault();
          const message = value.trim();
          if (!message || busy) return;
          setValue("");
          void send(message);
        }}
      >
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
          placeholder="Ask the curator…"
          className="w-full resize-none bg-paper px-4 py-3 text-[13px] outline-none placeholder:text-muted-foreground focus:bg-wash"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="invert-hover shrink-0 self-stretch border-l border-ink px-5 text-[13px] font-semibold disabled:opacity-40"
        >
          Send
        </button>
      </form>
        </>
      )}
    </aside>
  );
}
