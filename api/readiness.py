"""Vercel Function transport for the stateless Python readiness model."""

import json
from datetime import date as calendar_date
from http.server import BaseHTTPRequestHandler

from backend.readiness import readiness_for_date

ALLOWED_METRICS = {"hrv", "restingHeartRate", "sleep", "respiratoryRate"}


class handler(BaseHTTPRequestHandler):
    def do_POST(self):
        try:
            content_length = int(self.headers.get("content-length", "0"))
            if content_length <= 0:
                raise ValueError("Request body is required.")
            payload = json.loads(self.rfile.read(content_length))
            health, checkins, day = _validate_payload(payload)
            self._json(200, readiness_for_date(health, checkins, day))
        except (ValueError, TypeError, KeyError, json.JSONDecodeError) as error:
            self._json(400, {"error": str(error)})
        except Exception:
            # Avoid returning health data or implementation details in errors.
            self._json(500, {"error": "The readiness model could not run."})

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Allow", "POST, OPTIONS")
        self.end_headers()

    def _json(self, status: int, body: dict):
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(encoded)


def _validate_payload(payload: object) -> tuple[list[dict], list[dict], str]:
    if not isinstance(payload, dict) or not isinstance(payload.get("health"), list) or not isinstance(payload.get("checkins"), list):
        raise ValueError("health and checkins must be arrays.")
    day = str(payload.get("date", ""))
    calendar_date.fromisoformat(day)

    health = []
    for item in payload["health"]:
        if not isinstance(item, dict) or item.get("metric") not in ALLOWED_METRICS:
            raise ValueError("The request contains an invalid health record.")
        item_day = str(item.get("date", ""))
        calendar_date.fromisoformat(item_day)
        value = float(item.get("value"))
        if value < 0 or value != value or value in (float("inf"), float("-inf")):
            raise ValueError("The request contains an invalid health value.")
        health.append({"date": item_day, "metric": item["metric"], "value": value})

    checkins = []
    for item in payload["checkins"]:
        if not isinstance(item, dict):
            raise ValueError("The request contains an invalid check-in.")
        item_day = str(item.get("date", ""))
        calendar_date.fromisoformat(item_day)
        recovery_value = float(item.get("recovery"))
        if not recovery_value.is_integer() or recovery_value < 1 or recovery_value > 5:
            raise ValueError("Recovery ratings must be from 1 to 5.")
        checkins.append({"date": item_day, "recovery": int(recovery_value)})
    return health, checkins, day
