"""Smoke and authorization tests for the JOY University bus portal."""
import os
import tempfile
import unittest
from io import BytesIO

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

    def test_student_portal_is_limited_to_assigned_transport(self):
        self.assertIn(self.login("student", "Student@123").status_code, (301, 302))
        profile = self.client.get("/api/student/me")
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.get_json()["student"]["register_no"], "student")
        buses = self.client.get("/api/buses")
        self.assertEqual(buses.status_code, 200)
        self.assertEqual(len(buses.get_json()), 1)
        self.assertEqual(self.client.get("/api/overview").status_code, 403)

    def test_driver_portal_exposes_only_assigned_bus_and_trips(self):
        self.assertIn(self.login("driver", "Driver@123").status_code, (301, 302))
        profile = self.client.get("/api/driver/me")
        self.assertEqual(profile.status_code, 200)
        self.assertEqual(profile.get_json()["bus"]["bus_no"], "JOY-01")
        self.assertGreaterEqual(len(profile.get_json()["trips"]), 1)
        self.assertEqual(len(self.client.get("/api/buses").get_json()), 1)
        self.assertEqual(self.client.get("/api/admin/reports").status_code, 403)

    def test_student_cannot_read_another_buses_gps_history(self):
        self.assertIn(self.login("student", "Student@123").status_code, (301, 302))
        response = self.client.get("/api/tracking/buses/2/history")
        self.assertEqual(response.status_code, 404)

    def test_driver_cannot_read_another_buses_gps_history(self):
        self.assertIn(self.login("driver", "Driver@123").status_code, (301, 302))
        response = self.client.get("/api/tracking/buses/2/history")
        self.assertEqual(response.status_code, 404)

    def test_student_excel_import_creates_login_and_add_only_skips_existing(self):
        self.assertIn(self.login("admin", "Admin@123").status_code, (301, 302))
        with self.client.session_transaction() as session:
            csrf = session["csrf"]
        csv_data = (
            "Student Name,Register Number,Department,Academic Year,Phone Number,"
            "Assigned Bus Number,Assigned Route,Assigned Bus Stop,Initial Password\n"
            "Imported Student,TEST-LOGIN-01,Science,2026-27,9000000000,JOY-01,R01,,Student@1234\n"
        )
        response = self.client.post(
            "/api/import/students",
            data={"file": (BytesIO(csv_data.encode("utf-8")), "students.csv"), "mode": "upsert"},
            headers={"X-CSRF-Token": csrf},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["imported"], 1, response.get_json())
        with portal.db_conn() as con:
            account = con.execute("SELECT role FROM users WHERE username='test-login-01'").fetchone()
            student = con.execute("SELECT name FROM students WHERE register_no='TEST-LOGIN-01'").fetchone()
        self.assertEqual(account["role"], "STUDENT")
        self.assertEqual(student["name"], "Imported Student")
        self.assertIn(self.login("test-login-01", "Student@1234").status_code, (301, 302))
        self.assertEqual(self.client.get("/api/student/me").get_json()["student"]["register_no"], "TEST-LOGIN-01")
        self.client.post("/logout")
        self.assertIn(self.login("admin", "Admin@123").status_code, (301, 302))
        with self.client.session_transaction() as session:
            csrf = session["csrf"]
        duplicate = csv_data.replace("Imported Student", "Changed Name").replace("Student@1234", "Another@1234")
        response = self.client.post(
            "/api/import/students",
            data={"file": (BytesIO(duplicate.encode("utf-8")), "students.csv"), "mode": "add_only"},
            headers={"X-CSRF-Token": csrf},
            content_type="multipart/form-data",
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["updated_or_existing"], 1)
        with portal.db_conn() as con:
            student = con.execute("SELECT name FROM students WHERE register_no='TEST-LOGIN-01'").fetchone()
        self.assertEqual(student["name"], "Imported Student")

    def test_driver_can_start_and_complete_assigned_trip(self):
        self.assertIn(self.login("driver", "Driver@123").status_code, (301, 302))
        trip_id = self.client.get("/api/driver/me").get_json()["trips"][0]["id"]
        with self.client.session_transaction() as session:
            csrf = session["csrf"]
        started = self.client.post(
            f"/api/driver/trips/{trip_id}",
            json={"status": "In progress"},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(started.status_code, 200)
        completed = self.client.post(
            f"/api/driver/trips/{trip_id}",
            json={"status": "Completed"},
            headers={"X-CSRF-Token": csrf},
        )
        self.assertEqual(completed.status_code, 200)
        self.assertEqual(completed.get_json()["status"], "Completed")

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
