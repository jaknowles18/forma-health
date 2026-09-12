"""Train, evaluate, and explain Forma's personal readiness model."""

from backend.features import MODEL_FEATURES, feature_row, unusual_signals
from backend.ridge import fit_ridge, predict

MIN_TRAINING_ROWS = 14


def train_readiness_model(health: list[dict], checkins: list[dict]) -> dict:
    rows = []
    for checkin in checkins:
        row = feature_row(health, checkin["date"])
        try:
            target = float(checkin["recovery"])
        except (KeyError, TypeError, ValueError):
            continue
        if not row["missing"] and 1 <= target <= 5:
            rows.append({**row, "target": target})
    rows.sort(key=lambda row: row["date"])

    if len(rows) < MIN_TRAINING_ROWS:
        return {
            "ready": False,
            "rows": len(rows),
            "requiredRows": MIN_TRAINING_ROWS,
            "skippedRows": len(checkins) - len(rows),
        }

    # The newest 20% is held out. Random splitting would allow nearby future
    # days to influence evaluation and overstate time-series performance.
    test_size = max(3, int(len(rows) * 0.2))
    training, testing = rows[:-test_size], rows[-test_size:]
    evaluation_model = fit_ridge(training, len(MODEL_FEATURES))
    naive_prediction = sum(row["target"] for row in training) / len(training)
    model_mae = sum(abs(predict(evaluation_model, row["values"]) - row["target"]) for row in testing) / len(testing)
    baseline_mae = sum(abs(naive_prediction - row["target"]) for row in testing) / len(testing)
    return {
        "ready": True,
        "rows": len(rows),
        "requiredRows": MIN_TRAINING_ROWS,
        "model": fit_ridge(rows, len(MODEL_FEATURES)),
        "evaluation": {"mae": model_mae, "baselineMae": baseline_mae, "testDays": test_size},
    }


def readiness_for_date(health: list[dict], checkins: list[dict], day: str) -> dict:
    # When reviewing an older date, exclude later labels. A model should never
    # learn from answers that did not exist on the day being predicted.
    eligible_checkins = [checkin for checkin in checkins if checkin.get("date", "") <= day]
    training = train_readiness_model(health, eligible_checkins)
    features = feature_row(health, day)
    result = {
        **training,
        "date": day,
        "missing": features["missing"],
        "baselines": features["baselines"],
        "signals": unusual_signals(health, day),
        "prediction": None,
    }
    if not training["ready"] or features["missing"]:
        return result

    raw_prediction = predict(training["model"], features["values"])
    prediction = min(5.0, max(1.0, raw_prediction))
    contributions = [
        {
            "label": label,
            "zScore": features["values"][index],
            "effect": training["model"]["weights"][index] * features["values"][index],
        }
        for index, (_, label) in enumerate(MODEL_FEATURES)
    ]
    contributions.sort(key=lambda item: abs(item["effect"]), reverse=True)
    return {
        **result,
        "prediction": prediction,
        "score": round((prediction - 1) / 4 * 100),
        "confidence": "Established" if training["rows"] >= 60 else "Growing" if training["rows"] >= 30 else "Early",
        "contributions": contributions,
    }
