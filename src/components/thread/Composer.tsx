"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Square, User, X, Layers } from "lucide-react";
import { routeVerb } from "@/lib/router/rules";
import type { Attachment, Route } from "@/lib/thread/types";
import Icon from "../Icon";
import { useThread, type RouteOverride } from "./ThreadProvider";

/** the override menu's height, for choosing whether it fits above */
const MENU_HEIGHT = 240;

const OVERRIDES: { id: RouteOverride; label: string; hint: string }[] = [
  { id: null, label: "Let Curio decide", hint: "Search a name, read a description, or curate a brief" },
  { id: "lookup", label: "Search exactly", hint: "The museums' own search, as typed" },
  { id: "describe", label: "Read it as a description", hint: "Turn the phrase into subjects and periods" },
  { id: "curate", label: "Ask Curio", hint: "Search, look, and curate an exhibit" },
];

function attachmentKey(a: Attachment) {
  return a.kind === "artwork" ? a.id : `${a.kind}:${a.name}`;
}

function AttachmentRow({ a, onRemove }: { a: Attachment; onRemove: () => void }) {
  const [preview, setPreview] = useState(false);
  const title = a.kind === "artwork" ? a.title : a.name;
  const sub = a.kind === "artwork" ? a.artist : a.kind === "artist" ? "Artist" : "Movement";
  return (
    <div
      className="animate-rise relative flex items-center gap-2 py-1"
      onPointerEnter={() => setPreview(true)}
      onPointerLeave={() => setPreview(false)}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden bg-wash text-ink/60">
        {a.kind === "artwork" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.thumb} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
        ) : (
          <Icon icon={a.kind === "artist" ? User : Layers} size={14} />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] leading-[16px]">{title}</span>
        <span className="caption block truncate leading-[15px]">{sub}</span>
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${title} from the message`}
        title="Remove"
        className="press-none flex h-7 w-7 shrink-0 items-center justify-center text-ink/50 hover:bg-wash hover:text-ink"
      >
        <Icon icon={X} size={14} />
      </button>
      {preview && a.kind === "artwork" && (
        <span
          aria-hidden
          className="animate-pop pointer-events-none absolute bottom-full left-0 z-20 mb-1 block w-40 border border-ink bg-paper p-1"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={a.thumb} alt="" referrerPolicy="no-referrer" className="block max-h-40 w-full object-contain" />
        </span>
      )}
    </div>
  );
}

/**
 * The one input. Attachments sit inside the box above the text, stacked, as
 * wide as the field and no wider. The submit button says what pressing Enter
 * will do (the router's reading of the text, live); a small menu beside it
 * overrides that. While Curio works the button is Stop.
 */
export default function Composer({
  variant,
  placeholder,
  autoFocus = false,
  attachmentsHere = true,
}: {
  /** hero: the empty wall's big box · bar: one line above the wall ·
   *  thread: the bottom of the thread */
  variant: "hero" | "bar" | "thread";
  placeholder: string;
  autoFocus?: boolean;
  /** show (and send) the attached works here; off for the top bar while the
   *  thread, which has its own input, is open */
  attachmentsHere?: boolean;
}) {
  const { attachments: allAttachments, detach, submit, classify, chatStatus, stop, registerComposer } =
    useThread();
  const attachments = attachmentsHere ? allAttachments : [];
  const [value, setValue] = useState("");
  const [override, setOverride] = useState<RouteOverride>(null);
  const [menu, setMenu] = useState(false);
  // The override menu opens above the button (the thread's input sits at
  // the bottom of the screen) unless there isn't room there, e.g. the top bar.
  const [menuBelow, setMenuBelow] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const busy = chatStatus === "submitted" || chatStatus === "streaming";
  const hero = variant === "hero";
  const bar = variant === "bar";

  // The route preview settles 150ms after typing stops.
  const [route, setRoute] = useState<Route>("lookup");
  useEffect(() => {
    const t = setTimeout(() => setRoute(classify(value || " ", attachmentsHere).route), 150);
    return () => clearTimeout(t);
  }, [value, classify, attachmentsHere]);
  const effective: Route = override ?? (attachments.length > 0 ? "curate" : route);
  // Empty, the button just says Ask; once there's text it names the route.
  const verb = value.trim() || attachments.length ? routeVerb(effective) : "Ask";

  const toggleMenu = () => {
    if (!menu && menuRef.current) {
      const r = menuRef.current.getBoundingClientRect();
      const need = MENU_HEIGHT + 8;
      setMenuBelow(r.top < need && window.innerHeight - r.bottom > r.top);
    }
    setMenu((v) => !v);
  };

  // Grow with the text: min 1 line (2 on the hero), max 8 (4 in the bar).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const line = hero ? 26 : bar ? 22 : 21;
    const min = hero ? line * 2 : line;
    const pad = hero ? 16 : bar ? 24 : 10;
    el.style.height = `${Math.min(line * (bar ? 4 : 8) + pad, Math.max(min + pad, el.scrollHeight))}px`;
  }, [value, hero, bar]);

  const setRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      if (ref.current && ref.current !== el) registerComposer(ref.current, false);
      ref.current = el;
      if (el) registerComposer(el, true);
    },
    [registerComposer],
  );

  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const send = () => {
    if (busy) return;
    if (!value.trim() && attachments.length === 0) return;
    submit(value, override, attachmentsHere);
    setValue("");
    setOverride(null);
  };

  const canSend = !busy && (value.trim().length > 0 || attachments.length > 0);

  return (
    <form
      className="flex flex-col border border-ink bg-paper"
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
    >
      {attachments.length > 0 && (
        <div className={`flex flex-col border-b border-ink/15 ${hero ? "px-4 pt-2 pb-1" : "px-3 pt-1.5 pb-1"}`} aria-label="Attached">
          {attachments.map((a) => (
            <AttachmentRow key={attachmentKey(a)} a={a} onRemove={() => detach(a)} />
          ))}
        </div>
      )}
      <div className={bar ? "flex items-end" : "flex flex-col"}>
      <textarea
        ref={setRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            send();
          } else if (e.key === "Backspace" && !value && attachments.length) {
            detach(attachments[attachments.length - 1]);
          }
        }}
        rows={1}
        enterKeyHint="send"
        aria-label={hero ? "Ask Curio" : "Message Curio"}
        placeholder={attachments.length ? "Ask about these, or send as is to find more like them" : placeholder}
        className={`block w-full min-w-0 resize-none bg-transparent outline-none placeholder:text-muted-foreground ${
          hero
            ? "px-4 pt-4 text-[17px] leading-[26px]"
            : bar
              ? "flex-1 px-4 py-3 text-[14px] leading-[22px] pointer-coarse:text-[16px]"
              : "px-3 pt-2.5 text-[13px] leading-[21px] pointer-coarse:text-[16px] pointer-coarse:leading-[22px]"
        }`}
      />
      <div
        className={`flex shrink-0 items-center justify-end gap-2 ${
          hero ? "px-3 pt-1 pb-3" : bar ? "px-2 py-2" : "px-2 pt-0.5 pb-2"
        }`}
      >
        {override && (
          <span className="caption mr-auto pl-1">{OVERRIDES.find((o) => o.id === override)?.label}</span>
        )}
        {busy ? (
          <button
            type="button"
            onClick={stop}
            className="invert-hover flex items-center gap-1.5 border border-ink px-3 py-1.5 text-[12px] font-semibold"
          >
            <Icon icon={Square} size={11} className="fill-current" />
            Stop
          </button>
        ) : (
          <div ref={menuRef} className="relative flex items-stretch">
            {/* Always the one blue on the page: with nothing typed it
                just puts the caret in the box. */}
            <button
              type="submit"
              aria-disabled={!canSend}
              onClick={(e) => {
                if (!canSend) {
                  e.preventDefault();
                  ref.current?.focus();
                }
              }}
              className={`flex items-center gap-1.5 border border-accent bg-accent font-semibold text-paper transition-[background-color,border-color] duration-150 hover:border-ink hover:bg-ink ${
                hero ? "px-4 py-2 text-[14px]" : bar ? "px-3.5 py-1.5 text-[13px]" : "px-3 py-1.5 text-[12px]"
              }`}
            >
              {verb}
              <Icon icon={ArrowUp} size={hero ? 15 : 13} />
            </button>
            <button
              type="button"
              aria-label="How to read this"
              aria-haspopup="menu"
              aria-expanded={menu}
              title="How to read this"
              onClick={toggleMenu}
              className={`press-none flex items-center border border-l-paper/35 px-1.5 text-paper transition-[background-color,border-color] duration-150 ${
                menu ? "border-ink bg-ink" : "border-accent bg-accent hover:border-ink hover:bg-ink"
              }`}
            >
              <Icon icon={ChevronDown} size={13} />
            </button>
            {menu && (
              <div
                role="menu"
                className={`animate-pop-right absolute right-0 z-30 w-72 border border-ink bg-paper py-1 ${
                  menuBelow ? "top-full mt-1" : "bottom-full mb-1"
                }`}
              >
                {OVERRIDES.map((o) => (
                  <button
                    key={String(o.id)}
                    type="button"
                    role="menuitemradio"
                    aria-checked={override === o.id}
                    onClick={() => {
                      setOverride(o.id);
                      setMenu(false);
                      ref.current?.focus();
                    }}
                    className="invert-hover press-none group/o flex w-full items-start gap-2 px-3 py-2 text-left"
                  >
                    <span
                      aria-hidden
                      className={`mt-[3px] block h-3 w-3 shrink-0 border border-current ${
                        override === o.id ? "bg-current" : ""
                      }`}
                    />
                    <span className="flex flex-col gap-0.5">
                      <span className="text-[12px] font-medium">{o.label}</span>
                      <span className="caption group-hover/o:text-paper">{o.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </form>
  );
}
