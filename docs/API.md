# AI Guardian API

The current WebDev runtime exposes typed tRPC procedures under the standard server gateway. The conceptual REST equivalents are listed below for a future FastAPI or device-facing adapter.

| Procedure / future route                                | Purpose                            |
| ------------------------------------------------------- | ---------------------------------- |
| `health` / `GET /api/health`                            | Runtime status and simulation mode |
| `device` / `GET /api/device`                            | Current device metadata            |
| `sensors.current` / `GET /api/sensors/current`          | Current simulated telemetry        |
| `sensors.history` / `GET /api/sensors/history`          | Rolling sensor/risk history        |
| `simulation.scenario` / `POST /api/simulation/scenario` | Select a demo scenario             |
| `risk.current` / `GET /api/risk/current`                | Current risk score and factors     |
| `risk.analyze` / `POST /api/risk/analyze`               | Analyze validated sensor inputs    |
| `incidents.list` / `GET /api/incidents`                 | Read incident records              |
| `incidents.create` / `POST /api/incidents`              | Create an incident record          |
| `contacts.list` / `GET /api/contacts`                   | Read emergency contacts            |
| `contacts.create` / `POST /api/contacts`                | Add a validated contact            |
| `emergency.activate` / `POST /api/emergency/activate`   | Start a simulated workflow         |
| `emergency.cancel` / `POST /api/emergency/cancel`       | Cancel a simulated workflow        |
| `telemetry` / `POST /api/device/telemetry`              | Future ESP32 telemetry ingestion   |

## Telemetry shape

```json
{
  "deviceId": "AG-001",
  "timestamp": "2026-09-16T10:30:00Z",
  "heartRate": 112,
  "accelX": 2.4,
  "accelY": 1.2,
  "accelZ": 3.8,
  "gyroX": 0.4,
  "gyroY": 1.1,
  "gyroZ": 0.2,
  "latitude": 16.7049,
  "longitude": 74.2433,
  "battery": 82
}
```

The procedures above remain demonstration APIs; do not treat their contact list, coordinates, or SOS status as real. When a signed-in user is available, database-backed contact procedures are scoped to that authenticated user ID; unauthenticated demonstration requests use only the local demo store and never read or write shared database contacts. The authenticated REST endpoints below are separate and operate only with a configured MySQL database and OAuth session. OTP and server-side message routes additionally require MSG91; the Android phone-composer routes do not. They never silently fall back to demo data.

## Authenticated real-safety routes

All routes except the token-scoped tracking endpoint require the existing OAuth session cookie (or the existing preview bearer session). Requests are scoped to the authenticated database user.

| Method and route                                | Purpose                                                                                                                                                                                                                                 |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/otp/send`                       | Request a real account-phone OTP. Body: `{ "phone": "+919876543210", "purpose": "account" }`. A contact-purpose request returns 410; contact trust is not phone verification. MSG91 acceptance does not confirm handset delivery.         |
| `POST /api/auth/otp/verify`                     | Verify an account-phone `{ "challengeId", "phone", "otp", "purpose": "account" }` with MSG91. Only provider confirmation records account phone verification.                                                                            |
| `GET /api/safety/status`                        | Actual account phone verification, OTP provider configuration, trusted and verified contact counts, latest device location, and active SOS/sharing status.                                                                             |
| `GET /api/safety/contacts`                      | List the signed-in user's persisted contacts.                                                                                                                                                                                           |
| `POST /api/safety/contacts`                     | Create a contact without asserting phone verification. Body includes name, relationship, E.164 phone, priority `1`-`3`, and `enabled`; `enabled: true` is explicit trusted-contact consent. `phoneVerifiedAt` remains null.               |
| `PATCH /api/safety/contacts/:id`                | Edit a contact, priority, or trusted/enabled flag. Changing a phone clears `phoneVerifiedAt` and disables SOS trust until the user re-enables it.                                                                                        |
| `DELETE /api/safety/contacts/:id`               | Delete an owned contact.                                                                                                                                                                                                                |
| `POST /api/safety/location`                     | Upload a real device fix `{ "deviceId", "latitude", "longitude", "accuracyMeters", "recordedAt" }` from an authenticated, permission-authorized client. Only the latest fix per device is retained.                                     |
| `POST /api/safety/sos`                          | Record a website-triggered incident/location share; sends no SMS. Optional body: `{ "trigger": "SOS", "location": { ...location fields } }`. The response explicitly says to use the Android app for phone-composer SMS.                                           |
| `POST /api/safety/android-sos`                  | Create an Android-originated incident without sending SMS on the server. Body: `{ "trigger": "SOS" \| "FALL" \| "MANUAL_HELP", "contactId": 123, "location": { ...location fields } }`; contact must be explicitly trusted/enabled, not phone-verified. |
| `POST /api/safety/incidents/:id/android-sms-status` | Record `composer_opened`, `user_reported_sent`, `user_reported_cancelled`, or `composer_unavailable` from the Android client. A user report is not provider/carrier delivery confirmation. |
| `GET /api/safety/incidents`                     | Read only the signed-in user's incidents, notification attempt statuses, provider IDs, and timeline.                                                                                                                                    |
| `POST /api/safety/incidents/:id/resolve`        | Resolve an active incident and revoke its live-location links.                                                                                                                                                                          |
| `POST /api/safety/incidents/:id/sharing/revoke` | Revoke active tracking links without resolving the incident.                                                                                                                                                                            |
| `POST /api/safety/notifications/:id/retry`      | Returns 410. Server-side emergency SMS and paid-gateway retries are disabled; historic attempt records are retained for audit.                                                                                                             |
| `GET /api/safety/share/:token`                  | Public, expiring bearer-link read of the incident status and latest location only. The token is 256-bit random; only its SHA-256 hash is stored.                                                                                        |

OTP request limits are five requests per account/number and ten per account per hour, with a configurable resend cooldown; verification is limited to five attempts and each challenge expires after the configured provider OTP expiry. Plaintext OTPs are not stored. Phone hashes use `PHONE_HASH_SECRET` (or a sufficiently long `JWT_SECRET`). Old OTP metadata is purged after 24 hours. The existing OAuth provider remains the account login authority; OTP verifies and associates a phone number, it does not replace OAuth login.

MSG91 account-OTP references: [SendOTP](https://docs.msg91.com/otp/sendotp) and [Verify OTP](https://docs.msg91.com/otp/verify-otp). These provider references define the request authentication and API payloads used by the retained account-phone adapter. Emergency SMS does not use an SMS Flow or server-side gateway.

## Location and sharing behavior

The web client only obtains location after a user action and a browser permission grant. While an active emergency remains open, it uploads fixes on the `LOCATION_UPDATE_INTERVAL_SECONDS` interval (15–300 seconds, default 30) only after a successful foreground location request; browser background execution is not guaranteed. The Android app obtains one fresh device location for SOS when authorized and uploads it with the incident when online. It does not implement periodic/background location collection or offline synchronization. Only the latest location per account is retained. SMS link access cannot locate a device by itself.

Live links expire after `LIVE_LOCATION_EXPIRY_MINUTES` (5–1440, default 60), return `no-store` and `X-Robots-Tag: noindex`, and become unavailable when revoked, expired, or resolved. They are bearer links: anyone a recipient forwards the URL to can view the location until it expires or is revoked. The public page refreshes every ten seconds and labels stale fixes as last reported. Accuracy and GPS timestamps come from the device request; the backend cannot independently attest GPS authenticity.

## Real integration smoke tests

1. Configure the required values in the local, server-only `.env` file; do not paste provider keys, OTPs, or share tokens into chat or commit them. Start MySQL, apply pending migrations only after checking the existing migration ledger and taking a backup, then start the app and sign in.
2. Account-phone OTP remains a separate MSG91 flow. Contact management no longer requests contact OTP or claims phone verification. Do not request a real account OTP in automated tests; for a live account-phone test, use your own phone only and confirm first.
3. For emergency SMS, add the number on the website and explicitly mark it trusted. This consent does not verify the number. Use the Android app to create the incident and inspect the prefilled native SMS composer. Nothing is sent until the user taps Send; composer opening or a user report is not delivery confirmation. Confirm receipt directly with a consenting recipient.
4. For browser location, open the authenticated dashboard in a supported browser on a secure origin, explicitly allow location access, and request a fix while the page is active. Inspect the displayed coordinates, accuracy, and device timestamp; values must come from the browser's actual GPS result. Exercise live sharing only during an intentional active SOS, using the link delivered to a consenting contact; resolve the incident or revoke sharing to shut it down.
5. Android SOS testing requires a compatible Android phone, a trusted consenting contact, location permission if coordinates are desired, an SMS-capable app, and a functioning SIM/carrier plan. The app opens a prefilled system composer and never sends automatically. Do not treat a user's report that they tapped Send as proof of delivery; confirm receipt with the consenting recipient. No live Android/SIM/location/SMS test has been performed.
