"use client";

import { Search } from "lucide-react";
import type { Artwork } from "@/lib/types";
import type { CurioUIMessage, ExhibitData, StepData } from "@/lib/thread/types";
import Icon from "../Icon";
import ExhibitCard from "./ExhibitCard";
import { ThinkingLine } from "./Live";
import { StepRow, WorkGroup } from "./Steps";
import type { CuratorStatus } from "./status";

/** Curio writes plain text; the odd *title* still renders as emphasis. */
function Prose({ text, className = "" }: { text: string; className?: string }) {
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim());
  return (
    <>
      {paragraphs.map((para, i) => (
        <p key={i} className={`pretty text-[13px] leading-relaxed ${className}`}>
          {para.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((s, j) => {
            if (s.startsWith("**") && s.endsWith("**") && s.length > 4) return <strong key={j}>{s.slice(2, -2)}</strong>;
            if (s.startsWith("*") && s.endsWith("*") && s.length > 2) return <em key={j}>{s.slice(1, -1)}</em>;
            return s;
          })}
        </p>
      ))}
    </>
  );
}

export function UserMessage({ message }: { message: CurioUIMessage }) {
  const text = message.parts.map((p) => (p.type === "text" ? p.text : "")).join("\n").trim();
  const attachments = message.metadata?.attachments ?? [];
  return (
    <div className="animate-rise ml-8 flex flex-col items-end gap-1">
      {attachments.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {attachments.map((a) =>
            a.kind === "artwork" ? (
              <span key={a.id} title={`${a.title}, ${a.artist}`} className="block h-10 w-10 overflow-hidden bg-wash">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={a.thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              </span>
            ) : (
              <span key={`${a.kind}:${a.name}`} className="caption bg-wash px-2 py-1 text-ink/80">
                {a.name}
              </span>
            ),
          )}
        </div>
      )}
      {text && (
        <p className="pretty max-w-full bg-ink px-3 py-2 text-[13px] leading-relaxed text-paper">{text}</p>
      )}
    </div>
  );
}

/** A plain search from the one input, recorded as a compact line. */
function SearchEntry({ message }: { message: CurioUIMessage }) {
  const part = message.parts.find((p) => p.type === "data-search");
  if (!part || part.type !== "data-search") return null;
  const d = part.data;
  return (
    <div className="animate-rise flex items-start gap-2">
      <span aria-hidden className="flex h-[18px] w-3 shrink-0 items-center justify-center text-ink/45">
        <Icon icon={Search} size={12} />
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-[12px] leading-[18px] text-ink/80">
        <span>
          {d.count === 0
            ? "Nothing came back"
            : `Put ${d.count} ${d.count === 1 ? "work" : "works"} from ${d.museums} ${d.museums === 1 ? "museum" : "museums"} on the wall`}
        </span>
        {d.readAs?.map((f) => (
          <span key={f} className="inline-flex bg-wash px-1.5 text-[11px] tracking-[0.03em] text-ink/70">
            {f}
          </span>
        ))}
      </div>
    </div>
  );
}

type Segment =
  | { kind: "text"; key: string; text: string; streaming: boolean }
  | { kind: "step"; key: string; step: StepData }
  | { kind: "exhibit"; key: string; exhibit: ExhibitData };

function segmentsOf(m: CurioUIMessage): Segment[] {
  const out: Segment[] = [];
  m.parts.forEach((p, i) => {
    if (p.type === "text" && p.text.trim()) {
      out.push({ kind: "text", key: `t${i}`, text: p.text, streaming: p.state === "streaming" });
    } else if (p.type === "data-step") {
      out.push({ kind: "step", key: p.id ?? `s${i}`, step: p.data });
    } else if (p.type === "data-exhibit") {
      out.push({ kind: "exhibit", key: p.id ?? `e${i}`, exhibit: p.data });
    }
  });
  return out;
}

/**
 * A curator turn: the opening brief, the work (steps and short asides, as
 * one group that folds away once the exhibit is up), the exhibit itself, and
 * anything said after it.
 */
export function AssistantMessage({
  message,
  live,
  status,
  onWallExhibitId,
  exhibitPartId,
  onShow,
  onOpen,
  onFollowUp,
  onRunFresh,
  busy,
}: {
  message: CurioUIMessage;
  /** this is the turn being streamed right now */
  live: boolean;
  status: CuratorStatus;
  onWallExhibitId?: string;
  exhibitPartId?: string;
  onShow: () => void;
  onOpen: (a: Artwork) => void;
  onFollowUp: (text: string) => void;
  onRunFresh?: () => void;
  busy: boolean;
}) {
  if (message.parts.some((p) => p.type === "data-search")) return <SearchEntry message={message} />;

  const segs = segmentsOf(message);
  // The opening sentence ("Looking for …") is the brief; it stays visible
  // above the work even once the work folds away.
  const brief = segs[0]?.kind === "text" ? segs[0] : undefined;
  const rest = brief ? segs.slice(1) : segs;
  const exhibitAt = rest.findIndex((s) => s.kind === "exhibit");
  const work = exhibitAt === -1 ? rest : rest.slice(0, exhibitAt);
  const exhibitSeg = exhibitAt === -1 ? undefined : (rest[exhibitAt] as Extract<Segment, { kind: "exhibit" }>);
  const after = exhibitAt === -1 ? [] : rest.slice(exhibitAt + 1).filter((s) => s.kind === "text");

  const steps = work.filter((s): s is Extract<Segment, { kind: "step" }> => s.kind === "step").map((s) => s.step);
  const kept = exhibitSeg ? new Set(exhibitSeg.exhibit.artworks.map((a) => a.id)) : undefined;
  const lastLook = [...steps].reverse().find((s) => s.kind === "look");
  const scanning = live && status.phase === "thinking" && status.after === "look";
  const runningStep = steps.some((s) => s.phase === "running");
  const streamingText = segs.some((s) => s.kind === "text" && s.streaming);
  const showThinking = live && !runningStep && !streamingText && !exhibitSeg;
  const { startedAt, finishedAt, recorded } = message.metadata ?? {};
  const seconds =
    startedAt && finishedAt ? Math.max(1, Math.round((finishedAt - startedAt) / 1000)) : undefined;
  const lookedAt = steps
    .filter((s) => s.kind === "look")
    .reduce((n, s) => n + (s.items?.filter((i) => i.state === "seen").length ?? 0), 0);
  const hasWork = work.length > 0;

  return (
    <div className="animate-rise flex flex-col gap-3">
      {brief && brief.kind === "text" && <Prose text={brief.text} />}

      {hasWork && (
        <WorkGroup
          running={live && !exhibitSeg}
          seconds={seconds}
          counts={{
            searches: steps.filter((s) => s.kind === "search").length,
            lookedAt,
            kept: kept?.size,
          }}
          hasError={steps.some((s) => s.phase === "error")}
        >
          {work.map((s) =>
            s.kind === "step" ? (
              <StepRow
                key={s.key}
                step={s.step}
                kept={kept}
                scanning={scanning && s.step === lastLook}
              />
            ) : s.kind === "text" ? (
              <Prose key={s.key} text={s.text} className="text-ink/85" />
            ) : null,
          )}
          {showThinking && <ThinkingLine status={status} />}
        </WorkGroup>
      )}
      {showThinking && !hasWork && <ThinkingLine status={status} />}

      {exhibitSeg && (
        <ExhibitCard
          exhibit={exhibitSeg.exhibit}
          onWall={onWallExhibitId !== undefined && onWallExhibitId === exhibitPartId}
          onShow={onShow}
          onOpen={onOpen}
          onFollowUp={onFollowUp}
          recorded={recorded}
          onRunFresh={onRunFresh}
          busy={busy}
        />
      )}
      {after.map((s) => (s.kind === "text" ? <Prose key={s.key} text={s.text} /> : null))}
    </div>
  );
}
