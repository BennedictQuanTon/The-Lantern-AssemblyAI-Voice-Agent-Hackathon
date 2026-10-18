"""Daily limits for the public demo, so one visitor cannot burn the speech and model budget.

AssemblyAI bills streaming by how long the socket stays open, and every turn costs an LLM and a
TTS call on the hosted demo. The limiter therefore caps, per client IP and per UTC day: voice
sessions and guest turns; and globally: turns per day and sessions open at once. Each session
also has a maximum length and turn count, and staff write endpoints are capped per minute.

Counts live in memory. The demo runs as a single instance, and a restart resetting the counts is
acceptable for this purpose.
"""
from __future__ import annotations

import time
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Callable, Mapping


@dataclass(frozen=True)
class Decision:
    allowed: bool
    scope: str = ""
    message: str = ""
    retry_after_s: int = 0

    def payload(self) -> dict:
        return {"type": "rate_limited", "scope": self.scope, "message": self.message, "retry_after_s": self.retry_after_s}


ALLOWED = Decision(True)


@dataclass
class DemoLimits:
    enabled: bool = False
    sessions_per_ip_per_day: int = 8
    turns_per_ip_per_day: int = 80
    turns_per_day: int = 2000
    max_concurrent_sessions: int = 4
    max_session_seconds: int = 300
    max_turns_per_session: int = 30
    writes_per_ip_per_minute: int = 30
    max_transcript_chars: int = 280


@dataclass
class _Day:
    key: str
    sessions: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    turns: dict[str, int] = field(default_factory=lambda: defaultdict(int))
    total_turns: int = 0


def client_ip(headers: Mapping[str, str], fallback: str | None) -> str:
    """The visitor's address behind Render's proxy.

    ``CF-Connecting-IP`` / ``True-Client-IP`` are set by the edge and cannot be forged by the
    client. ``X-Forwarded-For`` is appended to by each proxy, so its last entry is the one the
    nearest proxy saw; earlier entries may be client-supplied.
    """
    for name in ("cf-connecting-ip", "true-client-ip"):
        value = (headers.get(name) or "").strip()
        if value:
            return value
    forwarded = [part.strip() for part in (headers.get("x-forwarded-for") or "").split(",") if part.strip()]
    if forwarded:
        return forwarded[-1]
    return fallback or "unknown"


class DemoRateLimiter:
    def __init__(self, limits: DemoLimits, clock: Callable[[], float] = time.time) -> None:
        self.limits = limits
        self.clock = clock
        self._day = _Day(self._day_key())
        self._open = 0
        self._writes: dict[str, deque[float]] = defaultdict(deque)

    def _now(self) -> datetime:
        return datetime.fromtimestamp(self.clock(), tz=timezone.utc)

    def _day_key(self) -> str:
        return self._now().strftime("%Y-%m-%d")

    def _today(self) -> _Day:
        key = self._day_key()
        if self._day.key != key:
            self._day = _Day(key)
        return self._day

    def _until_midnight(self) -> int:
        now = self._now()
        tomorrow = (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return max(1, int((tomorrow - now).total_seconds()))

    def open_session(self, ip: str) -> Decision:
        if not self.limits.enabled:
            return ALLOWED
        day = self._today()
        if self._open >= self.limits.max_concurrent_sessions:
            return Decision(False, "busy", "The demo is busy right now. Please try again in a minute.", 60)
        if day.sessions[ip] >= self.limits.sessions_per_ip_per_day:
            return Decision(False, "daily_sessions", "You've reached today's demo limit. Please come back tomorrow.", self._until_midnight())
        if day.total_turns >= self.limits.turns_per_day:
            return Decision(False, "daily_total", "The demo has reached today's limit. Please come back tomorrow.", self._until_midnight())
        day.sessions[ip] += 1
        self._open += 1
        return ALLOWED

    def close_session(self) -> None:
        if self.limits.enabled:
            self._open = max(0, self._open - 1)

    def allow_turn(self, ip: str, session_turns: int, text: str) -> Decision:
        if not self.limits.enabled:
            return ALLOWED
        if len(text) > self.limits.max_transcript_chars:
            return Decision(False, "too_long", "That request is too long. Please keep it to a sentence or two.", 0)
        if session_turns >= self.limits.max_turns_per_session:
            return Decision(False, "session_turns", "This demo session has reached its turn limit. Start a new one to keep going.", 0)
        day = self._today()
        if day.turns[ip] >= self.limits.turns_per_ip_per_day:
            return Decision(False, "daily_turns", "You've reached today's demo limit. Please come back tomorrow.", self._until_midnight())
        if day.total_turns >= self.limits.turns_per_day:
            return Decision(False, "daily_total", "The demo has reached today's limit. Please come back tomorrow.", self._until_midnight())
        day.turns[ip] += 1
        day.total_turns += 1
        return ALLOWED

    def session_expired(self) -> Decision:
        minutes = max(1, round(self.limits.max_session_seconds / 60))
        return Decision(False, "session_time", f"This demo session ended after {minutes} minutes. Tap the microphone to start a new one.", 0)

    def allow_write(self, ip: str) -> Decision:
        if not self.limits.enabled:
            return ALLOWED
        now = self.clock()
        window = self._writes[ip]
        while window and now - window[0] >= 60:
            window.popleft()
        if len(window) >= self.limits.writes_per_ip_per_minute:
            return Decision(False, "writes", "Too many changes in a short time. Please wait a moment.", int(60 - (now - window[0])) + 1)
        window.append(now)
        return ALLOWED

    def usage(self) -> dict:
        day = self._today()
        return {"enabled": self.limits.enabled, "open_sessions": self._open, "turns_today": day.total_turns,
                "turns_per_day": self.limits.turns_per_day}
