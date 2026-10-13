import base64
import importlib.util
import os
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

spec = importlib.util.spec_from_file_location("snapfeed_example", Path(__file__).with_name("server.py"))
server = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = server
spec.loader.exec_module(server)

TOKEN = "test-only-runtime-token"
ORIGIN = "https://app.example.com"
EVENT = {
    "session_id": "test-session",
    "seq": 1,
    "ts": "2026-10-13T20:00:00Z",
    "event_type": "feedback",
    "detail": {"message": "private feedback"},
    "screenshot": base64.b64encode(b"fake-jpeg").decode(),
}
ENDPOINTS = [
    ("POST", "/api/telemetry/events"),
    ("GET", "/api/telemetry/events"),
    ("GET", "/api/telemetry/sessions"),
    ("GET", "/api/telemetry/events/1/screenshot"),
]


class TelemetryAuthTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db_patch = patch.object(server, "DB_PATH", str(Path(self.temp.name) / "events.db"))
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)
        self.env_patch = patch.dict(os.environ, {
            "SNAPFEED_API_TOKEN": TOKEN,
            "SNAPFEED_ALLOWED_ORIGINS": ORIGIN,
        })
        self.env_patch.start()
        self.addCleanup(self.env_patch.stop)
        self.client = self.enterContext(TestClient(server.create_app()))
        self.headers = {"Authorization": f"Bearer {TOKEN}"}
        response = self.client.post("/api/telemetry/events", headers=self.headers, json={"events": [EVENT]})
        self.assertEqual(response.status_code, 200)

    def test_all_sensitive_routes_require_credentials(self):
        for method, path in ENDPOINTS:
            for authorization in (None, "Bearer wrong", "Basic wrong", "Bearer", "Bearer \u2603"):
                with self.subTest(method=method, path=path, authorization=authorization):
                    headers = {} if authorization is None else {"Authorization": authorization}
                    # Use raw UTF-8 bytes to cover non-ASCII credentials without HTTPX's ASCII header encoder.
                    raw_headers = [(key.encode(), value.encode()) for key, value in headers.items()]
                    kwargs = {"json": {"events": [EVENT]}} if method == "POST" else {}
                    response = self.client.request(method, path, headers=raw_headers, **kwargs)
                    self.assertEqual(response.status_code, 401)
                    self.assertEqual(response.headers["www-authenticate"], "Bearer")
                    self.assertEqual(response.json(), {"detail": "Invalid or missing bearer token"})
        with closing(server.get_db()) as db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM ui_telemetry").fetchone()[0], 1)

    def test_valid_credentials_preserve_all_endpoints(self):
        events = self.client.get("/api/telemetry/events", headers=self.headers)
        self.assertEqual(events.status_code, 200)
        self.assertEqual(len(events.json()), 1)
        self.assertEqual(events.json()[0]["session_id"], EVENT["session_id"])
        sessions = self.client.get("/api/telemetry/sessions", headers=self.headers)
        self.assertEqual(sessions.status_code, 200)
        self.assertEqual(sessions.json()[0]["event_count"], 1)
        screenshot = self.client.get("/api/telemetry/events/1/screenshot", headers=self.headers)
        self.assertEqual(screenshot.status_code, 200)
        self.assertEqual(screenshot.headers["content-type"], "image/jpeg")
        self.assertEqual(screenshot.content, b"fake-jpeg")
        missing = self.client.get("/api/telemetry/events/999/screenshot", headers=self.headers)
        self.assertEqual(missing.status_code, 404)

    def test_origin_is_not_a_substitute_for_authentication(self):
        response = self.client.get("/api/telemetry/events", headers={"Origin": ORIGIN})
        self.assertEqual(response.status_code, 401)
        response = self.client.get("/api/telemetry/events", headers=self.headers)
        self.assertEqual(response.status_code, 200)

    def test_exact_cors_and_authorized_browser_ingestion(self):
        preflight = {
            "Origin": ORIGIN,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers": "Authorization,Content-Type",
        }
        allowed = self.client.options("/api/telemetry/events", headers=preflight)
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.headers["access-control-allow-origin"], ORIGIN)
        blocked = self.client.options("/api/telemetry/events", headers={
            **preflight, "Origin": "https://untrusted.example",
        })
        self.assertEqual(blocked.status_code, 400)
        self.assertNotIn("access-control-allow-origin", blocked.headers)
        accepted = self.client.post("/api/telemetry/events", headers={
            **self.headers, "Origin": ORIGIN,
        }, json={"events": [{**EVENT, "seq": 2}]})
        self.assertEqual(accepted.status_code, 200)
        self.assertEqual(accepted.json(), {"accepted": 1})
        self.assertEqual(accepted.headers["access-control-allow-origin"], ORIGIN)

    def test_health_is_public_and_does_not_disclose_db_path(self):
        response = self.client.get("/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok"})


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.db_patch = patch.object(server, "DB_PATH", str(Path(self.temp.name) / "events.db"))
        self.db_patch.start()
        self.addCleanup(self.db_patch.stop)

    def test_missing_or_blank_token_fails_startup(self):
        for token in (None, "", "  \t\n"):
            with self.subTest(token=token), patch.dict(os.environ, {"SNAPFEED_ALLOWED_ORIGINS": ""}):
                if token is None:
                    os.environ.pop("SNAPFEED_API_TOKEN", None)
                else:
                    os.environ["SNAPFEED_API_TOKEN"] = token
                with self.assertRaisesRegex(RuntimeError, "SNAPFEED_API_TOKEN"):
                    with TestClient(server.create_app()):
                        self.fail("Unconfigured server started")

    def test_cors_defaults_to_no_browser_origins(self):
        with patch.dict(os.environ, {"SNAPFEED_API_TOKEN": TOKEN, "SNAPFEED_ALLOWED_ORIGINS": ""}):
            with TestClient(server.create_app()) as client:
                response = client.options("/api/telemetry/events", headers={
                    "Origin": ORIGIN, "Access-Control-Request-Method": "POST",
                })
                self.assertEqual(response.status_code, 400)
                self.assertNotIn("access-control-allow-origin", response.headers)

    def test_invalid_origin_configuration_fails_explicitly(self):
        for origin in ("*", "null", "javascript:alert(1)", "https://app.example.com/path",
                       "https://user:pass@app.example.com", "https://app.example.com?query=1"):
            with self.subTest(origin=origin), patch.dict(os.environ, {"SNAPFEED_ALLOWED_ORIGINS": origin}):
                with self.assertRaisesRegex(ValueError, "SNAPFEED_ALLOWED_ORIGINS"):
                    server.create_app()


if __name__ == "__main__":
    unittest.main()
