# AI Guardian real platform architecture

This repository currently contains a simulation-first dashboard and backend. The code is production-shaped, but it is not yet a fully trusted real-world safety platform. The project should be treated as a Phase 1 prototype with a migration path to a real mobile, watch, backend, and database deployment.

## Current state

- Frontend: React + TypeScript + Vite + Tailwind in the existing dashboard.
- Backend: Express + tRPC in the Node server.
- Database: Drizzle schema for MySQL/TiDB, with a local database fallback.
- Authentication: OAuth scaffolding is present but not configured in the current environment.
- Safety workflow: Emergency actions are simulated and explicitly identified as a demo.

## Source of truth in this repo

- Frontend shell: [client/src/pages/Home.tsx](../client/src/pages/Home.tsx)
- API router: [server/routers.ts](../server/routers.ts)
- MySQL schema: [drizzle/schema.ts](../drizzle/schema.ts)
- Server entry: [server/\_core/index.ts](../server/_core/index.ts)
- Environment config: [.env](../.env)
- Project description: [README.md](../README.md)

## Target architecture

```text
WATCH
  ↓
MOBILE APP (Android / Kotlin / Jetpack Compose)
  ↓
BACKEND API (Express + tRPC + REST adapter)
  ↓
MYSQL + AI ANALYSIS SERVICE
  ↓
WEB DASHBOARD
```

## Phase plan

1. Fix backend connectivity and route exposure.
2. Replace placeholder auth with real provider-backed authentication.
3. Move from demo data to persisted MySQL-backed device, contact, location, and incident records.
4. Implement real emergency workflows with audit-trail events and permission-based location capture.
5. Add Android and Wear OS clients that communicate with the backend over authenticated APIs and/or WebSockets.
6. Add offline queue synchronization and FCM/notification infrastructure.
7. Add real-time dashboard updates with WebSocket or SSE events.
8. Validate end-to-end flows for registration, SOS, fallback detection, cancellation, and resolution.

## Safety restrictions

- No medical claims should be made.
- No real SMS, call, or emergency services should be described as connected unless they are configured and verified.
- No fake success states should be shown when a provider or device is unavailable.

## Required env vars

- DATABASE_URL
- JWT_SECRET
- OAUTH_SERVER_URL
- OWNER_OPEN_ID
- BUILT_IN_FORGE_API_URL
- BUILT_IN_FORGE_API_KEY

## Required permissions

- Android: ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, POST_NOTIFICATIONS, BODY_SENSORS, FOREGROUND_SERVICE, RECEIVE_BOOT_COMPLETED, WAKE_LOCK.
- Wear OS: phone connectivity, notification permission, motion sensors only when exposed by the device.

## Notes

This document serves as the migration baseline; the existing dashboard and simulation flows remain available alongside clearly separate real-safety panels.

## Real-safety API addition

The demo APIs above remain simulation-only. The repository also has authenticated Express routes for account-phone MSG91 verification, per-user trusted emergency contacts, SOS incident recording, latest device locations, incident timelines, and expiring tracking links. Contact trust is distinct from phone verification. Database changes are in `drizzle/0003_real_safety_integrations.sql`; API and environment details are in [API.md](./API.md).

The browser dashboard can capture a location only after a user gesture grants browser location permission, and uploads only while its page is active. The Kotlin Android app in `android/` requests location permission for a one-time SOS fix and uploads that fix with an incident when online; it opens the system SMS composer for explicit user confirmation. Periodic/background Android location updates, a foreground service, and offline incident synchronization are not implemented. Do not present browser simulation or the one-time Android SOS fix as continuous tracking.

MSG91 is used only for the separate account-phone OTP feature. Emergency SMS is not sent by the server: the Android app opens the phone's messaging composer and requires the user to confirm sending. A composer-opened or user-reported send status is not delivery confirmation. The website's SOS route records the incident and optional location share but explicitly does not send SMS.
