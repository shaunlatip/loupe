"use client";

import { useEffect, useState } from "react";
import { ArrowUp } from "lucide-react";
import Icon from "./Icon";

/**
 * Back to the top of a long wall. Appears once the page is scrolled past
 * one and a half screens and hides again near the top (MFA Boston uses the
 * same square, bottom-right). It tracks `--thread-w` so it never sits under
 * the docked thread. In development it rides higher to clear the agentation
 * toolbar, which owns the bottom-right corner there.
 */
export default function ScrollTopButton({ enabled }: { enabled: boolean }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setShow(false);
      return;
    }
    const onScroll = () => setShow(window.scrollY > window.innerHeight * 1.5);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled]);

  return (
    <button
      type="button"
      aria-label="Back to top"
      title="Back to top"
      tabIndex={show ? 0 : -1}
      aria-hidden={!show}
      onClick={() => {
        const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      }}
      className={`invert-hover fixed z-30 flex h-10 w-10 items-center justify-center border border-ink bg-paper transition-[opacity,transform,background-color,color] duration-200 ease-[var(--ease-out)] ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-2 opacity-0"
      }`}
      style={{
        right: "calc(var(--thread-w, 0px) + 24px)",
        bottom: process.env.NODE_ENV === "development" ? 88 : 24,
      }}
    >
      <Icon icon={ArrowUp} size={18} />
    </button>
  );
}
