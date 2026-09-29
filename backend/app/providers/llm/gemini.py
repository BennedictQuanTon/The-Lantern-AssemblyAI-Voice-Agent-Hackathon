from __future__ import annotations

import json
from typing import get_args

import httpx

from ...domain.restaurant.models import Action, IntentProposal, Ref
from .ollama import build_intent_prompt, proposal_from_raw


def gemini_intent_schema() -> dict:
    """A flat schema. Gemini rejects some pieces of the Pydantic export."""
    return {
        "type": "object",
        "properties": {
            "source_language": {"type": "string"},
            "action": {"type": "string", "enum": list(get_args(Action))},
            "ref": {"type": "string", "enum": list(get_args(Ref))},
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "sku": {"type": "string"},
                        "quantity": {"type": "integer"},
                        "modifiers": {"type": "array", "items": {"type": "string"}},
                    },
                    "required": ["sku", "quantity", "modifiers"],
                },
            },
            "allergies": {"type": "array", "items": {"type": "string"}},
            "dietary_constraints": {"type": "array", "items": {"type": "string"}},
            "needs_clarification": {"type": "boolean"},
        },
        "required": ["source_language", "action", "ref", "items", "allergies", "dietary_constraints", "needs_clarification"],
    }


class GeminiClient:
    def __init__(
        self,
        api_key: str,
        model: str,
        *,
        timeout_seconds: float = 30.0,
        client: httpx.AsyncClient | None = None,
    ):
        self.api_key = api_key.strip()
        self.model = model.strip()
        if not self.api_key:
            raise ValueError("GEMINI_API_KEY is required")
        self._owns_client = client is None
        self._client = client or httpx.AsyncClient(timeout=httpx.Timeout(timeout_seconds, connect=5.0))

    async def close(self) -> None:
        if self._owns_client:
            await self._client.aclose()

    async def _generate(self, prompt: str, schema: dict, max_tokens: int) -> str:
        response = await self._client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
            headers={"x-goog-api-key": self.api_key, "Content-Type": "application/json"},
            json={
                "contents": [{"role": "user", "parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": 0,
                    "maxOutputTokens": max_tokens,
                    "responseMimeType": "application/json",
                    "responseSchema": schema,
                },
            },
        )
        if response.status_code >= 400:
            raise RuntimeError(f"Gemini failed ({response.status_code}): {response.text[:300]}")
        body = response.json()
        try:
            parts = body["candidates"][0]["content"]["parts"]
        except (KeyError, IndexError) as exc:
            reason = (body.get("candidates") or [{}])[0].get("finishReason")
            raise RuntimeError(f"Gemini returned no text ({reason})") from exc
        texts = [part["text"] for part in parts if part.get("text") and not part.get("thought")]
        if not texts:
            reason = body["candidates"][0].get("finishReason")
            raise RuntimeError(f"Gemini returned no text ({reason})")
        return texts[-1]

    async def warmup(self) -> None:
        await self._generate(
            'Return {"ready":true}.',
            {"type": "object", "properties": {"ready": {"type": "boolean"}}, "required": ["ready"]},
            128,
        )

    async def extract_intent(self, transcript: str, context: dict) -> IntentProposal:
        raw = await self._generate(build_intent_prompt(transcript, context), gemini_intent_schema(), 256)
        return proposal_from_raw(raw, transcript)

    async def localize_verified_response(self, facts: dict, language: str) -> str:
        schema = {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}
        raw = await self._generate(
            f"Translate text into {language}. Keep every preserve_names_exactly entry, currency symbol and number unchanged. Do not add facts. Return JSON only.\n{json.dumps(facts, ensure_ascii=False)}",
            schema,
            128,
        )
        return str(json.loads(raw)["text"])
