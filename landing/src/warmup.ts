/**
 * /demo: wakes the live app on Render and opens it once it's warm.
 *
 * Render's free instances sleep when idle; the first request boots the container, and FastAPI
 * finishes warming the model and the voice before it answers. This page polls GET /ready
 * (CORS-enabled for reads) and walks through the real start-up steps it reports. If /ready can't
 * be read cross-origin, an opaque no-cors ping to /health still tells us the server is up.
 */

import "../../frontend/src/styles/tokens.css";
import "../../frontend/src/styles/components.css";
import "./styles/landing.css";
import "./styles/warmup.css";
import { AppleOrb } from "../../frontend/src/components/siri_orb";
import { arrive } from "./transition";

// The backend is the Docker service on Render (render.yaml); set VITE_API_URL on Vercel.
// The app itself ships with this site under /app/ and talks to that backend directly.
const APP_URL = (import.meta.env.VITE_API_URL?.trim() || import.meta.env.VITE_APP_URL?.trim() || "https://lantern.onrender.com").replace(/\/$/, "");
const ENTER_URL = "/app/?table_id=T4";
const POLL_MS = 2500;
const REQUEST_TIMEOUT_MS = 25000;
const SLOW_AFTER_S = 75;
const GIVE_UP_AFTER_S = 180;
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

interface ReadyPayload {
  ready?: boolean;
  providers?: { asr?: string; llm?: string; tts?: string };
  provider_state?: { llm_warm?: boolean; tts_warm?: boolean; llm_error?: string | null; tts_error?: string | null };
}

type StepState = "active" | "done" | "error";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const root = $("wu");
const title = $("wuTitle");
const ticker = $("wuTicker");
const status = $("wuStatus");
const bar = $("wuBar");
const elapsedEl = $("wuElapsed");
const hint = $("wuHint");
const steps = $("wuSteps");
const auto = $("wuAuto");
const enter = $<HTMLAnchorElement>("wuEnter");
const retry = $<HTMLButtonElement>("wuRetry");
const redirect = $("wuRedirect");
const countdown = $("wuCountdown");
const stay = $<HTMLButtonElement>("wuStay");
const log = $("wuLog");
const tip = $("wuTip");

const orb = new AppleOrb($<HTMLCanvasElement>("wuOrb"));
orb.setMode("think");
$("wuHost").textContent = new URL(APP_URL).host;
enter.href = ENTER_URL;

const started = performance.now();
let finished = false;
let cancelRedirect = false;
const seconds = () => Math.round((performance.now() - started) / 1000);

// ---------- Rolling captions ----------
const LINE_H = 30;
/** Push a caption: it rises in, the earlier ones drift up and fade like subtitles. */
function caption(text: string, withTime = false): void {
  const li = document.createElement("li");
  li.className = "is-new";
  li.textContent = text;
  if (withTime) {
    const t = document.createElement("span");
    t.className = "tnum";
    t.textContent = `${seconds()} s`;
    li.appendChild(t);
  }
  ticker.appendChild(li);
  while (ticker.children.length > 4) ticker.firstElementChild?.remove();
  status.textContent = text;
  if (reduceMotion) return;
  // FLIP the whole strip: start one line lower, then glide up into place.
  ticker.style.transition = "none";
  ticker.style.transform = `translateY(${LINE_H}px)`;
  void ticker.offsetHeight;
  ticker.style.transition = "";
  ticker.style.transform = "";
}

// Between real events, the dining room gets ready.
const AMBIENCE = [
  "Lighting the lanterns",
  "Polishing the glasses",
  "Setting out the menus",
  "Warming the kitchen",
  "Briefing the sommelier",
  "Tuning the waiter’s voice",
  "Folding the napkins",
];
let ambience = 0;
let lastEventAt = 0;
window.setInterval(() => {
  if (finished || performance.now() - lastEventAt < 2600) return;
  caption(AMBIENCE[ambience++ % AMBIENCE.length]);
}, 2900);

function event(text: string, withTime = true): void {
  lastEventAt = performance.now();
  caption(text, withTime);
}

// ---------- Start-up log (collapsed) ----------
function addLog(text: string, tone: "info" | "ok" | "warn" = "info"): void {
  const li = document.createElement("li");
  li.className = `wu-log-line is-${tone}`;
  li.innerHTML = `<span>${String(seconds()).padStart(3, " ")}s</span><span></span>`;
  (li.lastElementChild as HTMLElement).textContent = text;
  log.appendChild(li);
  while (log.children.length > 12) log.firstElementChild?.remove();
}

// ---------- Steps: each appears only once it starts ----------
function setStep(key: string, state: StepState, name: string, meta: string): void {
  let row = steps.querySelector<HTMLElement>(`[data-step="${key}"]`);
  if (!row) {
    row = document.createElement("li");
    row.className = "wu-step";
    row.dataset.step = key;
    row.innerHTML = '<span class="wu-icon" aria-hidden="true"></span><span class="wu-step-name"></span><span class="wu-step-meta"></span>';
    steps.appendChild(row);
  }
  row.dataset.state = state;
  row.querySelector<HTMLElement>(".wu-step-name")!.textContent = name;
  row.querySelector<HTMLElement>(".wu-step-meta")!.textContent = meta;
}

function setTitle(text: string): void {
  if (title.textContent === text) return;
  title.classList.add("is-swap");
  window.setTimeout(() => {
    title.textContent = text;
    title.classList.remove("is-swap");
  }, reduceMotion ? 0 : 280);
}

// Progress creeps toward 90% on an ease-out curve while waking; the last 10% is the real answer.
function tick(): void {
  if (finished) return;
  const s = (performance.now() - started) / 1000;
  elapsedEl.textContent = `${Math.floor(s)} s`;
  bar.style.transform = `scaleX(${0.9 * (1 - Math.exp(-s / 28))})`;
  if (s > SLOW_AFTER_S) hint.textContent = "a little longer than usual";
  requestAnimationFrame(tick);
}

const TIPS = [
  "“What would you recommend for a mild couple?”",
  "“We’ll take those two, please.”",
  "“I’m allergic to peanuts.”",
  "“Make it a grilled seabass instead.”",
  "“¿Qué nos recomienda?”",
  "“That’s all, please place the order.”",
];
let tipIndex = 0;
window.setInterval(() => {
  tip.classList.add("is-swap");
  window.setTimeout(() => {
    tipIndex = (tipIndex + 1) % TIPS.length;
    tip.textContent = TIPS[tipIndex];
    tip.classList.remove("is-swap");
  }, 300);
}, 3400);

// ---------- Talking to the server ----------
async function fetchReady(): Promise<{ status: number; body: ReadyPayload | null } | null> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${APP_URL}/ready`, { cache: "no-store", signal: ctrl.signal });
    const type = res.headers.get("content-type") ?? "";
    return { status: res.status, body: type.includes("json") ? ((await res.json()) as ReadyPayload) : null };
  } catch {
    return null;
  } finally {
    window.clearTimeout(timer);
  }
}

/** Opaque ping: resolves only once the server itself answers, even without CORS. */
async function serverAnswers(): Promise<boolean> {
  try {
    await fetch(`${APP_URL}/health`, { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, reduceMotion ? 0 : ms));

/** Reveal the remaining steps one by one with what /ready reported. */
async function walkSteps(body: ReadyPayload | null): Promise<boolean> {
  const p = body?.providers ?? {};
  const state = body?.provider_state ?? {};
  setStep("server", "done", "Server", "awake");
  event("The server is awake", false);
  await wait(450);
  setStep("asr", "active", "Speech recognition", "connecting");
  await wait(350);
  setStep("asr", "done", "Speech recognition", `AssemblyAI ${p.asr ?? "Universal-3.5 Pro"}`);
  event("Speech recognition is listening", false);
  await wait(450);
  // Without /ready details (opaque ping), an answering server has finished its start-up warm-up.
  const llmWarm = body ? state.llm_warm === true : true;
  const ttsWarm = body ? state.tts_warm === true : true;
  setStep("llm", "active", "Language model", "warming");
  await wait(350);
  if (state.llm_error || !llmWarm) {
    setStep("llm", "error", "Language model", state.llm_error ?? `${p.llm ?? "model"} · not warm`);
    addLog(`llm: ${state.llm_error ?? "not warm"}`, "warn");
  } else {
    setStep("llm", "done", "Language model", p.llm ?? "warm");
    event("The model knows tonight’s menu", false);
  }
  await wait(450);
  setStep("tts", "active", "Waiter’s voice", "warming");
  await wait(350);
  if (state.tts_error || !ttsWarm) {
    setStep("tts", "error", "Waiter’s voice", state.tts_error ?? `${p.tts ?? "voice"} · not warm`);
    addLog(`tts: ${state.tts_error ?? "not warm"}`, "warn");
  } else {
    setStep("tts", "done", "Waiter’s voice", p.tts ?? "warm");
    event("The waiter is ready to speak", false);
  }
  await wait(350);
  return llmWarm && ttsWarm && body?.ready !== false;
}

function becomeReady(fully: boolean): void {
  finished = true;
  root.dataset.state = fully ? "ready" : "degraded";
  orb.setMode("listen");
  bar.style.transform = "scaleX(1)";
  setTitle(fully ? "Good evening. Your table is ready." : "Almost ready, one provider is still warming.");
  caption(fully ? "Tap the microphone and order the way you would with your favourite waiter." : "You can enter now; spoken replies may fall back to text for a moment.");
  elapsedEl.textContent = `${seconds()} s`;
  hint.textContent = "ready";
  auto.hidden = true;
  enter.hidden = false;
  if (!fully) return;
  redirect.hidden = false;
  let left = 3;
  countdown.textContent = String(left);
  const timer = window.setInterval(() => {
    if (cancelRedirect) return window.clearInterval(timer);
    left -= 1;
    countdown.textContent = String(Math.max(0, left));
    if (left <= 0) {
      window.clearInterval(timer);
      window.location.href = ENTER_URL;
    }
  }, 1000);
}

function giveUp(): void {
  finished = true;
  root.dataset.state = "slow";
  orb.setMode("idle");
  setTitle("The kitchen is taking a while.");
  caption("No answer yet. Try again, or open The Lantern directly.");
  setStep("server", "error", "Server", "no answer yet");
  auto.hidden = true;
  retry.hidden = false;
  enter.hidden = false;
  addLog("no answer yet, stopped polling", "warn");
}

async function poll(): Promise<void> {
  setStep("server", "active", "Server", "waking the Render instance");
  event("Sending a wake-up call to the server", false);
  addLog(`GET ${new URL(APP_URL).host}/ready`);
  let attempts = 0;
  while (!finished) {
    if (seconds() > GIVE_UP_AFTER_S) return giveUp();
    const res = await fetchReady();
    attempts += 1;
    if (res && res.status === 200 && res.body) {
      const models = [res.body.providers?.asr, res.body.providers?.llm, res.body.providers?.tts].filter(Boolean).join(" · ");
      addLog(`200 · ${res.body.ready ? "ready" : "answering, not fully ready"} · ${models}`, res.body.ready ? "ok" : "warn");
      return becomeReady(await walkSteps(res.body));
    }
    if (res) {
      addLog(`${res.status} · the instance is still starting`);
      event("The container is starting");
    } else if (await serverAnswers()) {
      // Up, but /ready isn't readable from here (an older deploy without CORS): good enough to enter.
      addLog("server answered · details unavailable", "ok");
      return becomeReady(await walkSteps(null));
    } else {
      addLog("no answer yet · booting the container");
      if (attempts === 1 || attempts % 3 === 0) event("Booting the container on Render");
    }
    await wait(POLL_MS);
  }
}

stay.addEventListener("click", () => {
  cancelRedirect = true;
  redirect.hidden = true;
});
retry.addEventListener("click", () => window.location.reload());

requestAnimationFrame(tick);
void arrive($("wuMic"));
void poll();
