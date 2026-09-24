"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { classifyRules, type RouteDecision } from "@/lib/router/rules";
import { EXAMPLES } from "@/lib/examples";
import { loadRecording } from "@/lib/example-recordings";
import type {
  Attachment,
  CurioUIMessage,
  ExhibitData,
  RevisionData,
  Route,
  SearchEntryData,
  StepData,
  WallContext,
} from "@/lib/thread/types";
import { useSteadyText } from "./Live";
import {
  deriveStatus,
  doneTitle,
  exhibitOf,
  isWorking,
  statusText,
  type CuratorPhase,
  type CuratorStatus,
} from "./status";

/**
 * The thread: one conversation that every input feeds. A plain search, a
 * description and a curator brief all land here (the first two as compact
 * entries, no model behind them), so Curio always knows what the visitor has
 * been looking at, and the wall always shows the latest result.
 *
 * useChat lives here, not in the page: the page (and its wall of cards) never
 * re-renders on a streamed token; only the components that read this context
 * do.
 */

export type ThreadMode = "docked" | "overlay" | "sheet";
export type RouteOverride = Route | null;

export interface ThreadHandlers {
  /** an exhibit arrived (streamed, replayed, or re-shown from the thread) */
  onExhibit: (exhibit: ExhibitData) => void;
  /** the exhibit on the wall was revised in place (title, note, comments) */
  onExhibitRevised: (exhibit: ExhibitData) => void;
  /** run a plain search on the wall; resolves with a summary for the thread */
  runLookup: (q: string) => Promise<SearchEntryData | null>;
  /** read a description into facets and search; resolves likewise */
  runDescribe: (q: string) => Promise<SearchEntryData | null>;
  /** a curator turn began / ended (with or without an exhibit) */
  onTurnStart: () => void;
  onTurnEnd: () => void;
}

interface ThreadContextValue {
  messages: CurioUIMessage[];
  chatStatus: ReturnType<typeof useChat<CurioUIMessage>>["status"];
  curator: CuratorStatus;
  /** statusText(curator), held long enough per change to be read */
  curatorText: string;
  /** the phase that goes with curatorText, for its spinner */
  curatorGlyph: CuratorPhase;
  /** the exhibit the wall is showing, if it came from the thread */
  wallExhibitId?: string;
  open: boolean;
  setOpen: (open: boolean) => void;
  mode: ThreadMode;
  width: number;
  setWidth: (w: number) => void;
  attachments: Attachment[];
  attach: (a: Attachment) => void;
  detach: (a: Attachment) => void;
  /** withAttachments false: a composer that doesn't show the attachments
   *  (the top bar, with the thread open) sends without them */
  submit: (text: string, override?: RouteOverride, withAttachments?: boolean) => void;
  classify: (text: string, withAttachments?: boolean) => RouteDecision;
  stop: () => void;
  reset: () => void;
  retry: () => void;
  runFresh: (prompt: string) => void;
  showExhibit: (messageId: string) => void;
  /** put the exhibit with this data-part id back on the wall */
  showExhibitPart: (partId: string) => void;
  /** an exhibit in the thread, by its data-part id (revisions applied) */
  exhibitByPart: (partId: string) => ExhibitData | undefined;
  runExample: (slug: string) => void;
  /** the done state has been looked at (clears the header's "unseen" pill) */
  unseen: boolean;
  focusComposer: () => void;
  registerComposer: (el: HTMLTextAreaElement, present: boolean) => void;
  setMessages: (m: CurioUIMessage[] | ((m: CurioUIMessage[]) => CurioUIMessage[])) => void;
}

const ThreadContext = createContext<ThreadContextValue | null>(null);

export function useThread(): ThreadContextValue {
  const v = useContext(ThreadContext);
  if (!v) throw new Error("useThread outside ThreadProvider");
  return v;
}

export const THREAD_MIN = 320;
export const THREAD_DEFAULT = 420;
export function threadMax(): number {
  return typeof window === "undefined" ? 720 : Math.min(720, Math.round(window.innerWidth * 0.6));
}

function useMode(): ThreadMode {
  return useSyncExternalStore(
    (cb) => {
      const a = window.matchMedia("(min-width: 80rem)");
      const b = window.matchMedia("(min-width: 48rem)");
      a.addEventListener("change", cb);
      b.addEventListener("change", cb);
      return () => {
        a.removeEventListener("change", cb);
        b.removeEventListener("change", cb);
      };
    },
    () =>
      window.matchMedia("(min-width: 80rem)").matches
        ? "docked"
        : window.matchMedia("(min-width: 48rem)").matches
          ? "overlay"
          : "sheet",
    () => "docked",
  );
}

let idSeq = 0;
const localId = (p: string) => `${p}-${Date.now().toString(36)}-${++idSeq}`;

/** The id of a message's (last) exhibit part, which the wall tracks. */
export function exhibitPartIdOf(m: CurioUIMessage): string | undefined {
  for (let i = m.parts.length - 1; i >= 0; i--) {
    const p = m.parts[i];
    if (p.type === "data-exhibit") return p.id;
  }
  return undefined;
}

/** What goes up with each request: no step parts, no tool parts. The server
 *  rebuilds history from text, exhibits, revisions, searches and metadata. */
function slim(messages: CurioUIMessage[]): CurioUIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.filter(
      (p) =>
        p.type === "text" || p.type === "data-exhibit" || p.type === "data-revision" || p.type === "data-search",
    ),
  }));
}

/** An exhibit with a revision applied. Revisions carry the turn's whole
 *  edit, so applying one again changes nothing. */
function applyRevision(e: ExhibitData, r: RevisionData): ExhibitData {
  const comments = { ...e.comments };
  for (const [id, text] of Object.entries(r.comments)) {
    if (text) comments[id] = text;
    else delete comments[id];
  }
  return {
    ...e,
    title: r.title || e.title,
    note: r.note || e.note,
    comments: Object.keys(comments).length ? comments : undefined,
  };
}

function findExhibitPart(messages: CurioUIMessage[], partId: string): ExhibitData | undefined {
  for (const m of messages) {
    for (const p of m.parts) if (p.type === "data-exhibit" && p.id === partId) return p.data;
  }
  return undefined;
}

function parseError(err: Error | undefined): string | undefined {
  if (!err) return undefined;
  try {
    const j = JSON.parse(err.message) as { error?: string };
    if (j.error) return j.error;
  } catch {
    /* not JSON */
  }
  return err.message || "Something went wrong.";
}

export default function ThreadProvider({
  handlers,
  wall,
  children,
}: {
  handlers: ThreadHandlers;
  wall: WallContext;
  children: ReactNode;
}) {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const wallRef = useRef(wall);
  wallRef.current = wall;
  // The exhibit last put on the wall. It only counts while the wall is
  // still showing an exhibit (a search or a collection replaces it).
  const [lastExhibitId, setWallExhibitId] = useState<string>();
  const wallExhibitId = wall.exhibit ? lastExhibitId : undefined;
  const wallExhibitRef = useRef(wallExhibitId);
  wallExhibitRef.current = wallExhibitId;

  const transport = useMemo(
    () =>
      new DefaultChatTransport<CurioUIMessage>({
        api: "/api/agent",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages: slim(messages), wall: { ...wallRef.current, exhibitId: wallExhibitRef.current } },
        }),
      }),
    [],
  );

  const messagesRef = useRef<CurioUIMessage[]>([]);
  const chat = useChat<CurioUIMessage>({
    transport,
    throttle: 50,
    onData: (part) => {
      if (part.type === "data-exhibit") {
        handlersRef.current.onExhibit(part.data);
        setWallExhibitId(part.id);
      } else if (part.type === "data-revision") {
        // Edit the exhibit it targets where it sits in the thread, so the
        // card, the wall and the next turn's history all read the new text.
        const r = part.data;
        const target = findExhibitPart(messagesRef.current, r.target);
        if (!target) return;
        const revised = applyRevision(target, r);
        chat.setMessages((ms) =>
          ms.map((m) =>
            m.parts.some((p) => p.type === "data-exhibit" && p.id === r.target)
              ? {
                  ...m,
                  parts: m.parts.map((p) =>
                    p.type === "data-exhibit" && p.id === r.target ? { ...p, data: revised } : p,
                  ),
                }
              : m,
          ),
        );
        if (wallExhibitRef.current === r.target) handlersRef.current.onExhibitRevised(revised);
      }
    },
  });
  const { messages, status: chatStatus, sendMessage, setMessages, stop: stopChat, regenerate, error } = chat;
  messagesRef.current = messages;

  const [stopped, setStopped] = useState(false);
  const [pendingSince, setPendingSince] = useState<number>();
  // A recorded example playing back reads as a live turn everywhere.
  const [replaying, setReplaying] = useState(false);
  const liveStatus = replaying ? "streaming" : chatStatus;

  // Tell the page when a turn is over, however it ended.
  const wasBusy = useRef(false);
  useEffect(() => {
    const nowBusy = chatStatus === "submitted" || chatStatus === "streaming";
    if (wasBusy.current && !nowBusy) handlersRef.current.onTurnEnd();
    wasBusy.current = nowBusy;
  }, [chatStatus]);
  const curator = useMemo(
    () => deriveStatus(messages, liveStatus, { stopped, error: parseError(error), pendingSince }),
    [messages, liveStatus, stopped, error, pendingSince],
  );
  // One held line for every surface that shows it, so they never disagree.
  // The phase rides along so a surface's spinner switches with its text,
  // not ahead of it.
  // Held only while it works: the moment a turn ends, the outcome shows.
  const steady = useSteadyText(`${curator.phase}|${statusText(curator)}`);
  const working = isWorking(curator);
  const curatorGlyph = working ? (steady.slice(0, steady.indexOf("|")) as CuratorPhase) : curator.phase;
  const curatorText = working ? steady.slice(steady.indexOf("|") + 1) : statusText(curator);

  // — open / mode / width

  const mode = useMode();
  const [open, setOpenState] = useState(false);
  const [width, setWidthState] = useState(THREAD_DEFAULT);
  useEffect(() => {
    const saved = Number(localStorage.getItem("curio.threadWidth"));
    if (saved >= THREAD_MIN) setWidthState(Math.min(saved, threadMax()));
  }, []);
  const setWidth = useCallback((w: number) => {
    const next = Math.round(Math.max(THREAD_MIN, Math.min(threadMax(), w)));
    setWidthState(next);
    localStorage.setItem("curio.threadWidth", String(next));
  }, []);
  const setOpen = useCallback((v: boolean) => setOpenState(v), []);

  // The docked thread takes its width out of the page; everything that
  // positions against the right edge reads this one variable.
  useEffect(() => {
    const docked = open && mode === "docked";
    document.documentElement.style.setProperty("--thread-w", docked ? `${width}px` : "0px");
  }, [open, mode, width]);

  // — composer focus. Every mounted composer registers (the hero or the top
  // bar, and the thread's while it's open); focus goes to the one that
  // mounted last, i.e. the thread's when it's showing.

  const composers = useRef<HTMLTextAreaElement[]>([]);
  const registerComposer = useCallback((el: HTMLTextAreaElement, present: boolean) => {
    composers.current = composers.current.filter((x) => x !== el);
    if (present) composers.current.push(el);
  }, []);
  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => {
      const live = composers.current.filter((el) => el.isConnected);
      live[live.length - 1]?.focus();
    });
  }, []);

  // — attachments

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const keyOf = (a: Attachment) => (a.kind === "artwork" ? a.id : `${a.kind}:${a.name}`);
  const attach = useCallback((a: Attachment) => {
    setAttachments((prev) =>
      prev.some((x) => keyOf(x) === keyOf(a)) || prev.length >= 8 ? prev : [...prev, a],
    );
  }, []);
  const detach = useCallback((a: Attachment) => {
    setAttachments((prev) => prev.filter((x) => keyOf(x) !== keyOf(a)));
  }, []);

  // — routing & sending

  const busy = liveStatus === "submitted" || liveStatus === "streaming";
  const classify = useCallback(
    (text: string, withAttachments = true) =>
      classifyRules(text, {
        hasWall: wallRef.current.count > 0,
        attachments: withAttachments ? attachments.length : 0,
      }),
    [attachments.length],
  );

  const submit = useCallback(
    (raw: string, override?: RouteOverride, withAttachments = true) => {
      const text = raw.trim();
      const sent = withAttachments ? attachments : [];
      if (!text && sent.length === 0) return;
      if (busy) return;
      const message = text || (sent.length === 1 ? "Find more like this" : "Find more like these");
      const route: Route = override ?? classify(message, withAttachments).route;
      if (sent.length) setAttachments([]);
      setStopped(false);

      if (route === "lookup" || route === "describe") {
        const user: CurioUIMessage = {
          id: localId("u"),
          role: "user",
          parts: [{ type: "text", text: message }],
          metadata: { route },
        };
        setMessages((m) => [...m, user]);
        const run = route === "lookup" ? handlersRef.current.runLookup : handlersRef.current.runDescribe;
        void run(message).then((entry) => {
          if (!entry) return;
          const reply: CurioUIMessage = {
            id: localId("a"),
            role: "assistant",
            parts: [{ type: "data-search", id: localId("search"), data: entry }],
            metadata: {},
          };
          setMessages((m) => [...m, reply]);
        });
        return;
      }

      setOpenState(true);
      setPendingSince(Date.now());
      handlersRef.current.onTurnStart();
      void sendMessage({
        text: message,
        metadata: { attachments: sent.length ? sent : undefined, route },
      });
    },
    [attachments, busy, classify, sendMessage, setMessages],
  );

  const replayTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const cancelReplay = useCallback(() => {
    replayTimers.current.forEach(clearTimeout);
    replayTimers.current = [];
    setReplaying(false);
  }, []);

  const stop = useCallback(() => {
    setStopped(true);
    if (replaying) {
      cancelReplay();
      handlersRef.current.onTurnEnd();
    }
    void stopChat();
  }, [stopChat, replaying, cancelReplay]);

  const reset = useCallback(() => {
    cancelReplay();
    void stopChat();
    setMessages([]);
    setAttachments([]);
    setStopped(false);
    setWallExhibitId(undefined);
    focusComposer();
  }, [cancelReplay, stopChat, setMessages, focusComposer]);

  const retry = useCallback(() => {
    setStopped(false);
    setPendingSince(Date.now());
    handlersRef.current.onTurnStart();
    void regenerate();
  }, [regenerate]);

  /** A recorded example's brief, run live from a clean thread and blind to
   *  the wall (which is showing that same recording), so it's a true rerun
   *  rather than "more like what's up". */
  const runFresh = useCallback(
    (prompt: string) => {
      if (busy) return;
      cancelReplay();
      setMessages([]);
      setAttachments([]);
      setStopped(false);
      setWallExhibitId(undefined);
      setOpenState(true);
      setPendingSince(Date.now());
      handlersRef.current.onTurnStart();
      void sendMessage({ text: prompt, metadata: { route: "curate", fresh: true } });
    },
    [busy, cancelReplay, setMessages, sendMessage],
  );

  const showExhibit = useCallback(
    (messageId: string) => {
      const m = messages.find((x) => x.id === messageId);
      const exhibit = exhibitOf(m);
      if (m && exhibit) {
        handlersRef.current.onExhibit(exhibit);
        setWallExhibitId(exhibitPartIdOf(m));
      }
    },
    [messages],
  );

  const exhibitByPart = useCallback((partId: string) => findExhibitPart(messages, partId), [messages]);
  const showExhibitPart = useCallback(
    (partId: string) => {
      const exhibit = findExhibitPart(messages, partId);
      if (!exhibit) return;
      handlersRef.current.onExhibit(exhibit);
      setWallExhibitId(partId);
    },
    [messages],
  );

  /**
   * Play a recorded run (public/examples/<slug>.json) through the same
   * components a live turn uses, at about a third of its real pace (7–10s):
   * quick enough to beat a live run, slow enough to follow. Prose is written
   * out word by word, each step shows running for at least a beat before it
   * settles, look strips fill in image by image, and the exhibit goes up on
   * the wall. The message keeps the run's real timings and is marked
   * recorded; the thread carries on live from there.
   */
  const replay = useCallback(
    async (slug: string, prompt: string): Promise<boolean> => {
      const rec = await loadRecording(slug);
      if (!rec) return false;

      const userId = localId("u");
      const asstId = localId("a");
      const t0 = Date.now();
      setOpenState(true);
      setStopped(false);
      setReplaying(true);
      setPendingSince(t0);
      handlersRef.current.onTurnStart();
      setMessages((m) => [
        ...m,
        { id: userId, role: "user", parts: [{ type: "text", text: prompt }], metadata: { route: "curate" } },
        { id: asstId, role: "assistant", parts: [], metadata: { startedAt: t0, recorded: true } },
      ]);

      const last = Math.max(1, ...rec.parts.map((p) => p.doneAt ?? p.at));
      const target = Math.min(10_000, Math.max(7_000, last * 0.3));
      const scale = Math.min(1, target / last);
      const at = (ms: number) => Math.round(ms * scale);
      let end = 0;
      const later = (ms: number, fn: () => void) => {
        end = Math.max(end, ms);
        replayTimers.current.push(setTimeout(fn, ms));
      };
      const edit = (fn: (parts: CurioUIMessage["parts"]) => CurioUIMessage["parts"]) =>
        setMessages((m) => m.map((x) => (x.id === asstId ? { ...x, parts: fn(x.parts) } : x)));

      for (const p of rec.parts) {
        const start = at(p.at);
        if (p.type === "text") {
          // written out word by word, like a live stream
          const words = (p.text ?? "").split(/(?<=\s)/);
          const duration = Math.min(1400, words.length * 45);
          const ticks = Math.max(1, Math.ceil(duration / 50));
          let index = -1;
          later(start, () =>
            edit((parts) => {
              index = parts.length;
              return [...parts, { type: "text", text: "", state: "streaming" }];
            }),
          );
          for (let t = 1; t <= ticks; t++) {
            const text = words.slice(0, Math.round((words.length * t) / ticks)).join("");
            const state = t === ticks ? ("done" as const) : ("streaming" as const);
            later(start + (duration * t) / ticks, () =>
              edit((parts) => parts.map((x, j) => (j === index && x.type === "text" ? { ...x, text, state } : x))),
            );
          }
        } else if (p.type === "data-step") {
          const final = p.data as StepData;
          const running: StepData = {
            ...final,
            phase: "running",
            items: final.kind === "look" ? final.items?.map((i) => ({ ...i, state: "loading" as const })) : undefined,
          };
          const put = (data: StepData) =>
            edit((parts) => {
              const i = parts.findIndex((x) => x.type === "data-step" && x.id === p.id);
              const part = { type: "data-step" as const, id: p.id, data };
              return i === -1 ? [...parts, part] : parts.map((x, j) => (j === i ? part : x));
            });
          // every step shows as running long enough to read
          const settle = Math.max(start + 350, at(p.doneAt ?? p.at));
          later(start, () => put(running));
          // look strips fill in one image at a time across the step
          if (final.kind === "look" && final.items?.length) {
            final.items.forEach((_, k) =>
              later(start + ((settle - start) * (k + 1)) / (final.items!.length + 1), () =>
                put({
                  ...running,
                  items: final.items!.map((it, j) => (j <= k ? it : { ...it, state: "loading" })),
                }),
              ),
            );
          }
          later(settle, () => put(final));
        } else if (p.type === "data-exhibit") {
          later(start, () => {
            edit((parts) => [...parts, { type: "data-exhibit", id: p.id, data: p.data as ExhibitData }]);
            handlersRef.current.onExhibit(p.data as ExhibitData);
            setWallExhibitId(p.id);
          });
        }
      }
      later(end + 150, () => {
        setMessages((m) =>
          m.map((x) =>
            x.id === asstId
              ? {
                  ...x,
                  metadata: {
                    ...x.metadata,
                    finishedAt: t0 + rec.durationMs,
                    model: rec.metadata?.model,
                  },
                }
              : x,
          ),
        );
        replayTimers.current = [];
        setReplaying(false);
        handlersRef.current.onTurnEnd();
      });
      return true;
    },
    [setMessages],
  );

  /** A starting point from the wall or the empty thread: always a curator
   *  brief, replayed from its recording when there is one. */
  const runExample = useCallback(
    (slug: string) => {
      const ex = EXAMPLES.find((e) => e.slug === slug);
      if (!ex || busy) return;
      setOpenState(true);
      void replay(ex.slug, ex.prompt).then((ok) => {
        if (!ok) submit(ex.prompt, "curate");
      });
    },
    [busy, replay, submit],
  );

  // — "unseen": a turn finished while the thread wasn't showing

  const [seenId, setSeenId] = useState<string>();
  const visible = open;
  useEffect(() => {
    if (visible && curator.phase === "done") setSeenId(curator.messageId);
  }, [visible, curator.phase, curator.messageId]);
  const unseen = curator.phase === "done" && curator.messageId !== seenId && !visible;

  // — background tabs: the title carries the status

  useEffect(() => {
    const base = "Curio";
    if (isWorking(curator)) document.title = `${curatorText} · ${base}`;
    else if (unseen) document.title = `✓ ${doneTitle(curator)} · ${base}`;
    else document.title = base;
  }, [curator, curatorText, unseen]);

  const value = useMemo<ThreadContextValue>(
    () => ({
      messages,
      chatStatus: liveStatus,
      curator,
      curatorText,
      curatorGlyph,
      wallExhibitId,
      open,
      setOpen,
      mode,
      width,
      setWidth,
      attachments,
      attach,
      detach,
      submit,
      classify,
      stop,
      reset,
      retry,
      runFresh,
      showExhibit,
      showExhibitPart,
      exhibitByPart,
      runExample,
      unseen,
      focusComposer,
      registerComposer,
      setMessages,
    }),
    [
      messages,
      liveStatus,
      curator,
      curatorText,
      curatorGlyph,
      wallExhibitId,
      open,
      setOpen,
      mode,
      width,
      setWidth,
      attachments,
      attach,
      detach,
      submit,
      classify,
      stop,
      reset,
      retry,
      runFresh,
      showExhibit,
      showExhibitPart,
      exhibitByPart,
      runExample,
      unseen,
      focusComposer,
      registerComposer,
      setMessages,
    ],
  );

  return <ThreadContext.Provider value={value}>{children}</ThreadContext.Provider>;
}

export { exhibitOf };
