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
import type {
  Attachment,
  CurioUIMessage,
  ExhibitData,
  Route,
  SearchEntryData,
  WallContext,
} from "@/lib/thread/types";
import { deriveStatus, exhibitOf, isWorking, statusText, type CuratorStatus } from "./status";

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
  submit: (text: string, override?: RouteOverride) => void;
  classify: (text: string) => RouteDecision;
  stop: () => void;
  reset: () => void;
  retry: () => void;
  showExhibit: (messageId: string) => void;
  runExample: (slug: string) => void;
  /** the done state has been looked at (clears the header's "unseen" pill) */
  unseen: boolean;
  focusComposer: () => void;
  registerComposer: (el: HTMLTextAreaElement | null) => void;
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
 *  rebuilds history from text, exhibits, searches and metadata alone. */
function slim(messages: CurioUIMessage[]): CurioUIMessage[] {
  return messages.map((m) => ({
    ...m,
    parts: m.parts.filter(
      (p) => p.type === "text" || p.type === "data-exhibit" || p.type === "data-search",
    ),
  }));
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

  const transport = useMemo(
    () =>
      new DefaultChatTransport<CurioUIMessage>({
        api: "/api/agent",
        prepareSendMessagesRequest: ({ messages }) => ({
          body: { messages: slim(messages), wall: wallRef.current },
        }),
      }),
    [],
  );

  const [wallExhibitId, setWallExhibitId] = useState<string>();
  const chat = useChat<CurioUIMessage>({
    transport,
    throttle: 50,
    onData: (part) => {
      if (part.type === "data-exhibit") {
        handlersRef.current.onExhibit(part.data);
        setWallExhibitId(part.id);
      }
    },
  });
  const { messages, status: chatStatus, sendMessage, setMessages, stop: stopChat, regenerate, error } = chat;

  const [stopped, setStopped] = useState(false);
  const [pendingSince, setPendingSince] = useState<number>();

  // Tell the page when a turn is over, however it ended.
  const wasBusy = useRef(false);
  useEffect(() => {
    const nowBusy = chatStatus === "submitted" || chatStatus === "streaming";
    if (wasBusy.current && !nowBusy) handlersRef.current.onTurnEnd();
    wasBusy.current = nowBusy;
  }, [chatStatus]);
  const curator = useMemo(
    () => deriveStatus(messages, chatStatus, { stopped, error: parseError(error), pendingSince }),
    [messages, chatStatus, stopped, error, pendingSince],
  );

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

  // — composer focus (the thread's and the hero's composers register here)

  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const registerComposer = useCallback((el: HTMLTextAreaElement | null) => {
    composerRef.current = el;
  }, []);
  const focusComposer = useCallback(() => {
    requestAnimationFrame(() => composerRef.current?.focus());
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

  const busy = chatStatus === "submitted" || chatStatus === "streaming";
  const classify = useCallback(
    (text: string) =>
      classifyRules(text, {
        hasWall: wallRef.current.count > 0,
        attachments: attachments.length,
      }),
    [attachments.length],
  );

  const submit = useCallback(
    (raw: string, override?: RouteOverride) => {
      const text = raw.trim();
      if (!text && attachments.length === 0) return;
      if (busy) return;
      const message =
        text || (attachments.length === 1 ? "Find more like this" : "Find more like these");
      const route: Route = override ?? classify(message).route;
      const sent = attachments;
      setAttachments([]);
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

  const stop = useCallback(() => {
    setStopped(true);
    void stopChat();
  }, [stopChat]);

  const reset = useCallback(() => {
    void stopChat();
    setMessages([]);
    setAttachments([]);
    setStopped(false);
    setWallExhibitId(undefined);
    focusComposer();
  }, [stopChat, setMessages, focusComposer]);

  const retry = useCallback(() => {
    setStopped(false);
    setPendingSince(Date.now());
    handlersRef.current.onTurnStart();
    void regenerate();
  }, [regenerate]);

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

  /** A starting point from the wall or the empty thread: always a curator
   *  brief. (Recorded runs replay instantly; see replayExample below.) */
  const runExample = useCallback(
    (slug: string) => {
      const ex = EXAMPLES.find((e) => e.slug === slug);
      if (!ex || busy) return;
      setOpenState(true);
      submit(ex.prompt, "curate");
    },
    [busy, submit],
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
    if (isWorking(curator)) document.title = `${statusText(curator)} · ${base}`;
    else if (unseen && curator.exhibit) document.title = `✓ ${curator.exhibit.title} · ${base}`;
    else document.title = base;
  }, [curator, unseen]);

  const value = useMemo<ThreadContextValue>(
    () => ({
      messages,
      chatStatus,
      curator,
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
      showExhibit,
      runExample,
      unseen,
      focusComposer,
      registerComposer,
      setMessages,
    }),
    [
      messages,
      chatStatus,
      curator,
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
      showExhibit,
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
