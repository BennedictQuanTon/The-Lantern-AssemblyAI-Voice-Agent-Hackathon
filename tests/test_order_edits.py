"""Regressions for the deployed quantity and readback failures."""
import json
import tempfile
import unittest
from pathlib import Path

import httpx
from fastapi.testclient import TestClient

from backend.app import main

from backend.app.domain.restaurant.models import IntentItem, IntentProposal
from backend.app.domain.restaurant.repository import SQLiteOrderRepository
from backend.app.domain.restaurant.store import LanternStore
from backend.app.domain.restaurant.workflow import OrderWorkflow
from backend.app.providers.llm.gemini import GeminiClient, gemini_intent_schema
from backend.app.providers.llm.ollama import INTENT_SCHEMA, build_intent_prompt
from backend.app.services.order_requests import explicit_order_request
from backend.app.services.realtime_session import RealtimeSession
from backend.app.services.kitchen_events import KitchenEventBroker
from eval.benchmarks.restaurant.order_edits import ReplayLLM


class MisclassifyingLLM:
    """Replay the two observable pre-fix extraction mistakes, not an ideal intent."""
    async def extract_intent(self, transcript, context):
        if "quantity" in transcript:
            return IntentProposal(action="create_or_update_order", items=[IntentItem(sku="DRINK_LEMON", quantity=1)])
        return IntentProposal(action="menu_query")


class DeployedOrderEditTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.repo = SQLiteOrderRepository(Path(self.directory.name) / "orders.sqlite3")
        self.store = LanternStore()
        self.workflow = OrderWorkflow(self.repo, self.store)
        self.order = self.workflow.submit("T10", "guest", "one tofu and two teas", IntentProposal(
            action="create_or_update_order",
            items=[IntentItem(sku="VG_TOFU", quantity=1), IntentItem(sku="DRINK_LEMON", quantity=2)],
        ))
        self.session = RealtimeSession("T10", self.workflow, MisclassifyingLLM(), session_id="guest", order_id=self.order["order_id"])

    def tearDown(self):
        self.repo.close()
        self.directory.cleanup()

    async def test_change_quantity_is_absolute_and_preserves_other_lines(self):
        result = await self.session.handle_transcript("Change the Lemongrass Iced Tea quantity to one.")
        self.assertEqual({line["sku"]: line["quantity"] for line in result["basket"]}, {"VG_TOFU": 1, "DRINK_LEMON": 1})
        self.assertEqual(result["total"], 8.5)
        self.assertFalse(result["placed"])
        self.assertEqual(result["current_revision"], 2)

    async def test_order_questions_read_the_saved_basket_without_writing_or_placing(self):
        for phrase in ("What is in my order?", "Read back my order, but do not place it.",
                       "Could you repeat my order?", "Can you say my order again?"):
            with self.subTest(phrase=phrase):
                result = await self.session.handle_transcript(phrase)
                self.assertEqual(result.get("order_id"), self.order["order_id"])
                self.assertIn("1 Lemongrass Tofu", result["response_text"])
                self.assertIn("2 Lemongrass Iced Tea", result["response_text"])
                self.assertIn("$11.00", result["response_text"])
                self.assertEqual(result["current_revision"], 1)
                self.assertFalse(result["wrote_revision"])
                self.assertFalse(result["placed"])
                self.assertIsNone(self.session.dialogue.pending)

    async def test_same_quantity_is_a_noop_even_after_reload(self):
        for _ in range(2):
            session = RealtimeSession("T10", self.workflow, MisclassifyingLLM(), session_id="guest", order_id=self.order["order_id"])
            result = await session.handle_transcript("Set the Lemongrass Iced Tea quantity to two.")
            self.assertEqual(result["current_revision"], 1)
            self.assertFalse(result["wrote_revision"])
            self.assertEqual(result["total"], 11)

    async def test_quantity_preserves_saved_modifiers(self):
        order = self.workflow.submit("T10", "other", "one morning glory no garlic", IntentProposal(
            action="create_or_update_order", items=[IntentItem(sku="VG_MORNING", quantity=1, modifiers=["no garlic"])],
        ))
        session = RealtimeSession("T10", self.workflow, MisclassifyingLLM(), session_id="other", order_id=order["order_id"])
        result = await session.handle_transcript("Change the Stir-fried Morning Glory quantity to two.")
        self.assertEqual(result["basket"][0]["quantity"], 2)
        self.assertEqual(result["basket"][0]["modifiers"], ["no garlic"])

    async def test_ambiguous_invalid_and_missing_targets_never_write(self):
        for phrase in ("Make it two.", "Change the Unicorn Pizza quantity to one.",
                       "Change the Lemongrass Iced Tea quantity to zero.",
                       "Change the Lemongrass Iced Tea quantity to -1.",
                       "Change the Lemongrass Iced Tea quantity to 51."):
            with self.subTest(phrase=phrase):
                result = await self.session.handle_transcript(phrase)
                self.assertEqual(result["status"], "clarification_required")
                self.assertFalse(result["wrote_revision"])
                self.assertEqual(self.repo.get_order(self.order["order_id"])["current_revision"], 1)

    async def test_multiple_modifier_versions_require_a_choice(self):
        self.workflow.submit("T10", "guest", "add one tea less ice", IntentProposal(
            action="create_or_update_order", items=[IntentItem(sku="DRINK_LEMON", quantity=1, modifiers=["less ice"])],
        ), self.order["order_id"])
        result = await self.session.handle_transcript("Change the Lemongrass Iced Tea quantity to one.")
        self.assertEqual(result["status"], "clarification_required")
        self.assertFalse(result["wrote_revision"])
        self.assertEqual(self.repo.get_order(self.order["order_id"])["current_revision"], 2)

    async def test_readback_without_an_order_does_not_invent_one(self):
        session = RealtimeSession("T10", self.workflow, MisclassifyingLLM())
        result = await session.handle_transcript("What is in my order?")
        self.assertEqual(result["status"], "clarification_required")
        self.assertIn("nothing in your order", result["response_text"])
        self.assertFalse(result["wrote_revision"])
        self.assertEqual(len(self.repo.list_orders()), 1)

    async def test_readback_clears_old_placement_confirmation(self):
        self.session.dialogue.set_pending("confirm_place")
        await self.session.handle_transcript("Read back my order, but do not place it.")
        self.assertIsNone(self.session.dialogue.pending)
        self.assertFalse(self.repo.get_order(self.order["order_id"])["placed"])

    async def test_set_quantity_from_model_and_addition_have_different_semantics(self):
        class LLM:
            async def extract_intent(self, transcript, context):
                return IntentProposal(action="create_or_update_order" if "another" in transcript.casefold() else "set_quantity",
                                      items=[IntentItem(sku="DRINK_LEMON", quantity=1)])
        self.session.llm = LLM()
        added = await self.session.handle_transcript("Another Lemongrass Iced Tea please.")
        self.assertEqual(added["basket"][1]["quantity"], 3)
        updated = await self.session.handle_transcript("Solo un Lemongrass Iced Tea, por favor.", "es")
        self.assertEqual(updated["basket"][1]["quantity"], 1)
        self.assertEqual(updated["language_code"], "es")

    async def test_same_sku_replacement_can_change_quantity(self):
        result = self.workflow.submit("T10", "guest", "one tea instead of two", IntentProposal(
            action="replace_item", replaces_sku="DRINK_LEMON", items=[IntentItem(sku="DRINK_LEMON", quantity=1)],
        ), self.order["order_id"])
        self.assertEqual(result["total"], 8.5)
        self.assertEqual(result["current_revision"], 2)

    async def test_soldout_quantity_can_decrease_but_cannot_increase(self):
        self.store.set_available("DRINK_LEMON", False)
        result = await self.session.handle_transcript("Change the Lemongrass Iced Tea quantity to three.")
        self.assertEqual(result["status"], "clarification_required")
        self.assertFalse(result["wrote_revision"])
        decreased = await self.session.handle_transcript("Change the Lemongrass Iced Tea quantity to one.")
        self.assertEqual(decreased["total"], 8.5)

    async def test_quantity_edit_after_placement_preserves_the_kitchen_workflow(self):
        placed = self.workflow.place("T10", "guest", "place", self.order["order_id"])
        result = await self.session.handle_transcript("Change the Lemongrass Iced Tea quantity to one.")
        self.assertEqual(result["status"], "pending_kitchen")
        self.assertTrue(result["placed"])
        self.assertEqual(result["current_revision"], placed["current_revision"] + 1)
        self.assertEqual(result["total"], 8.5)

    def test_set_quantity_requires_one_existing_line(self):
        for skus in ([], ["VG_TOFU", "DRINK_LEMON"], ["MAIN_SEABASS"]):
            with self.subTest(skus=skus):
                result = self.workflow.submit("T10", "guest", "edit", IntentProposal(
                    action="set_quantity", items=[IntentItem(sku=sku, quantity=1) for sku in skus],
                ), self.order["order_id"])
                self.assertEqual(result["status"], "clarification_required")
                self.assertEqual(self.repo.get_order(self.order["order_id"])["current_revision"], 1)


class OrderEditContractTests(unittest.IsolatedAsyncioTestCase):
    def test_explicit_routing_does_not_swallow_additions_menu_or_combined_requests(self):
        store = LanternStore()
        for text in ("Add one more Lemongrass Iced Tea.", "Repeat that order again and place it.",
                     "Do not repeat my order.", "What is on the menu?", "Change tofu to sea bass.",
                     "Change the tea quantity to one and add soup."):
            with self.subTest(text=text):
                self.assertIsNone(explicit_order_request(text, None, store))

    def test_provider_contracts_include_quantity_readback_and_swap_target(self):
        schema = gemini_intent_schema()["properties"]
        self.assertIn("readback", schema["action"]["enum"])
        self.assertIn("set_quantity", schema["action"]["enum"])
        self.assertIn("replaces_sku", schema)
        self.assertIn("readback", INTENT_SCHEMA["properties"]["action"]["enum"])
        prompt = build_intent_prompt("What is in my order?", {})
        self.assertIn("requested FINAL quantity", prompt)
        self.assertIn("never menu_query or place_order", prompt)

    async def test_gemini_swap_schema_and_response_preserve_existing_target(self):
        captured = {}
        def handler(request):
            captured.update(json.loads(request.content))
            return httpx.Response(200, json={"candidates": [{"content": {"parts": [{"text": json.dumps({
                "action": "replace_item", "replaces_sku": "VG_TOFU",
                "items": [{"sku": "MAIN_SEABASS", "quantity": 1, "modifiers": []}],
            })}]}}]})
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = GeminiClient("test-key", "test-model", client=http)
            intent = await client.extract_intent("Change the tofu to sea bass", {})
        self.assertEqual(intent.replaces_sku, "VG_TOFU")
        self.assertIn("replaces_sku", captured["generationConfig"]["responseSchema"]["properties"])


class OrderEditWebSocketTests(unittest.TestCase):
    def test_quantity_and_readback_survive_websocket_resume_with_audio_and_no_kitchen_ticket(self):
        class FixtureTTS:
            sample_rate = 24000

            async def stream_async(self, *_args):
                yield bytes(960)

        with tempfile.TemporaryDirectory() as directory:
            repo = SQLiteOrderRepository(Path(directory) / "orders.sqlite3")
            original = (main.repository, main.store, main.workflow, main.broker, main.llm, main.tts)
            store = LanternStore()
            main.repository, main.store, main.workflow = repo, store, OrderWorkflow(repo, store)
            main.broker, main.llm, main.tts = KitchenEventBroker(), ReplayLLM(), FixtureTTS()

            def turn(ws, text):
                ws.send_json({"type": "transcript", "text": text, "language_code": "en"})
                events = []
                while True:
                    event = ws.receive_json()
                    self.assertNotEqual(event["type"], "error")
                    events.append(event)
                    if event["type"] == "turn_complete":
                        break
                self.assertTrue(any(event["type"] == "audio_chunk" for event in events))
                self.assertIsInstance(events[-1]["pipeline_ms"], float)
                return next(event for event in events if event.get("response_text"))

            try:
                client = TestClient(main.app)
                with client.websocket_connect("/ws/realtime?table_id=T10") as ws:
                    self.assertEqual(ws.receive_json()["type"], "session_ready")
                    order = turn(ws, "Add one Lemongrass Tofu and two Lemongrass Iced Tea to my order.")
                    updated = turn(ws, "Change the Lemongrass Iced Tea quantity to one.")
                    readback = turn(ws, "What is in my order?")
                    self.assertEqual(updated["total"], 8.5)
                    self.assertEqual(readback["current_revision"], updated["current_revision"])
                    self.assertFalse(readback["wrote_revision"])
                    self.assertFalse(readback["placed"])
                with client.websocket_connect(f"/ws/realtime?table_id=T10&order_id={order['order_id']}") as ws:
                    ready = ws.receive_json()
                    self.assertEqual(ready["order"]["order_id"], order["order_id"])
                    repeated = turn(ws, "Read back my order, but do not place it.")
                    self.assertIn("$8.50", repeated["response_text"])
                    self.assertEqual(repeated["current_revision"], updated["current_revision"])
                self.assertEqual(client.get("/api/kitchen/orders").json()["orders"], [])
            finally:
                main.repository, main.store, main.workflow, main.broker, main.llm, main.tts = original
                repo.close()


if __name__ == "__main__":
    unittest.main()
