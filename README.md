# JOY UNIVERSITY BUS TRACKING

A responsive Flask + SQLite development starter with an improved navy/blue dashboard, the supplied JOY University logo, an OpenStreetMap-based map, bus/route records, CSV/XLSX imports, CSV exports, role-based views, and authenticated GPS ingestion.

## Quick start (Windows)
1. Extract the ZIP completely.
2. Double-click `START_WEBSITE.bat`.
3. Allow Python through any local firewall prompt if you trust this application.
4. Open `http://127.0.0.1:5000`.

Requires Python 3 and internet access for first-run package installation and map tiles. If browser auto-open is blocked, open the URL manually. Keep the terminal window open while using the app.

## Development demo logins
- Admin: `admin` / `Admin@123`
- Driver: `driver` / `Driver@123`
- Student: `student` / `Student@123`

These are development-only accounts. Change/remove them before any real deployment. Only three roles are supported: **Admin, Student and Driver**. Transport Manager and Security accounts are not supported.

## Administrator panel — 14 options

The Admin account has a dedicated 14-item navigation: Dashboard, Students, Drivers, Buses, Routes, Stops, Trips, Live GPS, Attendance, Alerts, Reports, Maintenance, Permissions, and Settings & Logs.

Database-backed Admin screens support creating and editing student, driver, bus, route, stop, trip, attendance, maintenance, alert, announcement and settings records. Supported records can be deleted where foreign-key/history safeguards permit it. Driver accounts are created with hashed passwords; student accounts can be created with a password from Student Management. Trip scheduling checks for an existing scheduled/active trip and refuses buses marked unavailable. Maintenance reports mark the related bus under maintenance; resolving the report returns it to Active. Admin changes are written to the audit log. Only the ADMIN role can call the management APIs; driver and student navigation remains restricted.

The Reports screen provides CSV exports and database summary counts. The Alerts screen supports acknowledgement and Admin announcement publishing. Permissions is a read-only role capability summary: role boundaries are enforced by the server, not editable from the browser.

## Important data and GPS behavior
- The ten starter buses and route names are setup records, not proof of an official route assignment.
- No fake bus GPS coordinates are seeded. Buses without current GPS display `NOT CONNECTED`; the map may show a separately labelled road preview when a route has mapped stops.
- The map uses Leaflet and OpenStreetMap tiles and requires internet access. If tiles do not load, check internet/firewall access. Attribution is displayed on the map.
- External tracking devices can POST JSON to `/api/tracking/location` with header `X-Tracking-Token`. Set `TRACKING_API_TOKEN` in the server environment first. Required JSON keys: `bus_id`, `latitude`, `longitude`; optional `speed`, `heading`, `accuracy`, `timestamp` (ISO-8601), `device_id`.
- A logged-in driver assigned to a bus can use the browser's GPS share controls. Browser geolocation requires localhost or HTTPS, permission, and an assigned bus. Never present stale locations as live.
- Official service-stop coordinates and route geometry must be entered and verified by the transport office. Traffic-based ETA, SMTP email, web push, and production 3D maps are not claimed to be implemented. Verify routes/stops with the transport office before real operations.

## Imports
The import page supports category CSV and `.xlsx` files, up to 8 MB. Download the provided templates. Unique bus numbers, route IDs, and student register numbers prevent duplicate inserts; existing records are updated. Failed rows are reported in the response. The `.xlsx` importer looks for a sheet named `Buses`, `Routes`, or `Students` for the selected category; otherwise it uses the first sheet.

## Deploy the web app

### Vercel (fixes the function invocation error)

Vercel now detects Flask applications directly from the root `app.py` and `requirements.txt`; no custom function-routing file is needed. This avoids routing every request through a legacy function configuration. Pushes to `main` should trigger the connected Vercel project. In Vercel Project Settings → Environment Variables, set `SECRET_KEY` to a long random value, `INITIAL_ADMIN_PASSWORD` to a strong unique password, and `COOKIE_SECURE` to `1`. Redeploy after setting them. The Vercel `/tmp` SQLite database is temporary and can reset between function instances; use the Render persistent-disk deployment below for actual records.

### Render (persistent SQLite deployment)

Create a new Blueprint in Render and select this repository. `render.yaml` provisions a Flask/Gunicorn service with a persistent disk mounted at `/var/data`. Set the prompted `INITIAL_ADMIN_PASSWORD` and `TRACKING_API_TOKEN` values. The service stores its SQLite database on the persistent disk. The Render starter service and disk are paid resources; check current pricing before creating them.

## Local development
```bash
python -m venv .venv
# Windows: .venv\\Scripts\\activate
# macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

SQLite database `joy_bus.db` is created automatically in the project folder. Back it up before updates. The Render Blueprint stores it on its persistent disk; Vercel's `/tmp` storage is temporary. The application initializes its SQLite tables automatically, but does not include a production migration framework.

## GPS provider example
```bash
# Set these in your shell or service environment, never in frontend JavaScript.
# Windows cmd:
set SECRET_KEY=use-a-long-random-secret
set TRACKING_API_TOKEN=use-a-separate-long-random-token
python app.py
```

Example request:
```bash
curl -X POST http://127.0.0.1:5000/api/tracking/location ^
  -H "Content-Type: application/json" ^
  -H "X-Tracking-Token: YOUR_TOKEN" ^
  -d "{\"bus_id\":1,\"latitude\":8.2436,\"longitude\":77.6058,\"speed\":5,\"device_id\":\"tracker-01\"}"
```

## Production checklist
This starter is not production-certified. Before deployment: use HTTPS; set a persistent secret and secure cookies; change demo passwords; add rate limiting and CSRF coverage to all state-changing forms; deploy behind a production WSGI server; use managed PostgreSQL/MySQL and migrations; configure backups/retention/monitoring; use per-device GPS credentials and rotation; implement real email/push, file scanning, and security testing; and have the university verify routes, stop coordinates, permissions, and privacy policy.

## Role-specific navigation and map preview update

The dashboard now shows different navigation and quick actions by account role:
- **Admin:** fleet, routes, student transport, imports, alerts, reports and settings.
- **Driver:** overview, tracking, routes, alerts and browser GPS sharing for the assigned bus.
- **Student:** overview, bus tracking and route information only (read-only; no fleet management or other students' records).
Selecting a bus without live GPS shows a clearly labelled **ROAD ROUTE PREVIEW** only when at least one mapped destination stop has been configured for that route. The preview starts from the campus reference point and follows a road path returned by the routing service; it is not a live vehicle location or a verified official service route. All ten starter routes include public locality/map reference coordinates so a road preview can be drawn from the campus reference point. These are explicitly labelled as NOT verified JOY service stops. The transport office must edit them to actual pickup/drop-off locations in Stop Management before operational use. Real tracking requires device GPS or the driver's permitted location sharing. Map tiles and road previews require internet access.


## Health check and automated tests

- Hosting platforms and uptime monitors can call `GET /healthz`. It returns HTTP 200 when the Flask process can query its database and HTTP 503 when the database is unavailable.
- GitHub Actions runs on pushes and pull requests to `main`. It compiles the Flask module and runs smoke tests for health, login protection, Admin/Student authorization, and CSRF-protected bus creation.
- Run the same checks locally with `python -m unittest discover -s tests -v`.
- Copy `.env.example` to `.env` for local configuration. Keep real secrets out of Git. GPS timestamps more than five minutes old or more than one minute in the future are rejected.
