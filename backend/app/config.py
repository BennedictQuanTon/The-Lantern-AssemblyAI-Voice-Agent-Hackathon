from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", "development")
    app_host: str = os.getenv("APP_HOST", "0.0.0.0")
    app_port: int = int(os.getenv("APP_PORT", "8000"))
    log_level: str = os.getenv("LOG_LEVEL", "INFO")
    allow_stub_providers: bool = os.getenv("ALLOW_STUB_PROVIDERS", "false").lower() == "true"
    assemblyai_api_key: str = os.getenv("ASSEMBLYAI_API_KEY", "")
    assemblyai_speech_model: str = os.getenv("ASSEMBLYAI_SPEECH_MODEL", "universal-3-5-pro")
    llm_provider: str = os.getenv("LLM_PROVIDER", "ollama")
    ollama_model: str = os.getenv("OLLAMA_MODEL", "qwen3:4b")
    ollama_base_url: str = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
    ollama_thinking: bool = os.getenv("OLLAMA_THINKING", "false").lower() == "true"
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")
    tts_provider: str = os.getenv("TTS_PROVIDER", "kokoro")
    kokoro_model_id: str = os.getenv("KOKORO_MODEL_ID", "hexgrad/Kokoro-82M")
    kokoro_device: str = os.getenv("KOKORO_DEVICE", "auto")
    cartesia_api_key: str = os.getenv("CARTESIA_API_KEY", "")
    cartesia_voice_id: str = os.getenv("CARTESIA_VOICE_ID", "")
    cartesia_model: str = os.getenv("CARTESIA_MODEL", "sonic-3")
    # Public demo limits (see services/rate_limit.py). Off by default so local runs and benchmarks are unaffected.
    rate_limit_enabled: bool = os.getenv("RATE_LIMIT_ENABLED", "false").lower() == "true"
    demo_sessions_per_ip_per_day: int = int(os.getenv("DEMO_SESSIONS_PER_IP_PER_DAY", "8"))
    demo_turns_per_ip_per_day: int = int(os.getenv("DEMO_TURNS_PER_IP_PER_DAY", "80"))
    demo_turns_per_day: int = int(os.getenv("DEMO_TURNS_PER_DAY", "2000"))
    demo_max_concurrent_sessions: int = int(os.getenv("DEMO_MAX_CONCURRENT_SESSIONS", "4"))
    demo_max_session_seconds: int = int(os.getenv("DEMO_MAX_SESSION_SECONDS", "300"))
    demo_max_turns_per_session: int = int(os.getenv("DEMO_MAX_TURNS_PER_SESSION", "30"))
    demo_writes_per_ip_per_minute: int = int(os.getenv("DEMO_WRITES_PER_IP_PER_MINUTE", "30"))
    demo_max_transcript_chars: int = int(os.getenv("DEMO_MAX_TRANSCRIPT_CHARS", "280"))
    # Origins allowed to read GET endpoints cross-origin (the landing page polls /ready while the demo wakes up).
    cors_allow_origins: str = os.getenv("CORS_ALLOW_ORIGINS", "*")
    database_path: Path = Path(os.getenv("DATABASE_PATH", "var/lantern.sqlite3"))
    metrics_dir: Path = Path(os.getenv("METRICS_DIR", "var/metrics"))


settings = Settings()
