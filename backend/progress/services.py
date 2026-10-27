import json
from functools import lru_cache
from pathlib import Path

from django.conf import settings


AUTHORED_EVENT_IDS = {"emergency", "cuba", "wwi", "berlin", "space", "independence", "oil"}
EMERGENCY_DECISIONS = (
    {
        "tighten": {"stability": 7, "trust": -9, "liberties": -18, "legitimacy": -8},
        "guardrails": {"stability": -3, "trust": 8, "liberties": 5, "legitimacy": 9},
        "dialogue": {"stability": -7, "trust": 10, "liberties": 8, "legitimacy": 7},
    },
    {
        "censor": {"stability": 5, "trust": -12, "liberties": -15, "legitimacy": -7},
        "limited": {"stability": 1, "trust": 4, "liberties": 3, "legitimacy": 3},
        "freepress": {"stability": -4, "trust": 9, "liberties": 12, "legitimacy": 8},
    },
    {
        "election": {"stability": -2, "trust": 8, "liberties": 10, "legitimacy": 12},
        "phaseout": {"stability": 3, "trust": 5, "liberties": 8, "legitimacy": 5, "min_trust": 35},
        "mediated": {"stability": -1, "trust": 7, "liberties": 8, "legitimacy": 10, "prior_choice": "dialogue"},
        "extend": {"stability": 4, "trust": -14, "liberties": -12, "legitimacy": -13},
    },
)


@lru_cache(maxsize=1)
def imported_event_ids() -> frozenset[str]:
    catalog = Path(settings.BASE_DIR).parent / "data" / "history-events.json"
    if not catalog.is_file():
        return frozenset()
    with catalog.open(encoding="utf-8") as file:
        events = json.load(file)
    if not isinstance(events, list):
        raise ValueError("The shared historical event catalogue must be a JSON array.")
    return frozenset(event["id"] for event in events if isinstance(event, dict) and isinstance(event.get("id"), str))


def is_known_event(event_id: str) -> bool:
    return event_id in AUTHORED_EVENT_IDS or event_id in imported_event_ids()


def is_verified_completion(campaign_id: str, game_state: dict) -> bool:
    if campaign_id != "emergency" or game_state.get("ended") is not True:
        return False
    choices = game_state.get("choices")
    if not isinstance(choices, list) or len(choices) != len(EMERGENCY_DECISIONS):
        return False
    indicators = {"stability": 55, "trust": 48, "liberties": 52, "legitimacy": 50}
    prior_choices = []
    for index, choice in enumerate(choices):
        if not isinstance(choice, dict) or choice.get("node") != ("opening", "press", "election")[index]:
            return False
        effects = EMERGENCY_DECISIONS[index].get(choice.get("choice"))
        if effects is None:
            return False
        if effects.get("min_trust") is not None and indicators["trust"] < effects["min_trust"]:
            return False
        if effects.get("prior_choice") and effects["prior_choice"] not in prior_choices:
            return False
        for key in indicators:
            indicators[key] = max(0, min(100, indicators[key] + effects[key]))
        prior_choices.append(choice["choice"])
    reported_state = game_state.get("state")
    return (
        game_state.get("node") == len(EMERGENCY_DECISIONS)
        and isinstance(reported_state, dict)
        and all(reported_state.get(key) == value for key, value in indicators.items())
    )
