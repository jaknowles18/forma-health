"""Focused checks for the Python feature and model pipeline."""

import unittest
from datetime import date, timedelta

from api.readiness import _validate_payload
from backend.features import baseline_for_metric
from backend.readiness import readiness_for_date
from backend.ridge import fit_ridge, predict


class ReadinessModelTests(unittest.TestCase):
    def test_baseline_excludes_the_day_being_evaluated(self):
        health = [
            {"date": f"2026-09-0{day}", "metric": "hrv", "value": day}
            for day in range(1, 8)
        ]
        health.append({"date": "2026-09-08", "metric": "hrv", "value": 100})
        baseline = baseline_for_metric(health, "hrv", "2026-09-08")
        self.assertEqual(baseline["samples"], 7)
        self.assertEqual(baseline["average"], 4)
        self.assertGreater(baseline["zScore"], 40)

    def test_ridge_fits_a_small_linear_relationship(self):
        rows = [
            {"values": [0.0], "target": 2.0},
            {"values": [1.0], "target": 4.0},
            {"values": [2.0], "target": 6.0},
            {"values": [3.0], "target": 8.0},
        ]
        model = fit_ridge(rows, feature_count=1, regularization=0.001)
        self.assertAlmostEqual(predict(model, [4.0]), 10.0, places=2)

    def test_readiness_waits_then_trains_on_matched_checkins(self):
        health, checkins = [], []
        start = date(2026, 1, 1)
        for offset in range(55):
            day = (start + timedelta(days=offset)).isoformat()
            health.extend((
                {"date": day, "metric": "hrv", "value": 48 + offset % 7},
                {"date": day, "metric": "restingHeartRate", "value": 62 - offset % 5},
                {"date": day, "metric": "sleep", "value": 6.5 + offset % 6 * 0.3},
            ))
            if 28 <= offset < 52:
                checkins.append({"date": day, "recovery": 1 + offset % 5})

        prediction_day = (start + timedelta(days=53)).isoformat()
        self.assertFalse(readiness_for_date(health, checkins[:8], prediction_day)["ready"])
        future_checkin = {"date": (start + timedelta(days=54)).isoformat(), "recovery": 5}
        result = readiness_for_date(health, [*checkins, future_checkin], prediction_day)
        self.assertTrue(result["ready"])
        self.assertEqual(result["rows"], len(checkins))
        self.assertGreaterEqual(result["score"], 0)
        self.assertLessEqual(result["score"], 100)
        self.assertGreaterEqual(result["evaluation"]["mae"], 0)

    def test_api_payload_keeps_only_valid_compact_records(self):
        payload = {
            "date": "2026-09-12",
            "health": [{"date": "2026-09-12", "metric": "hrv", "value": 52}],
            "checkins": [{"date": "2026-09-12", "recovery": 4}],
        }
        health, checkins, day = _validate_payload(payload)
        self.assertEqual(day, "2026-09-12")
        self.assertEqual(health[0]["value"], 52.0)
        self.assertEqual(checkins[0]["recovery"], 4)
        with self.assertRaises(ValueError):
            _validate_payload({**payload, "health": [{"date": "2026-09-12", "metric": "steps", "value": 100}]})
        with self.assertRaises(ValueError):
            _validate_payload({**payload, "checkins": [{"date": "2026-09-12", "recovery": 3.5}]})


if __name__ == "__main__":
    unittest.main()
