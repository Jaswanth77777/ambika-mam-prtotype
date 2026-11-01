# CampusRide — College Student Bus Tracking System

A simple responsive front-end demo for a college transport portal.

## Run locally
Open `index.html` in a modern browser. No build step is required.

## Demo sign-in
- Admin: `admin` / `admin123`
- Student: `student` / `student123`
- Driver: `driver` / `driver123`

## Features
- Role-based demo login screens (admin, student and driver)
- Student overview with active buses, routes and departure times
- Bus list and route schedule
- Admin can add and remove buses
- Driver can share this browser's GPS location using the Geolocation API
- Responsive desktop and mobile layout
- Bus data is saved in the browser's localStorage

## Important demo limitations
This is a front-end academic prototype. Login credentials are demo-only, and browser localStorage is not a secure database. GPS is displayed only in the current browser session; it is **not** transmitted to students on other devices. For a real deployment, add a secure backend (for example Flask/Node), hashed passwords, role-based server authorization, a database, and authenticated real-time location updates (WebSocket/Firebase). Use HTTPS for GPS access.

## Deploy
The root `index.html` can be deployed as a static site on Vercel. Import this GitHub repository and use the project root with no build command.
