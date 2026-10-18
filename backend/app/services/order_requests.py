"""Ground narrow, explicit order requests before asking a model to interpret them.

Only complete supported sentences match. Mixed requests and additions remain on
the normal extraction path; ambiguous quantity targets ask rather than guess.
"""
from __future__ import annotations

import re

from ..domain.restaurant.mentions import mentioned_skus
from ..domain.restaurant.models import IntentItem, IntentProposal
from ..domain.restaurant.store import LanternStore
from .response_renderer import render_prompt


_READBACK = re.compile(
    r"(?:please |(?:can|could|would) you )?"
    r"(?:(?:read(?: ?back)?|repeat|summari[sz]e|say) (?:my|our|the) order(?: again)?"
    r"|(?:tell|remind) me (?:what (?:i|we) (?:ordered|have ordered)|(?:my|our) order)"
    r"|what(?: is|'s) (?:in (?:my|our|the) order|(?:my|our|the) (?:order|total))"
    r"|what (?:have|did) (?:i|we) order(?:ed)?)"
    r"(?: please)?(?: but (?:do not|don't) (?:place|send) it)?",
    re.IGNORECASE,
)
_NUMBERS = {"zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
            "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_NUMBER = r"-?\d+|" + "|".join(_NUMBERS)
_QUANTITY = re.compile(
    rf"(?:please )?(?:change|set|update) (?:the )?(?P<target>.+?)"
    rf"(?: quantity| count)? to (?P<count>{_NUMBER})(?: (?:please|instead))?",
    re.IGNORECASE,
)
_PRONOUN_QUANTITY = re.compile(
    rf"(?:please )?make (?P<target>it|that|those|them) (?P<count>{_NUMBER})(?: (?:please|instead))?",
    re.IGNORECASE,
)


def explicit_order_request(transcript: str, order: dict | None, store: LanternStore,
                           language: str = "en") -> IntentProposal | None:
    text = re.sub(r"[,?.!]", " ", transcript.casefold())
    text = " ".join(text.split())
    if _READBACK.fullmatch(text):
        return IntentProposal(action="readback", source_language=language)
    match = _QUANTITY.fullmatch(text) or _PRONOUN_QUANTITY.fullmatch(text)
    if match is None:
        return None

    def clarify(code: str) -> IntentProposal:
        return IntentProposal(action="clarify", source_language=language, needs_clarification=True,
                              clarification_question=render_prompt(code, language.split("-")[0]))

    count_text = match["count"]
    quantity = _NUMBERS[count_text] if count_text in _NUMBERS else int(count_text)
    if not 1 <= quantity <= 50:
        return clarify("quantity_range")
    lines = order.get("basket", []) if order and order.get("status") not in {"cancelled", "ready", "rejected"} else []
    menu = [store.get_item(line["sku"]) for line in lines]
    menu = [item for item in menu if item]
    target = match["target"]
    if target in {"it", "that", "those", "them"}:
        skus = {line["sku"] for line in lines}
    else:
        skus = mentioned_skus(target, menu)
    if len(skus) != 1:
        return clarify("which_quantity")
    return IntentProposal(action="set_quantity", source_language=language,
                          items=[IntentItem(sku=next(iter(skus)), quantity=quantity)])
