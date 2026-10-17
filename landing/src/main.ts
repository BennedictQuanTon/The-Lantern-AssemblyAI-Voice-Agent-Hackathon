/**
 * The Lantern landing page: scroll reveals, count-ups, the hero orb, the problem slider,
 * the product view switcher and the teaser player. No framework, same stack as the app.
 */

import "./styles/tokens.css";
import "./styles/landing.css";

// The live app is the Docker service on Render (render.yaml); set VITE_APP_URL on Vercel.
const APP_URL = import.meta.env.VITE_APP_URL?.trim() || "https://lantern.onrender.com";

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

// ---------- Demo links ----------
for (const a of $$<HTMLAnchorElement>("[data-app-link]")) {
  a.href = APP_URL;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
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
  for (const el of $$<HTMLElement>(".l-reveal, .l-reveal-scale, .l-mask-heading, [data-viz], .l-member")) {
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
    const eased = 1 - Math.pow(1 - p, 4);
    render(from + (target - from) * eased);
    if (p < 1) requestAnimationFrame(tick);
  };
  render(from);
  requestAnimationFrame(tick);
}

function initCounters(): void {
  // Counters inside the slider run when their slide becomes active instead.
  for (const el of $$<HTMLElement>("[data-count]")) {
    if (el.closest(".l-slide")) continue;
    onceInView(el, () => countUp(el), { threshold: 0.6 });
  }
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

// ---------- Problem slider ----------
function initSlider(): void {
  const root = $<HTMLElement>("#problemSlider");
  if (!root) return;
  const track = $<HTMLElement>(".l-slider-track", root)!;
  const slides = $$<HTMLElement>(".l-slide", root);
  const dots = $$<HTMLButtonElement>(".l-dot", root);
  const [prev, next] = $$<HTMLButtonElement>(".l-arrow", root);
  const counted = new Set<HTMLElement>();
  let index = 0;
  let visible = false;

  // Build the slide visuals: 62 of 100 dots, 7 of 10 guests leaving.
  for (const grid of $$<HTMLElement>(".l-viz-dots", root)) {
    const filled = Number(grid.dataset.filled ?? 0);
    for (let n = 0; n < 100; n++) {
      const dot = document.createElement("span");
      if (n < filled) dot.className = "on";
      dot.style.setProperty("--t", `${n * 8}ms`);
      grid.appendChild(dot);
    }
  }
  $$<HTMLElement>(".l-viz-guests span", root).forEach((g, n) => {
    if (n < 7) g.classList.add("gone");
    g.style.setProperty("--t", `${200 + n * 90}ms`);
  });

  const activate = () => {
    slides.forEach((s, n) => {
      const on = visible && n === index;
      s.classList.toggle("is-active", on);
      s.setAttribute("aria-hidden", String(n !== index));
      if (on) {
        for (const c of $$<HTMLElement>("[data-count]", s)) {
          if (counted.has(c)) continue;
          counted.add(c);
          countUp(c);
        }
      }
    });
  };

  const go = (n: number) => {
    index = Math.max(0, Math.min(slides.length - 1, n));
    track.style.setProperty("--i", String(index));
    dots.forEach((d, k) => (k === index ? d.setAttribute("aria-current", "true") : d.removeAttribute("aria-current")));
    prev.disabled = index === 0;
    next.disabled = index === slides.length - 1;
    activate();
  };

  dots.forEach((d, k) => d.addEventListener("click", () => go(k)));
  prev.addEventListener("click", () => go(index - 1));
  next.addEventListener("click", () => go(index + 1));
  slides.forEach((s, k) => s.addEventListener("click", () => k !== index && go(k)));
  root.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") go(index + 1);
    if (e.key === "ArrowLeft") go(index - 1);
  });

  // Touch swipe
  let startX: number | null = null;
  let dx = 0;
  track.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    startX = e.clientX;
    dx = 0;
    track.classList.add("is-dragging");
  });
  track.addEventListener("pointermove", (e) => {
    if (startX === null) return;
    dx = e.clientX - startX;
    track.style.setProperty("--dx", `${dx}px`);
  });
  const end = () => {
    if (startX === null) return;
    startX = null;
    track.classList.remove("is-dragging");
    track.style.setProperty("--dx", "0px");
    if (Math.abs(dx) > 50) go(index + (dx < 0 ? 1 : -1));
  };
  track.addEventListener("pointerup", end);
  track.addEventListener("pointercancel", end);

  // Slide visuals only animate while the slider is on screen.
  new IntersectionObserver(
    ([e]) => {
      visible = e.isIntersecting || reduceMotion;
      activate();
    },
    { threshold: 0.35 },
  ).observe(root);

  go(0);
}

// ---------- Product views ----------
const VIEWS: Record<string, { src: string; alt: string; caption: string }> = {
  dining: {
    src: "/shots/guest-dining.jpg",
    alt: "Dining view: the microphone orb, a welcome line and suggested requests.",
    caption: "<strong>Dining.</strong> The table device: the listening orb, the guest’s words, the waiter’s reply, and a live table order.",
  },
  management: {
    src: "/shots/management.jpg",
    alt: "Management view: table KPIs, the spatial floor map, menu availability and the kitchen display.",
    caption: "<strong>Management.</strong> KPIs, a spatial floor map, 86’d stock that applies on the very next guest turn, and a live Kitchen Display System.",
  },
  logs: {
    src: "/shots/logs.jpg",
    alt: "Logs view: the latest turn with its transcript, reply, latency breakdown and live event stream.",
    caption: "<strong>Logs.</strong> Every turn inspected: what was heard, what the waiter said, the state change, and the latency breakdown.",
  },
};

function initViews(): void {
  const tabs = $$<HTMLButtonElement>(".segment-btn[data-view]");
  const img = $<HTMLImageElement>("#viewImg");
  const panel = $<HTMLElement>("#view-shot");
  const caption = $<HTMLElement>("#viewCaption");
  if (!img || !panel || !caption) return;

  // Warm the other screenshots so switching is instant.
  for (const v of Object.values(VIEWS)) new Image().src = v.src;

  const select = (tab: HTMLButtonElement) => {
    const view = VIEWS[tab.dataset.view ?? ""];
    if (!view) return;
    for (const t of tabs) {
      t.setAttribute("aria-selected", String(t === tab));
      t.tabIndex = t === tab ? 0 : -1;
    }
    panel.setAttribute("aria-labelledby", tab.id);
    img.classList.add("is-swap");
    window.setTimeout(() => {
      img.src = view.src;
      img.alt = view.alt;
      caption.innerHTML = view.caption;
      img.classList.remove("is-swap");
    }, reduceMotion ? 0 : 200);
  };

  tabs.forEach((tab, k) => {
    tab.tabIndex = k === 0 ? 0 : -1;
    tab.addEventListener("click", () => select(tab));
    tab.addEventListener("keydown", (e) => {
      const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
      if (!step) return;
      const nextTab = tabs[(k + step + tabs.length) % tabs.length];
      nextTab.focus();
      select(nextTab);
    });
  });
}

// ---------- Teaser player ----------
/**
 * Plays silently and loops while on screen. Sound is a tap away: the speaker button,
 * or the first tap on the video. After that, a tap pauses and resumes.
 */
function initPlayer(): void {
  const player = $<HTMLElement>("#player");
  const video = $<HTMLVideoElement>("#teaserVideo");
  const playBtn = $<HTMLButtonElement>("#playerPlay");
  const soundBtn = $<HTMLButtonElement>("#playerSound");
  if (!player || !video || !playBtn || !soundBtn) return;

  let userPaused = false;
  let onScreen = false;

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
        onScreen = e.isIntersecting;
        if (onScreen && !userPaused) void play();
        else if (!onScreen && !video.paused) video.pause();
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

// ---------- Marquee: duplicate the track so the loop is seamless ----------
function initMarquee(): void {
  const track = $<HTMLElement>("#marqueeTrack");
  if (!track) return;
  for (const li of Array.from(track.children)) {
    const copy = li.cloneNode(true) as HTMLElement;
    copy.setAttribute("aria-hidden", "true");
    track.appendChild(copy);
  }
}

initNav();
initMarquee();
initReveals();
initCounters();
initOrb();
initSlider();
initViews();
initPlayer();
