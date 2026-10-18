from __future__ import annotations


SUPPORTED_TTS_LANGUAGES = {"en", "es", "fr", "hi", "it", "ja", "zh", "pt-BR"}
LANGUAGE_NAMES = {
    "english": "en",
    "spanish": "es",
    "español": "es",
    "french": "fr",
    "hindi": "hi",
    "italian": "it",
    "japanese": "ja",
    "chinese": "zh",
    "portuguese": "pt-BR",
}


def normalize_language(code: str | None) -> str:
    """Turn a model label such as 'English' into the code the voice list uses."""
    raw = (code or "en").strip().replace("_", "-")
    named = LANGUAGE_NAMES.get(raw.casefold())
    if named:
        return named
    if raw.casefold() in {"en-us", "en-gb"}:
        return "en"
    if raw.casefold().startswith("pt"):
        return "pt-BR"
    return raw


def resolve_language(code: str | None) -> tuple[str, bool]:
    language = normalize_language(code)
    base = language.split("-")[0]
    return language, language in SUPPORTED_TTS_LANGUAGES or base in SUPPORTED_TTS_LANGUAGES
