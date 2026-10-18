/**
 * The Lantern landing page: scroll reveals, count-ups, the hero orb, the teaser player,
 * the deployment switch in How It Works, the turn-detection waveform and the feature demos.
 * No framework, same stack as the app.
 */

import "../../frontend/src/styles/tokens.css";
import "../../frontend/src/styles/components.css";
import "./styles/landing.css";
import { initShowcase } from "./showcase";

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = <T extends Element>(sel: string, root: ParentNode = document) => root.querySelector<T>(sel);
const $$ = <T extends Element>(sel: string, root: ParentNode = document) => Array.from(root.querySelectorAll<T>(sel));

/** Run `fn` once, the first time `el` scrolls into view. */
function onceInView(el: Element, fn: () => void, options: IntersectionObserverInit = { threshold: 0.2, rootMargin: "0px 0px -8% 0px" }): void {
  if (reduceMotion) return fn();
  const io = new IntersectionObserver(([entry]) => {
    if (entry.isIntersecting) {
      io.disconnect();
      fn();
    }
  }, options);
  io.observe(el);
}

// ---------- Navigation ----------
function initNav(): void {
  const nav = $<HTMLElement>("#nav")!;
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 8);
  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });

  const links = $$<HTMLAnchorElement>(".l-nav-links a");
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const l of links) {
          if (l.hash === `#${e.target.id}`) l.setAttribute("aria-current", "true");
          else l.removeAttribute("aria-current");
        }
      }
    },
    { rootMargin: "-45% 0px -50% 0px" },
  );
  for (const l of links) {
    const section = document.querySelector(l.hash);
    if (section) io.observe(section);
  }

  const toggle = $<HTMLButtonElement>("#navToggle")!;
  const menu = $<HTMLElement>("#navMobile")!;
  const setOpen = (open: boolean) => {
    menu.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close Menu" : "Open Menu");
  };
  toggle.addEventListener("click", () => setOpen(menu.hidden));
  for (const a of $$<HTMLAnchorElement>("a", menu)) a.addEventListener("click", () => setOpen(false));
}

// ---------- Reveals, masked headings, count-ups ----------
function initReveals(): void {
  for (const el of $$<HTMLElement>(".l-reveal, .l-reveal-scale, .l-mask-heading, [data-viz], .l-member, .aai")) {
    if (el.classList.contains("is-in")) continue;
    const immediate = el.hasAttribute("data-immediate");
    onceInView(el, () => el.classList.add("is-in"), immediate ? { threshold: 0 } : undefined);
  }
}

function countUp(el: HTMLElement): void {
  const target = Number(el.dataset.count);
  const from = Number(el.dataset.from ?? 0);
  const decimals = Number(el.dataset.decimals ?? 0);
  const suffix = el.dataset.suffix ?? "";
  const duration = Number(el.dataset.duration ?? 1400);
  const render = (v: number) => (el.textContent = `${v.toFixed(decimals)}${suffix}`);
  if (reduceMotion) return void render(target);
  const t0 = performance.now();
  const tick = (t: number) => {
    const p = Math.min(1, (t - t0) / duration);
    render(from + (target - from) * (1 - Math.pow(1 - p, 4)));
    if (p < 1) requestAnimationFrame(tick);
  };
  render(from);
  requestAnimationFrame(tick);
}

function initCounters(): void {
  for (const el of $$<HTMLElement>("[data-count]")) onceInView(el, () => countUp(el), { threshold: 0.6 });
}

// ---------- Hero orb: listening → understanding → speaking ----------
function initOrb(): void {
  const scene = $<HTMLElement>(".l-orb-scene");
  if (!scene) return;
  const states = ["listen", "understand", "speak"] as const;
  const labels = $$<HTMLElement>(".l-orb-label", scene);
  const statuses = $$<HTMLElement>(".l-order-status", scene);
  let i = 0;
  const show = () => {
    const state = states[i % states.length];
    scene.dataset.state = state;
    for (const l of labels) l.classList.toggle("is-active", l.dataset.state === state);
  };
  show();
  if (reduceMotion) return;
  window.setInterval(() => {
    i += 1;
    show();
    // Each full cycle moves the order rows one status forward, like a live ticket.
    if (i % states.length === 0) {
      for (const s of statuses) {
        const cycle = (s.dataset.cycle ?? "").split(",");
        const next = cycle[(cycle.indexOf(s.textContent ?? "") + 1) % cycle.length];
        s.classList.add("is-swap");
        window.setTimeout(() => {
          s.textContent = next;
          s.classList.remove("is-swap");
        }, 300);
      }
    }
  }, 1900);
}

// ---------- Teaser player ----------
/** Plays silently and loops while on screen; the speaker button or the first tap brings the sound in. */
function initPlayer(): void {
  const player = $<HTMLElement>("#player");
  const video = $<HTMLVideoElement>("#teaserVideo");
  const playBtn = $<HTMLButtonElement>("#playerPlay");
  const soundBtn = $<HTMLButtonElement>("#playerSound");
  if (!player || !video || !playBtn || !soundBtn) return;

  let userPaused = false;
  const sync = () => {
    player.classList.toggle("is-playing", !video.paused);
    soundBtn.setAttribute("aria-pressed", String(!video.muted));
    soundBtn.setAttribute("aria-label", video.muted ? "Turn Sound On" : "Turn Sound Off");
  };
  const play = () => video.play().catch(() => sync());
  for (const ev of ["play", "pause", "volumechange"]) video.addEventListener(ev, sync);

  if (!reduceMotion) {
    new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting && !userPaused) void play();
        else if (!e.isIntersecting && !video.paused) video.pause();
      },
      { threshold: 0.4 },
    ).observe(player);
  }

  playBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    userPaused = false;
    video.muted = false;
    void play();
  });
  soundBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    video.muted = !video.muted;
    if (!video.muted && video.paused) {
      userPaused = false;
      void play();
    }
  });
  video.addEventListener("click", () => {
    if (video.paused) {
      userPaused = false;
      void play();
    } else if (video.muted) {
      video.muted = false;
    } else {
      userPaused = true;
      video.pause();
    }
  });
  sync();
}

// ---------- How it works: edge vs hosted models ----------
function initProfiles(): void {
  const buttons = $$<HTMLButtonElement>(".hw-profile .segment-btn");
  const swappable = $$<HTMLElement>("[data-edge][data-hosted]");
  for (const b of buttons) {
    b.addEventListener("click", () => {
      const profile = b.dataset.profile === "hosted" ? "hosted" : "edge";
      for (const other of buttons) other.setAttribute("aria-selected", String(other === b));
      for (const el of swappable) {
        el.classList.add("is-swap");
        window.setTimeout(() => {
          el.textContent = el.dataset[profile] ?? "";
          el.classList.remove("is-swap");
        }, reduceMotion ? 0 : 180);
      }
    });
  }
}

// ---------- Turn detection waveform ----------
// RMS envelope of the demo's own "We'll take those two, please." clip (1.52 s), then silence.
const SPEECH = [0.06, 0.06, 0.16, 0.32, 0.51, 0.58, 0.16, 0.06, 0.1, 0.2, 0.76, 1.0, 0.65, 0.3, 0.08, 0.06, 0.06, 0.06, 0.52, 0.53, 0.46, 0.38, 0.28, 0.24, 0.23, 0.06, 0.06, 0.12, 0.16, 0.39, 0.31, 0.28, 0.28, 0.19, 0.08, 0.06, 0.1, 0.06, 0.24, 0.41, 0.41, 0.34, 0.31, 0.26, 0.17, 0.09, 0.06, 0.06, 0.06, 0.06, 0.06, 0.06, 0.07, 0.06, 0.06, 0.06];
const SPEECH_S = 1.52;
const TIMELINE_S = 3.0;

function initWave(): void {
  const wave = $<HTMLElement>("#aaiWave");
  const scale = $<HTMLElement>(".aai-turn-scale");
  if (!wave || !scale) return;
  const barS = SPEECH_S / SPEECH.length;
  const total = Math.round(TIMELINE_S / barS);
  for (let i = 0; i < total; i++) {
    const bar = document.createElement("span");
    const speaking = i < SPEECH.length;
    bar.style.setProperty("--h", String(speaking ? SPEECH[i] : 0.04));
    bar.style.setProperty("--t", `${i * 8}ms`);
    if (!speaking) bar.className = "is-silence";
    wave.appendChild(bar);
  }
  scale.style.setProperty("--min", `${((SPEECH_S + 0.4) / TIMELINE_S) * 100}%`);
  scale.style.setProperty("--max", `${((SPEECH_S + 1.0) / TIMELINE_S) * 100}%`);
}

initNav();
initWave();
initReveals();
initCounters();
initOrb();
initPlayer();
initProfiles();
initShowcase();
