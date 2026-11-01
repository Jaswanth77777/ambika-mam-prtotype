"""Smoke and authorization tests for the JOY University bus portal."""
import os
import tempfile
import unittest

# Isolate the import-time SQLite database from developer data and CI runners.
_TEST_DB = tempfile.mktemp(prefix="joy-bus-tests-", suffix=".db")
os.environ["JOY_DB_PATH"] = _TEST_DB
os.environ.setdefault("SECRET_KEY", "test-only-secret-key-that-is-not-used-in-production")
os.environ.pop("TRACKING_API_TOKEN", None)

import app as portal  # noqa: E402


class PortalSmokeTests(unittest.TestCase):
    def setUp(self):
        portal.app.config.update(TESTING=True)
        self.client = portal.app.test_client()

    def login(self, username, password):
        return self.client.post(
            "/login",
            data={"username": username, "password": password},
            follow_redirects=False,
        )

    def test_health_endpoint_is_public_and_checks_database(self):
        response = self.client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "ok")

    def test_dashboard_requires_login(self):
        response = self.client.get("/")
        self.assertIn(response.status_code, (301, 302))
        self.assertIn("/login", response.headers["Location"])

    def test_admin_api_rejects_anonymous_requests(self):
        response = self.client.get("/api/admin/reports")
        self.assertEqual(response.status_code, 401)

    def test_student_cannot_access_admin_reports(self):
        self.assertIn(self.login("student", "Student@123").status_code, (301, 302))
        response = self.client.get("/api/admin/reports")
        self.assertEqual(response.status_code, 403)

    def test_admin_can_access_reports(self):
        self.assertIn(self.login("admin", "Admin@123").status_code, (301, 302))
        response = self.client.get("/api/admin/reports")
        self.assertEqual(response.status_code, 200)
        self.assertIn("buses", response.get_json())

    def test_admin_bus_write_requires_csrf_token(self):
        self.assertIn(self.login("admin", "Admin@123").status_code, (301, 302))
        response = self.client.post(
            "/api/buses",
            json={"bus_no": "CI-SECURITY-CHECK", "capacity": 40},
        )
        self.assertEqual(response.status_code, 403)

    def test_admin_can_create_bus_with_csrf_token(self):
        self.assertIn(self.login("admin", "Admin@123").status_code, (301, 302))
        with self.client.session_transaction() as session:
            csrf = session["csrf"]
        response = self.client.post(
            "/api/buses",
            json={"bus_no": "CI-SMOKE-01", "capacity": 40},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.get_json()["ok"])
        # Keep the shared import-time test database isolated for test_smoke.py.
        with portal.db_conn() as con:
            con.execute("DELETE FROM buses WHERE bus_no=?", ("CI-SMOKE-01",))


if __name__ == "__main__":
    unittest.main()
