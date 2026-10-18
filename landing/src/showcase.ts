/**
 * Feature demos: the app's own Dining view (components.css + the real orb canvas) replays six
 * moments of a dinner service in sync with real audio. Waiter lines are verbatim from the live
 * stack; audio comes from landing/scripts/generate_demo_audio.py. Numbered hotspots are pinned to
 * the live DOM, BKAi-style.
 */

import { AppleOrb } from "../../frontend/src/components/siri_orb";

type KdsStatus = "queued" | "cooking" | "plating" | "ready";
interface Line { name: string; qty: number; price: number }
type Step =
  | { t: "guest"; clip: string; text: string }
  | { t: "filler"; clip: string }
  | { t: "waiter"; clip: string; text: string; basket?: Line[] }
  | { t: "kds"; status: KdsStatus; press?: boolean }
  | { t: "pause"; ms: number }
  | { t: "barge"; waiter: string; text: string; cutAt: number; guest: string; guestText: string };

interface Callout { sel: string; label: string; at?: [number, number]; side?: "left" | "right"; staff?: boolean }
interface Scene {
  key: string;
  tab: string;
  icon: string;
  title: string;
  body: string;
  basket: Line[];
  staff?: boolean;
  callouts: Callout[];
  steps: Step[];
}

interface ClipMeta { speaker: string; text: string; seconds: number }

const POMELO: Line = { name: "Pomelo Salad with Shrimp", qty: 1, price: 6.5 };
const CHICKEN: Line = { name: "Lemongrass Chicken", qty: 1, price: 9 };
const SEABASS: Line = { name: "Grilled Seabass", qty: 1, price: 16 };
const GLORY: Line = { name: "Stir-fried Morning Glory", qty: 1, price: 5 };

const ICONS = {
  chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  ban: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z"/><path d="m9 12 2 2 4-4"/></svg>',
  kitchen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/></svg>',
  globe: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  hand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5 6 9H3v6h3l5 4V5z"/><path d="m22 9-6 6M16 9l6 6"/></svg>',
};

const SCENES: Scene[] = [
  {
    key: "memory",
    tab: "Those two",
    icon: ICONS.chat,
    title: "It remembers what it just offered.",
    body: "The guest asks for a recommendation, then says “those two”. The reference resolves from the dishes the waiter just offered, kept in SQLite, so the small model never has to remember them.",
    basket: [],
    callouts: [
      { sel: ".orb-container", at: [0.8, 0.22], label: "The orb follows the live audio" },
      { sel: "#scGuest", at: [0, 0], label: "AssemblyAI Universal-3.5 Pro, streamed live" },
      { sel: "#scAgent", at: [0, 0], label: "Reply rendered from the saved order" },
      { sel: "#scBasket", at: [0, 0], label: "“Those two” → 2 dishes, $15.50" },
    ],
    steps: [
      { t: "guest", clip: "g_recommend", text: "What would you recommend for a mild couple?" },
      { t: "filler", clip: "f_recommend_en" },
      { t: "waiter", clip: "w_recommend", text: "I recommend Pomelo Salad with Shrimp ($6.50), Lemongrass Chicken ($9.00)." },
      { t: "guest", clip: "g_those_two", text: "We'll take those two, please." },
      { t: "filler", clip: "f_order_en" },
      { t: "waiter", clip: "w_those_two", text: "Your order now includes 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken. Total: $15.50. Tell me when you'd like me to place it.", basket: [POMELO, CHICKEN] },
    ],
  },
  {
    key: "soldout",
    tab: "Sold out",
    icon: ICONS.ban,
    title: "Sold out is handled in the conversation.",
    body: "The kitchen marked Crispy Squid as 86’d. The waiter refuses it with an available alternative, and “instead” adds the seabass without removing anything else.",
    basket: [POMELO, CHICKEN],
    callouts: [
      { sel: "#scGuest", at: [0, 0], label: "Natural speech, no keywords" },
      { sel: "#scAgent", at: [0, 0], label: "86’d stock applies on the very next turn" },
      { sel: "#scBasket", at: [0, 0], label: "“Instead” replaced only the refused dish" },
    ],
    steps: [
      { t: "guest", clip: "g_squid", text: "I'd like the crispy squid too." },
      { t: "filler", clip: "f_order_en" },
      { t: "waiter", clip: "w_squid", text: "Crispy Squid is sold out. Would you like Grilled Seabass instead?" },
      { t: "guest", clip: "g_instead", text: "Okay, make it a grilled seabass instead." },
      { t: "filler", clip: "f_order_en" },
      { t: "waiter", clip: "w_instead", text: "Your order now includes 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken, 1 Grilled Seabass. Total: $31.50. Tell me when you'd like me to place it.", basket: [POMELO, CHICKEN, SEABASS] },
    ],
  },
  {
    key: "allergy",
    tab: "Allergies",
    icon: ICONS.shield,
    title: "Allergies are kept for the whole order.",
    body: "The guest mentions a peanut allergy once. A turn later, a dish with peanut is refused before it can enter the order, and the kitchen ticket carries the allergy as a note.",
    basket: [],
    callouts: [
      { sel: "#scGuest", at: [0, 0], label: "Allergy captured with the order" },
      { sel: "#scAgent", at: [0, 0], label: "Validator: peanut conflict, refused" },
      { sel: "#scBasket", at: [0, 0], label: "The salad never entered the order" },
    ],
    steps: [
      { t: "guest", clip: "g_allergy", text: "I'm allergic to peanuts. One grilled seabass, please." },
      { t: "filler", clip: "f_order_en" },
      { t: "waiter", clip: "w_allergy", text: "Your order now includes 1 Grilled Seabass. Total: $16.00. Tell me when you'd like me to place it.", basket: [SEABASS] },
      { t: "guest", clip: "g_pomelo", text: "And the pomelo salad." },
      { t: "filler", clip: "f_order_en" },
      { t: "waiter", clip: "w_pomelo", text: "Pomelo Salad with Shrimp contains peanut, which you're avoiding. Would you like something else?" },
    ],
  },
  {
    key: "kitchen",
    tab: "Kitchen",
    icon: ICONS.kitchen,
    title: "Only “place the order” reaches the kitchen.",
    body: "Drafts stay off the Kitchen Display. Once the guest places the order, the ticket appears for staff, and each kitchen decision is spoken back at the table.",
    basket: [POMELO, CHICKEN, SEABASS, GLORY],
    staff: true,
    callouts: [
      { sel: "#scAgent", at: [0, 0], label: "Kitchen decisions, spoken at the table" },
      { sel: ".kds-ticket-card", at: [0.02, 0.06], label: "Ticket appears only once placed", staff: true, side: "left" },
      { sel: ".btn-kds-bump", at: [0.5, 0.5], label: "Each step checks the order’s revision", staff: true, side: "left" },
    ],
    steps: [
      { t: "guest", clip: "g_place", text: "That's all, please place the order." },
      { t: "filler", clip: "f_place_en" },
      { t: "waiter", clip: "w_place", text: "Your order is in: 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken, 1 Grilled Seabass, 1 Stir-fried Morning Glory. Total: $36.50. I sent it to the kitchen." },
      { t: "kds", status: "queued" },
      { t: "pause", ms: 900 },
      { t: "kds", status: "cooking", press: true },
      { t: "waiter", clip: "w_kitchen_accept", text: "The kitchen confirmed your order." },
      { t: "pause", ms: 900 },
      { t: "kds", status: "plating", press: true },
      { t: "pause", ms: 1100 },
      { t: "kds", status: "ready", press: true },
      { t: "waiter", clip: "w_kitchen_ready", text: "Your order is ready." },
    ],
  },
  {
    key: "spanish",
    tab: "Español",
    icon: ICONS.globe,
    title: "Guests order in their own language.",
    body: "AssemblyAI transcribes the Spanish as it is spoken. Replies use native Spanish templates, dish names and prices stay exactly as on the menu, and the kitchen still gets its ticket.",
    basket: [],
    callouts: [
      { sel: "#scGuest", at: [0, 0], label: "Spanish, transcribed live" },
      { sel: "#scAgent", at: [0, 0], label: "Native template, menu names unchanged" },
      { sel: "#scBasket", at: [0, 0], label: "Same order, same prices" },
    ],
    steps: [
      { t: "guest", clip: "g_es_recommend", text: "¿Qué nos recomienda para una pareja, algo suave?" },
      { t: "filler", clip: "f_generic_es" },
      { t: "waiter", clip: "w_es_recommend", text: "Le recomiendo Pomelo Salad with Shrimp ($6.50), Lemongrass Chicken ($9.00)." },
      { t: "guest", clip: "g_es_those_two", text: "Queremos esos dos, por favor." },
      { t: "filler", clip: "f_generic_es" },
      { t: "waiter", clip: "w_es_those_two", text: "Su pedido ahora incluye 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken. Total: $15.50. Avíseme cuando quiera que lo envíe.", basket: [POMELO, CHICKEN] },
      { t: "guest", clip: "g_es_place", text: "Eso es todo, envíe el pedido, por favor." },
      { t: "filler", clip: "f_generic_es" },
      { t: "waiter", clip: "w_es_place", text: "Su pedido quedó registrado: 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken. Total: $15.50. Lo envié a la cocina." },
    ],
  },
  {
    key: "barge",
    tab: "Barge-in",
    icon: ICONS.hand,
    title: "Talk over it, and it stops to listen.",
    body: "When the guest starts speaking, AssemblyAI’s SpeechStarted event cancels the reply in progress and stops playback, so nobody waits for a long readback to finish.",
    basket: [POMELO, CHICKEN, SEABASS, GLORY],
    callouts: [
      { sel: ".orb-container", at: [0.8, 0.22], label: "Playback stops the moment the guest speaks" },
      { sel: "#scGuest", at: [0, 0], label: "SpeechStarted → barge_in" },
      { sel: "#scAgent", at: [0, 0], label: "Reply cancelled mid-sentence" },
    ],
    steps: [
      { t: "barge", waiter: "w_side", text: "Your order now includes 1 Pomelo Salad with Shrimp, 1 Lemongrass Chicken, 1 Grilled Seabass, 1 Stir-fried Morning Glory. Total: $36.50. Tell me when you'd like me to place it.", cutAt: 4.4, guest: "g_barge", guestText: "Sorry, one more thing." },
      { t: "pause", ms: 600 },
    ],
  },
];

const VIEW_W = 1180;
const VIEW_H = 820;
const STAFF_W = 560;
const GAP_MS = 260;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const money = (v: number) => `$${v.toFixed(2)}`;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Web Audio playback through one analyser, so the real orb reacts to the voices. */
class Voice {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private buffers = new Map<string, Promise<AudioBuffer>>();
  private sources = new Set<AudioBufferSourceNode>();

  constructor() {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.analyser.connect(this.ctx.destination);
  }

  load(id: string): Promise<AudioBuffer> {
    let buffer = this.buffers.get(id);
    if (!buffer) {
      buffer = fetch(`/audio/demo/${id}.mp3`).then((r) => r.arrayBuffer()).then((data) => this.ctx.decodeAudioData(data));
      this.buffers.set(id, buffer);
    }
    return buffer;
  }

  /** Resolves when the clip ends or is stopped. */
  async play(id: string, onStart?: (seconds: number) => void): Promise<{ done: Promise<void>; stop: () => void }> {
    const buffer = await this.load(id);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    this.sources.add(source);
    const done = new Promise<void>((resolve) => {
      source.onended = () => {
        this.sources.delete(source);
        resolve();
      };
    });
    source.start();
    onStart?.(buffer.duration);
    return { done, stop: () => { try { source.stop(); } catch { /* already stopped */ } } };
  }

  stopAll(): void {
    for (const s of this.sources) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.sources.clear();
  }
}

export function initShowcase(): void {
  const root = document.getElementById("showcase");
  if (!root) return;

  const tabsEl = $("scTabs");
  const stage = $("scStage");
  const screen = $("scScreen");
  const viewport = $("scViewport");
  const body = $("scBody");
  const staff = $("scStaff");
  const staffViewport = $("scStaffViewport");
  const kds = $("scKds");
  const callouts = $("scCallouts");
  const guestText = $("scGuestText");
  const guestStatus = $("scGuestStatus");
  const agentText = $("scAgentText");
  const agentStatus = $("scAgentStatus");
  const basket = $("scBasket");
  const basketList = $("scBasketList");
  const basketTotal = $("scBasketTotal");
  const mic = $("scMic");
  const captionWho = $("scCaptionWho");
  const captionText = $("scCaptionText");
  const title = $("scTitle");
  const bodyText = $("scBodyText");
  const points = $("scPoints");
  const playBtn = $<HTMLButtonElement>("scPlay");
  const toggle = $<HTMLButtonElement>("scToggle");
  const toggleLabel = $("scToggleLabel");
  const prev = $<HTMLButtonElement>("scPrev");
  const next = $<HTMLButtonElement>("scNext");

  const orb = new AppleOrb($<HTMLCanvasElement>("scOrb"));
  let voice: Voice | null = null;
  let manifest: Record<string, ClipMeta> = {};
  void fetch("/audio/demo/manifest.json").then((r) => r.json()).then((m) => (manifest = m)).catch(() => {});

  let index = 0;
  let runId = 0;
  let playing = false;
  let onScreen = false;
  let progressStart = 0;
  let progressTotal = 1;

  // ---------- Tabs ----------
  const tabs = SCENES.map((scene, k) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sc-tab";
    b.setAttribute("role", "tab");
    b.innerHTML = `${scene.icon}<span>${scene.tab}</span><span class="sc-tab-progress"></span>`;
    b.addEventListener("click", () => select(k, playing));
    tabsEl.appendChild(b);
    return b;
  });

  // ---------- Scaling: the app renders at its real size, then scales into the frame ----------
  const fit = () => {
    viewport.style.transform = `scale(${screen.clientWidth / VIEW_W})`;
    const staffScreen = staffViewport.parentElement!;
    staffViewport.style.transform = `scale(${staffScreen.clientWidth / STAFF_W})`;
  };
  new ResizeObserver(fit).observe(screen);
  new ResizeObserver(fit).observe(staffViewport.parentElement!);

  /** Keep the newest content in view, like the page scrolling on a real tablet. */
  const follow = () => {
    const overflow = 64 + body.offsetHeight - VIEW_H;
    body.style.transform = overflow > 0 ? `translateY(${-overflow}px)` : "";
  };

  // ---------- App state, in the app's own markup ----------
  const setBasket = (lines: Line[]) => {
    basket.classList.toggle("visible", lines.length > 0);
    basketList.innerHTML = lines
      .map((l) => `<div class="basket-row"><span class="basket-row-name">${l.qty}× ${l.name}</span><span class="basket-row-price">${money(l.price * l.qty)}</span></div>`)
      .join("");
    basketTotal.textContent = money(lines.reduce((sum, l) => sum + l.price * l.qty, 0));
    follow();
  };

  const setMic = (active: boolean) => {
    mic.classList.toggle("active", active);
    mic.innerHTML = active
      ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5"/></svg>'
      : '<svg viewBox="0 0 24 24"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/><path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>';
  };

  const setGuest = (text: string, interim: boolean, status: string) => {
    guestText.className = `speech-text guest-text${interim ? " interim" : ""}`;
    guestText.textContent = text;
    guestStatus.textContent = status;
  };
  const setAgent = (text: string, status: string) => {
    agentText.className = "speech-text agent-text";
    agentText.textContent = text;
    agentStatus.textContent = status;
    follow();
  };

  let ticketStatus: KdsStatus | null = null;
  const BUMP: Record<KdsStatus, string> = { queued: "Start Cooking", cooking: "Mark Plating", plating: "Ready to Serve", ready: "Mark Served" };
  const setKds = (status: KdsStatus | null, lines: Line[]) => {
    const fresh = ticketStatus === null && status !== null;
    ticketStatus = status;
    if (!status) {
      kds.innerHTML = '<div class="empty-kds-state"><p>All kitchen orders have been served. Kitchen is clear.</p></div>';
      return;
    }
    const items = lines
      .map((l) => `<div class="kds-dish-item"><span class="kds-dish-qty">${l.qty}×</span><div class="kds-dish-desc"><span class="kds-dish-name">${l.name}</span></div></div>`)
      .join("");
    kds.innerHTML = `
      <div class="kds-ticket-card status-${status}"${fresh ? "" : ' style="animation:none"'}>
        <div class="kds-ticket-header">
          <div class="kds-header-meta"><span class="kds-ticket-number">#7F3A2C</span><span class="kds-table-badge">Table 4</span></div>
          <div class="kds-header-status"><span class="kds-time-timer">just now</span><span class="kds-status-pill ${status}">${status}</span></div>
        </div>
        <div class="kds-ticket-body">${items}</div>
        <div class="kds-ticket-footer"><span class="kds-server-tag">Server: Lantern Voice</span><button type="button" class="btn-kds-bump" tabindex="-1">${BUMP[status]}</button></div>
      </div>`;
  };

  const caption = (who: "guest" | "waiter" | "filler" | "kitchen" | "idle", text: string) => {
    captionWho.className = `sc-caption-who${who === "guest" ? " is-guest" : who === "waiter" || who === "filler" ? " is-waiter" : ""}`;
    captionWho.textContent = { guest: "Guest", waiter: "Waiter", filler: "Waiter · filler", kitchen: "Kitchen", idle: "Ready" }[who];
    captionText.className = `sc-caption-text${who === "filler" ? " is-filler" : ""}`;
    captionText.textContent = text;
  };

  // ---------- Callouts pinned to the DOM ----------
  const renderCallouts = (scene: Scene) => {
    callouts.innerHTML = scene.callouts
      .map((c, i) => `<div class="sc-callout" data-side="${c.side ?? "right"}"><span class="sc-callout-dot">${i + 1}</span><span class="sc-callout-label">${c.label}</span></div>`)
      .join("");
    points.innerHTML = scene.callouts.map((c, i) => `<li><span>${i + 1}</span>${c.label}</li>`).join("");
  };

  const placeCallouts = () => {
    const scene = SCENES[index];
    const box = stage.getBoundingClientRect();
    const screenBox = screen.getBoundingClientRect();
    const staffBox = staff.getBoundingClientRect();
    const nodes = callouts.children;
    scene.callouts.forEach((c, i) => {
      const node = nodes[i] as HTMLElement | undefined;
      const scope = c.staff ? staffViewport : viewport;
      const anchor = scope.querySelector<HTMLElement>(c.sel);
      const r = anchor?.getBoundingClientRect();
      const clip = c.staff ? staffBox : screenBox;
      const [fx, fy] = c.at ?? [0, 0];
      const visible = !!r && r.width > 0 && (!c.staff || staff.classList.contains("is-on"))
        && r.top + r.height * fy >= clip.top && r.top + r.height * fy <= clip.bottom;
      if (!node) return;
      node.classList.toggle("is-on", visible);
      if (r && visible) {
        node.style.left = `${r.left + r.width * fx - box.left}px`;
        node.style.top = `${r.top + r.height * fy - box.top}px`;
      }
    });
  };

  const loop = () => {
    if (onScreen) {
      placeCallouts();
      if (playing) {
        const p = Math.min(1, (performance.now() - progressStart) / progressTotal);
        tabs[index].querySelector<HTMLElement>(".sc-tab-progress")!.style.setProperty("--p", String(p));
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  // ---------- Running a scene ----------
  const sleep = (ms: number, id: number) =>
    new Promise<void>((resolve) => {
      const started = performance.now();
      const tick = () => (runId !== id || performance.now() - started >= ms ? resolve() : requestAnimationFrame(tick));
      requestAnimationFrame(tick);
    });

  /** Types the interim transcript over the clip, the way AssemblyAI's partials arrive. */
  const typeGuest = (text: string, seconds: number, id: number) => {
    const words = text.split(" ");
    const started = performance.now();
    const tick = () => {
      if (runId !== id) return;
      const p = Math.min(1, (performance.now() - started) / (seconds * 900));
      const shown = Math.max(1, Math.ceil(p * words.length));
      setGuest(words.slice(0, shown).join(" "), true, "Listening…");
      if (p < 1) requestAnimationFrame(tick);
    };
    tick();
  };

  const stepSeconds = (s: Step): number => {
    const sec = (id: string) => manifest[id]?.seconds ?? 2;
    switch (s.t) {
      case "guest": case "filler": case "waiter": return sec(s.clip) + GAP_MS / 1000;
      case "pause": return s.ms / 1000;
      case "kds": return s.press ? 0.4 : 0;
      case "barge": return s.cutAt + sec(s.guest) + 0.4;
    }
  };

  /** Applies a step's end state without audio: used to show a scene's outcome before it plays. */
  const settle = (scene: Scene) => {
    let lines = [...scene.basket];
    setBasket(lines);
    setKds(null, lines);
    setGuest("", false, "");
    setAgent("", "");
    for (const s of scene.steps) {
      if (s.t === "guest") setGuest(s.text, false, "");
      if (s.t === "waiter") {
        setAgent(s.text, "The Lantern");
        if (s.basket) setBasket((lines = s.basket));
      }
      if (s.t === "kds") setKds(s.status, lines);
      if (s.t === "barge") {
        setAgent(s.text, "The Lantern");
        setGuest(s.guestText, true, "Listening…");
      }
    }
    staff.classList.toggle("is-on", !!scene.staff);
    orb.setMode("idle");
    orb.setAnalyser(null);
    setMic(false);
    follow();
  };

  const run = async (k: number) => {
    const id = ++runId;
    const scene = SCENES[k];
    if (!voice) voice = new Voice();
    if (voice.ctx.state === "suspended") await voice.ctx.resume();
    voice.stopAll();
    const ids = scene.steps.flatMap((s) => (s.t === "guest" || s.t === "filler" || s.t === "waiter" ? [s.clip] : s.t === "barge" ? [s.waiter, s.guest] : []));
    await Promise.all(ids.map((c) => voice!.load(c))).catch(() => {});
    if (runId !== id) return;

    let lines = [...scene.basket];
    setBasket(lines);
    setKds(null, lines);
    setGuest("", false, "Listening…");
    setAgent("", "");
    staff.classList.toggle("is-on", !!scene.staff);
    setMic(true);
    orb.setAnalyser(voice.analyser);
    progressStart = performance.now();
    progressTotal = scene.steps.reduce((sum, s) => sum + stepSeconds(s), 0) * 1000;
    setPlaying(true);

    for (const s of scene.steps) {
      if (runId !== id) return;
      if (s.t === "guest") {
        orb.setMode("listen");
        caption("guest", s.text);
        const clip = await voice.play(s.clip, (sec) => typeGuest(s.text, sec, id));
        await clip.done;
        if (runId !== id) return;
        setGuest(s.text, false, "Speech captured");
        agentStatus.textContent = "Consulting kitchen & menu…";
        orb.setMode("think");
        await sleep(GAP_MS, id);
      } else if (s.t === "filler") {
        orb.setMode("speak");
        caption("filler", manifest[s.clip]?.text ?? "");
        await (await voice.play(s.clip)).done;
        await sleep(GAP_MS, id);
      } else if (s.t === "waiter") {
        setAgent(s.text, "The Lantern");
        guestStatus.textContent = "";
        if (s.basket) setBasket((lines = s.basket));
        orb.setMode("speak");
        caption("waiter", s.text);
        await (await voice.play(s.clip)).done;
        if (runId !== id) return;
        orb.setMode("listen");
        guestStatus.textContent = "Listening…";
        await sleep(GAP_MS, id);
      } else if (s.t === "kds") {
        if (s.press) {
          const button = kds.querySelector<HTMLElement>(".btn-kds-bump");
          caption("kitchen", `${button?.textContent ?? ""} pressed on the Kitchen Display`);
          button?.classList.add("is-pressed");
          await sleep(380, id);
        } else {
          caption("kitchen", "Ticket #7F3A2C arrives on the Kitchen Display");
        }
        setKds(s.status, lines);
      } else if (s.t === "pause") {
        await sleep(s.ms, id);
      } else if (s.t === "barge") {
        setAgent(s.text, "The Lantern");
        orb.setMode("speak");
        caption("waiter", s.text);
        const reply = await voice.play(s.waiter);
        await Promise.race([reply.done, sleep(s.cutAt * 1000, id)]);
        if (runId !== id) return;
        orb.setMode("listen");
        caption("guest", `${s.guestText}  ·  barge_in: playback stopped`);
        const guest = await voice.play(s.guest, (sec) => typeGuest(s.guestText, sec, id));
        await sleep(160, id);
        reply.stop();
        await guest.done;
        setGuest(s.guestText, true, "Listening…");
      }
    }
    if (runId !== id) return;
    tabs[k].querySelector<HTMLElement>(".sc-tab-progress")!.style.setProperty("--p", "1");
    caption("idle", k < SCENES.length - 1 ? `Next: ${SCENES[k + 1].tab}` : "That’s the tour. Try it live with the demo.");
    // Autoplay the next moment while the section stays on screen.
    await sleep(1400, id);
    if (runId !== id) return;
    if (k < SCENES.length - 1 && onScreen) select(k + 1, true);
    else stop();
  };

  const setPlaying = (on: boolean) => {
    playing = on;
    root.classList.toggle("is-playing", on);
    toggleLabel.textContent = on ? "Stop" : "Play";
  };

  const stop = () => {
    runId++;
    voice?.stopAll();
    setPlaying(false);
    orb.setMode("idle");
    setMic(false);
    caption("idle", "Press play to hear this moment.");
  };

  function select(k: number, autoplay: boolean) {
    runId++;
    voice?.stopAll();
    index = (k + SCENES.length) % SCENES.length;
    const scene = SCENES[index];
    tabs.forEach((t, j) => {
      t.setAttribute("aria-selected", String(j === index));
      t.querySelector<HTMLElement>(".sc-tab-progress")!.style.setProperty("--p", "0");
    });
    // Scroll only the tab strip (never the page) so the active tab stays visible on phones.
    const tab = tabs[index];
    tabsEl.scrollTo({ left: tab.offsetLeft - (tabsEl.clientWidth - tab.offsetWidth) / 2, behavior: reduceMotion ? "auto" : "smooth" });
    title.textContent = scene.title;
    bodyText.textContent = scene.body;
    renderCallouts(scene);
    settle(scene);
    if (autoplay) void run(index);
    else {
      setPlaying(false);
      caption("idle", "Press play to hear this moment.");
    }
  }

  playBtn.addEventListener("click", () => void run(index));
  toggle.addEventListener("click", () => (playing ? stop() : void run(index)));
  prev.addEventListener("click", () => select(index - 1, playing));
  next.addEventListener("click", () => select(index + 1, playing));

  new IntersectionObserver(
    ([e]) => {
      onScreen = e.isIntersecting;
      if (!onScreen && playing) stop();
    },
    { threshold: 0.2 },
  ).observe(stage);

  fit();
  select(0, false);
}
