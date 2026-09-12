"""Turn daily health summaries into leakage-safe model features."""

from datetime import date as calendar_date, timedelta
from math import sqrt

BASELINE_DAYS = 28
MIN_BASELINE_SAMPLES = 7
MODEL_FEATURES = (
    ("hrv", "HRV"),
    ("restingHeartRate", "Resting heart rate"),
    ("sleep", "Sleep"),
)


def _shift_day(day: str, offset: int) -> str:
    return (calendar_date.fromisoformat(day) + timedelta(days=offset)).isoformat()


def baseline_for_metric(health: list[dict], metric: str, day: str, window_days: int = BASELINE_DAYS) -> dict:
    """Compare *day* with earlier values, never with a baseline containing itself.

    Excluding the current day prevents data leakage: otherwise the value being
    evaluated would pull its own average toward itself and appear less unusual.
    """
    current = next((item for item in health if item.get("metric") == metric and item.get("date") == day), None)
    start = _shift_day(day, -window_days)
    history = [
        float(item["value"])
        for item in health
        if item.get("metric") == metric and start <= item.get("date", "") < day and _finite_number(item.get("value"))
    ]
    if current is None or len(history) < MIN_BASELINE_SAMPLES:
        return {
            "metric": metric,
            "current": current,
            "average": None,
            "standardDeviation": None,
            "zScore": None,
            "samples": len(history),
            "requiredSamples": MIN_BASELINE_SAMPLES,
        }

    average = sum(history) / len(history)
    variance = sum((value - average) ** 2 for value in history) / len(history)
    standard_deviation = sqrt(variance)
    difference = float(current["value"]) - average
    # A completely flat history has no usable deviation. An exact match is
    # normal; a changed value is capped at ±3 so it still appears unusual.
    if standard_deviation < 1e-9:
        z_score = 0 if abs(difference) < 1e-9 else (3 if difference > 0 else -3)
    else:
        z_score = difference / standard_deviation
    return {
        "metric": metric,
        "current": current,
        "average": average,
        "standardDeviation": standard_deviation,
        "zScore": z_score,
        "samples": len(history),
        "requiredSamples": MIN_BASELINE_SAMPLES,
    }


def feature_row(health: list[dict], day: str) -> dict:
    baselines = [
        {"metric": metric, "label": label, "baseline": baseline_for_metric(health, metric, day)}
        for metric, label in MODEL_FEATURES
    ]
    missing = [item["label"] for item in baselines if item["baseline"]["zScore"] is None]
    return {
        "date": day,
        "values": [item["baseline"]["zScore"] for item in baselines],
        "baselines": baselines,
        "missing": missing,
    }


def unusual_signals(health: list[dict], day: str) -> list[dict]:
    signals = [baseline_for_metric(health, metric, day) for metric in ("hrv", "restingHeartRate", "sleep", "respiratoryRate")]
    available = [signal for signal in signals if signal["current"] is not None]
    return sorted(available, key=lambda item: abs(item["zScore"] or 0), reverse=True)


def _finite_number(value: object) -> bool:
    try:
        number = float(value)
        return number == number and number not in (float("inf"), float("-inf"))
    except (TypeError, ValueError):
        return False
