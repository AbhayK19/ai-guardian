# AI Guardian

AI Guardian is a BCA project prototype for personal safety monitoring. The existing dashboard and sensor/risk workflows remain simulation-first. An opt-in, authenticated safety API supports account phone OTP verification, explicitly trusted emergency contacts, user-submitted device locations, and expiring location links.

> **Safety boundary:** This prototype is not medically validated, law-enforcement certified, or connected to emergency services. The legacy simulator still uses fictional coordinates and sends no messages. Emergency SMS is prepared in the Android phone's messaging app and requires the user to tap Send. Trusting a contact does not verify phone ownership, and composer activity is not proof of delivery.

## Features

- Dark-first responsive command center with persistent desktop navigation and mobile navigation.
- Real-time simulated heart rate, acceleration, gyroscope, movement, fall state, GPS, battery, and connection data.
- Six demonstration scenarios: Normal, Running, Sudden Impact, Fall, Possible Distress, and Emergency.
- Explainable risk engine with 0–100 scores, factors, thresholds, and safety disclaimers.
- Live monitoring charts for risk, heart rate, and acceleration.
- Emergency center with the original six-step simulated workflow and a separate intentional real-SOS control.
- Original demo contact controls plus an authenticated contact manager with separate phone-verification status and explicit trusted-contact consent.
- Fictional location view plus user-permission-based browser location reporting and a secure, expiring live-sharing page.
- Device management view with simulated connection toggle and future ESP32 integration path.
- Incident history with search and clear-demo-data controls.
- Typed tRPC backend contracts and database-ready Drizzle models.

## Stack

- React 19, TypeScript, Vite, Tailwind CSS, Lucide React, Recharts.
- Node.js, Express, tRPC, Zod.
- Drizzle ORM with a MySQL/TiDB-ready schema and a persistent local fallback for development without a database server.
- Manus WebDev runtime and authentication scaffold.

This WebDev build uses the platform's typed Node/Express/tRPC server rather than a separate Python process. The risk engine and API contracts are intentionally modular so they can be moved to FastAPI later if a standalone Python service is required.

## Run locally

```bash
pnpm install
pnpm dev
```

The WebDev runtime serves the application on the configured development port. Use the preview URL shown by the project tooling.

Useful checks:

```bash
pnpm check
pnpm test
pnpm build
pnpm drizzle-kit generate
```

## Demo mode and real-safety integrations

The simulator now sends typed telemetry through the existing tRPC API. `server/risk-engine.ts` centralizes prototype thresholds and sensor-fusion weights, maintains a bounded recent-reading window, and returns explainable risk factors. Scenarios produce coherent signals for normal activity, running, impact, fall, distress, and emergency states; exercise heart rate alone is not treated as an emergency.

The original scenario controls, old tRPC contact APIs, and six-step demonstration workflow are unchanged and are not real safety signals. Use the separate real-safety panels on Emergency Center, Emergency Contacts, Location, Incidents, and Settings to see authenticated provider/database status and use the new APIs.

Real-safety requests do not fall back to the local demo store. They require an authenticated user and the MySQL schema. MSG91 credentials and an OTP template are required only for the separate account-phone OTP flow. Emergency-contact management and SOS no longer use a server-side SMS gateway. Android opens the phone's SMS composer and requires the user to confirm sending. A configured public HTTPS origin is required for server-side tracking links. OTP challenge records contain a keyed phone hash and metadata only, never the OTP. Only the newest location per authenticated user/device is retained.

An initial Kotlin Android app is in [android/](./android/). It loads enabled trusted contacts from the authenticated backend, runs a cancellable SOS countdown, requests a real device location, and opens Android's system SMS composer with a prefilled message. The user must review and tap Send. It does not request `SEND_SMS`, does not send automatically, and does not use MSG91 for emergency SMS. The backend records the incident and phone-reported composer action, but a "user reported sent" event is not delivery confirmation. Setup and limitations are documented in [docs/ANDROID_APP.md](./docs/ANDROID_APP.md).

For a Windows checkout without `pnpm` on `PATH`, use Corepack:

```bat
corepack pnpm install
set NODE_ENV=development&& corepack pnpm exec tsx watch server/_core/index.ts
```

### Database initialization

The production-shaped database engine is MySQL/TiDB. Set `DATABASE_URL` before applying database changes:

```env
DATABASE_URL=mysql://user:password@127.0.0.1:3306/ai_guardian
```

The journal referenced a missing `0000_peaceful_the_phantom.sql`. It has been restored from the checked-in `0001_snapshot.json` baseline, which contains the `users` table and its `openId` uniqueness constraint; the next migration creates the other five tables represented in that snapshot. Drizzle now successfully loads all four journal entries. This repair restores migration tooling metadata and does not itself change a database. Back up the database before applying migrations. The migration has not yet been applied to a database in this environment.

After confirming the existing database and Drizzle migration history, back it up and apply pending checked-in migrations with `corepack pnpm exec drizzle-kit migrate`. Do not manually replay `0001`/`0002` or edit the migration ledger to bypass the restored baseline: if the migration table or existing schema does not match the expected history, stop and reconcile it before applying anything. The real-safety schema changes are [drizzle/0003_real_safety_integrations.sql](./drizzle/0003_real_safety_integrations.sql) and [drizzle/0004_emergency_contacts_updated_at.sql](./drizzle/0004_emergency_contacts_updated_at.sql). Existing simulation screens still use the local development fallback when there is no authenticated database user. Copy `.env.example` values into your environment manually; never overwrite your real `.env` file.

After migration, verify the schema read-only with MySQL:

```sql
SELECT TABLE_NAME, COLUMN_NAME
FROM information_schema.columns
WHERE table_schema = DATABASE()
  AND (
    TABLE_NAME IN (
      'phoneVerificationChallenges', 'latestLocations',
      'emergencyNotificationAttempts', 'incidentTimelineEvents',
      'liveLocationSessions'
    )
    OR (TABLE_NAME = 'userProfiles' AND COLUMN_NAME = 'phoneVerifiedAt')
    OR (TABLE_NAME = 'emergencyContacts' AND COLUMN_NAME IN ('phoneVerifiedAt', 'updatedAt'))
    OR (TABLE_NAME = 'incidents' AND COLUMN_NAME IN (
      'emergencyStatus', 'latitude', 'longitude', 'locationAccuracyMeters',
      'locationRecordedAt', 'resolvedAt'
    ))
  )
ORDER BY TABLE_NAME, ORDINAL_POSITION;
```

### MSG91 setup

Configure `MSG91_AUTH_KEY` and an approved six-digit OTP template ID in server-only environment variables only if you need the separate account-phone OTP feature. No MSG91 SMS Flow, SMS gateway, or DLT setup is required for emergency contacts or Android SOS. Set `PUBLIC_APP_URL` to the publicly reachable HTTPS application origin and `PHONE_HASH_SECRET` to a random secret of at least 32 characters. See [docs/API.md](./docs/API.md) for endpoints and security controls.

For Indian account-OTP delivery, configure the provider's applicable DLT/template settings. Emergency messages are user-confirmed from the Android phone and remain subject to the phone's SMS app, SIM, carrier, and plan.

The Android app currently captures a one-time authorized location for an SOS and sends it to the backend with the incident when online. It does not implement periodic background location streaming or offline incident synchronization. Browser GPS testing is separate: it is permission-gated and foreground-only. An SMS link itself never tracks a phone.

## Project structure

```text
client/src/pages/Home.tsx       Main application shell and feature views
client/src/index.css            Visual system and responsive layout
server/routers.ts               Typed API contracts and transparent risk engine
server/db.ts                    Database connection helpers
 drizzle/schema.ts              User, device, telemetry, contact, incident, location models
docs/                           Architecture, API, hardware, and risk documentation
```

## Demo walkthrough

1. Start on the SAFE dashboard.
2. Select **Fall** or **Emergency** in the simulation panel.
3. Confirm that sensor values, the risk score, explanation, and charts change.
4. Open **Emergency center** and activate the simulated workflow.
5. Let the autonomous workflow capture location, prepare notification, and record the incident.
6. Review the new record in **Incidents**.
7. Add or disable a contact in **Emergency contacts**.
8. Use **Device** to toggle the simulated connection.

## Environment

The WebDev scaffold provides the database and authentication environment variables. Do not commit `.env` files or real personal information. The frontend does not require an external API key for the simulation experience.

## Limitations and next steps

Physical ESP32/GPS/MPU6050/heart-rate hardware is not connected. Real integrations should add authenticated telemetry ingestion, device identity, rate limiting, encrypted transport, consent and privacy controls, reliable notification providers, and an independent safety validation process before any real-world use.
