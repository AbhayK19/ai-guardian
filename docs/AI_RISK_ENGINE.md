# AI Risk Engine

## Current approach

The engine is intentionally transparent and rule-based. The simulated device sends typed telemetry through `telemetry.ingest`; the server keeps a bounded recent window, fuses multiple signals, and returns a structured assessment. The frontend renders that assessment alongside the score so a reviewer can see why the state changed.

| Score | Display level | Intended demonstration |
|---:|---|---|
| 0–29 | SAFE | Stable sensors and low movement |
| 30–59 | MONITORING | Elevated but contextually plausible activity |
| 60–79 | POSSIBLE DISTRESS | Abnormal movement or sensor deviation |
| 80–100 | HIGH RISK | Multiple abnormal signals or fall-like pattern |

These thresholds are illustrative and **not medically validated**.

## Sensor fusion

Weights and thresholds live in `server/risk-engine.ts` under `RISK_CONFIG`. The engine considers heart-rate elevation outside the running context, acceleration and gyroscope anomalies, fall state, post-impact inactivity, movement anomalies, persistence across recent readings, and sensor variance. A single high heart rate does not create a high-risk result by itself.

Fall detection is a prototype sequence: acceleration spike, orientation/movement anomaly, and reduced movement afterward. It is not a medically validated fall-detection algorithm.

## Runtime flow

1. `simulation.scenario` selects a scenario and emits coherent telemetry.
2. `telemetry.ingest` validates and analyzes each reading.
3. `sensors.current` and `sensors.history` expose the latest telemetry and risk trend.
4. Confirmed `emergency.activate` creates a simulated incident; `emergency.cancel` records a cancelled countdown.
5. Risk assessments and incidents are persisted through Drizzle when `DATABASE_URL` is configured. Without a database, a bounded in-memory store keeps local demos functional.

The current API is Node/Express/tRPC, not FastAPI. The contracts are typed so a future hardware or service implementation can replace the simulator without changing the dashboard.

## Inputs

- Heart-rate deviation from the demo baseline.
- Accelerometer magnitude and sudden impact spikes.
- Gyroscope movement.
- Fall detection state.
- Inactivity after impact.
- Selected scenario/context.
- Sensor consistency.

## Future replacement

The `risk.current` and `risk.analyze` contracts are deliberately structured around a score, level, explanation, factors, timestamp, and model name. A trained model can replace the rule engine behind that contract, but it must be independently evaluated, monitored for bias and drift, and never represented as a substitute for medical or emergency-service judgment without appropriate validation.
