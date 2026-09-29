from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

import httpx

from .kokoro import TTSResult

DEFAULT_VOICE_ID = "db6b0ed5-d5d3-463d-ae85-518a07d3c2b4"
CARTESIA_VERSION = "2026-03-01"
LANGUAGE_CODES = {
    "en": "en",
    "es": "es",
    "fr": "fr",
    "de": "de",
    "pt": "pt",
    "pt-BR": "pt",
    "it": "it",
    "ja": "ja",
    "zh": "zh",
    "hi": "hi",
}


class CartesiaProvider:
    sample_rate = 24000

    def __init__(self, api_key: str, voice_id: str = "", model_id: str = "sonic-3"):
        self.api_key = api_key.strip()
        self.voice_id = (voice_id or DEFAULT_VOICE_ID).strip()
        self.model_id = model_id
        if not self.api_key:
            raise ValueError("CARTESIA_API_KEY is required")

    @property
    def resolved_device(self) -> str:
        return "cartesia"

    def voice_for(self, language: str) -> str | None:
        return LANGUAGE_CODES.get(language) or LANGUAGE_CODES.get(language.split("-")[0])

    async def stream_async(
        self, text: str, language: str, cancel_event: asyncio.Event | None = None,
    ) -> AsyncIterator[bytes]:
        cartesia_language = self.voice_for(language)
        if not text.strip() or cartesia_language is None:
            return
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            async with client.stream(
                "POST",
                "https://api.cartesia.ai/tts/bytes",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Cartesia-Version": CARTESIA_VERSION,
                    "Content-Type": "application/json",
                },
                json={
                    "model_id": self.model_id,
                    "transcript": text,
                    "voice": {"mode": "id", "id": self.voice_id},
                    "language": cartesia_language,
                    "output_format": {
                        "container": "raw",
                        "encoding": "pcm_s16le",
                        "sample_rate": self.sample_rate,
                    },
                },
            ) as response:
                if response.status_code >= 400:
                    detail = (await response.aread())[:300]
                    raise RuntimeError(f"Cartesia failed ({response.status_code}): {detail.decode('utf-8', 'replace')}")
                async for chunk in response.aiter_bytes(4096):
                    if cancel_event and cancel_event.is_set():
                        break
                    if chunk:
                        yield chunk

    async def synthesize_async(self, text: str, language: str) -> TTSResult:
        language_code = self.voice_for(language)
        if language_code is None:
            return TTSResult(False, language_code=language)
        pcm = b"".join([chunk async for chunk in self.stream_async(text, language)])
        return TTSResult(bool(pcm), pcm, self.sample_rate, language)

    async def warmup(self, language: str = "en") -> None:
        async for _ in self.stream_async("Ready.", language):
            break
