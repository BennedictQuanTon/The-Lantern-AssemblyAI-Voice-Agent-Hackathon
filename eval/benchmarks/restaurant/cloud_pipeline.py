"""Live check of the cloud providers on the six-turn table order.

Uses Gemini for intent and Cartesia for the spoken reply. AssemblyAI is not
in this run: the transcripts are the same typed lines as the demo script.
"""

from __future__ import annotations

import asyncio
import tempfile
import time
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

from backend.app.config import settings  # noqa: E402
from backend.app.domain.restaurant.repository import SQLiteOrderRepository  # noqa: E402
from backend.app.domain.restaurant.store import LanternStore  # noqa: E402
from backend.app.domain.restaurant.workflow import OrderWorkflow  # noqa: E402
from backend.app.providers.llm.gemini import GeminiClient  # noqa: E402
from backend.app.providers.tts.cartesia import CartesiaProvider  # noqa: E402
from backend.app.services.realtime_session import RealtimeSession  # noqa: E402

TURNS = [
    "What would you recommend for a mild couple?",
    "We'll take those two please.",
    "I'd like the crispy squid too.",
    "Okay, make it a grilled seabass instead.",
    "And stir-fried morning glory on the side.",
    "That's all, please place the order.",
]
EXPECTED_TOTAL = 36.50
EXPECTED_NAMES = {
    "Pomelo Salad with Shrimp",
    "Lemongrass Chicken",
    "Grilled Seabass",
    "Stir-fried Morning Glory",
}


async def main() -> None:
    llm = GeminiClient(settings.gemini_api_key, settings.gemini_model)
    tts = CartesiaProvider(settings.cartesia_api_key, settings.cartesia_voice_id, settings.cartesia_model)
    store = LanternStore()
    store.set_available("MAIN_SQUID", False)
    database = Path(tempfile.mkdtemp()) / "cloud.sqlite3"
    repository = SQLiteOrderRepository(database)
    session = RealtimeSession("T4", OrderWorkflow(repository, store), llm)
    print(f"llm={settings.gemini_model} tts={settings.cartesia_model}")
    rows = []
    try:
        warm = time.perf_counter()
        try:
            await llm.warmup()
            print(f"gemini_warmup_ms={round((time.perf_counter() - warm) * 1000)}")
        except Exception as exc:
            print(f"gemini_warmup_skipped={type(exc).__name__}: {exc}")
        for text in TURNS:
            started = time.perf_counter()
            result = await session.handle_transcript(text, "en")
            rows.append({
                "guest": text,
                "ms": result.get("pipeline_ms"),
                "status": result.get("status"),
                "reply": result.get("response_text"),
                "total": result.get("total"),
                "placed": bool(result.get("placed")) or result.get("status") == "pending_kitchen",
                "basket": [line.get("name") for line in result.get("basket") or []],
                "voice": bool(result.get("tts_supported")),
            })
            print(f"{result.get('pipeline_ms'):>7} ms | {text}")
            print(f"         {result.get('status')} | lang={result.get('language_code')} voice={result.get('tts_supported')} | {result.get('response_text')}")
        reply = rows[-1]["reply"] or "Your order is in."
        started = time.perf_counter()
        first = None
        pcm = 0
        async for chunk in tts.stream_async(reply, "en"):
            if first is None:
                first = round((time.perf_counter() - started) * 1000)
            pcm += len(chunk)
        print(f"cartesia_first_chunk_ms={first} pcm_bytes={pcm} sample_rate={tts.sample_rate}")
    finally:
        store.set_available("MAIN_SQUID", True)
        await llm.close()
        repository.close()

    final = rows[-1]
    names = set(final["basket"])
    ok = names == EXPECTED_NAMES and final["total"] == EXPECTED_TOTAL and final["placed"] and all(row["voice"] for row in rows)
    print(f"final_basket={final['basket']} total={final['total']} placed={final['placed']}")
    print("SIX_TURN", "PASS" if ok else "FAIL")


if __name__ == "__main__":
    asyncio.run(main())
