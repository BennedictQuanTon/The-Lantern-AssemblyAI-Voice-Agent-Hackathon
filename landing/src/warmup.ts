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

// The live app is the Docker service on Render (render.yaml); set VITE_APP_URL on Vercel.
const APP_URL = (import.meta.env.VITE_APP_URL?.trim() || "https://lantern.onrender.com").replace(/\/$/, "");
const ENTER_URL = `${APP_URL}/?table_id=T4`;
const POLL_MS = 2500;
const REQUEST_TIMEOUT_MS = 25000;
const SLOW_AFTER_S = 75;
const GIVE_UP_AFTER_S = 180;

interface ReadyPayload {
  ready?: boolean;
  providers?: { asr?: string; llm?: string; tts?: string };
  provider_state?: { llm_warm?: boolean; tts_warm?: boolean; llm_error?: string | null; tts_error?: string | null };
  demo_limits?: { enabled?: boolean };
}

type StepState = "pending" | "active" | "done" | "error";
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const root = $("wu");
const title = $("wuTitle");
const sub = $("wuSub");
const badge = $("wuBadge");
const bar = $("wuBar");
const elapsedEl = $("wuElapsed");
const hint = $("wuHint");
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
const stamp = () => `${String(seconds()).padStart(3, " ")}s`;

function addLog(text: string, tone: "info" | "ok" | "warn" = "info"): void {
  const li = document.createElement("li");
  li.className = `wu-log-line is-${tone}`;
  li.innerHTML = `<span class="tnum">${stamp()}</span><span></span>`;
  (li.lastElementChild as HTMLElement).textContent = text;
  log.appendChild(li);
  while (log.children.length > 9) log.firstElementChild?.remove();
}

function setStep(name: string, state: StepState, meta?: string): void {
  const step = document.querySelector<HTMLElement>(`[data-step="${name}"]`);
  if (!step) return;
  step.dataset.state = state;
  if (meta) step.querySelector<HTMLElement>("[data-meta]")!.textContent = meta;
}

// Progress creeps toward 90% on an ease-out curve while waking; the last 10% is the real answer.
function tick(): void {
  if (finished) return;
  const s = (performance.now() - started) / 1000;
  elapsedEl.textContent = `${Math.floor(s)} s`;
  bar.style.transform = `scaleX(${0.9 * (1 - Math.exp(-s / 28))})`;
  if (s > SLOW_AFTER_S) hint.textContent = "taking a little longer than usual";
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
  if (finished) return;
  tip.classList.add("is-swap");
  window.setTimeout(() => {
    tipIndex = (tipIndex + 1) % TIPS.length;
    tip.textContent = TIPS[tipIndex];
    tip.classList.remove("is-swap");
  }, 250);
}, 3200);

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

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

async function walkSteps(body: ReadyPayload | null): Promise<boolean> {
  const p = body?.providers ?? {};
  const state = body?.provider_state ?? {};
  setStep("server", "done", "Awake and answering");
  await wait(350);
  setStep("asr", "done", `AssemblyAI ${p.asr ?? "Universal-3.5 Pro"}`);
  await wait(350);
  // Without /ready details (opaque ping), an answering server has finished its start-up warm-up.
  const llmWarm = body ? state.llm_warm === true : true;
  const ttsWarm = body ? state.tts_warm === true : true;
  if (state.llm_error || !llmWarm) {
    setStep("llm", "error", state.llm_error ?? `${p.llm ?? "Model"} · not warm`);
    addLog(`llm: ${state.llm_error ?? "not warm"}`, "warn");
  } else setStep("llm", "done", p.llm ?? "Warm");
  await wait(350);
  if (state.tts_error || !ttsWarm) {
    setStep("tts", "error", state.tts_error ?? `${p.tts ?? "Voice"} · not warm`);
    addLog(`tts: ${state.tts_error ?? "not warm"}`, "warn");
  } else setStep("tts", "done", p.tts ?? "Warm");
  await wait(300);
  return llmWarm && ttsWarm && body?.ready !== false;
}

function becomeReady(fully: boolean): void {
  finished = true;
  root.dataset.state = fully ? "ready" : "degraded";
  orb.setMode("speak");
  bar.style.transform = "scaleX(1)";
  badge.textContent = fully ? "Ready" : "Partly ready";
  title.textContent = fully ? "Good evening. Your table is ready." : "The Lantern is up, with a provider still warming.";
  sub.textContent = fully
    ? "Tap the microphone and order the way you would with your favourite waiter."
    : "You can open it now; spoken replies may fall back to text until every provider is warm.";
  enter.removeAttribute("aria-disabled");
  elapsedEl.textContent = `${seconds()} s`;
  hint.textContent = "ready";
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
  badge.textContent = "Still waking";
  title.textContent = "The kitchen is taking a while.";
  sub.textContent = "The server hasn’t answered yet. Try again, or open The Lantern directly and give it a moment to load.";
  retry.hidden = false;
  enter.removeAttribute("aria-disabled");
  addLog("no answer yet, stopped polling", "warn");
}

async function poll(): Promise<void> {
  setStep("server", "active");
  addLog(`GET ${new URL(APP_URL).host}/ready`);
  while (!finished) {
    if (seconds() > GIVE_UP_AFTER_S) return giveUp();
    const res = await fetchReady();
    if (res && res.status === 200 && res.body) {
      const models = [res.body.providers?.asr, res.body.providers?.llm, res.body.providers?.tts].filter(Boolean).join(" · ");
      addLog(`200 · ${res.body.ready ? "ready" : "answering, not fully ready"} · ${models}`, res.body.ready ? "ok" : "warn");
      return becomeReady(await walkSteps(res.body));
    }
    if (res) {
      addLog(`${res.status} · the instance is still starting`);
    } else if (await serverAnswers()) {
      // Up, but /ready isn't readable from here (an older deploy without CORS): good enough to enter.
      addLog("server answered · details unavailable", "ok");
      return becomeReady(await walkSteps(null));
    } else {
      addLog("no answer yet · booting the container");
    }
    await wait(POLL_MS);
  }
}

enter.addEventListener("click", (e) => {
  if (enter.getAttribute("aria-disabled") === "true") e.preventDefault();
});
stay.addEventListener("click", () => {
  cancelRedirect = true;
  redirect.hidden = true;
});
retry.addEventListener("click", () => window.location.reload());

requestAnimationFrame(tick);
void poll();
