/**
 * The landing → /demo transition.
 *
 * Leave: from the click point an ink wave sweeps the screen, a stage-colored wave follows inside
 * it, the page recedes, and the app's mic orb settles in the center with "Setting the table…".
 * Arrive (/demo): the same frame is already painted (an inline script sets `pt-arrive` before first
 * paint), then the orb flies into its real place on the page while the frame dissolves and the
 * content rises in. Reduced motion skips all of it.
 */

import "./styles/transition.css";

const KEY = "lantern:pt";
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const EASE_SWEEP = "cubic-bezier(0.76, 0, 0.24, 1)";
const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";

const MIC_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';

/** The overlay markup, shared by both pages (demo.html also ships it inline to avoid a flash). */
export function overlayMarkup(): string {
  return `
    <div class="pt-wave pt-wave-ink"></div>
    <div class="pt-wave pt-wave-stage"></div>
    <div class="pt-center">
      <div class="pt-orb">
        <span class="pt-ring"></span><span class="pt-ring"></span><span class="pt-ring"></span>
        <span class="pt-mic">${MIC_SVG}</span>
      </div>
      <p class="pt-line">Setting the table…</p>
    </div>`;
}

/** Landing: every link to /demo leaves through the transition. */
export function initDemoLinks(): void {
  for (const link of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href="/demo"]'))) {
    link.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0 || reduceMotion()) return;
      e.preventDefault();
      void leave(link.href, e.clientX || window.innerWidth / 2, e.clientY || window.innerHeight / 2);
    });
  }
  // Coming back with the browser's back button: drop any frame left over from leaving.
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) {
      document.querySelector(".pt")?.remove();
      document.documentElement.classList.remove("pt-leaving");
    }
  });
}

async function leave(href: string, x: number, y: number): Promise<void> {
  const overlay = document.createElement("div");
  overlay.className = "pt pt-active";
  overlay.setAttribute("aria-hidden", "true");
  overlay.innerHTML = overlayMarkup();
  document.body.appendChild(overlay);
  document.documentElement.classList.add("pt-leaving");

  // Radius that covers the farthest corner from the click.
  const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 40;
  const at = `at ${x}px ${y}px`;
  const ink = overlay.querySelector<HTMLElement>(".pt-wave-ink")!;
  const stage = overlay.querySelector<HTMLElement>(".pt-wave-stage")!;
  const orb = overlay.querySelector<HTMLElement>(".pt-orb")!;
  const line = overlay.querySelector<HTMLElement>(".pt-line")!;

  ink.animate([{ clipPath: `circle(0px ${at})` }, { clipPath: `circle(${r}px ${at})` }], { duration: 640, easing: EASE_SWEEP, fill: "both" });
  const sweep = stage.animate([{ clipPath: `circle(0px ${at})` }, { clipPath: `circle(${r}px ${at})` }], { duration: 720, delay: 170, easing: EASE_SWEEP, fill: "both" });
  orb.animate(
    [{ opacity: 0, transform: "scale(0.55)", filter: "blur(8px)" }, { opacity: 1, transform: "scale(1)", filter: "blur(0)" }],
    { duration: 700, delay: 520, easing: EASE_OUT, fill: "both" },
  );
  line.animate([{ opacity: 0, transform: "translateY(14px)" }, { opacity: 1, transform: "none" }], { duration: 600, delay: 700, easing: EASE_OUT, fill: "both" });

  await sweep.finished;
  await new Promise((r2) => window.setTimeout(r2, 520));
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    /* private mode: the demo page simply appears without the arrival */
  }
  window.location.href = href;
}

/**
 * /demo: if we arrived through the transition, fly the orb into `target` and reveal `[data-stagger]`.
 * Returns once the frame is gone.
 */
export async function arrive(target: HTMLElement): Promise<void> {
  const root = document.documentElement;
  const overlay = document.querySelector<HTMLElement>(".pt");
  if (!root.classList.contains("pt-arrive") || !overlay || reduceMotion()) {
    root.classList.remove("pt-arrive");
    overlay?.remove();
    return;
  }
  // Keep the frame painted on its own once `pt-arrive` comes off the root.
  overlay.classList.add("pt-active", "pt-full");
  const orb = overlay.querySelector<HTMLElement>(".pt-orb")!;
  const line = overlay.querySelector<HTMLElement>(".pt-line")!;
  const stage = overlay.querySelector<HTMLElement>(".pt-wave-stage")!;

  // FLIP: from the centered mic to the real mic on the page.
  await new Promise(requestAnimationFrame);
  const from = orb.querySelector<HTMLElement>(".pt-mic")!.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const scale = to.width / from.width;

  line.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-10px)" }], { duration: 380, easing: EASE_OUT, fill: "both" });
  const fly = orb.animate(
    [{ transform: "translate(0, 0) scale(1)" }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }],
    { duration: 950, delay: 120, easing: "cubic-bezier(0.65, 0, 0.15, 1)", fill: "both" },
  );
  for (const ring of Array.from(orb.querySelectorAll<HTMLElement>(".pt-ring"))) {
    ring.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 500, delay: 700, fill: "both" });
  }
  stage.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 700, delay: 420, easing: "ease", fill: "both" });

  // Content rises in behind the dissolving frame.
  root.classList.add("pt-revealing");
  document.querySelectorAll<HTMLElement>("[data-stagger]").forEach((el, i) => {
    el.animate(
      [{ opacity: 0, transform: "translateY(22px)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0)" }],
      { duration: 900, delay: 520 + i * 80, easing: EASE_OUT, fill: "backwards" },
    );
  });
  root.classList.remove("pt-arrive");

  await fly.finished;
  overlay.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, fill: "both" }).finished.then(() => overlay.remove());
  root.classList.remove("pt-revealing");
}

/** For demo.html's inline head script: whether to paint the arrival frame. */
export const TRANSITION_KEY = KEY;
