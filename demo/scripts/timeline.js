      (function () {
        /*
         * Timing system (see BRIEF.md § Notes):
         *   feedback      100–200ms   press, chip swaps          (NN/g ~100ms feedback; Curio press 120ms)
         *   enter / exit  300–500 / 200–300ms                    (NN/g, Val Head 200–500ms; exits faster)
         *   glyph states  500–650ms   the glyphs' own cycles     (Flip/Morph 1200ms → 600ms per half; Gather 1600ms)
         *   camera        1.0–1.4s in-out, no whips              (Material 3 extra-long 900–1400ms)
         *   text holds    ~2–3 words per second on screen
         * Every section starts from a named mark in S, so a beat can be lengthened
         * by moving the marks after it.
         *
         * v4 (39.3s → 28.5s, feedback: shave ~10s): typing starts at once and
         * speeds up harder; Ask hands off to the square 0.2s after the press; the
         * lens pan, the reading blocks and Gather run at about 60% of their v3
         * length; the note holds briefly once written; each comment is one
         * sentence, fully open for about 2s, and the second sits a row below the
         * first so the camera travels down rather than across.
         *
         * v5: the payoff's ground is plain white; the note holds less; from the
         * note the camera goes straight into the first work (no wide stop), glides
         * to the second on a strong in-out, then zooms out to the whole wall and
         * holds there about 2s.
         *
         * v6: each commented work holds 1.4s (comment open as the camera lands);
         * the second is Steinlen's Winter cat, second in row two, so the move
         * from the first runs diagonally down and right.
         *
         * v7: 0.9s on each commented work (was 1.4s), the comment fully open as the
         * camera lands; the four reading blocks show each work's full crop.
         *
         * v8: the button reads "Ask Curio" (wider, same right edge); "Looking for
         * cats with attitude." holds ~50% longer; the note holds ~30% longer.
         */
        const CX = 1280;
        const CY = 856;
        const IO = "power2.inOut"; // camera and on-screen travel: gentle in-out
        const IO_SOFT = "sine.inOut";
        const OUT = "power3.out"; // arrivals
        const IN = "power2.in"; // exits
        const $ = (id) => document.getElementById(id);
        const tl = gsap.timeline({ paused: true });

        const S = {};
        S.ask = 2.8;
        S.handoff = S.ask + 1.2; // 0.2s after the press
        S.gotIt = S.handoff + 0.6;
        S.search = S.gotIt + 3.0; // "Looking for cats with attitude." held ~50% longer (v8)
        S.look = S.search + 3.4;
        S.read = S.look + 2.0;
        S.curate = S.read + 2.4;
        S.done = S.curate + 1.3;
        S.note = S.done + 1.7;
        S.wall = S.note + 2.1; // the note held ~30% longer (v8)
        S.end = S.wall + 7.4;

        // ---------- data (cats-with-opinions.json) ----------
        const BRIEF = "Cats with opinions. Smug, plotting, deeply unimpressed.";
        const NOTE =
          "I went for attitude over fame, so Steinlen and a few lesser-known prints outrank the grand names. Start with the cat in spectacles, who has clearly read your work, then move through the squinters, the back-turners and one very pleased sleeper.";

        const noteEl = $("note");
        const noteWords = NOTE.split(" ");
        noteWords.forEach((w) => {
          const s = document.createElement("span");
          s.textContent = w;
          s.className = "w";
          noteEl.appendChild(s);
        });

        // ---------- camera (viewport-change: one world, one writer) ----------
        // Tween the point of view (px, py) and scale, derive the translate, so the
        // focus travels in a straight line instead of swinging during a zoom.
        const world = $("world");
        const cam = { px: CX, py: CY, s: 1 };
        const applyCamera = () => {
          const x = -(cam.px - CX) * cam.s;
          const y = -(cam.py - CY) * cam.s;
          world.style.transform = `translate(${x}px, ${y}px) scale(${cam.s})`;
        };
        const LINE = [1240, 830];
        const HERO = [1280, 900];
        const ASK = [1743, 932]; // centre of the "Ask Curio" button (v8: 290px wide)
        // a comment and its picture, framed together (card at left, comment beside it):
        // c01 (the white cat, row 1, column 1) and c04 (Steinlen's Winter cat, row 2,
        // column 2): the move between them runs diagonally down and right
        const C01 = [912, 1060];
        const C04 = [1572, 1705];
        const CLOSE = 2.1;
        // the whole wall: all three columns, the counts and rule above them
        const GALLERY = [1280, 1640];
        const GALLERY_S = 0.8;
        const poses = [
          { t: 0.0, p: [760, 782], s: 3.2 },
          { t: 0.35, p: [766, 782], s: 3.15, ease: "none" }, // the caret, then the first key
          { t: 1.5, p: [1280, 856], s: 1.3, ease: IO }, // pull out to the composer as it types
          { t: S.ask, p: [1320, 856], s: 1.36, ease: IO_SOFT }, // drift while typing
          { t: S.ask + 0.85, p: ASK, s: 2.6, ease: IO }, // travel to Ask
          { t: S.gotIt, p: ASK, s: 2.75, ease: "none" },
          { t: S.gotIt + 0.9, p: LINE, s: 2.2, ease: IO }, // pull back with the glyph
          { t: S.search, p: LINE, s: 2.25, ease: "none" }, // read the line
          { t: S.search + 1.0, p: HERO, s: 2.0, ease: IO },
          { t: S.look, p: HERO, s: 2.05, ease: "none" },
          { t: S.look + 0.8, p: [1000, 900], s: 1.4, ease: IO }, // widen for the loupe
          { t: S.look + 1.75, p: [1180, 900], s: 1.42, ease: IO }, // follow the lens
          { t: S.read, p: [1180, 900], s: 1.44, ease: "none" },
          { t: S.read + 0.8, p: HERO, s: 2.0, ease: IO },
          { t: S.done, p: HERO, s: 2.06, ease: "none" },
          { t: S.done + 0.8, p: LINE, s: 2.2, ease: IO },
          { t: S.note, p: LINE, s: 2.25, ease: "none" },
          { t: S.note + 0.9, p: [1000, 400], s: 1.7, ease: IO }, // up to the note
          { t: S.wall, p: [1000, 400], s: 1.73, ease: "none" },
          { t: S.wall + 1.2, p: C01, s: CLOSE, ease: "power3.inOut" }, // straight from the note into the white cat
          { t: S.wall + 2.1, p: C01, s: CLOSE + 0.015, ease: "none" }, // 0.9s on it
          { t: S.wall + 3.2, p: C04, s: CLOSE, ease: "power4.inOut" }, // diagonally to the Winter cat: a strong glide, not a slide
          { t: S.wall + 4.1, p: C04, s: CLOSE + 0.015, ease: "none" }, // 0.9s on it
          { t: S.wall + 5.25, p: GALLERY, s: GALLERY_S, ease: "power3.inOut" }, // out to the whole wall
          { t: S.end, p: [GALLERY[0], GALLERY[1] + 15], s: GALLERY_S + 0.015, ease: "none" }, // and stay a while
        ];
        const pose = (q) => ({ px: q.p[0], py: q.p[1], s: q.s });
        Object.assign(cam, pose(poses[0]));
        applyCamera();
        for (let i = 1; i < poses.length; i++) {
          const a = poses[i - 1];
          const b = poses[i];
          tl.fromTo(
            cam,
            pose(a),
            { ...pose(b), duration: b.t - a.t, ease: b.ease, immediateRender: false, onUpdate: applyCamera },
            a.t,
          );
        }

        // ---------- the brief types (0.35–2.3s), picking up speed hard as the sentence goes ----------
        const hash = (i) => {
          const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
          return x - Math.floor(x);
        };
        const FIRST_KEY = 0.35;
        const LAST_KEY = 2.3;
        const gaps = [];
        for (let i = 1; i < BRIEF.length; i++) {
          let g = 0.036 + hash(i) * 0.024;
          const prev = BRIEF[i - 1];
          if (prev === ".") g += 0.12;
          else if (prev === ",") g += 0.05;
          else if (prev === " ") g += 0.01;
          g *= 1.45 - 1.05 * (i / BRIEF.length); // warm up, then fluent: the last keys land ~3.5x faster than the first
          gaps.push(g);
        }
        const total = gaps.reduce((a, b) => a + b, 0);
        const k = (LAST_KEY - FIRST_KEY) / total;
        const keyTimes = [FIRST_KEY];
        gaps.forEach((g) => keyTimes.push(keyTimes[keyTimes.length - 1] + g * k));

        const typed = $("typed");
        const lastChar = $("last-char");
        const caret = $("caret");
        const renderTyping = (t) => {
          let n = 0;
          while (n < keyTimes.length && keyTimes[n] <= t) n++;
          typed.textContent = BRIEF.slice(0, Math.max(0, n - 1));
          lastChar.textContent = n > 0 ? BRIEF[n - 1] : "";
          const age = n > 0 ? t - keyTimes[n - 1] : 1;
          lastChar.style.opacity = String(Math.min(1, age / 0.1));
          const lastKey = n > 0 ? keyTimes[n - 1] : 0.0;
          const idle = t - lastKey;
          const on = idle < 0.5 || idle % 1.0 < 0.5; // Curio's 1s steps(2) blink
          caret.style.opacity = on ? "1" : "0";
        };
        const typing = { t: 0 };
        renderTyping(0);
        tl.fromTo(
          typing,
          { t: 0 },
          { t: S.gotIt, duration: S.gotIt, ease: "none", immediateRender: false, onUpdate: () => renderTyping(typing.t) },
          0,
        );
        tl.fromTo("#placeholder", { opacity: 1 }, { opacity: 0, duration: 0.2, ease: "none", immediateRender: false }, FIRST_KEY);

        // ---------- Ask: the real press, then two focus rings step out ----------
        const PRESS = S.ask + 1.0; // the camera has arrived at S.ask + 0.85
        tl.fromTo("#ask-btn", { scale: 1 }, { scale: 0.97, duration: 0.12, ease: "power1.in", immediateRender: false }, PRESS);
        tl.fromTo("#ask-btn", { scale: 0.97 }, { scale: 1, duration: 0.2, ease: OUT, immediateRender: false }, PRESS + 0.12);
        // quick, so they've gone by the time the button starts narrowing (S.handoff)
        tl.fromTo("#ring1", { opacity: 0, scale: 0.95 }, { opacity: 1, scale: 1, duration: 0.12, ease: OUT, immediateRender: false }, PRESS + 0.03);
        tl.to("#ring1", { scale: 1.05, opacity: 0, duration: 0.25, ease: "power2.out" }, PRESS + 0.15);
        tl.fromTo("#ring2", { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.12, ease: OUT, immediateRender: false }, PRESS + 0.08);
        tl.to("#ring2", { scale: 1.06, opacity: 0, duration: 0.25, ease: "power2.out" }, PRESS + 0.2);

        // ---------- Ask becomes the glyph ----------
        const H = S.handoff;
        tl.to(["#ask-label", "#chev"], { opacity: 0, duration: 0.15, ease: "none" }, H);
        tl.to(["#composer-box", "#field"], { opacity: 0, duration: 0.4, ease: IN }, H + 0.05);
        tl.fromTo("#ask-bg", { scaleX: 1 }, { scaleX: 84 / 290, duration: 0.3, ease: IO, immediateRender: false }, H + 0.05);
        const G_SMALL = 84 / 480;
        const G_ASK = { x: ASK[0] - CX, y: ASK[1] - CY, scale: G_SMALL };
        const G_SLOT = { x: 800 - CX, y: 800 - CY, scale: G_SMALL };
        const G_HERO = { x: 0, y: 0, scale: 1 };
        const G_LENS = { x: 560 - CX, y: 0, scale: 0.75 };
        tl.set("#g-wrap", { ...G_ASK, opacity: 1 }, H + 0.35);
        tl.set("#ask-bg", { opacity: 0 }, H + 0.35);

        // Flip: rotateX -180 then rotateY -180 (loading-dev, 1200ms a cycle), in halves so the face never mirrors
        const flipHalf = (axis, t, dur) => {
          const prop = axis === "x" ? "rotationX" : "rotationY";
          tl.fromTo("#g-face", { [prop]: 0 }, { [prop]: -90, duration: dur / 2, ease: "power2.in", immediateRender: false }, t);
          tl.set("#g-face", { [prop]: 90 }, t + dur / 2);
          tl.fromTo("#g-face", { [prop]: 90 }, { [prop]: 0, duration: dur / 2, ease: "power2.out", immediateRender: false }, t + dur / 2);
        };
        flipHalf("x", H + 0.35, 0.4);

        // ---------- "Got it" ----------
        const Gi = S.gotIt;
        tl.fromTo("#g-wrap", G_ASK, { ...G_SLOT, duration: 0.8, ease: IO, immediateRender: false }, Gi);
        flipHalf("y", Gi + 0.15, 0.5);
        tl.set("#status-set", { opacity: 1 }, Gi + 0.5);
        tl.fromTo(
          "#ack span",
          { opacity: 0, y: 12 },
          { opacity: 1, y: 0, duration: 0.3, ease: OUT, stagger: 0.09, immediateRender: false },
          Gi + 0.6,
        );
        tl.fromTo(["#status-mask", "#status-elapsed"], { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "none", immediateRender: false }, Gi + 1.1);
        flipHalf("x", Gi + 1.45, 0.6); // thinking: the slow flip

        // elapsed clock: 1s at the first line, 44s (the real run) as the exhibit lands
        const CLOCK_A = Gi + 0.6;
        const CLOCK_B = S.done + 0.55;
        const clock = { t: CLOCK_A };
        const elapsedEls = [$("status-elapsed"), $("cap-elapsed")];
        const chip1 = $("chip1");
        const COUNT_A = S.search + 1.1;
        const COUNT_B = S.search + 2.9;
        const renderClock = (t) => {
          const p = Math.min(1, Math.max(0, (t - CLOCK_A) / (CLOCK_B - CLOCK_A)));
          const secs = Math.max(1, Math.round(p * 44));
          elapsedEls.forEach((el) => (el.textContent = secs + "s"));
          const q = Math.min(1, Math.max(0, (t - COUNT_A) / (COUNT_B - COUNT_A)));
          chip1.textContent = Math.round(q * 138) + " works";
        };
        renderClock(CLOCK_A);
        tl.fromTo(
          clock,
          { t: CLOCK_A },
          { t: CLOCK_B, duration: CLOCK_B - CLOCK_A, ease: "none", immediateRender: false, onUpdate: () => renderClock(clock.t) },
          CLOCK_A,
        );

        // ---------- Searching: Flip at full size, through the drawers ----------
        const Se = S.search;
        tl.to("#status-set", { opacity: 0, duration: 0.3, ease: IN }, Se);
        tl.fromTo("#g-wrap", G_SLOT, { ...G_HERO, duration: 0.8, ease: IO, immediateRender: false }, Se + 0.1);
        tl.fromTo("#cap-set", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.4, ease: OUT, immediateRender: false }, Se + 0.8);
        tl.fromTo("#chip1", { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "none", immediateRender: false }, Se + 1.0);
        flipHalf("x", Se + 1.1, 0.6);
        tl.set("#fa1", { opacity: 1 }, Se + 1.4);
        flipHalf("y", Se + 1.9, 0.6);
        tl.set("#fa1", { opacity: 0 }, Se + 2.2);
        tl.set("#fa2", { opacity: 1 }, Se + 2.2);
        flipHalf("x", Se + 2.7, 0.6);
        tl.set("#fa2", { opacity: 0 }, Se + 3.0);
        tl.set("#fa3", { opacity: 1 }, Se + 3.0);

        // the caption rolls up one label per state
        const rollCap = (step, t) =>
          tl.fromTo("#cap-roll", { y: -(step - 1) * 52 }, { y: -step * 52, duration: 0.45, ease: OUT, immediateRender: false }, t);
        const swapChip = (from, to, t) => {
          tl.to(from, { opacity: 0, duration: 0.2, ease: "none" }, t);
          tl.fromTo(to, { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "none", immediateRender: false }, t + 0.15);
        };

        // ---------- Looking: the last drawer rounds into a loupe, still holding its picture ----------
        const Lk = S.look;
        rollCap(1, Lk);
        swapChip("#chip1", "#chip2", Lk);
        tl.fromTo("#g-face", { borderRadius: 0 }, { borderRadius: 240, duration: 0.55, ease: IO, immediateRender: false }, Lk);
        tl.fromTo("#g-wrap", G_HERO, { ...G_LENS, duration: 0.6, ease: IO, immediateRender: false }, Lk);
        tl.fromTo("#strip", { opacity: 0 }, { opacity: 0.32, duration: 0.45, ease: "none", immediateRender: false }, Lk + 0.2);
        const LENS_M = 1.35;
        tl.set("#lens-wrap", { x: 560 - CX }, Lk);
        tl.set("#lens-strip", { x: -(560 - CX) * LENS_M }, Lk);
        // picture to picture inside the same circle, and the loupe's ring arrives
        tl.fromTo("#lens-wrap", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "none", immediateRender: false }, Lk + 0.5);
        tl.set("#g-wrap", { opacity: 0 }, Lk + 0.8);
        tl.set("#fa3", { opacity: 0 }, Lk + 0.8);
        tl.fromTo("#lens-wrap", { x: 560 - CX }, { x: 0, duration: 0.85, ease: IO, immediateRender: false }, Lk + 0.85);
        tl.fromTo("#lens-strip", { x: -(560 - CX) * LENS_M }, { x: 0, duration: 0.85, ease: IO, immediateRender: false }, Lk + 0.85);

        // ---------- Reading: the loupe closes, the square splits into the four works it read ----------
        const Rd = S.read;
        rollCap(2, Rd);
        swapChip("#chip2", "#chip3", Rd);
        // the lens ring thickens until the circle is solid blue: an iris, not a crossfade
        tl.fromTo("#lens-ring", { borderWidth: 8 }, { borderWidth: 180, duration: 0.35, ease: IN, immediateRender: false }, Rd);
        tl.to("#strip", { opacity: 0, duration: 0.35, ease: "none" }, Rd);
        tl.set("#g-wrap", { x: 0, y: 0, scale: 0.75, opacity: 1 }, Rd + 0.35);
        tl.set("#g-face", { borderRadius: 240, rotation: 0 }, Rd + 0.35);
        tl.set("#lens-wrap", { opacity: 0 }, Rd + 0.35);
        tl.fromTo("#g-face", { borderRadius: 240, rotation: 0 }, { borderRadius: 0, rotation: 90, duration: 0.45, ease: IO, immediateRender: false }, Rd + 0.35);
        tl.fromTo("#g-wrap", { scale: 0.75 }, { scale: 1, duration: 0.45, ease: IO, immediateRender: false }, Rd + 0.35);
        // the four Gather blocks start as the square's quadrants (identical pixels), then part
        const Q = 240 / 182.4;
        const QUAD = [
          ["#gb0", 28.8, 28.8],
          ["#gb1", -28.8, 28.8],
          ["#gb2", 28.8, -28.8],
          ["#gb3", -28.8, -28.8],
        ];
        QUAD.forEach(([sel, qx, qy]) => tl.set(sel, { x: qx, y: qy, scale: Q }, Rd + 0.8));
        tl.set("#gather-wrap", { opacity: 1 }, Rd + 0.8);
        tl.set("#g-wrap", { opacity: 0 }, Rd + 0.8);
        QUAD.forEach(([sel, qx, qy], i) => {
          tl.fromTo(sel, { x: qx, y: qy, scale: Q }, { x: 0, y: 0, scale: 1, duration: 0.45, ease: IO, immediateRender: false }, Rd + 0.82 + i * 0.03);
        });
        // each block reads its work: the blue drops away top to bottom, one after another
        ["#gb0", "#gb1", "#gb2", "#gb3"].forEach((sel, i) => {
          tl.fromTo(`${sel} .gb-blue`, { scaleY: 1 }, { scaleY: 0, duration: 0.35, ease: OUT, immediateRender: false }, Rd + 1.2 + i * 0.17);
        });

        // ---------- Curating: Gather pulls the set together and turns (1600ms cycle) ----------
        const Cu = S.curate;
        rollCap(3, Cu);
        swapChip("#chip3", "#chip4", Cu);
        const PULL = 38.4;
        [
          ["#gb0", PULL, PULL],
          ["#gb1", -PULL, PULL],
          ["#gb2", PULL, -PULL],
          ["#gb3", -PULL, -PULL],
        ].forEach(([sel, dx, dy]) => {
          tl.fromTo(sel, { x: 0, y: 0 }, { x: dx, y: dy, duration: 0.4, ease: IO, immediateRender: false }, Cu + 0.15);
        });
        tl.fromTo("#gather-group", { rotation: 0 }, { rotation: 90, duration: 0.5, ease: IO, immediateRender: false }, Cu + 0.55);
        // each picture counter-turns so it stays upright; at rest it fills its block
        // exactly (full crop), and mid-turn it scales by |cos|+|sin| (1.41x at 45deg)
        // so the rotated picture always covers the block's corners
        const turn = { a: 0 };
        const gbIn = document.querySelectorAll(".gb-in");
        const applyTurn = () => {
          const r = (turn.a * Math.PI) / 180;
          gsap.set(gbIn, { rotation: turn.a, scale: Math.abs(Math.cos(r)) + Math.abs(Math.sin(r)) });
        };
        tl.fromTo(turn, { a: 0 }, { a: -90, duration: 0.5, ease: IO, immediateRender: false, onUpdate: applyTurn }, Cu + 0.55);

        // ---------- Done: back into the line ----------
        const Dn = S.done;
        tl.to("#cap-set", { opacity: 0, duration: 0.25, ease: IN }, Dn);
        tl.fromTo("#gather-wrap", G_HERO, { ...G_SLOT, duration: 0.7, ease: IO, immediateRender: false }, Dn);
        tl.set("#ack", { opacity: 0.45 }, Dn + 0.35);
        tl.fromTo("#status-set", { opacity: 0 }, { opacity: 1, duration: 0.25, ease: "none", immediateRender: false }, Dn + 0.4);
        tl.fromTo("#status-roll", { y: 0 }, { y: -42, duration: 0.4, ease: OUT, immediateRender: false }, Dn + 0.55);
        tl.to("#gather-wrap", { opacity: 0, duration: 0.2, ease: "none" }, Dn + 0.65);
        tl.fromTo("#check", { opacity: 0, scale: 0.7 }, { opacity: 1, scale: 1, duration: 0.3, ease: OUT, immediateRender: false }, Dn + 0.7);

        // ---------- The note ----------
        const Nt = S.note;
        tl.to("#status-set", { opacity: 0, duration: 0.25, ease: IN }, Nt);
        tl.fromTo("#tint", { opacity: 0 }, { opacity: 1, duration: 1.0, ease: IO, immediateRender: false }, Nt + 0.15);
        tl.fromTo("#title", { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.45, ease: OUT, immediateRender: false }, Nt + 0.4);
        tl.fromTo("#note-rule", { opacity: 1, scaleY: 0 }, { opacity: 1, scaleY: 1, duration: 0.45, ease: IO, immediateRender: false }, Nt + 0.55);
        tl.fromTo(
          "#note span.w",
          { opacity: 0 },
          { opacity: 1, duration: 0.2, ease: "none", stagger: 0.55 / noteWords.length, immediateRender: false },
          Nt + 0.6,
        );

        // ---------- The wall hangs itself ----------
        const Wl = S.wall;
        tl.fromTo("#page-rule", { opacity: 1, scaleX: 0 }, { opacity: 1, scaleX: 1, duration: 0.6, ease: IO, immediateRender: false }, Wl + 0.2);
        tl.fromTo("#page-chips", { opacity: 0 }, { opacity: 1, duration: 0.3, ease: "none", immediateRender: false }, Wl + 0.3);
        ["#c01", "#c02", "#c03", "#c05", "#c04", "#c06", "#c09", "#c07", "#c08", "#c10"].forEach((sel, i) => {
          tl.fromTo(sel, { opacity: 0, y: 30 }, { opacity: 1, y: 0, duration: 0.5, ease: OUT, immediateRender: false }, Wl + 0.35 + i * 0.045);
        });

        // ---------- Two comments, each framed close: mat, the app's 350ms intent delay, open, hold, close ----------
        const comment = (card, id, tMat, tClose) => {
          tl.fromTo(`${card} .mat`, { opacity: 0 }, { opacity: 1, duration: 0.15, ease: "none", immediateRender: false }, tMat);
          tl.fromTo(id, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: OUT, immediateRender: false }, tMat + 0.35);
          tl.to(id, { opacity: 0, duration: 0.25, ease: "none" }, tClose);
          tl.to(`${card} .mat`, { opacity: 0, duration: 0.15, ease: "none" }, tClose);
        };
        // one sentence each; mat and comment open on the camera's approach so the
        // comment is fully open as it lands, then both close as it leaves (0.9s per work)
        comment("#c01", "#k01", Wl + 0.6, Wl + 2.1);
        comment("#c04", "#k04", Wl + 2.6, Wl + 4.1);
        // then the camera pulls out to the whole wall and holds (poses above); no page scroll

        window.__timelines["main"] = tl;
      })();
