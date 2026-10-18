"""Order-edit regressions and transcript-to-response timing, offline or over WebSocket.

Offline extraction deliberately replays pre-fix quantity/readback mistakes.
--server-url exercises the target's real providers. It creates/cancels a test
draft, never requests kitchen submission, and preserves failed turns in reports.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import math
import statistics
import time
from pathlib import Path
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx
import websockets

from backend.app.domain.restaurant.models import IntentItem, IntentProposal
from backend.app.domain.restaurant.repository import SQLiteOrderRepository
from backend.app.domain.restaurant.store import LanternStore
from backend.app.domain.restaurant.workflow import OrderWorkflow
from backend.app.services.realtime_session import RealtimeSession
from eval.reporting import create_run, write_results, write_summary


# Basket gates use quantities, not just matching names or a plausible reply.
STEPS = [
    ("add", "Add one Lemongrass Tofu and two Lemongrass Iced Tea to my order.", {"VG_TOFU": 1, "DRINK_LEMON": 2}, 11),
    ("quantity", "Change the Lemongrass Iced Tea quantity to one.", {"VG_TOFU": 1, "DRINK_LEMON": 1}, 8.5),
    ("readback", "What is in my order?", {"VG_TOFU": 1, "DRINK_LEMON": 1}, 8.5),
    ("repeat", "Read back my order, but do not place it.", {"VG_TOFU": 1, "DRINK_LEMON": 1}, 8.5),
    ("addition", "Add another Lemongrass Iced Tea.", {"VG_TOFU": 1, "DRINK_LEMON": 2}, 11),
    ("removal", "Remove one Lemongrass Iced Tea.", {"VG_TOFU": 1, "DRINK_LEMON": 1}, 8.5),
    ("swap", "Change the Lemongrass Tofu to Grilled Seabass.", {"MAIN_SEABASS": 1, "DRINK_LEMON": 1}, 18.5),
    ("unknown", "Add one Unicorn Stardust Pizza.", {"MAIN_SEABASS": 1, "DRINK_LEMON": 1}, 18.5),
    ("cancel", "Cancel my order.", {"MAIN_SEABASS": 1, "DRINK_LEMON": 1}, 18.5),
    ("confirm_cancel", "Yes, cancel the whole order.", {}, 0),
]


class ReplayLLM:
    async def extract_intent(self, text, context):
        def proposal(action, sku=None, quantity=1, **extra):
            return IntentProposal(action=action, items=[IntentItem(sku=sku, quantity=quantity)] if sku else [], **extra)
        if text == STEPS[0][1]:
            return IntentProposal(action="create_or_update_order", items=[IntentItem(sku="VG_TOFU", quantity=1), IntentItem(sku="DRINK_LEMON", quantity=2)])
        if text == STEPS[1][1] or text == STEPS[4][1]:
            return proposal("create_or_update_order", "DRINK_LEMON")
        if text in {STEPS[2][1], STEPS[3][1]}:
            return proposal("menu_query")
        if text == STEPS[5][1]:
            return proposal("remove_item", "DRINK_LEMON")
        if text == STEPS[6][1]:
            return proposal("replace_item", "MAIN_SEABASS", replaces_sku="VG_TOFU")
        if text == STEPS[7][1]:
            return proposal("clarify", clarification_question="Which menu dish did you mean?")
        return proposal("confirm" if text == STEPS[9][1] else "cancel_order")


def timing_stats(values):
    values = sorted(value for value in values if value is not None)
    if not values:
        return None
    return {"count": len(values), "median_ms": round(statistics.median(values), 2),
            "p95_nearest_rank_ms": round(values[math.ceil(.95 * len(values)) - 1], 2),
            "maximum_ms": round(values[-1], 2)}


def check_step(kind, result, saved, expected, total, previous_revision):
    # Do not flatten duplicate lines: modifier variants must stay distinguishable.
    lines = saved.get("basket", [])
    actual = [(line["sku"], line["quantity"], line.get("modifiers", [])) for line in lines]
    wanted = [(sku, quantity, []) for sku, quantity in expected.items()]
    checks = {"exact_basket": sorted(actual) == sorted(wanted),
              "total": saved.get("total") == total, "not_placed": not saved.get("placed", False)}
    if kind in {"readback", "repeat", "unknown", "cancel"}:
        checks["no_revision"] = saved.get("current_revision") == previous_revision
    if kind in {"readback", "repeat"}:
        reply = result.get("response_text", "")
        checks["basket_in_reply"] = all(f"{line['quantity']} {line['name']}" in reply for line in lines)
        checks["total_in_reply"] = f"${total:.2f}" in reply
        checks["not_menu"] = result.get("status") not in {"menu_query", "recommend"}
    if kind == "unknown":
        checks["clarification"] = result.get("status") == "clarification_required"
    if kind == "cancel":
        checks["confirmation_required"] = result.get("status") == "awaiting_reply"
    if kind == "confirm_cancel":
        checks["cancelled"] = saved.get("status") == "cancelled"
    return checks


class RemoteSession:
    def __init__(self, base, table, timeout):
        self.base, self.table, self.timeout = base.rstrip("/"), table, timeout
        self.http = httpx.AsyncClient(timeout=timeout)
        self.ws = None
        self.order_id = None

    async def connect(self):
        parsed = urlsplit(self.base)
        if parsed.scheme not in {"http", "https"} or parsed.path not in {"", "/"}:
            raise ValueError("server-url must be an HTTP(S) origin")
        query = {"table_id": self.table}
        if self.order_id:
            query["order_id"] = self.order_id
        url = urlunsplit(("wss" if parsed.scheme == "https" else "ws", parsed.netloc, "/ws/realtime", urlencode(query), ""))
        started = time.perf_counter()
        self.ws = await websockets.connect(url, open_timeout=self.timeout)
        async def receive_ready():
            while True:
                event = json.loads(await self.ws.recv())
                if event["type"] == "session_ready":
                    return {"ms": round((time.perf_counter() - started) * 1000, 2), "event": event}
        return await asyncio.wait_for(receive_ready(), self.timeout)

    async def turn(self, text):
        row = {"text": text, "events": [], "response_ms": None, "first_audio_ms": None, "complete_ms": None}
        started = time.perf_counter()
        async def receive_turn():
            await self.ws.send(json.dumps({"type": "transcript", "text": text, "language_code": "en"}))
            while True:
                event = json.loads(await self.ws.recv())
                ms = round((time.perf_counter() - started) * 1000, 2)
                # Retain event metadata without storing large PCM/base64 payloads.
                safe = {key: value for key, value in event.items() if key != "pcm_b64"}
                row["events"].append({"client_ms": ms, **safe})
                if event.get("order_id"):
                    self.order_id = event["order_id"]
                if event["type"] == "workflow_update" and event.get("response_text"):
                    row["response_ms"], row["result"] = ms, event
                if event["type"] == "audio_chunk" and row["first_audio_ms"] is None:
                    row["first_audio_ms"] = ms
                if event["type"] == "turn_complete":
                    row["complete_ms"] = ms
                    row["server_pipeline_ms"] = event.get("pipeline_ms")
                    break
                if event["type"] == "error":
                    row["error"] = event.get("message") or "server error with empty message"
                    break
        try:
            await asyncio.wait_for(receive_turn(), self.timeout)
        except Exception as exc:
            row["error"] = f"{type(exc).__name__}: {str(exc) or 'turn deadline exceeded'}"
        return row

    async def saved(self):
        if not self.order_id:
            return {"basket": [], "total": 0, "placed": False}
        response = await self.http.get(f"{self.base}/api/orders/{self.order_id}")
        response.raise_for_status()
        return response.json()

    async def close(self):
        if self.ws:
            await self.ws.close()
        await self.http.aclose()


async def run(args, run):
    output = {"mode": "remote" if args.server_url else "offline_replay", "repetitions": [],
              "boundary": "final transcript submission to returned text/first PCM/turn_complete; excludes ASR and speaker playback"}
    remote = RemoteSession(args.server_url, args.table, args.timeout) if args.server_url else None
    repo = SQLiteOrderRepository(run.directory / "orders.sqlite3") if remote is None else None
    workflow = OrderWorkflow(repo, LanternStore()) if repo else None
    try:
        if remote:
            floor = await remote.http.get(remote.base + "/floor")
            floor.raise_for_status()
            table = next((t for t in floor.json()["tables"] if t["id"] == args.table), None)
            if not table or table["status"] != "free":
                raise ValueError("Choose a provisioned free table for the test")
            menu = await remote.http.get(remote.base + "/menu")
            menu.raise_for_status()
            by_sku = {item["sku"]: item for item in menu.json()["items"]}
            for sku, price in {"VG_TOFU": 6, "DRINK_LEMON": 2.5, "MAIN_SEABASS": 16}.items():
                if sku not in by_sku or not by_sku[sku]["available"] or by_sku[sku]["price"] != price:
                    raise ValueError("Fixture menu changed; adjust STEPS before benchmarking")
            ready = await remote.http.get(remote.base + "/ready")
            ready.raise_for_status()
            output["deployment"] = ready.json()
        for index in range(args.repeat):
            record = {"index": index + 1, "turns": []}
            output["repetitions"].append(record)
            session = RealtimeSession(args.table, workflow, ReplayLLM()) if workflow else None
            if remote:
                remote.order_id = None
                record["session_ready"] = await remote.connect()
            previous_revision = None
            try:
                for kind, text, expected, total in STEPS:
                    if kind == "addition":
                        # Reconstruct halfway through the basket to exercise session continuity.
                        if remote:
                            old_id = remote.order_id
                            await remote.ws.close()
                            resumed = await remote.connect()
                            record["resume_passed"] = (resumed["event"].get("order") or {}).get("order_id") == old_id
                        else:
                            old_id = session.order_id
                            session = RealtimeSession(args.table, workflow, ReplayLLM(), session_id=session.session_id, order_id=old_id)
                            record["resume_passed"] = session.current_order()["order_id"] == old_id
                    if remote:
                        row = await remote.turn(text)
                        saved = await remote.saved()
                    else:
                        result = await session.handle_transcript(text)
                        row = {"text": text, "result": result, "response_ms": result["pipeline_ms"]}
                        saved = session.current_order() or {"basket": [], "total": 0, "placed": False}
                    row["kind"], row["saved"] = kind, saved
                    row["checks"] = check_step(kind, row.get("result", {}), saved, expected, total, previous_revision)
                    if remote:
                        row["checks"]["completed"] = row.get("complete_ms") is not None and "error" not in row
                        row["checks"]["audio_received"] = row.get("first_audio_ms") is not None
                    row["passed"] = all(row["checks"].values())
                    record["turns"].append(row)
                    previous_revision = saved.get("current_revision")
                    write_results(run, output)
                    print(f"{'PASS' if row['passed'] else 'FAIL'} {kind}: response={row.get('response_ms')} ms first_audio={row.get('first_audio_ms')} ms complete={row.get('complete_ms')} ms", flush=True)
                    if saved.get("placed"):
                        raise RuntimeError("Unexpected kitchen submission; stopping the benchmark")
                    if row.get("error"):
                        break  # Never attribute a late response to a later request.
            finally:
                if remote:
                    # Reconnect after an error so stale queued events cannot contaminate cleanup.
                    if remote.ws:
                        await remote.ws.close()
                    saved = await remote.saved()
                    if remote.order_id and saved.get("status") != "cancelled" and not saved.get("placed"):
                        await remote.connect()
                        record["cleanup_turns"] = [await remote.turn("Cancel my order."), await remote.turn("Yes, cancel the whole order.")]
                        saved = await remote.saved()
                    record["cleanup_passed"] = not remote.order_id or (saved.get("status") == "cancelled" and not saved.get("placed"))
                    if remote.ws:
                        await remote.ws.close()
                write_results(run, output)
    except Exception as exc:
        output["error"] = f"{type(exc).__name__}: {str(exc)}"
    finally:
        if remote:
            await remote.close()
        if repo:
            repo.close()
    rows = [row for record in output["repetitions"] for row in record["turns"]]
    output["attempted"] = len(rows)
    output["passed_steps"] = sum(row["passed"] for row in rows)
    output["passed"] = ("error" not in output and len(rows) == args.repeat * len(STEPS)
                        and all(row["passed"] for row in rows)
                        and all(record.get("resume_passed") and record.get("cleanup_passed", True) for record in output["repetitions"]))
    # Failures are retained above; successful-only latency never replaces completion counts.
    output["timing"] = {field: timing_stats([row.get(field) for row in rows if not row.get("error")])
                        for field in ("response_ms", "first_audio_ms", "complete_ms")}
    write_results(run, output)
    write_summary(run, f"# Order edit benchmark\n\nMode: {output['mode']}\n\nPassed: {output['passed_steps']}/{output['attempted']} steps; complete suite: {output['passed']}.\n\nBoundary: {output['boundary']}.\n\nOffline timing is local deterministic/scripted execution, not cloud inference or voice performance. See results.json for failures, resume, cleanup, and timing distributions.\n")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--server-url", help="HTTP(S) origin; omit for offline replay")
    parser.add_argument("--table", default="T10")
    parser.add_argument("--repeat", type=int, default=1)
    parser.add_argument("--timeout", type=float, default=45)
    parser.add_argument("--output-root", type=Path)
    args = parser.parse_args()
    if args.repeat < 1 or args.timeout <= 0:
        parser.error("repeat and timeout must be positive")
    run_dir = create_run(product="restaurant", suite="order-edits", output_root=args.output_root,
                         metadata={"server_url": args.server_url, "table": args.table, "repeat": args.repeat})
    print(f"Report: {run_dir.directory}", flush=True)
    result = asyncio.run(run(args, run_dir))
    if result.get("error"):
        print(result["error"])
    print("SUITE", "PASS" if result["passed"] else "FAIL")
    return 0 if result["passed"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
