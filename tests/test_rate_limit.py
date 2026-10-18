import tempfile
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

from backend.app import main
from backend.app.domain.restaurant.repository import SQLiteOrderRepository
from backend.app.domain.restaurant.store import LanternStore
from backend.app.domain.restaurant.workflow import OrderWorkflow
from backend.app.services.kitchen_events import KitchenEventBroker
from backend.app.services.rate_limit import DemoLimits, DemoRateLimiter, client_ip

DAY = 86400.0
NOON = 1_790_000_000.0 - (1_790_000_000.0 % DAY) + DAY / 2  # 12:00 UTC on some day


class FakeClock:
    def __init__(self, now=NOON):
        self.now = now

    def __call__(self):
        return self.now


def limiter(clock=None, **overrides):
    return DemoRateLimiter(DemoLimits(enabled=True, **overrides), clock or FakeClock())


class RateLimiterTests(unittest.TestCase):
    def test_disabled_limiter_allows_everything(self):
        off = DemoRateLimiter(DemoLimits(enabled=False, sessions_per_ip_per_day=0, turns_per_ip_per_day=0))
        self.assertTrue(off.open_session("1.1.1.1").allowed)
        self.assertTrue(off.allow_turn("1.1.1.1", 99, "x" * 10_000).allowed)
        self.assertTrue(off.allow_write("1.1.1.1").allowed)

    def test_daily_sessions_per_ip_reset_at_utc_midnight(self):
        clock = FakeClock()
        limits = limiter(clock, sessions_per_ip_per_day=2, max_concurrent_sessions=10)
        self.assertTrue(limits.open_session("a").allowed)
        self.assertTrue(limits.open_session("a").allowed)
        blocked = limits.open_session("a")
        self.assertEqual(blocked.scope, "daily_sessions")
        self.assertEqual(blocked.retry_after_s, int(DAY / 2))
        self.assertTrue(limits.open_session("b").allowed)  # another visitor is unaffected
        clock.now += DAY / 2 + 1
        self.assertTrue(limits.open_session("a").allowed)

    def test_concurrent_sessions_free_up_on_close(self):
        limits = limiter(max_concurrent_sessions=1)
        self.assertTrue(limits.open_session("a").allowed)
        self.assertEqual(limits.open_session("b").scope, "busy")
        limits.close_session()
        self.assertTrue(limits.open_session("b").allowed)

    def test_turn_limits_per_ip_per_session_and_global(self):
        limits = limiter(turns_per_ip_per_day=2, turns_per_day=3, max_turns_per_session=5)
        self.assertTrue(limits.allow_turn("a", 0, "one sea bass").allowed)
        self.assertTrue(limits.allow_turn("a", 1, "add rice").allowed)
        self.assertEqual(limits.allow_turn("a", 2, "and tea").scope, "daily_turns")
        self.assertTrue(limits.allow_turn("b", 0, "hello").allowed)
        self.assertEqual(limits.allow_turn("c", 0, "hello").scope, "daily_total")
        self.assertEqual(limiter(max_turns_per_session=3).allow_turn("d", 3, "hi").scope, "session_turns")

    def test_long_transcript_is_refused_without_spending_the_quota(self):
        limits = limiter(max_transcript_chars=20, turns_per_ip_per_day=1)
        self.assertEqual(limits.allow_turn("a", 0, "x" * 21).scope, "too_long")
        self.assertTrue(limits.allow_turn("a", 0, "one sea bass").allowed)

    def test_writes_use_a_sliding_minute(self):
        clock = FakeClock()
        limits = limiter(clock, writes_per_ip_per_minute=2)
        self.assertTrue(limits.allow_write("a").allowed)
        self.assertTrue(limits.allow_write("a").allowed)
        self.assertEqual(limits.allow_write("a").scope, "writes")
        clock.now += 61
        self.assertTrue(limits.allow_write("a").allowed)

    def test_client_ip_prefers_edge_headers_then_last_forwarded_hop(self):
        self.assertEqual(client_ip({"cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1"}, "10.0.0.1"), "9.9.9.9")
        self.assertEqual(client_ip({"x-forwarded-for": "6.6.6.6, 203.0.113.7"}, "10.0.0.1"), "203.0.113.7")
        self.assertEqual(client_ip({}, "10.0.0.1"), "10.0.0.1")


class RateLimitedEndpointTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.repo = SQLiteOrderRepository(Path(self.directory.name) / "orders.sqlite3")
        store = LanternStore()

        class SilentTTS:
            sample_rate = 24000

            async def stream_async(self, *_args):
                if False:
                    yield b""

        self.original = (main.repository, main.store, main.workflow, main.broker, main.llm, main.tts, main.limiter)
        main.repository, main.store, main.workflow = self.repo, store, OrderWorkflow(self.repo, store)
        main.broker, main.llm, main.tts = KitchenEventBroker(), None, SilentTTS()
        # TestClient without a lifespan avoids warming live providers.
        self.client = TestClient(main.app)

    def tearDown(self):
        main.repository, main.store, main.workflow, main.broker, main.llm, main.tts, main.limiter = self.original
        self.repo.close()
        self.directory.cleanup()

    def test_visitor_over_the_daily_session_limit_is_told_why(self):
        main.limiter = limiter(sessions_per_ip_per_day=1)
        with self.client.websocket_connect("/ws/realtime?table_id=T4") as guest:
            self.assertEqual(guest.receive_json()["type"], "session_ready")
        with self.client.websocket_connect("/ws/realtime?table_id=T4") as guest:
            refused = guest.receive_json()
            self.assertEqual((refused["type"], refused["scope"]), ("rate_limited", "daily_sessions"))
            self.assertGreater(refused["retry_after_s"], 0)
        self.assertEqual(main.limiter.usage()["open_sessions"], 0)

    def test_turns_past_the_limit_are_not_processed(self):
        main.limiter = limiter(turns_per_ip_per_day=1)
        with self.client.websocket_connect("/ws/realtime?table_id=T4") as guest:
            guest.receive_json()  # session_ready
            guest.send_json({"type": "transcript", "text": "Hello there", "language_code": "en"})
            while guest.receive_json()["type"] != "turn_complete":
                pass
            guest.send_json({"type": "transcript", "text": "One more", "language_code": "en"})
            refused = guest.receive_json()
            self.assertEqual((refused["type"], refused["scope"]), ("rate_limited", "daily_turns"))
        self.assertEqual(len(self.repo.list_orders()), 0)

    def test_session_ends_at_its_time_cap(self):
        main.limiter = limiter(max_session_seconds=1)
        with self.client.websocket_connect("/ws/realtime?table_id=T4") as guest:
            self.assertEqual(guest.receive_json()["type"], "session_ready")
            ended = guest.receive_json()
            self.assertEqual((ended["type"], ended["scope"]), ("rate_limited", "session_time"))
        self.assertEqual(main.limiter.usage()["open_sessions"], 0)

    def test_staff_writes_are_capped_per_minute(self):
        main.limiter = limiter(writes_per_ip_per_minute=1)
        first = self.client.post("/menu/set-available", json={"sku": "MAIN_SQUID", "available": False})
        second = self.client.post("/menu/set-available", json={"sku": "MAIN_SQUID", "available": True})
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.status_code, 429)
        self.assertIn("Retry-After", second.headers)

    def test_staff_writes_are_allowed_cross_origin(self):
        preflight = self.client.options("/menu/set-available", headers={
            "Origin": "https://lantern.vercel.app",
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "content-type",
        })
        self.assertEqual(preflight.status_code, 200)
        self.assertIn("POST", preflight.headers.get("access-control-allow-methods", ""))

    def test_ready_is_readable_cross_origin(self):
        response = self.client.get("/health", headers={"Origin": "https://lantern-landing.vercel.app"})
        self.assertEqual(response.headers.get("access-control-allow-origin"), "*")


if __name__ == "__main__":
    unittest.main()
